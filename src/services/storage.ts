import fs from 'fs/promises';
import path from 'path';
import { AuditReport, DashboardStats } from '../types';
import { getMonitorState } from './monitor';

// In-memory indexes
const auditsById: Map<string, AuditReport> = new Map();
const auditsByAddress: Map<string, AuditReport> = new Map();

// BigInt JSON serialization
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { __bigint: value.toString() };
  }
  return value;
}

function bigIntReviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__bigint' in (value as Record<string, unknown>)) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}

export async function initStorage(dataDir: string): Promise<void> {
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch {
    // Directory already exists
  }

  await loadAudits(dataDir);
}

export async function loadAudits(dataDir: string): Promise<void> {
  try {
    const files = await fs.readdir(dataDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(dataDir, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const report = JSON.parse(data, bigIntReviver) as AuditReport;
        auditsById.set(report.id, report);
        auditsByAddress.set(report.contractAddress.toLowerCase(), report);
      } catch (err) {
        console.error(`Error loading audit file ${file}:`, err);
      }
    }

    console.log(`Loaded ${auditsById.size} existing audit reports`);
  } catch {
    // No data directory yet, that's fine
  }
}

export async function saveAudit(report: AuditReport, dataDir: string): Promise<void> {
  auditsById.set(report.id, report);
  auditsByAddress.set(report.contractAddress.toLowerCase(), report);

  const filePath = path.join(dataDir, `${report.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(report, bigIntReplacer, 2));
}

export function getAuditById(id: string): AuditReport | undefined {
  return auditsById.get(id);
}

export function getAuditByAddress(address: string): AuditReport | undefined {
  return auditsByAddress.get(address.toLowerCase());
}

export function listAudits(options: {
  page?: number;
  limit?: number;
  severity?: string;
  sortBy?: string;
  order?: string;
} = {}): { audits: AuditReport[]; total: number } {
  const {
    page = 1,
    limit = 20,
    severity,
    sortBy = 'auditedAt',
    order = 'desc',
  } = options;

  let audits = Array.from(auditsById.values());

  // Filter by severity
  if (severity) {
    audits = audits.filter(a => a.overallRisk === severity);
  }

  // Sort
  audits.sort((a, b) => {
    let aVal: number | string;
    let bVal: number | string;

    if (sortBy === 'deployedAt') {
      aVal = a.deployedAt;
      bVal = b.deployedAt;
    } else if (sortBy === 'overallRisk') {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
      aVal = riskOrder[a.overallRisk] ?? 5;
      bVal = riskOrder[b.overallRisk] ?? 5;
    } else {
      aVal = a.auditedAt;
      bVal = b.auditedAt;
    }

    return order === 'desc'
      ? (bVal > aVal ? 1 : bVal < aVal ? -1 : 0)
      : (aVal > bVal ? 1 : aVal < bVal ? -1 : 0);
  });

  const total = audits.length;
  const start = (page - 1) * limit;
  const paged = audits.slice(start, start + limit);

  return { audits: paged, total };
}

export function getStats(): DashboardStats {
  const allAudits = Array.from(auditsById.values());
  const allFindings = allAudits.flatMap(a => a.findings);

  return {
    totalContracts: allAudits.length,
    totalAudited: allAudits.filter(a => a.sourceAvailable).length,
    totalSkipped: allAudits.filter(a => !a.sourceAvailable).length,
    criticalFindings: allFindings.filter(f => f.severity === 'critical').length,
    highFindings: allFindings.filter(f => f.severity === 'high').length,
    mediumFindings: allFindings.filter(f => f.severity === 'medium').length,
    lowFindings: allFindings.filter(f => f.severity === 'low').length,
    monitorState: getMonitorState(),
  };
}
