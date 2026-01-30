import { SolidityFinding, ContractSource, AppConfig } from '../types';
import { SOLIDITY_SYSTEM_PROMPT, buildSolidityPrompt } from '../prompts/solidity';

const MAX_SOURCE_LENGTH = 16000; // ~4K tokens

export async function analyzeContract(
  source: ContractSource,
  config: AppConfig
): Promise<SolidityFinding[]> {
  const sourceCode = source.sourceCode;

  // If source is small enough, analyze in one shot
  if (sourceCode.length <= MAX_SOURCE_LENGTH) {
    return analyzeSingleChunk(source.contractName, sourceCode, source.compilerVersion, config);
  }

  // Otherwise, chunk by contract boundaries and analyze each
  console.log(
    `Large contract (${sourceCode.length} chars), splitting into chunks...`
  );
  const chunks = chunkSourceCode(sourceCode);
  const allFindings: SolidityFinding[] = [];

  for (const chunk of chunks) {
    const findings = await analyzeSingleChunk(
      source.contractName,
      chunk,
      source.compilerVersion,
      config
    );
    allFindings.push(...findings);
  }

  return allFindings;
}

async function analyzeSingleChunk(
  contractName: string,
  sourceCode: string,
  compilerVersion: string,
  config: AppConfig
): Promise<SolidityFinding[]> {
  const prompt = buildSolidityPrompt(contractName, sourceCode, compilerVersion);

  // Use Groq if API key is set, otherwise fall back to Ollama
  if (config.groqApiKey) {
    return analyzeWithGroq(contractName, prompt, config);
  } else {
    return analyzeWithOllama(contractName, prompt, config);
  }
}

async function analyzeWithGroq(
  contractName: string,
  prompt: string,
  config: AppConfig
): Promise<SolidityFinding[]> {
  console.log(`[Groq] Starting analysis for ${contractName} (prompt length: ${prompt.length})`);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    console.log(`[Groq] Sending request to Groq API...`);
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.groqApiKey}`,
      },
      body: JSON.stringify({
        model: config.groqModel || 'llama-3.1-70b-versatile',
        messages: [
          { role: 'system', content: SOLIDITY_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    console.log(`[Groq] Response received, status: ${response.status}`);

    if (!response.ok) {
      const err = await response.text();
      console.error(`[Groq] API error response: ${err}`);
      throw new Error(`Groq API error: ${response.status} - ${err}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    const text = data.choices[0]?.message?.content || '';

    console.log(`[Groq] Response for ${contractName} (${text.length} chars):`, text.slice(0, 300));

    return parseFindings(text, config.confidenceThreshold);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`Analysis timed out for ${contractName}`);
    } else {
      console.error(`Error analyzing ${contractName} with Groq:`, err);
    }
    return [];
  }
}

async function analyzeWithOllama(
  contractName: string,
  prompt: string,
  config: AppConfig
): Promise<SolidityFinding[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollamaModel,
        system: SOLIDITY_SYSTEM_PROMPT,
        prompt,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    const text = data.response;

    console.log(`Ollama response for ${contractName}:`, text.slice(0, 300));

    return parseFindings(text, config.confidenceThreshold);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`Analysis timed out for ${contractName}`);
    } else {
      console.error(`Error analyzing ${contractName} with Ollama:`, err);
    }
    return [];
  }
}

function parseFindings(text: string, confidenceThreshold: number): SolidityFinding[] {
  // Extract JSON array from response (LLM may wrap in markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.log('No JSON array found in response');
    return [];
  }

  try {
    const findings = JSON.parse(jsonMatch[0]) as SolidityFinding[];
    // Filter by confidence threshold
    return findings.filter(f => f.confidence >= confidenceThreshold);
  } catch (err) {
    console.error('Failed to parse findings JSON:', err);
    return [];
  }
}

function chunkSourceCode(sourceCode: string): string[] {
  const chunks: string[] = [];

  // Try to split by contract/interface/library boundaries
  const contractRegex = /(?:^|\n)((?:abstract\s+)?(?:contract|interface|library)\s+\w+[^{]*\{)/g;
  const matches = [...sourceCode.matchAll(contractRegex)];

  if (matches.length <= 1) {
    // Can't split by contracts, split by line count
    return splitByLines(sourceCode, MAX_SOURCE_LENGTH);
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index!;
    const end = i < matches.length - 1 ? matches[i + 1].index! : sourceCode.length;
    const chunk = sourceCode.slice(start, end);

    if (chunk.length <= MAX_SOURCE_LENGTH) {
      chunks.push(chunk);
    } else {
      // This individual contract is too large, split by lines
      chunks.push(...splitByLines(chunk, MAX_SOURCE_LENGTH));
    }
  }

  // Include any preamble (pragmas, imports) before first contract
  if (matches.length > 0 && matches[0].index! > 0) {
    const preamble = sourceCode.slice(0, matches[0].index!).trim();
    if (preamble.length > 0 && chunks.length > 0) {
      // Prepend preamble to first chunk for context
      chunks[0] = preamble + '\n\n' + chunks[0];
    }
  }

  return chunks;
}

function splitByLines(text: string, maxLength: number): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
