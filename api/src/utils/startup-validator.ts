import { prisma } from '../config/db';
import { redisConnection } from '../config/redis';
import { logger } from './logger';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { getMissingConfigKeys } from '../services/config.service';

export interface StartupCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  message: string;
  required: boolean;
}

export interface StartupReport {
  timestamp: string;
  environment: string;
  checks: StartupCheck[];
  passed: boolean;
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>(async (resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    try {
      const result = await promise;
      clearTimeout(timer);
      resolve(result);
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

function pingHost(urlStr: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      reject(new Error(`Invalid URL: ${urlStr}`));
      return;
    }
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(urlStr, { method: 'GET', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Connection to ${urlStr} timed out after ${timeoutMs}ms`));
    });
    req.end();
  });
}

async function checkEnvVars(checks: StartupCheck[]): Promise<void> {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL', 'REDIS_URL'];
  const missing: string[] = [];
  for (const name of required) {
    if (!process.env[name]) {
      missing.push(name);
    }
  }
  if (missing.length === 0) {
    logger.info('Startup check: Environment variables - PASSED');
    checks.push({
      name: 'Environment Variables',
      status: 'passed',
      message: 'All required environment variables are set',
      required: true,
    });
  } else {
    logger.error(`Startup check: Environment variables - FAILED (missing: ${missing.join(', ')})`);
    checks.push({
      name: 'Environment Variables',
      status: 'failed',
      message: `Missing required environment variables: ${missing.join(', ')}`,
      required: true,
    });
  }
}

async function checkDatabase(checks: StartupCheck[]): Promise<void> {
  try {
    await withTimeout(prisma.$connect(), 15000, 'Database connection');
    logger.info('Startup check: Database - PASSED');
    checks.push({
      name: 'Database',
      status: 'passed',
      message: 'Successfully connected to database',
      required: true,
    });
  } catch (err: any) {
    const msg = err.message || 'Unknown error';
    logger.error(`Startup check: Database - FAILED (${msg})`);
    checks.push({
      name: 'Database',
      status: 'failed',
      message: `Cannot connect to database: ${msg}`,
      required: true,
    });
  }
}

async function checkRedis(checks: StartupCheck[]): Promise<void> {
  try {
    const result = await withTimeout(redisConnection.ping(), 10000, 'Redis ping');
    if (result === 'PONG') {
      logger.info('Startup check: Redis - PASSED');
      checks.push({
        name: 'Redis',
        status: 'passed',
        message: 'Redis responded to PING',
        required: true,
      });
    } else {
      checks.push({
        name: 'Redis',
        status: 'warning',
        message: `Unexpected Redis ping response: ${result}`,
        required: false,
      });
    }
  } catch (err: any) {
    const msg = err.message || 'Unknown error';
    logger.warn(`Startup check: Redis - WARNING (${msg})`);
    checks.push({
      name: 'Redis',
      status: 'warning',
      message: `Cannot connect to Redis: ${msg}. Queue features will be unavailable.`,
      required: false,
    });
  }
}

async function checkFfmpeg(checks: StartupCheck[]): Promise<void> {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe', timeout: 10000, encoding: 'utf-8' });
    logger.info('Startup check: ffmpeg - PASSED');
    checks.push({
      name: 'ffmpeg',
      status: 'passed',
      message: 'ffmpeg is available in PATH',
      required: false,
    });
  } catch {
    logger.warn('Startup check: ffmpeg - WARNING (not found)');
    checks.push({
      name: 'ffmpeg',
      status: 'warning',
      message: 'ffmpeg not found in PATH. Video rendering and processing features will be unavailable.',
      required: false,
    });
  }
}

async function checkUploadDirs(checks: StartupCheck[]): Promise<void> {
  const dirs = [
    path.join(process.cwd(), 'uploads'),
    path.join(process.cwd(), 'uploads', 'videos'),
    path.join(process.cwd(), 'uploads', 'thumbnails'),
    path.join(process.cwd(), 'uploads', 'temp'),
    path.join(process.cwd(), 'uploads', 'audio'),
  ];
  const failed: string[] = [];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.accessSync(dir, fs.constants.W_OK);
    } catch {
      failed.push(dir);
    }
  }
  if (failed.length === 0) {
    logger.info('Startup check: Upload directories - PASSED');
    checks.push({
      name: 'Upload Directories',
      status: 'passed',
      message: 'All upload directories exist and are writable',
      required: false,
    });
  } else {
    logger.warn(`Startup check: Upload directories - WARNING (${failed.length} failed)`);
    checks.push({
      name: 'Upload Directories',
      status: 'warning',
      message: `Some upload directories could not be created or are not writable: ${failed.join(', ')}`,
      required: false,
    });
  }
}

async function checkAiProvider(checks: StartupCheck[]): Promise<void> {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const hasCloudKey = !!process.env.GEMINI_API_KEY;

  try {
    await pingHost(ollamaHost, 5000);
    logger.info('Startup check: AI Provider - PASSED (Ollama)');
    checks.push({
      name: 'AI Provider',
      status: 'passed',
      message: `Ollama is reachable at ${ollamaHost}`,
      required: false,
    });
    return;
  } catch (err: any) {
    if (hasCloudKey) {
      logger.info('Startup check: AI Provider - PASSED (cloud fallback)');
      checks.push({
        name: 'AI Provider',
        status: 'passed',
        message: `Ollama unreachable (${err.message}), but a Gemini API key is configured as fallback`,
        required: false,
      });
    } else {
      logger.warn('Startup check: AI Provider - WARNING (no provider)');
      checks.push({
        name: 'AI Provider',
        status: 'warning',
        message: 'No AI provider available. Ollama is unreachable and no Gemini API key is set. AI features will not work.',
        required: false,
      });
    }
  }
}

async function checkYoutubeOAuth(checks: StartupCheck[]): Promise<void> {
  const hasClientId = !!process.env.YOUTUBE_CLIENT_ID;
  const hasClientSecret = !!process.env.YOUTUBE_CLIENT_SECRET;
  const hasApiKey = !!process.env.YOUTUBE_API_KEY;

  if (!hasClientId && !hasClientSecret && !hasApiKey) {
    logger.warn('Startup check: YouTube OAuth - WARNING (not configured)');
    checks.push({
      name: 'YouTube OAuth',
      status: 'warning',
      message: 'YouTube OAuth is not configured. Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET for YouTube authentication and uploads.',
      required: false,
    });
    return;
  }

  if (hasClientId !== hasClientSecret) {
    const missing: string[] = [];
    if (!hasClientId) missing.push('YOUTUBE_CLIENT_ID');
    if (!hasClientSecret) missing.push('YOUTUBE_CLIENT_SECRET');
    logger.warn(`Startup check: YouTube OAuth - WARNING (partial)`);
    checks.push({
      name: 'YouTube OAuth',
      status: 'warning',
      message: `YouTube OAuth is partially configured. Missing: ${missing.join(', ')}. YouTube authentication will not work.`,
      required: false,
    });
    return;
  }

  if (!hasClientId && hasApiKey) {
    logger.warn('Startup check: YouTube OAuth - WARNING (API key only)');
    checks.push({
      name: 'YouTube OAuth',
      status: 'warning',
      message: 'Only YOUTUBE_API_KEY is set. YouTube OAuth (client ID + secret) is required for authentication. API key alone provides limited read-only access.',
      required: false,
    });
    return;
  }

  try {
    const { validateOAuthCredentials, formatOAuthReport } = await import('./oauth-validator');
    const result = await validateOAuthCredentials();

    if (result.valid) {
      logger.info('Startup check: YouTube OAuth - PASSED (credentials verified)');
      checks.push({
        name: 'YouTube OAuth',
        status: 'passed',
        message: `YouTube OAuth credentials verified successfully. Redirect URI: ${result.redirectUri}`,
        required: false,
      });
    } else {
      const errorSummary = result.errors.map(e => e.split('\n')[0]).join('; ');
      logger.warn(`Startup check: YouTube OAuth - FAILED (${errorSummary})`);
      checks.push({
        name: 'YouTube OAuth',
        status: 'failed',
        message: errorSummary,
        required: false,
      });
    }
  } catch (err: any) {
    logger.warn(`Startup check: YouTube OAuth - WARNING (validation error: ${err.message})`);
    checks.push({
      name: 'YouTube OAuth',
      status: 'warning',
      message: `YouTube OAuth credentials present but could not be validated: ${err.message}. YouTube auth may still work.`,
      required: false,
    });
  }
}

async function checkAppConfig(checks: StartupCheck[]): Promise<void> {
  try {
    const missing = await getMissingConfigKeys();
    if (missing.length === 0) {
      logger.info('Startup check: Application Config - PASSED');
      checks.push({
        name: 'Application Config',
        status: 'passed',
        message: 'All required application config keys are set',
        required: false,
      });
    } else {
      const missingLabels = missing.map((m) => m.label).join(', ');
      logger.warn(`Startup check: Application Config - WARNING (missing: ${missingLabels})`);
      checks.push({
        name: 'Application Config',
        status: 'warning',
        message: `Missing config: ${missingLabels}. Visit /setup to configure.`,
        required: false,
      });
    }
  } catch (err: any) {
    logger.warn(`Startup check: Application Config - WARNING (${err.message})`);
    checks.push({
      name: 'Application Config',
      status: 'warning',
      message: `Could not check app config: ${err.message}`,
      required: false,
    });
  }
}

export async function validateStartup(): Promise<StartupReport> {
  const checks: StartupCheck[] = [];

  await checkEnvVars(checks);
  await checkDatabase(checks);
  await checkRedis(checks);
  await checkFfmpeg(checks);
  await checkUploadDirs(checks);
  await checkAiProvider(checks);
  await checkYoutubeOAuth(checks);
  await checkAppConfig(checks);

  const summary = {
    total: checks.length,
    passed: checks.filter((c) => c.status === 'passed').length,
    failed: checks.filter((c) => c.status === 'failed').length,
    warnings: checks.filter((c) => c.status === 'warning').length,
    skipped: checks.filter((c) => c.status === 'skipped').length,
  };

  return {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    checks,
    passed: summary.failed === 0,
    summary,
  };
}

export function formatStartupReport(report: StartupReport): string {
  const lines: string[] = [];
  const divider = '─'.repeat(62);

  lines.push('');
  lines.push(`  ${'STARTUP VALIDATION REPORT'.padStart(31)}`);
  lines.push(`  ${divider}`);
  lines.push(`  Timestamp   : ${report.timestamp}`);
  lines.push(`  Environment : ${report.environment}`);
  lines.push(`  Overall     : ${report.passed ? '\u2713 PASSED' : '\u2717 FAILED'}`);
  lines.push(`  ${divider}`);

  for (const check of report.checks) {
    const icon = check.status === 'passed' ? '\u2713'
      : check.status === 'failed' ? '\u2717'
      : check.status === 'warning' ? '\u26A0'
      : '\u25CB';
    const tag = check.required ? ' [REQUIRED]' : '';
    lines.push(`  ${icon} ${check.name}${tag}`);
    lines.push(`    ${check.message}`);
  }

  lines.push(`  ${divider}`);
  lines.push(`  Summary: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.warnings} warnings, ${report.summary.skipped} skipped`);
  lines.push(`  ${divider}`);
  lines.push('');

  return lines.join('\n');
}

export async function verifyAndExit(): Promise<void> {
  const report = await validateStartup();
  const formatted = formatStartupReport(report);
  console.log(formatted);

  const failedRequired = report.checks.filter((c) => c.status === 'failed' && c.required);
  if (failedRequired.length > 0) {
    logger.error(`${failedRequired.length} required startup check(s) failed. Server cannot start.`);
    for (const check of failedRequired) {
      logger.error(`  - ${check.name}: ${check.message}`);
    }
    process.exit(1);
  }
}
