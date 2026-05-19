/**
 * YouTube AI Platform — Development Orchestrator
 * 
 * Starts all services programmatically with:
 * - Port availability checking
 * - Auto-restart on crash (max 3 retries)
 * - Status logging (RUNNING/FAILED/RESTARTING)
 * - Graceful shutdown on SIGINT/SIGTERM
 *
 * Usage: node scripts/dev-orchestrator.js
 *        node scripts/dev-orchestrator.js --skip-db
 *        node scripts/dev-orchestrator.js --skip-ollama
 */

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'logs', 'orchestrator.log');

// ─── Service Registry ────────────────────────────────
const SERVICES = [
  {
    id: 'postgres',
    name: 'PostgreSQL',
    type: 'docker',
    containerName: 'yt-postgres',
    composeFile: path.join(ROOT, 'docker', 'docker-compose.local.yml'),
    port: 5432,
    healthCheck: () => checkDockerHealthy('yt-postgres'),
    maxRetries: 1,
  },
  {
    id: 'redis',
    name: 'Redis',
    type: 'docker',
    containerName: 'yt-redis',
    composeFile: path.join(ROOT, 'docker', 'docker-compose.local.yml'),
    port: 6379,
    healthCheck: () => checkDockerHealthy('yt-redis'),
    maxRetries: 1,
  },
  {
    id: 'ollama',
    name: 'Ollama AI',
    type: 'process',
    command: 'ollama',
    args: ['serve'],
    port: 11434,
    healthCheck: () => checkHttp('http://localhost:11434/api/tags', 2000),
    maxRetries: 2,
    cwd: ROOT,
    skipFlag: '--skip-ollama',
  },
  {
    id: 'api',
    name: 'API Server',
    type: 'process',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['nodemon', '-r', 'dotenv/config', 'src/server.ts'],
    port: parseInt(process.env.API_PORT || '4000', 10),
    healthCheck: () => checkHttp(`http://localhost:${process.env.API_PORT || 4000}/api/health`, 5000),
    maxRetries: 3,
    cwd: path.join(ROOT, 'api'),
    env: { ...process.env, NODE_ENV: 'development' },
  },
  {
    id: 'dashboard',
    name: 'Dashboard',
    type: 'process',
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['next', 'dev'],
    port: parseInt(process.env.DASHBOARD_PORT || '3001', 10),
    healthCheck: () => checkHttp(`http://localhost:${process.env.DASHBOARD_PORT || 3001}`, 5000),
    maxRetries: 2,
    cwd: path.join(ROOT, 'apps', 'dashboard'),
    optional: true,
  },
];

// ─── State ──────────────────────────────────────────
const state = new Map();
let shuttingDown = false;

// ─── Logger ─────────────────────────────────────────
function log(level, serviceId, message) {
  const ts = new Date().toISOString();
  const prefix = serviceId ? `[${serviceId.toUpperCase()}]` : '[ORCH]';
  const line = `${ts} ${prefix} ${level.toUpperCase()}: ${message}`;

  // Console with colors
  const colors = {
    info: '\x1b[36m',
    ok: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m',
  };
  const color = colors[level] || colors.info;
  console.log(`${color}${line}\x1b[0m`);

  // File log
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// ─── Port Check ─────────────────────────────────────
function checkPort(port) {
  return new Promise((resolve) => {
    const server = require('net').createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

// ─── HTTP Health Check ─────────────────────────────
function checkHttp(url, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ─── Docker Health Check ──────────────────────────
function checkDockerHealthy(containerName) {
  try {
    const out = execSync(
      `docker ps --filter "name=${containerName}" --filter "health=healthy" --format "{{.Names}}"`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return out.includes(containerName);
  } catch {
    return false;
  }
}

// ─── Docker Start ──────────────────────────────────
async function startDockerService(service) {
  log('info', service.id, `Starting ${service.name} via Docker...`);
  try {
    execSync(
      `docker compose -f "${service.composeFile}" up -d ${service.containerName.replace('yt-', '')}`,
      { stdio: 'pipe', timeout: 60000 }
    );
    return true;
  } catch (err) {
    log('error', service.id, `Docker start failed: ${err.message}`);
    return false;
  }
}

// ─── Process Start ─────────────────────────────────
function startProcessService(service) {
  return new Promise((resolve) => {
    log('info', service.id, `Starting ${service.name}...`);

    const proc = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: { ...process.env, ...(service.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    state.set(service.id, {
      ...state.get(service.id),
      process: proc,
      startedAt: Date.now(),
    });

    proc.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) log('info', service.id, text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) log('warn', service.id, text);
    });

    proc.on('exit', (code, signal) => {
      const s = state.get(service.id);
      if (shuttingDown) {
        log('info', service.id, `Process exited (signal ${signal})`);
        return;
      }
      log('warn', service.id, `Process exited with code ${code}`);
      s.retries = (s.retries || 0) + 1;
      if (s.retries <= service.maxRetries) {
        log('warn', service.id, `Restarting (attempt ${s.retries}/${service.maxRetries})...`);
        setTimeout(() => startProcessService(service), 1000);
      } else {
        log('error', service.id, `Max retries reached. Service will not restart.`);
        s.status = 'FAILED';
      }
    });

    resolve(proc);
  });
}

// ─── Orchestrator ──────────────────────────────────
async function startService(service) {
  const skipFlags = process.argv.slice(2);
  if (service.skipFlag && skipFlags.includes(service.skipFlag)) {
    log('warn', service.id, `Skipping ${service.name} (${service.skipFlag} flag)`);
    return;
  }

  state.set(service.id, { status: 'STARTING', retries: 0, attempts: 0 });

  // Check port availability
  const portFree = await checkPort(service.port);
  if (!portFree) {
    // Port is in use — check if already healthy
    const healthy = await service.healthCheck();
    if (healthy) {
      log('ok', service.id, `Already running on port ${service.port}`);
      state.set(service.id, { status: 'RUNNING' });
      return;
    }
    log('warn', service.id, `Port ${service.port} in use but not healthy — attempting restart`);
  }

  if (service.type === 'docker') {
    const ok = await startDockerService(service);
    if (!ok) {
      state.set(service.id, { status: 'FAILED' });
      return;
    }
    // Wait for healthy
    log('info', service.id, 'Waiting for healthy status...');
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const healthy = await service.healthCheck();
      if (healthy) {
        log('ok', service.id, 'Healthy');
        state.set(service.id, { status: 'RUNNING' });
        return;
      }
    }
    log('error', service.id, 'Failed to become healthy within timeout');
    state.set(service.id, { status: 'FAILED' });
  } else {
    await startProcessService(service);

    // Wait for health check
    log('info', service.id, 'Waiting for service to become healthy...');
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const healthy = await service.healthCheck();
      if (healthy) {
        log('ok', service.id, `Healthy on port ${service.port}`);
        state.set(service.id, { status: 'RUNNING' });
        return;
      }
    }

    const s = state.get(service.id);
    if (service.optional) {
      log('warn', service.id, 'Not healthy but optional — continuing');
      state.set(service.id, { status: 'DEGRADED' });
    } else {
      log('error', service.id, 'Failed to become healthy within timeout');
      state.set(service.id, { status: 'FAILED' });
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Status Dashboard ──────────────────────────────
function printStatus() {
  console.clear();
  const now = Date.now();
  console.log('\x1b[96m╔══════════════════════════════════════════════════╗');
  console.log('║  YouTube AI Platform — Service Status          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Started: ${new Date(startTime).toISOString()}`);
  console.log('');

  for (const svc of SERVICES) {
    const s = state.get(svc.id) || { status: 'PENDING' };
    const uptime = s.startedAt ? ` (${Math.round((now - s.startedAt) / 1000)}s)` : '';
    let icon, color;
    switch (s.status) {
      case 'RUNNING': icon = '🟢'; color = '\x1b[32m'; break;
      case 'STARTING': icon = '🟡'; color = '\x1b[33m'; break;
      case 'DEGRADED': icon = '🟠'; color = '\x1b[33m'; break;
      case 'FAILED': icon = '🔴'; color = '\x1b[31m'; break;
      default: icon = '⚪'; color = '\x1b[90m'; break;
    }
    const retries = s.retries ? ` (retries: ${s.retries})` : '';
    console.log(`  ${icon} ${color}${svc.name.padEnd(20)} ${s.status.padEnd(12)}${uptime}${retries}\x1b[0m`);
  }

  console.log('');
  console.log('\x1b[90m  Press Ctrl+C to stop all services gracefully\x1b[0m');
}

// ─── Graceful Shutdown ────────────────────────────
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  log('info', null, '╔═══════════════════════════════════════════╗');
  log('info', null, '║  Graceful shutdown initiated...           ║');
  log('info', null, '╚═══════════════════════════════════════════╝');

  // Stop process-based services in reverse order
  for (const svc of [...SERVICES].reverse()) {
    const s = state.get(svc.id);
    if (s && s.process && !s.process.killed) {
      log('info', svc.id, 'Stopping...');
      s.process.kill('SIGTERM');
      // Give it 5 seconds, then SIGKILL
      setTimeout(() => {
        if (s.process && !s.process.killed) {
          s.process.kill('SIGKILL');
          log('warn', svc.id, 'Force killed');
        }
      }, 5000);
    }
  }

  log('info', null, 'All services stopped. Goodbye.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Main ─────────────────────────────────────────
const startTime = Date.now();

async function main() {
  log('info', null, 'YouTube AI Platform — Development Orchestrator');
  log('info', null, `Root: ${ROOT}`);
  log('info', null, '');

  // Start all services sequentially
  for (const svc of SERVICES) {
    try {
      await startService(svc);
    } catch (err) {
      log('error', svc.id, `Unexpected error: ${err.message}`);
    }
    printStatus();
  }

  // Start status refresh
  setInterval(printStatus, 5000);

  // Final status
  printStatus();

  const running = SERVICES.filter(s => {
    const st = state.get(s.id);
    return st && (st.status === 'RUNNING' || st.status === 'DEGRADED');
  }).length;
  const total = SERVICES.filter(s => !s.optional && !s.skipFlag).length;

  log('info', null, `╔═══════════════════════════════════════════╗`);
  log('info', null, `║  ${running}/${total} services running                     ║`);
  log('info', null, `╚═══════════════════════════════════════════╝`);
}

main().catch((err) => {
  log('error', null, `Orchestrator failed: ${err.message}`);
  process.exit(1);
});
