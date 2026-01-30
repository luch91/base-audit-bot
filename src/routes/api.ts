import { Router } from 'express';
import { getMonitorState, startMonitor, stopMonitor } from '../services/monitor';
import { getAuditById, getAuditByAddress, listAudits, getStats, saveAudit } from '../services/storage';
import { getContractSource } from '../services/basescan';
import { analyzeContract } from '../services/analyzer';
import { AppConfig } from '../types';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export function createApiRouter(config: AppConfig): Router {
  const router = Router();

  // BigInt serializer for JSON responses
  function serializeBigInt(obj: unknown): unknown {
    return JSON.parse(JSON.stringify(obj, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  }

  // Health check
  router.get('/health', (_req, res) => {
    const state = getMonitorState();
    res.json({
      status: 'ok',
      monitor: state.isRunning ? 'running' : 'stopped',
      lastBlock: state.lastProcessedBlock.toString(),
      uptime: state.startedAt ? Date.now() - state.startedAt : 0,
    });
  });

  // Dashboard statistics
  router.get('/stats', (_req, res) => {
    const stats = getStats();
    res.json(serializeBigInt(stats));
  });

  // List audits (paginated)
  router.get('/audits', (req, res) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const severity = req.query.severity as string | undefined;
    const sortBy = req.query.sortBy as string || 'auditedAt';
    const order = req.query.order as string || 'desc';

    const result = listAudits({ page, limit, severity, sortBy, order });
    res.json({
      audits: serializeBigInt(result.audits),
      total: result.total,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    });
  });

  // Get single audit by ID
  router.get('/audits/:id', (req, res) => {
    const audit = getAuditById(req.params.id);
    if (!audit) {
      res.status(404).json({ error: 'Audit not found' });
      return;
    }
    res.json(serializeBigInt(audit));
  });

  // Get audit by contract address
  router.get('/audits/address/:addr', (req, res) => {
    const audit = getAuditByAddress(req.params.addr);
    if (!audit) {
      res.status(404).json({ error: 'No audit found for this address' });
      return;
    }
    res.json(serializeBigInt(audit));
  });

  // Monitor state
  router.get('/monitor/state', (_req, res) => {
    res.json(serializeBigInt(getMonitorState()));
  });

  // Start monitor
  router.post('/monitor/start', (_req, res) => {
    const state = getMonitorState();
    if (state.isRunning) {
      res.json({ message: 'Monitor is already running' });
      return;
    }
    startMonitor(config).catch(console.error);
    res.json({ message: 'Monitor started' });
  });

  // Stop monitor
  router.post('/monitor/stop', async (_req, res) => {
    await stopMonitor();
    res.json({ message: 'Monitor stop requested' });
  });

  // On-demand audit: audit any contract by address
  router.post('/audit', async (req, res) => {
    const { address } = req.body;

    if (!address || typeof address !== 'string') {
      res.status(400).json({ error: 'Missing or invalid "address" in request body' });
      return;
    }

    // Validate address format
    const addrClean = address.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/i.test(addrClean)) {
      res.status(400).json({ error: 'Invalid Ethereum address format' });
      return;
    }

    // Check if already audited
    const existing = getAuditByAddress(addrClean);
    if (existing && existing.sourceAvailable) {
      res.json({
        status: 'cached',
        message: 'Contract was previously audited',
        audit: serializeBigInt(existing)
      });
      return;
    }

    // Fetch source from Basescan
    console.log(`[On-demand] Fetching source for ${addrClean}...`);
    const source = await getContractSource(addrClean, config.basescanApiKey);

    if (!source) {
      res.status(404).json({
        error: 'Source code not verified on Basescan',
        address: addrClean,
        suggestion: 'Verify the contract source code on basescan.org first'
      });
      return;
    }

    // Analyze with Ollama
    console.log(`[On-demand] Analyzing ${source.contractName}...`);
    const startTime = Date.now();

    try {
      const findings = await analyzeContract(source, config);
      const analysisTimeMs = Date.now() - startTime;

      // Determine risk level
      let overallRisk: 'critical' | 'high' | 'medium' | 'low' | 'none' = 'none';
      if (findings.some(f => f.severity === 'critical')) overallRisk = 'critical';
      else if (findings.some(f => f.severity === 'high')) overallRisk = 'high';
      else if (findings.some(f => f.severity === 'medium')) overallRisk = 'medium';
      else if (findings.some(f => f.severity === 'low')) overallRisk = 'low';

      // Generate summary
      let summary = `No security issues found in ${source.contractName}.`;
      if (findings.length > 0) {
        const counts = {
          critical: findings.filter(f => f.severity === 'critical').length,
          high: findings.filter(f => f.severity === 'high').length,
          medium: findings.filter(f => f.severity === 'medium').length,
          low: findings.filter(f => f.severity === 'low').length,
        };
        const parts = [];
        if (counts.critical > 0) parts.push(`${counts.critical} critical`);
        if (counts.high > 0) parts.push(`${counts.high} high`);
        if (counts.medium > 0) parts.push(`${counts.medium} medium`);
        if (counts.low > 0) parts.push(`${counts.low} low`);
        summary = `Found ${findings.length} issue(s) in ${source.contractName}: ${parts.join(', ')}`;
      }

      const sourceHash = crypto.createHash('sha256').update(source.sourceCode).digest('hex');

      const audit = {
        id: uuidv4(),
        contractAddress: addrClean,
        contractName: source.contractName,
        deploymentTxHash: 'on-demand',
        deployer: 'unknown',
        blockNumber: 0n,
        deployedAt: 0,
        auditedAt: Date.now(),
        sourceAvailable: true,
        findings,
        summary,
        overallRisk,
        analysisTimeMs,
        compilerVersion: source.compilerVersion,
        sourceCodeHash: sourceHash,
      };

      // Save to storage
      await saveAudit(audit, config.dataDir);

      console.log(`[On-demand] Audit complete: ${source.contractName} — ${findings.length} findings, risk: ${overallRisk}`);

      res.json({
        status: 'success',
        message: `Audit complete for ${source.contractName}`,
        audit: serializeBigInt(audit)
      });
    } catch (err) {
      console.error(`[On-demand] Analysis error:`, err);
      res.status(500).json({
        error: 'Analysis failed',
        details: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });

  return router;
}
