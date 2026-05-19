/**
 * YouTube AI Platform — Health Monitor
 * 
 * Periodic health checks with auto-recovery.
 * Runs as a standalone process or as a module.
 *
 * Usage:
 *   node scripts/health-monitor.js              # Run once and exit
 *   node scripts/health-monitor.js --watch      # Watch mode (every 30s)
 *   node scripts/health-monitor.js --watch --interval 10  # Every 10s
 *   node scripts/health-monitor.js --recover    # Attempt auto-recovery
 */

const http = require('http');
const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'health-monitor.log');
const STATE_FILE = path.join(LOG_DIR, 'health-state.json');

const RECOVERY_SCRIPT = path.join(ROOT, 'scripts', 'dev-orchestrator.js');

// ─── Configuration ────────────────────────────────
const CONFIG = {
  apiPort: parseInt(process.env.API_PORT || '4000', 10),
  ollamaPort: 11434,
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3001', 10),
  recoveryRetries: 3,
  recoveryCooldownMs: 10000,
};

// ─── Logger ───────────────────────────────────────
function log(level, component, message, data) {
  const ts = new Date().toISOString();
  const prefix = component ? `[${component}]` : '[MONITOR]';
  const line = `${ts} ${prefix} ${level.toUpperCase()}: ${message}`;

  const colors = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m' };
  const color = colors[level] || colors.info;
  console.log(`${color}${line}\x1b[0m`);

  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ─── HTTP Check ──────────────────────────────────
function checkHttp(url, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode < 500, statusCode: res.statusCode, data: parsed });
        } catch {
          resolve({ ok: res.statusCode < 500, statusCode: res.statusCode });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

// ─── Component Checks ────────────────────────────
async function checkApi() {
  const url = `http://localhost:${CONFIG.apiPort}/api/health`;
  const result = await checkHttp(url);
  if (result.ok && result.data) {
    return {
      status: result.data.status === 'healthy' ? 'healthy' : 'degraded',
      uptime: result.data.uptime,
      checks: result.data.checks || {},
      latency: result.statusCode,
    };
  }
  return { status: 'down', error: result.error || 'no response', latency: 0 };
}

async function checkOllama() {
  const url = `http://localhost:${CONFIG.ollamaPort}/api/tags`;
  const result = await checkHttp(url, 2000);
  if (result.ok) {
    return { status: 'healthy', latency: result.statusCode };
  }
  return { status: 'down', error: result.error || 'no response' };
}

async function checkDashboard() {
  const url = `http://localhost:${CONFIG.dashboardPort}`;
  const result = await checkHttp(url, 3000);
  if (result.ok) {
    return { status: 'healthy', latency: result.statusCode };
  }
  return { status: 'down', error: result.error || 'no response' };
}

async function checkDocker(containerName) {
  try {
    const out = execSync(
      `docker ps --filter "name=${containerName}" --filter "health=healthy" --format "{{.Names}}"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return out.includes(containerName) ? 'healthy' : 'down';
  } catch {
    return 'down';
  }
}

// ─── Disk Check ─────────────────────────────────
function checkDisk() {
  try {
    const stats = fs.statfsSync(ROOT);
    const freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024);
    const totalGB = (stats.blocks * stats.bsize) / (1024 * 1024 * 1024);
    const usedPct = totalGB > 0 ? Math.round(((totalGB - freeGB) / totalGB) * 100) : 0;
    return { freeGB: Math.round(freeGB * 10) / 10, totalGB: Math.round(totalGB * 10) / 10, usedPct };
  } catch {
    return null;
  }
}

// ─── State Persistence ───────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { failures: {}, recoveryAttempts: {} };
}

function saveState(state) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// ─── Recovery Logic ──────────────────────────────
async function attemptRecovery(component, state) {
  const key = component;
  if (!state.recoveryAttempts[key]) state.recoveryAttempts[key] = 0;
  state.recoveryAttempts[key]++;

  if (state.recoveryAttempts[key] > CONFIG.recoveryRetries) {
    log('error', component, `Recovery failed after ${CONFIG.recoveryRetries} attempts. Manual intervention required.`);
    return false;
  }

  log('warn', component, `Attempting recovery (${state.recoveryAttempts[key]}/${CONFIG.recoveryRetries})...`);

  try {
    switch (component) {
      case 'api':
        // Restart the API process by killing and letting orchestrator restart it
        log('info', component, 'Restarting via orchestrator...');
        execSync(`start /B node "${RECOVERY_SCRIPT}"`, { timeout: 10000, stdio: 'pipe' });
        break;

      case 'postgres':
      case 'redis':
        const svcName = component === 'postgres' ? 'postgres' : 'redis';
        execSync(
          `docker compose -f "${path.join(ROOT, 'docker', 'docker-compose.local.yml')}" restart ${svcName}`,
          { timeout: 30000, stdio: 'pipe' }
        );
        break;

      case 'ollama':
        const proc = spawn('ollama', ['serve'], {
          stdio: 'ignore',
          detached: true,
          shell: process.platform === 'win32',
        });
        proc.unref();
        break;

      default:
        log('warn', component, `No recovery strategy for ${component}`);
        return false;
    }

    // Wait for component to recover
    await new Promise(r => setTimeout(r, CONFIG.recoveryCooldownMs));
    log('ok', component, 'Recovery attempt completed');
    return true;
  } catch (err) {
    log('error', component, `Recovery failed: ${err.message}`);
    return false;
  }
}

// ─── Main Check ─────────────────────────────────
async function runHealthCheck(watchMode = false) {
  const state = loadState();

  log('info', null, '═══════════════════════════════════════════════');
  log('info', null, `Health Check at ${new Date().toISOString()}`);
  log('info', null, '');

  const results = {};

  // Docker services
  for (const name of ['postgres', 'redis']) {
    const containerName = `yt-${name}`;
    const status = await checkDocker(containerName);
    results[name] = { status };
    const level = status === 'healthy' ? 'ok' : 'error';
    log(level, name, status === 'healthy' ? 'Healthy' : 'DOWN');
  }

  // Application services
  const api = await checkApi();
  results.api = api;
  const apiLevel = api.status === 'healthy' ? 'ok' : api.status === 'degraded' ? 'warn' : 'error';
  const checksDetail = api.checks ? ` (db:${api.checks.database?.status || '?'} redis:${api.checks.redis?.status || '?'} mem:${api.checks.memory?.status || '?'})` : '';
  log(apiLevel, 'api', `${api.status} — uptime ${Math.round(api.uptime || 0)}s${checksDetail}`);

  const ollama = await checkOllama();
  results.ollama = ollama;
  log(ollama.status === 'healthy' ? 'ok' : 'warn', 'ollama', ollama.status === 'healthy' ? 'Healthy' : `OFFLINE (${ollama.error})`);

  const dashboard = await checkDashboard();
  results.dashboard = dashboard;
  log(dashboard.status === 'healthy' ? 'ok' : 'info', 'dashboard', dashboard.status === 'healthy' ? 'Healthy' : `Unavailable (${dashboard.error || 'not started'})`);

  // Disk
  const disk = checkDisk();
  if (disk) {
    results.disk = disk;
    const diskLevel = disk.usedPct > 90 ? 'error' : disk.usedPct > 75 ? 'warn' : 'ok';
    log(diskLevel, 'disk', `${disk.usedPct}% used (${disk.freeGB}GB free of ${disk.totalGB}GB)`);
  }

  // ─── Auto-Recovery (only in watch mode) ─────
  if (watchMode) {
    const recoverFlag = process.argv.includes('--recover');
    const failed = [];

    if (results.api.status === 'down') failed.push('api');
    if (results.postgres?.status === 'down') failed.push('postgres');
    if (results.redis?.status === 'down') failed.push('redis');
    if (results.ollama?.status === 'down') failed.push('ollama');

    for (const component of failed) {
      if (state.failures[component] && Date.now() - state.failures[component] < 60000) {
        log('warn', component, 'Already failed recently — skipping recovery to avoid loop');
        continue;
      }
      state.failures[component] = Date.now();

      if (recoverFlag) {
        const recovered = await attemptRecovery(component, state);
        if (recovered) {
          state.recoveryAttempts[component] = 0;
          state.failures[component] = 0;
        }
      }
    }

    saveState(state);
  }

  // ─── Summary ────────────────────────────────
  const healthy = Object.entries(results).filter(([, v]) => v.status === 'healthy').length;
  const total = Object.keys(results).length;
  const allOk = healthy === total;
  log(allOk ? 'ok' : 'warn', null, `Status: ${healthy}/${total} components healthy`);
  log('info', null, '');

  return { ok: allOk, results };
}

// ─── CLI Entry ──────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes('--watch');
  const interval = parseInt(args.find(a => a.startsWith('--interval='))?.split('=')[1] || '30', 10);

  if (watchMode) {
    log('info', null, `Health Monitor running in WATCH mode (every ${interval}s)`);
    log('info', null, `PID: ${process.pid}`);
    log('info', null, '');

    // Run immediately
    await runHealthCheck(true);

    // Then run on interval
    setInterval(() => runHealthCheck(true), interval * 1000);
  } else {
    // Single run
    await runHealthCheck(false);
  }
}

// Handle signals gracefully if in watch mode
process.on('SIGINT', () => {
  log('info', null, 'Health Monitor stopped');
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  log('error', null, `Fatal: ${err.message}`);
  process.exit(1);
});
