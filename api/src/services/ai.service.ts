import { env } from '../config/env';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';
import { sanitizePrompt } from '../utils/prompt-sanitizer';
import { estimateTokens } from '../utils/token-estimator';
import { AIUsageService } from './ai-usage.service';
import { aiBreaker, CircuitBreakerOpenError } from './circuit-breaker.service';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`AI request timed out after ${ms}ms`)), ms)),
  ]);
}

type AIModel = 'ollama' | 'gemini';

interface AIConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
  timeout?: number;
}

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 1000;
const RATE_LIMIT_RPM = 10;
const CACHE_TTL_SEC = 3600;

function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object' || Array.isArray(obj)) return JSON.stringify(obj);
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(k => `"${k}":${stableStringify((obj as Record<string, unknown>)[k])}`);
  return `{${pairs.join(',')}}`;
}

function cacheKey(prompt: string, model: string, config: AIConfig): string {
  const hash = crypto.createHash('md5').update(stableStringify({ prompt, model, config })).digest('hex');
  return `ai:cache:${hash}`;
}

async function getCache(key: string): Promise<string | null> {
  try {
    return await redisConnection.get(key);
  } catch {
    return null;
  }
}

async function setCache(key: string, value: string, ttl: number): Promise<void> {
  try {
    await redisConnection.setex(key, ttl, value);
  } catch {}
}

async function checkRateLimit(provider: string): Promise<boolean> {
  try {
    const key = `ai:ratelimit:${provider}:${Math.floor(Date.now() / 60000)}`;
    const count = await redisConnection.incr(key);
    if (count === 1) await redisConnection.expire(key, 70);
    return count <= RATE_LIMIT_RPM;
  } catch {
    return true;
  }
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseDelay: number): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (i < attempts - 1) {
        const isRetryable = isTransientError(err);
        if (!isRetryable) break;
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function isTransientError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const axiosErr = err as { response?: { status?: number }; code?: string };
    if (axiosErr.response?.status) {
      const status = axiosErr.response.status;
      return status === 429 || status === 500 || status === 502 || status === 503;
    }
    if (axiosErr.code === 'ECONNRESET' || axiosErr.code === 'ETIMEDOUT' || axiosErr.code === 'ECONNREFUSED') {
      return true;
    }
  }
  return false;
}

async function callOllama(prompt: string, config: AIConfig = {}): Promise<string> {
  const { default: axios } = await import('axios');
  const response = await axios.post(
    `${env.OLLAMA_HOST}/api/chat`,
    {
      model: config.model || env.OLLAMA_MODEL || 'llama3',
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: config.temperature ?? 0.7,
        num_predict: config.maxTokens ?? 2048,
      },
      stream: false,
    },
    { timeout: config.timeout || 600000 }
  );
  return response.data.message.content;
}

async function callGemini(prompt: string, config: AIConfig = {}): Promise<string> {
  const { default: axios } = await import('axios');
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.model || env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: config.temperature ?? 0.7, maxOutputTokens: config.maxTokens ?? 2048 },
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: config.timeout || 60000 }
  );
  return response.data.candidates[0].content.parts[0].text;
}

const providerOrder: AIModel[] = ['ollama', 'gemini'];

async function callProviderWithRetry(provider: AIModel, prompt: string, config: AIConfig): Promise<string> {
  const fn = async () => {
    if (!(await checkRateLimit(provider))) {
      throw Object.assign(new Error('Rate limit exceeded'), { response: { status: 429 } });
    }
    switch (provider) {
      case 'gemini': return aiBreaker().call(() => callGemini(prompt, config));
      case 'ollama': return aiBreaker().call(() => callOllama(prompt, config));
    }
  };
  return withRetry(fn, RETRY_ATTEMPTS, RETRY_BASE_DELAY);
}

function hasKey(provider: AIModel): boolean {
  switch (provider) {
    case 'gemini': return !!env.GEMINI_API_KEY;
    case 'ollama': return true;
  }
}

export async function generateWithAI(prompt: string, model: AIModel = 'ollama', config: AIConfig = {}): Promise<string> {
  const sanitized = sanitizePrompt(prompt);
  if (sanitized.blocked) {
    throw new Error('Prompt blocked: contains disallowed patterns');
  }
  const cleanPrompt = sanitized.sanitized;

  if (config.userId) {
    const limit = await AIUsageService.checkDailyLimit(config.userId);
    if (!limit.allowed) {
      throw new Error(`Daily AI usage limit reached (${limit.limit} requests). Upgrade your plan or try again tomorrow.`);
    }
  }

  const cKey = cacheKey(cleanPrompt, model, config);
  const cached = await getCache(cKey);
  if (cached) return cached;

  const chain: AIModel[] = [];
  if (hasKey(model)) chain.push(model);
  for (const p of providerOrder) {
    if (p !== model && hasKey(p) && !chain.includes(p)) chain.push(p);
  }

  let lastError: unknown;
  const startTime = Date.now();
  const deadline = config.timeout ? startTime + config.timeout : 0;

  for (const provider of chain) {
    try {
      const remaining = deadline ? Math.max(10000, deadline - Date.now()) : 300000;
      const result = await withTimeout(callProviderWithRetry(provider, cleanPrompt, config), remaining);
      await setCache(cKey, result, CACHE_TTL_SEC);

      if (config.userId) {
        const inputTokens = estimateTokens(cleanPrompt);
        const outputTokens = estimateTokens(result);
        AIUsageService.track(config.userId, provider, config.model || provider, inputTokens, outputTokens, Date.now() - startTime, true);
      }

      return result;
    } catch (err: unknown) {
      lastError = err;
      const errMsg = err && typeof err === 'object' ? (err as Error).message : String(err);
      logger.warn(`AI provider ${provider} failed, trying next`, {
        error: errMsg,
        provider,
        chain: chain.filter(p => p !== provider),
        elapsedMs: Date.now() - startTime,
        promptPreview: cleanPrompt.slice(0, 80),
      });
    }
  }

  if (config.userId) {
    const inputTokens = estimateTokens(cleanPrompt);
    AIUsageService.track(config.userId, model, config.model || model, inputTokens, 0, Date.now() - startTime, false, lastError instanceof Error ? lastError.message : String(lastError));
  }

  logger.error('All AI providers failed — returning static degradation response', {
    error: lastError && typeof lastError === 'object' ? (lastError as Error).message : String(lastError || 'unknown'),
    chain: chain.join(', '),
    elapsedMs: Date.now() - startTime,
    promptPreview: cleanPrompt.slice(0, 120),
  });
  return `[AI_UNAVAILABLE] All AI providers are currently unavailable. Please try again later. Prompt: "${cleanPrompt.slice(0, 100)}"`;
}
