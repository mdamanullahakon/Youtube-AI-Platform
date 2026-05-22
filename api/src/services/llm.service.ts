// LLM service scaffold — supports Ollama or OpenAI via env vars
import fetch from 'node-fetch';

export type LLMOptions = {
  model?: string;
  maxTokens?: number;
  temperature?: number;
};

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function generateText(prompt: string, opts: LLMOptions = {}): Promise<string> {
  // Prefer Ollama local if available
  if (OLLAMA_URL) {
    try {
      const model = opts.model || 'llama3';
      const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, max_tokens: opts.maxTokens || 512, temperature: opts.temperature || 0.2 }),
      });
      const body = await res.json();
      // Ollama shape may vary; fallback to joined generations
      if (body && body.generations) return body.generations.map((g: any) => g.text).join('\n');
      if (body && body.text) return body.text;
    } catch (err) {
      // fallthrough to try OpenAI if configured
      console.warn('Ollama generate failed:', err.message || err);
    }
  }

  if (OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: opts.model || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: opts.maxTokens || 512, temperature: opts.temperature || 0.2 }),
    });
    const body = await res.json();
    if (body && body.choices && body.choices[0] && body.choices[0].message) return body.choices[0].message.content;
  }

  // Fallback: echo prompt (safe scaffold behavior)
  return `LLM_UNAVAILABLE: ${prompt}`;
}

export default { generateText };