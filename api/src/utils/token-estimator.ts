const TOKENS_PER_CHAR = 0.25;
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'llama3': { input: 0, output: 0 },
  'gemini-pro': { input: 0.001, output: 0.002 },
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

export function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const rates = COST_PER_1K_TOKENS[model] || COST_PER_1K_TOKENS['llama3'];
  const inputCost = (inputTokens / 1000) * rates.input;
  const outputCost = (outputTokens / 1000) * rates.output;
  return parseFloat((inputCost + outputCost).toFixed(6));
}
