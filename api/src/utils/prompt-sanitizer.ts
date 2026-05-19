import { redactPII } from './pii-filter';

const MAX_PROMPT_LENGTH = 10000;

const BLOCKED_PATTERNS: RegExp[] = [
  /ignore all previous instructions/i,
  /you are (?:now|an?)\s+(?:jailbreak|unbound|free|dan)/i,
  /system(?: prompt| instructions| message)/i,
  /your (?:system|initial) (?:prompt|instructions)/i,
  /\bDAN\b/i,
];

export interface SanitizationResult {
  sanitized: string;
  truncated: boolean;
  blocked: boolean;
  piiRemoved: boolean;
}

export function sanitizePrompt(prompt: string): SanitizationResult {
  const result: SanitizationResult = {
    sanitized: prompt,
    truncated: false,
    blocked: false,
    piiRemoved: false,
  };

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(result.sanitized)) {
      result.blocked = true;
      return result;
    }
  }

  const beforeRedact = result.sanitized;
  result.sanitized = redactPII(result.sanitized);
  result.piiRemoved = beforeRedact !== result.sanitized;

  if (result.sanitized.length > MAX_PROMPT_LENGTH) {
    result.sanitized = result.sanitized.slice(0, MAX_PROMPT_LENGTH);
    result.truncated = true;
  }

  return result;
}
