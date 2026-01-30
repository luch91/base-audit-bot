import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { ContractDeployment, MonitorState, AppConfig } from '../types';
import { getContractSource } from './basescan';
import { analyzeContract } from './analyzer';
import { saveAudit, getAuditByAddress } from './storage';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

let monitorState: MonitorState = {
  lastProcessedBlock: 0n,
  isRunning: false,
  contractsFound: 0,
  contractsAudited: 0,
  contractsSkipped: 0,
  startedAt: 0,
};

let stopRequested = false;

export function getMonitorState(): MonitorState {
  return { ...monitorState };
}

export async function startMonitor(config: AppConfig): Promise<void> {
  if (monitorState.isRunning) {
    console.log('Monitor is already running');
    return;
  }

  const client = createPublicClient({
    chain: base,
    transport: http(config.baseRpcUrl),
  });

  stopRequested = false;
  monitorState.isRunning = true;
  monitorState.startedAt = Date.now();

  // Determine starting block
  if (config.startBlock) {
    monitorState.lastProcessedBlock = config.startBlock;
  } else if (monitorState.lastProcessedBlock === 0n) {
    monitorState.lastProcessedBlock = await client.getBlockNumber();
    console.log(`Starting from current block: ${monitorState.lastProcessedBlock}`);
  }

  console.log(`Monitor started. Polling every ${config.pollIntervalMs}ms`);

  // Processing queue for audit pipeline
  const auditQueue: ContractDeployment[] = [];
  let processingAudits = 0;

  // Start audit processor
  const processAudits = async () => {
    while (!stopRequested || auditQueue.length > 0) {
      if (auditQueue.length === 0 || processingAudits >= config.maxConcurrentAnalyses) {
        await sleep(1000);
        continue;
      }

      const deployment = auditQueue.shift();
      if (!deployment) continue;

      processingAudits++;
      processContract(deployment, config)
        .catch(err => console.error(`Error processing ${deployment.contractAddress}:`, err))
        .finally(() => { processingAudits--; });
    }
  };

  // Run audit processor in background
  processAudits();

  // Main polling loop
  while (!stopRequested) {
    try {
      const currentBlock = await client.getBlockNumber();

      if (currentBlock > monitorState.lastProcessedBlock) {
        const fromBlock = monitorState.lastProcessedBlock + 1n;
        const toBlock = currentBlock;
        const blocksToProcess = Number(toBlock - fromBlock) + 1;

        if (blocksToProcess > 0) {
          console.log(`Processing blocks ${fromBlock} to ${toBlock} (${blocksToProcess} blocks)`);
        }

        for (let blockNum = fromBlock; blockNum <= toBlock && !stopRequested; blockNum++) {
          try {
            const block = await client.getBlock({
              blockNumber: blockNum,
              includeTransactions: true,
            });

            for (const tx of block.transactions) {
              // Contract deployment: tx.to is null
              if (tx.to === null || tx.to === undefined) {
                try {
                  const receipt = await client.getTransactionReceipt({ hash: tx.hash });

                  if (receipt.contractAddress) {
                    const deployment: ContractDeployment = {
                      txHash: tx.hash,
                      contractAddress: receipt.contractAddress,
                      deployer: tx.from,
                      blockNumber: blockNum,
                      timestamp: Number(block.timestamp),
                      bytecodeSize: 0,
                    };

                    // Try to get bytecode size
                    try {
                      const bytecode = await client.getCode({ address: receipt.contractAddress });
                      deployment.bytecodeSize = bytecode ? bytecode.length / 2 - 1 : 0;
                    } catch {
                      // Non-critical, skip
                    }

                    monitorState.contractsFound++;
                    console.log(
                      `[Block ${blockNum}] New contract: ${receipt.contractAddress} ` +
                      `(deployer: ${tx.from.slice(0, 10)}..., tx: ${tx.hash.slice(0, 10)}...)`
                    );

                    auditQueue.push(deployment);
                  }
                } catch (err) {
                  console.error(`Error getting receipt for tx ${tx.hash}:`, err);
                }
              }
            }
          } catch (err) {
            console.error(`Error processing block ${blockNum}:`, err);
          }
        }

        monitorState.lastProcessedBlock = toBlock;
      }
    } catch (err) {
      console.error('Error in monitor loop:', err);
    }

    await sleep(config.pollIntervalMs);
  }

  monitorState.isRunning = false;
  console.log('Monitor stopped');
}

export async function stopMonitor(): Promise<void> {
  stopRequested = true;
  console.log('Stop requested, finishing current work...');
}

async function processContract(deployment: ContractDeployment, config: AppConfig): Promise<void> {
  // Wait before checking Basescan (give time for source verification)
  await sleep(30000);

  // Check if already audited
  const existing = getAuditByAddress(deployment.contractAddress);
  if (existing) {
    console.log(`Already audited: ${deployment.contractAddress}`);
    return;
  }

  // Fetch source code from Basescan
  const source = await getContractSource(deployment.contractAddress, config.basescanApiKey);

  if (!source) {
    // No verified source — save minimal report
    monitorState.contractsSkipped++;
    console.log(`No verified source for ${deployment.contractAddress} — skipped`);

    await saveAudit({
      id: uuidv4(),
      contractAddress: deployment.contractAddress,
      contractName: 'Unknown',
      deploymentTxHash: deployment.txHash,
      deployer: deployment.deployer,
      blockNumber: deployment.blockNumber,
      deployedAt: deployment.timestamp,
      auditedAt: Date.now(),
      sourceAvailable: false,
      findings: [],
      summary: 'Source code not verified on Basescan. Unable to audit.',
      overallRisk: 'none',
      analysisTimeMs: 0,
    }, config.dataDir);

    return;
  }

  // Analyze with Ollama
  console.log(`Analyzing ${source.contractName} (${deployment.contractAddress})...`);
  const startTime = Date.now();

  try {
    const findings = await analyzeContract(source, config);
    const analysisTimeMs = Date.now() - startTime;

    const overallRisk = determineOverallRisk(findings);
    const summary = generateSummary(findings, source.contractName);

    const sourceHash = crypto.createHash('sha256').update(source.sourceCode).digest('hex');

    await saveAudit({
      id: uuidv4(),
      contractAddress: deployment.contractAddress,
      contractName: source.contractName,
      deploymentTxHash: deployment.txHash,
      deployer: deployment.deployer,
      blockNumber: deployment.blockNumber,
      deployedAt: deployment.timestamp,
      auditedAt: Date.now(),
      sourceAvailable: true,
      findings,
      summary,
      overallRisk,
      analysisTimeMs,
      compilerVersion: source.compilerVersion,
      sourceCodeHash: sourceHash,
    }, config.dataDir);

    monitorState.contractsAudited++;
    console.log(
      `Audit complete: ${source.contractName} — ${findings.length} findings, ` +
      `risk: ${overallRisk}, time: ${analysisTimeMs}ms`
    );
  } catch (err) {
    console.error(`Error analyzing ${deployment.contractAddress}:`, err);
  }
}

function determineOverallRisk(findings: { severity: string }[]): 'critical' | 'high' | 'medium' | 'low' | 'none' {
  if (findings.some(f => f.severity === 'critical')) return 'critical';
  if (findings.some(f => f.severity === 'high')) return 'high';
  if (findings.some(f => f.severity === 'medium')) return 'medium';
  if (findings.some(f => f.severity === 'low')) return 'low';
  return 'none';
}

function generateSummary(findings: { severity: string }[], contractName: string): string {
  if (findings.length === 0) {
    return `No security issues found in ${contractName}.`;
  }

  const critical = findings.filter(f => f.severity === 'critical').length;
  const high = findings.filter(f => f.severity === 'high').length;
  const medium = findings.filter(f => f.severity === 'medium').length;
  const low = findings.filter(f => f.severity === 'low').length;

  const parts = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (high > 0) parts.push(`${high} high`);
  if (medium > 0) parts.push(`${medium} medium`);
  if (low > 0) parts.push(`${low} low`);

  return `Found ${findings.length} issue(s) in ${contractName}: ${parts.join(', ')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
