import dotenv from 'dotenv';
dotenv.config();

function requireEnv(name: string, fallback?: string): string {
  const val = process.env[name] || fallback;
  if (!val) {
    throw new Error(`FATAL: Missing required environment variable: ${name}. Server cannot start.`);
  }
  return val;
}

export const env = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: requireEnv('JWT_SECRET'),
  JWT_REFRESH_SECRET: requireEnv('JWT_REFRESH_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  JWT_ISSUER: process.env.JWT_ISSUER || 'youtube-ai-platform',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  API_KEY: process.env.API_KEY || '',

  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'llama3',
  OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://localhost:11434',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-pro',

  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID || '',
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET || '',
  YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || '',
  YOUTUBE_REDIRECT_URI: process.env.YOUTUBE_REDIRECT_URI || 'http://localhost:4000/api/auth/youtube/callback',
  OAUTH_STATE_SECRET: process.env.OAUTH_STATE_SECRET || '',

  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || (() => {
    if (process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'FATAL: ENCRYPTION_KEY is required when YouTube OAuth is configured in production.\n' +
          '  YouTube OAuth tokens are encrypted with this key before storage.\n' +
          '  If you change this key after tokens are stored, ALL tokens become undecryptable.\n' +
          '  Generate a key: openssl rand -hex 32\n' +
          '  Set it in .env: ENCRYPTION_KEY=<your-64-char-hex-key>\n'
        );
      }
      console.warn(
        '\x1b[33m⚠ WARNING: ENCRYPTION_KEY is not set.\x1b[0m\n' +
        '\x1b[33m  YouTube OAuth tokens will NOT be encrypted.\x1b[0m\n' +
        '\x1b[33m  Set a 64-character hex key in .env: ENCRYPTION_KEY=<your-key>\x1b[0m\n' +
        '\x1b[33m  Generate: openssl rand -hex 32\x1b[0m'
      );
    }
    return '';
  })(),

  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  LOW_MEMORY_MODE: process.env.LOW_MEMORY_MODE === 'true',
  PEXELS_API_KEY: process.env.PEXELS_API_KEY || '',
  PIXABAY_API_KEY: process.env.PIXABAY_API_KEY || '',

  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || '',
  COOKIE_SECURE: process.env.NODE_ENV === 'production',
  COOKIE_SAME_SITE: (process.env.COOKIE_SAME_SITE || 'lax') as 'lax' | 'strict' | 'none',
};
