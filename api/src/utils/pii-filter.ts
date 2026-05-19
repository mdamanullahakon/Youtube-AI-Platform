const PII_PATTERNS: RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
  /\b\d{16}\d{0,6}\b/g,
  /\b(?:https?:\/\/)?(?:www\.)?(?:github\.com|twitter\.com|facebook\.com|linkedin\.com)\/\S+\b/gi,
  /\b[A-Z]{2}\d{6}\b/g,
  /\b(?:\d[ -]*?){13,16}\b/g,
];

const SENSITIVE_KEYS = ['password', 'secret', 'token', 'key', 'credential', 'authorization', 'x-api-key'];

export function redactPII(text: string): string {
  let result = text;
  for (const pattern of PII_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redactPII(value);
    } else if (value && typeof value === 'object') {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}
