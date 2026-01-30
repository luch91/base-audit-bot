# BaseAuditBot

AI-powered smart contract security auditor for Base Network. Automatically monitors new contract deployments, fetches verified source code, and analyzes for vulnerabilities using LLM-based security analysis.

**Live Demo:** https://base-audit-bot.onrender.com/

## Features

- **Real-time Monitoring** - Continuously monitors Base network for new contract deployments
- **Automated Auditing** - Fetches verified source code from Basescan and analyzes automatically
- **On-demand Scanning** - Audit any Base contract by entering its address
- **AI-Powered Analysis** - Uses Groq (LLaMA 3.1 70B) or local Ollama for vulnerability detection
- **Web Dashboard** - View audit results, statistics, and findings in a clean interface
- **REST API** - Integrate audits into your own applications

## Vulnerability Detection

BaseAuditBot scans for common Solidity security issues including:

| Category | Description |
|----------|-------------|
| Reentrancy | External calls before state updates |
| Integer Overflow | Arithmetic without SafeMath (pre-0.8.0) |
| Unchecked Calls | Missing return value checks on external calls |
| Access Control | Missing or improper authorization |
| Front-running | Transaction ordering vulnerabilities |
| Proxy Vulnerabilities | Upgrade pattern issues |
| Flash Loan Vectors | Price manipulation risks |
| tx.origin | Authentication using tx.origin |
| Delegatecall | Unsafe delegatecall patterns |
| Self-destruct | Unprotected selfdestruct |
| Timestamp Dependency | Block timestamp manipulation |
| Denial of Service | Gas limit and loop issues |

## Quick Start

### Prerequisites

- Node.js 18+
- Basescan API key (free at https://basescan.org/apis)
- Groq API key (free at https://console.groq.com) OR local Ollama

### Installation

```bash
git clone https://github.com/luch91/base-audit-bot.git
cd base-audit-bot
npm install
```

### Configuration

Create a `.env` file:

```env
# Required
BASESCAN_API_KEY=your_basescan_api_key

# AI Provider (choose one)
GROQ_API_KEY=your_groq_api_key          # Recommended for cloud
GROQ_MODEL=llama-3.1-70b-versatile

# OR use local Ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3

# Optional
BASE_RPC_URL=https://mainnet.base.org
PORT=3001
POLL_INTERVAL_MS=15000
MAX_CONCURRENT_ANALYSES=3
CONFIDENCE_THRESHOLD=0.7
DATA_DIR=./data
```

### Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

Visit http://localhost:3001 to access the dashboard.

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check and monitor status |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/audits` | List all audits (paginated) |
| GET | `/api/audits/:id` | Get audit by ID |
| GET | `/api/audits/address/:addr` | Get audit by contract address |
| POST | `/api/audit` | Audit a contract on-demand |
| GET | `/api/monitor/state` | Get monitor state |
| POST | `/api/monitor/start` | Start blockchain monitor |
| POST | `/api/monitor/stop` | Stop blockchain monitor |

### Example: On-demand Audit

```bash
curl -X POST https://base-audit-bot.onrender.com/api/audit \
  -H "Content-Type: application/json" \
  -d '{"address": "0x..."}'
```

Response:
```json
{
  "status": "success",
  "message": "Audit complete for MyContract",
  "audit": {
    "id": "...",
    "contractAddress": "0x...",
    "contractName": "MyContract",
    "findings": [...],
    "overallRisk": "medium",
    "summary": "Found 2 issue(s): 1 medium, 1 low"
  }
}
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Base Network  │────▶│  Block Monitor   │────▶│  Basescan API   │
│   (viem/RPC)    │     │  (detect deploy) │     │  (fetch source) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Dashboard     │◀────│   Express API    │◀────│   Groq/Ollama   │
│   (HTML/JS)     │     │   (REST + JSON)  │     │   (LLM analyze) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Project Structure

```
base-audit-bot/
├── src/
│   ├── index.ts              # Entry point
│   ├── types/index.ts        # TypeScript interfaces
│   ├── services/
│   │   ├── monitor.ts        # Block monitoring
│   │   ├── basescan.ts       # Etherscan V2 API client
│   │   ├── analyzer.ts       # LLM integration
│   │   └── storage.ts        # JSON persistence
│   ├── prompts/
│   │   └── solidity.ts       # Security analysis prompts
│   └── routes/
│       └── api.ts            # REST endpoints
├── public/
│   ├── index.html            # Dashboard UI
│   ├── style.css             # Styles
│   └── app.js                # Frontend logic
└── data/                     # Audit storage (gitignored)
```

## Deployment

### Render (Recommended)

1. Push to GitHub
2. Create new Web Service on Render
3. Connect your repository
4. Set environment variables
5. Deploy

Build Command: `npm install && npm run build`
Start Command: `npm start`

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Disclaimer

BaseAuditBot provides automated security analysis as a preliminary screening tool. It should not be considered a replacement for professional security audits. Always conduct thorough manual reviews and formal audits before deploying contracts to production.

## License

MIT

## Links

- **Live App:** https://base-audit-bot.onrender.com/
- **GitHub:** https://github.com/luch91/base-audit-bot
- **Base Network:** https://base.org
- **Basescan:** https://basescan.org
