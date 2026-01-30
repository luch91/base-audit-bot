import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createApiRouter } from './routes/api';
import { startMonitor } from './services/monitor';
import { initStorage } from './services/storage';
import { AppConfig } from './types';

function loadConfig(): AppConfig {
  return {
    baseRpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    basescanApiKey: process.env.BASESCAN_API_KEY || '',
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
    groqApiKey: process.env.GROQ_API_KEY || undefined,
    groqModel: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
    port: parseInt(process.env.PORT || '3001', 10),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '15000', 10),
    maxConcurrentAnalyses: parseInt(process.env.MAX_CONCURRENT_ANALYSES || '3', 10),
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.7'),
    startBlock: process.env.START_BLOCK ? BigInt(process.env.START_BLOCK) : undefined,
    dataDir: process.env.DATA_DIR || './data',
  };
}

async function main() {
  const config = loadConfig();

  // Validate Basescan API key
  if (!config.basescanApiKey) {
    console.warn('WARNING: No BASESCAN_API_KEY set. Source code fetching will fail.');
    console.warn('Get a free key at https://basescan.org/apis');
  }

  // Initialize storage
  await initStorage(config.dataDir);

  // Set up Express
  const app = express();
  app.use(express.json());

  // Serve static dashboard files
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Mount API routes
  app.use('/api', createApiRouter(config));

  // Root info endpoint
  app.get('/api/info', (_req, res) => {
    res.json({
      name: 'BaseAuditBot',
      description: 'Smart Contract Audit Bot for Base Network',
      version: '1.0.0',
      endpoints: {
        dashboard: 'GET /',
        health: 'GET /api/health',
        stats: 'GET /api/stats',
        audits: 'GET /api/audits',
        audit: 'GET /api/audits/:id',
        auditByAddress: 'GET /api/audits/address/:addr',
        monitorState: 'GET /api/monitor/state',
        monitorStart: 'POST /api/monitor/start',
        monitorStop: 'POST /api/monitor/stop',
      },
    });
  });

  // Start server
  app.listen(config.port, () => {
    console.log('');
    console.log('=== BaseAuditBot ===');
    console.log(`Dashboard:  http://localhost:${config.port}`);
    console.log(`API:        http://localhost:${config.port}/api`);
    console.log(`Health:     http://localhost:${config.port}/api/health`);
    console.log('');
    console.log(`Base RPC:   ${config.baseRpcUrl}`);
    if (config.groqApiKey) {
      console.log(`AI:         Groq (model: ${config.groqModel})`);
    } else {
      console.log(`AI:         Ollama @ ${config.ollamaUrl} (model: ${config.ollamaModel})`);
    }
    console.log(`Poll:       every ${config.pollIntervalMs}ms`);
    console.log(`Data:       ${config.dataDir}`);
    console.log('');
  });

  // Start blockchain monitor
  console.log('Starting blockchain monitor...');
  await startMonitor(config);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  const { stopMonitor } = await import('./services/monitor');
  await stopMonitor();
  process.exit(0);
});
