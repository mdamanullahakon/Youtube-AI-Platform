const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const API_DIR = path.join(__dirname, '..');
const LOG_DIR = path.join(API_DIR, 'logs');
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_WINDOW_MS = 30000;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[backend] ${ts} ${msg}`);
}

function warn(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.warn(`[backend] ${ts} ${msg}`);
}

function error(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[backend] ${ts} ${msg}`);
}

log('========================================');
log('  Safe Backend Server (Windows v1)');
log('========================================');

// ─── STEP 1: Check Node.js version ──────────────────────────────────────────
log('Step 1: Checking Node.js version...');
const nodeVersion = process.versions.node;
const major = parseInt(nodeVersion.split('.')[0], 10);
const LTS_MAJOR = 20;
const STABLE_MAJORS = [18, 20, 22];

if (!STABLE_MAJORS.includes(major)) {
  warn(`Node.js v${nodeVersion} is NOT an LTS release (recommended: v${LTS_MAJOR})`);
  warn(`Unstable Node.js v${major} may cause cryptic crashes due to V8/API changes.`);
  warn(`Install Node.js v${LTS_MAJOR} LTS from https://nodejs.org/`);
  warn('Continuing with current version — you may encounter instability.');
} else {
  log(`Node.js v${nodeVersion} (LTS compatible) — OK`);
}

// ─── STEP 2: Check for Docker Redis ─────────────────────────────────────────
log('Step 2: Checking Redis availability...');
let redisViaDocker = false;
try {
  const dockerPs = execSync(
    'docker ps --filter "name=yt-redis" --format "{{.ID}} {{.Image}} {{.Status}}"',
    { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  if (dockerPs) {
    log(`Docker Redis found: ${dockerPs}`);
    redisViaDocker = true;
  } else {
    warn('Docker Redis container is not running.');
    warn('Start it with: npm run db:up (from root) or docker compose -f docker/docker-compose.local.yml up -d');
  }
} catch (e) {
  warn('Docker not available. Redis must be running separately.');
}

// ─── STEP 3: Ensure log directory exists ────────────────────────────────────
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─── STEP 4: Global error handlers ─────────────────────────────────────────
process.on('uncaughtException', (err) => {
  error('═══════════════════════════════════════');
  error('  UNCAUGHT EXCEPTION (fatal)');
  error('═══════════════════════════════════════');
  error(`  Message: ${err.message}`);
  error(`  Code: ${(err).code || 'N/A'}`);
  error(`  Stack:`);
  error(err.stack || '  (no stack trace)');
  error('═══════════════════════════════════════');

  const logFile = path.join(LOG_DIR, `crash-${Date.now()}.log`);
  fs.writeFileSync(logFile, JSON.stringify({
    type: 'uncaughtException',
    timestamp: new Date().toISOString(),
    message: err.message,
    code: err.code,
    stack: err.stack,
  }, null, 2));
  error(`Crash logged to: ${logFile}`);

  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  warn('═══════════════════════════════════════');
  warn('  UNHANDLED REJECTION');
  warn('═══════════════════════════════════════');
  warn(`  Message: ${err.message}`);
  warn(`  Stack:`);
  warn(err.stack || '  (no stack trace)');
  warn('═══════════════════════════════════════');

  try {
    const logFile = path.join(LOG_DIR, `rejection-${Date.now()}.log`);
    fs.writeFileSync(logFile, JSON.stringify({
      type: 'unhandledRejection',
      timestamp: new Date().toISOString(),
      message: err.message,
      stack: err.stack,
    }, null, 2));
  } catch { }
});

// ─── STEP 5: Start the server with ts-node ─────────────────────────────────
log('Step 5: Starting API server...');

// Kill any previous API process on the port
const PORT = process.env.PORT || '4000';
try {
  const netstatOutput = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
    { timeout: 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
  if (netstatOutput) {
    const pids = netstatOutput.split('\n').map(s => s.trim()).filter(Boolean);
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { timeout: 3000, stdio: 'pipe' });
        log(`Killed stale process ${pid} on port ${PORT}`);
      } catch { }
    }
  }
} catch { }

const serverProcess = spawn(
  'npx.cmd',
  ['ts-node', '-r', 'dotenv/config', 'src/server.ts'],
  {
    cwd: API_DIR,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      TS_NODE_TRANSPILE_ONLY: 'true',
    },
    shell: true,
  },
);

serverProcess.stdout.on('data', (data) => {
  process.stdout.write(data);
});

serverProcess.stderr.on('data', (data) => {
  process.stderr.write(data);
});

serverProcess.on('error', (err) => {
  error(`Failed to start server: ${err.message}`);
  process.exit(1);
});

serverProcess.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    error(`Server exited with code ${code}`);
    log('Check crash logs in api/logs/crash-*.log for details.');
  } else {
    log(`Server exited gracefully with code ${code}`);
  }
  process.exit(code ?? 0);
});

// Forward signals
process.on('SIGINT', () => {
  log('Received SIGINT, forwarding to server...');
  serverProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  log('Received SIGTERM, forwarding to server...');
  serverProcess.kill('SIGTERM');
});

log(`Backend server starting on port ${PORT}...`);
