const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const http = require('http');

const execAsync = promisify(exec);

const ROOT = path.join(__dirname, '..');
const BACKEND_PORT = 4000;
const FRONTEND_PORT = 3001;

let backendProcess = null;
let frontendProcess = null;

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[start-all] ${ts} ${msg}`);
}

function warn(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.warn(`[start-all] ${ts} ${msg}`);
}

function error(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.error(`[start-all] ${ts} ${msg}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── STEP 0: Check Node version ─────────────────────────────────────────────
function checkNodeVersion() {
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split('.')[0], 10);
  const stableMajors = [18, 20, 22];

  if (!stableMajors.includes(major)) {
    warn(`Node.js v${nodeVer} not LTS (use v20). Continuing anyway.`);
  } else {
    log(`Node.js v${nodeVer} (LTS compatible)`);
  }
}

// ─── STEP 1: Kill stale processes (NON-BLOCKING) ──────────────────────────
async function killStaleProcesses() {
  log('Step 1: Killing stale processes...');
  const MAX_KILL_WAIT_MS = 8000;

  const killPromises = [];
  const ports = [BACKEND_PORT, FRONTEND_PORT, 3000];

  for (const port of ports) {
    killPromises.push((async () => {
      try {
        const { stdout } = await execAsync(
          `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`,
          { timeout: 3000, maxBuffer: 1024 },
        );
        const pids = [...new Set(stdout.trim().split('\n').map(s => s.trim()).filter(Boolean))];
        for (const pid of pids) {
          try { await execAsync(`taskkill /F /PID ${pid}`, { timeout: 2000, maxBuffer: 128 }); log(`Killed PID ${pid} on port ${port}`); } catch {}
        }
      } catch {}
    })());
  }

  killPromises.push((async () => {
    try {
      const { stdout } = await execAsync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.ProcessId -ne ${process.pid} } | Select-Object -ExpandProperty ProcessId"`,
        { timeout: 3000, maxBuffer: 2048 },
      );
      const pids = [...new Set(stdout.trim().split('\n').map(s => s.trim()).filter(Boolean))];
      for (const pid of pids) {
        try { await execAsync(`taskkill /F /PID ${pid}`, { timeout: 2000, maxBuffer: 128 }); } catch {}
      }
      if (pids.length > 0) log(`Killed ${pids.length} other node process(es)`);
    } catch {}
  })());

  await Promise.race([
    Promise.allSettled(killPromises),
    sleep(MAX_KILL_WAIT_MS).then(() => warn(`Kill phase timed out after ${MAX_KILL_WAIT_MS}ms`)),
  ]);
}

// ─── STEP 2: Ensure Docker Redis (NON-BLOCKING) ──────────────────────────
async function ensureRedis() {
  log('Step 2: Checking Docker Redis...');
  try {
    const { stdout } = await execAsync(
      'docker ps --filter "name=yt-redis" --format "{{.Status}}"',
      { timeout: 5000, maxBuffer: 1024 },
    );
    if (stdout.trim().includes('Up') || stdout.trim().includes('healthy')) {
      log('Docker Redis is running');
      return true;
    }
  } catch {}

  warn('Redis not running. Starting via Docker Compose...');
  try {
    await execAsync(
      'docker compose -f docker/docker-compose.local.yml up -d redis',
      { cwd: ROOT, timeout: 30000, maxBuffer: 1024 },
    );
    log('Redis container started');
    await sleep(3000);
    return true;
  } catch (e) {
    warn(`Could not start Redis: ${e.message}. Running without queue features.`);
    return false;
  }
}

// ─── STEP 3: Start backend ──────────────────────────────────────────────────
function startBackend() {
  log('Step 3: Starting backend...');
  const apiDir = path.join(ROOT, 'api');
  backendProcess = spawn('node', [path.join(apiDir, 'scripts', 'start-backend.js')], {
    cwd: apiDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development', PORT: String(BACKEND_PORT) },
    shell: true,
  });
  backendProcess.stdout.on('data', (data) => process.stdout.write(`[backend] ${data}`));
  backendProcess.stderr.on('data', (data) => process.stderr.write(`[backend] ${data}`));
  backendProcess.on('error', (err) => error(`Backend failed: ${err.message}`));
  backendProcess.on('exit', (code) => { if (code !== 0 && code !== null) error(`Backend exited with code ${code}`); });
  log('Backend process launched');
}

// ─── STEP 4: Start frontend ─────────────────────────────────────────────────
function startFrontend() {
  log('Step 4: Starting frontend...');
  const dashboardDir = path.join(ROOT, 'apps', 'dashboard');
  frontendProcess = spawn('node', [path.join(dashboardDir, 'scripts', 'start-safe-dev.js')], {
    cwd: dashboardDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development', PORT: String(FRONTEND_PORT) },
    shell: true,
  });
  frontendProcess.stdout.on('data', (data) => process.stdout.write(`[frontend] ${data}`));
  frontendProcess.stderr.on('data', (data) => process.stderr.write(`[frontend] ${data}`));
  frontendProcess.on('error', (err) => error(`Frontend failed: ${err.message}`));
  frontendProcess.on('exit', (code) => { if (code !== 0 && code !== null) error(`Frontend exited with code ${code}`); });
  log('Frontend process launched');
}

// ─── STEP 5: Health check (PURE MONITORING — fire-and-forget) ────────────
async function checkHealthAsync() {
  let backendOk = false;
  let frontendOk = false;

  for (let i = 0; i < 40; i++) {
    if (!backendOk) {
      try {
        const res = await fetch(`http://localhost:${BACKEND_PORT}/health`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) backendOk = true;
      } catch {}
    }
    if (!frontendOk) {
      try {
        const res = await fetch(`http://localhost:${FRONTEND_PORT}/`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) frontendOk = true;
      } catch {}
    }
    if (backendOk && frontendOk) break;
    await sleep(2000);
  }

  log('Health check complete');
  log(`  Frontend (${FRONTEND_PORT}): ${backendOk ? '✔' : '✘'}`);
  log(`  Backend  (${BACKEND_PORT}): ${frontendOk ? '✔' : '✘'}`);
}

// ─── STEP 6: Enqueue async upload (fire-and-forget) ─────────────────────────
async function fireUploadJob() {
  // Wait for backend to be up (max 30s), then enqueue a test upload via API
  for (let i = 0; i < 15; i++) {
    try {
      const res = await fetch(`http://localhost:${BACKEND_PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {}
    await sleep(2000);
  }

  try {
    // Login to get auth token
    const loginRes = await fetch(`http://localhost:${BACKEND_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.TEST_EMAIL || 'test@youtube-ai-platform.com',
        password: process.env.TEST_PASSWORD || 'test123456',
      }),
      signal: AbortSignal.timeout(10000),
    });
    const loginData = await loginRes.json();
    const token = loginData?.token || loginData?.data?.token || null;

    if (!token) {
      // Try registering
      const regRes = await fetch(`http://localhost:${BACKEND_PORT}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.TEST_EMAIL || 'test@youtube-ai-platform.com',
          password: process.env.TEST_PASSWORD || 'test123456',
          name: 'Test User',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const regData = await regRes.json();
      const token = regData?.token || regData?.data?.token || null;
      if (!token) { log('Upload: No auth token (OAuth not configured?)'); return; }
    }

    // Fire test upload (async — don't wait)
    fetch(`http://localhost:${BACKEND_PORT}/api/test-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(300000),
    }).then(async (res) => {
      const result = await res.json();
      if (result.success) {
        log(`✔  Test upload SUCCESS — ${result.url}`);
      } else {
        log(`Upload: ${result.message || 'failed'}`);
      }
    }).catch((err) => {
      log(`Upload request failed: ${err.message}`);
    });

    log('Upload job dispatched (async)');
  } catch (err) {
    log(`Upload setup failed: ${err.message}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  YouTube AI Platform — System Start      ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  const startTime = Date.now();

  checkNodeVersion();
  await killStaleProcesses();
  await ensureRedis();
  startBackend();
  await sleep(2000);
  startFrontend();

  // Fire-and-forget health check + upload — never block the main flow
  const healthPromise = checkHealthAsync();
  const uploadPromise = fireUploadJob();

  // Don't await them — just print system info immediately
  const elapsed = Date.now() - startTime;
  console.log('');
  log(`Startup initiated (${elapsed}ms) — services starting in background`);
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  🎉 SYSTEM STARTING                      ║');
  console.log('╠═══════════════════════════════════════════╣');
  console.log(`║  Frontend: http://localhost:${FRONTEND_PORT}           ║`);
  console.log(`║  Backend:  http://localhost:${BACKEND_PORT}            ║`);
  console.log(`║  Health:   http://localhost:${BACKEND_PORT}/health      ║`);
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  // Wait for health in background (purely informational)
  await Promise.allSettled([healthPromise, uploadPromise]);
}

main().catch(err => {
  error(`Fatal: ${err.message}`);
  process.exit(1);
});
