/**
 * YouTube AI Platform — Environment Validator
 *
 * Standalone script that validates .env configuration on startup.
 * Detects missing variables, type mismatches, and security issues.
 *
 * Usage:
 *   node scripts/env-validator.js                # Auto-detect .env file
 *   node scripts/env-validator.js --file .env     # Specific file
 *   node scripts/env-validator.js --json          # Machine-readable output
 *   node scripts/env-validator.js --fix           # Generate .env from .env.example
 *   node scripts/env-validator.js --strict        # Exit on warnings too
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const CONFIG = {
  strict: process.argv.includes('--strict'),
  jsonOutput: process.argv.includes('--json'),
  fixMode: process.argv.includes('--fix'),
};

// ─── Severity levels ─────────────────────────────
const LEVELS = {
  FATAL: { code: 0, label: 'FATAL', exitCode: 1 },
  ERROR: { code: 1, label: 'ERROR', exitCode: 1 },
  WARN: { code: 2, label: 'WARN', exitCode: 0 },
  INFO: { code: 3, label: 'INFO', exitCode: 0 },
};

// ─── Validation rules ────────────────────────────
const RULES = [
  // ── Connection strings ──
  {
    key: 'DATABASE_URL',
    required: true,
    pattern: /^postgresql:\/\/.+/,
    message: 'Must be a valid PostgreSQL connection string (postgresql://user:pass@host:port/db)',
    severity: LEVELS.FATAL,
  },
  {
    key: 'REDIS_URL',
    required: false,
    pattern: /^redis(s)?:\/\/.+/,
    default: 'redis://localhost:6379',
    message: 'Should be a valid Redis URL (redis://host:port)',
    severity: LEVELS.WARN,
  },

  // ── JWT Secrets ──
  {
    key: 'JWT_SECRET',
    required: true,
    minLength: 32,
    message: 'Must be at least 32 characters. Generate: openssl rand -hex 64',
    severity: LEVELS.FATAL,
  },
  {
    key: 'JWT_REFRESH_SECRET',
    required: true,
    minLength: 32,
    message: 'Must be at least 32 characters. Generate: openssl rand -hex 64',
    severity: LEVELS.FATAL,
  },

  // ── OAuth / API keys ──
  {
    key: 'YOUTUBE_CLIENT_ID',
    required: false,
    pattern: /^\d{12,}-[\w\d]+\.apps\.googleusercontent\.com$/,
    message: 'Must be a valid Google OAuth client ID',
    severity: LEVELS.WARN,
  },
  {
    key: 'YOUTUBE_CLIENT_SECRET',
    required: false,
    message: 'Required if YOUTUBE_CLIENT_ID is set',
    dependsOn: 'YOUTUBE_CLIENT_ID',
    severity: LEVELS.ERROR,
  },
  {
    key: 'YOUTUBE_API_KEY',
    required: false,
    pattern: /^AIza[0-9A-Za-z_-]{35}$/,
    message: 'Should be a valid YouTube Data API key',
    severity: LEVELS.WARN,
  },

  // ── Encryption ──
  {
    key: 'ENCRYPTION_KEY',
    required: false,
    minLength: 64,
    pattern: /^[0-9a-f]{64}$/i,
    message: '64-character hex string. Generate: openssl rand -hex 32',
    severity: LEVELS.WARN,
    condition: (env) => env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET,
  },

  // ── AI config ──
  {
    key: 'OLLAMA_HOST',
    required: false,
    pattern: /^https?:\/\/.+/,
    default: 'http://localhost:11434',
    message: 'Must be a valid URL (http://localhost:11434)',
    severity: LEVELS.WARN,
  },
  {
    key: 'OLLAMA_MODEL',
    required: false,
    message: 'Consider setting a specific model (e.g., llama3, mistral)',
    severity: LEVELS.INFO,
  },

  // ── Ports ──
  {
    key: 'PORT',
    required: false,
    pattern: /^\d+$/,
    default: '4000',
    minValue: 1024,
    maxValue: 65535,
    message: 'Must be between 1024 and 65535',
    severity: LEVELS.WARN,
  },

  // ── Security ──
  {
    key: 'COOKIE_SECURE',
    required: false,
    pattern: /^(true|false)$/i,
    default: 'false',
    message: 'Set to true in production for HTTPS cookies',
    severity: LEVELS.WARN,
    condition: (env) => env.NODE_ENV === 'production',
  },
  {
    key: 'CORS_ORIGINS',
    required: false,
    message: 'Consider restricting CORS in production',
    severity: LEVELS.INFO,
    condition: (env) => !process.env.CORS_ORIGINS && env.NODE_ENV === 'production',
  },

  // ── Performance ──
  {
    key: 'LOW_MEMORY_MODE',
    required: false,
    pattern: /^(true|false)$/i,
    default: 'false',
    message: 'Set to true on servers with <4GB RAM',
    severity: LEVELS.INFO,
  },
];

// ─── Parser ──────────────────────────────────────
function parseEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;

    let key = trimmed.substring(0, eqIdx).trim();
    let value = trimmed.substring(eqIdx + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Handle inline comments (only in unquoted values)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.substring(0, commentIdx).trim();
    }

    env[key] = value;
  }

  return { valid: true, env };
}

// ─── Validator ──────────────────────────────────
function validate(env, envPath) {
  const results = [];
  const errors = [];
  const warnings = [];
  const info = [];

  for (const rule of RULES) {
    const value = env[rule.key];
    const exists = value !== undefined && value !== '';
    const issues = [];

    // Skip check if value is conditional
    if (rule.condition && !rule.condition(env)) continue;

    // Required check
    if (rule.required && !exists) {
      issues.push({ type: 'missing', message: `Missing required variable: ${rule.key}` });
    }

    // Depends-on check
    if (rule.dependsOn && !exists && env[rule.dependsOn]) {
      issues.push({ type: 'missing', message: `Missing: ${rule.key} (required when ${rule.dependsOn} is set)` });
    }

    if (exists) {
      // Pattern check
      if (rule.pattern && !rule.pattern.test(value)) {
        issues.push({ type: 'invalid', message: `Invalid format for ${rule.key}: ${rule.message}` });
      }

      // Min length
      if (rule.minLength && value.length < rule.minLength) {
        issues.push({ type: 'too-short', message: `${rule.key} is too short (${value.length} < ${rule.minLength}). ${rule.message}` });
      }

      // Min value
      if (rule.minValue !== undefined) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num < rule.minValue) {
          issues.push({ type: 'out-of-range', message: `${rule.key}=${value}. ${rule.message}` });
        }
      }

      // Max value
      if (rule.maxValue !== undefined) {
        const num = parseInt(value, 10);
        if (isNaN(num) || num > rule.maxValue) {
          issues.push({ type: 'out-of-range', message: `${rule.key}=${value}. ${rule.message}` });
        }
      }

      // Check for placeholder values (always a warning regardless of rule severity)
      if (value === 'your-secret-key-here' || value === 'change-me' || value.includes('PLACEHOLDER') || value.includes('TODO')) {
        issues.push({ type: 'placeholder-warn', message: `${rule.key} still has a placeholder value` });
      }

      // Note production-length values (just info, not error)
      if (rule.severity === LEVELS.FATAL && value.length > 40 && env.NODE_ENV !== 'production') {
        issues.push({ type: 'info', message: `${rule.key}: ${value.length} chars (OK)` });
      }
    } else if (!rule.required && rule.default) {
      // Not set — suggest default
      issues.push({ type: 'default', message: `${rule.key} not set. Default: ${rule.default}` });
    }

    for (const issue of issues) {
      // Override severity if issue provides a specific type
      const severity = issue.type === 'info' ? LEVELS.INFO
        : issue.type === 'placeholder-warn' ? LEVELS.WARN
        : issue.type === 'dev-mode' ? LEVELS.WARN
        : rule.severity;

      const entry = {
        key: rule.key,
        type: issue.type,
        message: issue.message,
        severity: severity.label,
        severityCode: severity.code,
      };

      results.push(entry);

      if (entry.severityCode <= LEVELS.ERROR.code) {
        errors.push(entry);
      } else if (entry.severityCode === LEVELS.WARN.code) {
        if (CONFIG.strict) errors.push(entry);
        else warnings.push(entry);
      } else {
        info.push(entry);
      }
    }
  }

  return { results, errors, warnings, info, passed: errors.length === 0 };
}

// ─── Fix mode: generate .env from .env.example ──
function generateEnvFromExample(examplePath, outputPath) {
  if (!fs.existsSync(examplePath)) {
    console.error(`Example file not found: ${examplePath}`);
    return false;
  }

  const content = fs.readFileSync(examplePath, 'utf8');
  let output = content;
  let changed = false;

  // Generate random secrets for placeholders
  const needsGeneration = [
    { pattern: /JWT_SECRET=.*/, value: `JWT_SECRET=${crypto.randomBytes(64).toString('hex')}` },
    { pattern: /JWT_REFRESH_SECRET=.*/, value: `JWT_REFRESH_SECRET=${crypto.randomBytes(64).toString('hex')}` },
    { pattern: /OAUTH_STATE_SECRET=.*/, value: `OAUTH_STATE_SECRET=${crypto.randomBytes(32).toString('hex')}` },
    { pattern: /ENCRYPTION_KEY=.*/, value: `ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}` },
  ];

  for (const gen of needsGeneration) {
    // Check if placeholder exists and is not set
    const match = content.match(gen.pattern);
    if (match && (match[0].includes('your-') || match[0].includes('PLACEHOLDER') || match[0].includes('change-me') || match[0].endsWith('='))) {
      output = output.replace(match[0], gen.value);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(outputPath, output);
    return true;
  }
  return false;
}

// ─── Format output ──────────────────────────────
function formatHuman(results, stats) {
  const lines = [];

  if (stats.errors.length > 0) {
    lines.push('\x1b[31m── ERRORS ──────────────────────────────────────\x1b[0m');
    for (const err of stats.errors) {
      lines.push(`  \x1b[31m✖\x1b[0m ${err.message}`);
    }
    lines.push('');
  }

  if (stats.warnings.length > 0) {
    lines.push('\x1b[33m── WARNINGS ────────────────────────────────────\x1b[0m');
    for (const w of stats.warnings) {
      lines.push(`  \x1b[33m⚠\x1b[0m ${w.message}`);
    }
    lines.push('');
  }

  if (stats.info.length > 0) {
    lines.push('\x1b[36m── INFO ────────────────────────────────────────\x1b[0m');
    for (const i of stats.info) {
      lines.push(`  \x1b[36mℹ\x1b[0m ${i.message}`);
    }
    lines.push('');
  }

  if (stats.passed) {
    lines.push(`\x1b[32m✅ Environment valid — ${results.length} checks passed\x1b[0m`);
  } else {
    lines.push(`\x1b[31m❌ Environment has ${stats.errors.length} error(s) — fix before starting\x1b[0m`);
  }
  if (stats.warnings.length > 0) {
    lines.push(`\x1b[33m   ${stats.warnings.length} warning(s) — review recommended\x1b[0m`);
  }

  return lines.join('\n');
}

function formatJson(results, stats) {
  return JSON.stringify({ results, stats, timestamp: new Date().toISOString() }, null, 2);
}

// ─── Main ───────────────────────────────────────
function main() {
  // Determine env file path
  const fileFlagIdx = process.argv.indexOf('--file');
  const envPath = fileFlagIdx >= 0
    ? path.resolve(process.argv[fileFlagIdx + 1])
    : path.join(ROOT, '.env');

  if (CONFIG.fixMode) {
    const examplePaths = [
      path.join(ROOT, '.env.production.example'),
      path.join(ROOT, 'api', '.env.example'),
    ];

    let generated = false;
    for (const example of examplePaths) {
      const output = path.join(path.dirname(example), '.env');
      if (generateEnvFromExample(example, output)) {
        console.log(`\x1b[32mGenerated .env from ${path.basename(example)}\x1b[0m`);
        generated = true;
      }
    }

    if (!generated) {
      console.log('\x1b[33mNo placeholders found to replace. .env already configured.\x1b[0m');
    }
    return;
  }

  // Parse env
  const parsed = parseEnv(envPath);
  if (!parsed.valid) {
    console.error(`\x1b[31m${parsed.error}\x1b[0m`);

    // Try to generate from example
    const examplePath = envPath + '.example';
    if (fs.existsSync(examplePath)) {
      console.log(`\x1b[33mTip: Run with --fix to generate .env from .env.example\x1b[0m`);
    }
    process.exit(1);
  }

  // Validate
  const stats = validate(parsed.env, envPath);
  const { results } = stats;

  // Output
  if (CONFIG.jsonOutput) {
    console.log(formatJson(results, stats));
  } else {
    console.log(formatHuman(results, stats));
  }

  if (stats.errors.length > 0) {
    process.exit(1);
  }
}

main();
