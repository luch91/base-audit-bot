import { ContractSource } from '../types';

const BASESCAN_API = 'https://api.basescan.org/api';

// Simple rate limiter: max 5 requests per second
let lastRequestTime = 0;
let requestsThisSecond = 0;

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  if (now - lastRequestTime >= 1000) {
    requestsThisSecond = 0;
    lastRequestTime = now;
  }

  if (requestsThisSecond >= 5) {
    const waitTime = 1000 - (now - lastRequestTime);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    requestsThisSecond = 0;
    lastRequestTime = Date.now();
  }

  requestsThisSecond++;
}

export async function getContractSource(
  address: string,
  apiKey: string
): Promise<ContractSource | null> {
  console.log(`[Basescan] getContractSource called for ${address}`);
  await rateLimitWait();
  console.log(`[Basescan] Rate limit passed`);

  try {
    const url = `${BASESCAN_API}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
    console.log(`[Basescan] Fetching: ${address} (API key: ${apiKey ? apiKey.slice(0, 8) + '...' : 'NOT SET'})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    console.log(`[Basescan] HTTP status: ${response.status}`);
    const data = await response.json() as BasescanResponse;

    console.log(`[Basescan] Response status: ${data.status}, message: ${data.message}`);

    if (data.status !== '1' || !data.result?.[0]?.SourceCode) {
      console.log(`[Basescan] No source found. Result:`, JSON.stringify(data.result?.[0] || {}).slice(0, 200));
      return null;
    }

    const result = data.result[0];

    // Empty source means not verified
    if (!result.SourceCode || result.SourceCode === '') {
      return null;
    }

    // Handle multi-file source format
    let sourceCode = result.SourceCode;
    if (sourceCode.startsWith('{{')) {
      sourceCode = parseMultiFileSource(sourceCode);
    } else if (sourceCode.startsWith('{')) {
      // Single JSON object with sources
      try {
        const parsed = JSON.parse(sourceCode) as { sources?: Record<string, { content: string }> };
        if (parsed.sources) {
          sourceCode = Object.values(parsed.sources)
            .map(s => s.content)
            .join('\n\n');
        }
      } catch {
        // Not JSON, use as-is
      }
    }

    const contractSource: ContractSource = {
      contractAddress: address,
      contractName: result.ContractName || 'Unknown',
      compilerVersion: result.CompilerVersion || 'Unknown',
      sourceCode,
      abi: result.ABI || '[]',
      constructorArguments: result.ConstructorArguments || '',
      optimizationUsed: result.OptimizationUsed === '1',
      runs: parseInt(result.Runs || '0', 10),
      evmVersion: result.EVMVersion || 'default',
      library: result.Library || '',
      licenseType: result.LicenseType || 'None',
      isProxy: result.Proxy === '1',
      implementationAddress: result.Implementation || undefined,
    };

    // If it's a proxy, also try to fetch the implementation source
    if (contractSource.isProxy && contractSource.implementationAddress) {
      console.log(
        `Proxy detected at ${address}, implementation: ${contractSource.implementationAddress}`
      );
      const implSource = await getContractSource(contractSource.implementationAddress, apiKey);
      if (implSource) {
        // Prepend proxy info, use implementation source for analysis
        contractSource.sourceCode =
          `// PROXY CONTRACT: ${address}\n` +
          `// IMPLEMENTATION: ${contractSource.implementationAddress}\n\n` +
          implSource.sourceCode;
        contractSource.contractName = `${contractSource.contractName} (Proxy -> ${implSource.contractName})`;
      }
    }

    return contractSource;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[Basescan] Request timed out for ${address}`);
    } else {
      console.error(`[Basescan] API error for ${address}:`, err);
    }
    return null;
  }
}

function parseMultiFileSource(raw: string): string {
  // Basescan wraps multi-file sources in double braces: {{...}}
  // Remove outer braces to get valid JSON
  const jsonStr = raw.slice(1, -1);

  try {
    const parsed = JSON.parse(jsonStr) as {
      sources?: Record<string, { content: string }>;
    };

    if (parsed.sources) {
      return Object.entries(parsed.sources)
        .map(([filename, source]) => `// --- ${filename} ---\n${source.content}`)
        .join('\n\n');
    }
  } catch {
    // Fall through
  }

  return raw;
}

// Basescan API response types
interface BasescanResponse {
  status: string;
  message: string;
  result: BasescanContractResult[];
}

interface BasescanContractResult {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  EVMVersion: string;
  Library: string;
  LicenseType: string;
  Proxy: string;
  Implementation: string;
}
