// ─────────────────────────────────────────────
// Environment Variable Validator
// Runs on boot to ensure required secrets exist
// ─────────────────────────────────────────────

interface EnvCheck {
  name: string;
  required: boolean;
  validate?: (value: string) => boolean;
  message?: string;
}

const GOOGLE_CLIENT_ID_PATTERN = /^\d+-\w+\.apps\.googleusercontent\.com$/;

const CHECKS: EnvCheck[] = [
  { name: 'JWT_SECRET', required: true, validate: (v) => v.length >= 32, message: 'Must be at least 32 characters (use: openssl rand -hex 64)' },
  { name: 'JWT_REFRESH_SECRET', required: true, validate: (v) => v.length >= 32, message: 'Must be at least 32 characters' },
  { name: 'DATABASE_URL', required: true, validate: (v) => v.startsWith('postgresql://'), message: 'Must start with postgresql://' },
  { name: 'REDIS_URL', required: false, validate: (v) => v.startsWith('redis://') || v.startsWith('rediss://'), message: 'Must start with redis://' },
  { name: 'YOUTUBE_CLIENT_ID', required: false, validate: (v) => GOOGLE_CLIENT_ID_PATTERN.test(v), message: 'Must match pattern: <project-id>-<hash>.apps.googleusercontent.com' },
  { name: 'YOUTUBE_CLIENT_SECRET', required: false, message: 'YouTube OAuth will be unavailable' },
  { name: 'DB_POOL_MIN', required: false, message: 'Will default to 2' },
  { name: 'DB_POOL_MAX', required: false, message: 'Will default to 10' },
  { name: 'REDIS_MAX_RETRIES', required: false, message: 'Will default to 10' },
];

const WARNINGS: EnvCheck[] = [
  { name: 'YOUTUBE_API_KEY', required: false, message: 'YouTube analytics will be unavailable' },
  { name: 'SMTP_HOST', required: false, message: 'SMTP host not set — email features disabled' },
  { name: 'SMTP_USER', required: false, message: 'SMTP user not set' },
  { name: 'SMTP_PASS', required: false, message: 'SMTP password not set' },
  { name: 'YOUTUBE_CLIENT_ID', required: false, message: 'YouTube OAuth unavailable — set via Setup Wizard' },
  { name: 'YOUTUBE_CLIENT_SECRET', required: false, message: 'YouTube OAuth unavailable — set via Setup Wizard' },
  { name: 'YOUTUBE_REFRESH_TOKEN', required: false, message: 'YouTube refresh token not set' },
  { name: 'YOUTUBE_REDIRECT_URI', required: false, message: 'Redirect URI not explicitly set. Default: http://localhost:4000/api/auth/youtube/callback. MUST match Google Cloud Console in production.' },
  { name: 'ENCRYPTION_KEY', required: false, message: 'Not set. YouTube OAuth tokens will NOT be encrypted. Set a 64-char hex key (openssl rand -hex 32).' },
  { name: 'OAUTH_STATE_SECRET', required: false, message: 'OAuth state secret not set — OAuth may be insecure' },
  { name: 'GEMINI_API_KEY', required: false, message: 'Gemini AI fallback will be unavailable — set via Setup Wizard' },
  { name: 'TRANSCRIPT_API_KEY', required: false, message: 'Transcript API key not set — set via Setup Wizard' },
];

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of CHECKS) {
    const value = process.env[check.name] || '';

    if (!value) {
      if (check.required) {
        errors.push(`MISSING REQUIRED ENV: ${check.name}${check.message ? ` — ${check.message}` : ''}`);
      }
      continue;
    }

    if (check.validate && !check.validate(value)) {
      errors.push(`INVALID ENV: ${check.name}=${value.substring(0, 20)}...${check.message ? ` — ${check.message}` : ''}`);
    }
  }

  for (const check of WARNINGS) {
    const value = process.env[check.name] || '';
    if (!value) {
      warnings.push(`${check.name} is not set${check.message ? ` — ${check.message}` : ''}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
