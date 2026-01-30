// --- Blockchain Types ---

export interface ContractDeployment {
  txHash: string;
  contractAddress: string;
  deployer: string;
  blockNumber: bigint;
  timestamp: number;
  bytecodeSize: number;
}

export interface ContractSource {
  contractAddress: string;
  contractName: string;
  compilerVersion: string;
  sourceCode: string;
  abi: string;
  constructorArguments: string;
  optimizationUsed: boolean;
  runs: number;
  evmVersion: string;
  library: string;
  licenseType: string;
  isProxy: boolean;
  implementationAddress?: string;
}

// --- Analysis Types ---

export type VulnerabilityCategory =
  | 'reentrancy'
  | 'integer-overflow'
  | 'unchecked-call'
  | 'access-control'
  | 'front-running'
  | 'proxy-vulnerability'
  | 'flash-loan'
  | 'tx-origin'
  | 'delegatecall'
  | 'self-destruct'
  | 'timestamp-dependency'
  | 'gas-limit'
  | 'denial-of-service'
  | 'other';

export interface SolidityFinding {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  line: number;
  description: string;
  suggestion: string;
  cweId?: string;
  confidence: number;
  category: VulnerabilityCategory;
}

export interface AuditReport {
  id: string;
  contractAddress: string;
  contractName: string;
  deploymentTxHash: string;
  deployer: string;
  blockNumber: bigint;
  deployedAt: number;
  auditedAt: number;
  sourceAvailable: boolean;
  findings: SolidityFinding[];
  summary: string;
  overallRisk: 'critical' | 'high' | 'medium' | 'low' | 'none';
  analysisTimeMs: number;
  compilerVersion?: string;
  sourceCodeHash?: string;
}

// --- Monitor Types ---

export interface MonitorState {
  lastProcessedBlock: bigint;
  isRunning: boolean;
  contractsFound: number;
  contractsAudited: number;
  contractsSkipped: number;
  startedAt: number;
}

// --- API Types ---

export interface AuditListQuery {
  page?: number;
  limit?: number;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  sortBy?: 'deployedAt' | 'auditedAt' | 'overallRisk';
  order?: 'asc' | 'desc';
}

export interface DashboardStats {
  totalContracts: number;
  totalAudited: number;
  totalSkipped: number;
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  lowFindings: number;
  monitorState: MonitorState;
}

// --- Config Types ---

export interface AppConfig {
  baseRpcUrl: string;
  basescanApiKey: string;
  ollamaUrl: string;
  ollamaModel: string;
  groqApiKey?: string;
  groqModel?: string;
  port: number;
  pollIntervalMs: number;
  maxConcurrentAnalyses: number;
  confidenceThreshold: number;
  startBlock?: bigint;
  dataDir: string;
}
