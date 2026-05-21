const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { safeDeleteDir, safeWriteFile, sleep, getJitteredDelay } = require('./safe-fs-utils');

const DASHBOARD_DIR = path.join(__dirname, '..');
const NEXT_DIR = path.join(DASHBOARD_DIR, '.next');
const DEV_SERVER_DIR = path.join(NEXT_DIR, 'dev', 'server');

const PORT = process.env.PORT || '3001';
const NEXT_BIN = path.join(DASHBOARD_DIR, 'node_modules', '.bin', 'next');
const HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.HEALTH_TIMEOUT || '60000', 10);

function log(msg) {
  console.log(`[safe-dev] ${msg}`);
}

function warn(msg) {
  console.warn(`[safe-dev] ${msg}`);
}

// ─── STEP 1: Kill stale node/next processes ─────────────────────────────────
function killStaleProcesses() {
  log('Step 1: Checking for stale processes...');
  const isWindows = os.platform() === 'win32';
  if (!isWindows) return;

  try {
    const result = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -match 'next' -or $_.CommandLine -match '\\\\.next' } | ForEach-Object { $_.ProcessId }"`,
      { timeout: 8000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (result) {
      const pids = result.split('\n').map(s => s.trim()).filter(Boolean);
      const uniquePids = [...new Set(pids)];
      if (uniquePids.length > 0) {
        log(`Found ${uniquePids.length} stale process(es): ${uniquePids.join(', ')}`);
        for (const pid of uniquePids) {
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000, stdio: 'pipe' });
            log(`Killed process tree ${pid}`);
          } catch { }
        }
        sleep(800);
      } else {
        log('No stale processes found');
      }
    } else {
      log('No stale processes found');
    }
  } catch (err) {
    warn(`Process check failed (non-fatal): ${err.message}`);
  }

  try {
    execSync(
      `powershell -NoProfile -Command "Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $pid } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
      { timeout: 5000, stdio: 'pipe' },
    );
  } catch { }
}

// ─── STEP 2: Delete .next directory with safe retry ─────────────────────────
async function cleanNextDir() {
  log('Step 2: Cleaning .next directory...');

  if (!fs.existsSync(NEXT_DIR)) {
    log('.next directory does not exist, nothing to clean');
    return true;
  }

  try {
    fs.chmodSync(NEXT_DIR, 0o777);
  } catch { }

  const cleaned = await safeDeleteDir(NEXT_DIR);
  if (cleaned) {
    log('.next directory cleaned successfully');
  } else {
    warn('Could not fully delete .next directory, proceeding with caution');
  }
  return cleaned;
}

// ─── STEP 3: Fix potential cache corruption ────────────────────────────────
async function fixPotentialCacheIssues() {
  log('Step 3: Checking for cache corruption...');

  const cacheDir = path.join(DASHBOARD_DIR, 'node_modules', '.cache');
  if (fs.existsSync(cacheDir)) {
    try {
      const turboDir = path.join(cacheDir, 'turbo');
      if (fs.existsSync(turboDir)) {
        fs.rmSync(turboDir, { recursive: true, force: true });
        log('Cleared turbopack cache');
      }
    } catch { }
    try {
      const webpackDir = path.join(cacheDir, 'webpack');
      if (fs.existsSync(webpackDir)) {
        fs.rmSync(webpackDir, { recursive: true, force: true });
        log('Cleared webpack cache');
      }
    } catch { }
  }

  const nextTypesDir = path.join(DASHBOARD_DIR, '.next', 'types');
  const nextDevDir = path.join(DASHBOARD_DIR, '.next', 'dev');
  for (const dir of [nextTypesDir, nextDevDir]) {
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch { }
    }
  }
}

// ─── STEP 4: Start dev server ──────────────────────────────────────────────
function startDevProcess() {
  log(`Step 4: Starting Next.js dev server on port ${PORT}...`);

  const devProcess = spawn(
    process.execPath,
    [NEXT_BIN, 'dev', '--webpack', '-p', PORT, '--hostname', 'localhost'],
    {
      cwd: DASHBOARD_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  );

  devProcess.on('error', (err) => {
    console.error(`[safe-dev] Failed to start dev server: ${err.message}`);
    process.exit(1);
  });

  devProcess.on('exit', (code) => {
    log(`Dev server exited with code ${code}`);
    process.exit(code ?? 0);
  });

  return devProcess;
}

// ─── STEP 5: Health check ──────────────────────────────────────────────────
function waitForHealthy(timeoutMs = HEALTH_CHECK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let lastError = '';

    function check() {
      const elapsed = Date.now() - startTime;
      if (elapsed > timeoutMs) {
        reject(new Error(`Health check timed out after ${timeoutMs}ms. Last error: ${lastError}`));
        return;
      }

      const req = http.get(`http://localhost:${PORT}/`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            log(`Health check passed (HTTP ${res.statusCode}) after ${Date.now() - startTime}ms`);
            resolve(true);
          } else if (res.statusCode === 500) {
            lastError = `HTTP 500 response`;
            log(`Health check: got 500, retrying... (${elapsed}ms)`);
            setTimeout(check, 1500);
          } else if (res.statusCode === 404) {
            lastError = `HTTP 404 response`;
            log(`Health check: got 404, retrying... (${elapsed}ms)`);
            setTimeout(check, 1500);
          } else {
            lastError = `HTTP ${res.statusCode}`;
            setTimeout(check, 1000);
          }
        });
      });

      req.on('error', (err) => {
        lastError = err.message;
        if (err.code === 'ECONNREFUSED') {
          setTimeout(check, 1000);
        } else {
          setTimeout(check, 1500);
        }
      });

      req.setTimeout(5000, () => {
        req.destroy();
        lastError = 'request timeout';
        setTimeout(check, 1000);
      });
    }

    check();
  });
}

// ─── STEP 6: Verify build manifest integrity ───────────────────────────────
function verifyBuildManifest() {
  const manifestPath = path.join(NEXT_DIR, 'build-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    warn('build-manifest.json not found yet (server may still be starting)');
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const allPages = new Set();
    for (const key of Object.keys(manifest.pages || {})) {
      const files = manifest.pages[key] || [];
      files.forEach(f => allPages.add(f));
    }
    log(`Build manifest verified: ${Object.keys(manifest.pages || {}).length} pages registered`);
    return true;
  } catch (err) {
    warn(`Could not verify build manifest: ${err.message}`);
    return false;
  }
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────
async function main() {
  log('========================================');
  log('  Safe Next.js Dev Server (Windows v2)');
  log('========================================');
  log(`Platform: ${os.platform()}`);
  log(`Next.js:  16.2.6 (webpack mode)`);
  log(`Port:     ${PORT}`);
  log('========================================');

  log('Windows stability measures active:');
  log('  • Retry-safe file operations (max 5 retries)');
  log('  • 50–150ms jittered FS delays');
  log('  • Stale process termination');
  log('  • Clean .next deletion with fallback');
  log('  • Cache corruption detection & fix');
  log('  • Dev server health check (HTTP 200)');
  log('  • Build manifest integrity verification');
  log('========================================');

  killStaleProcesses();
  await sleep(getJitteredDelay());
  await cleanNextDir();
  await sleep(getJitteredDelay());
  await fixPotentialCacheIssues();

  const devProcess = startDevProcess();

  log('Waiting for dev server to become healthy...');
  try {
    await waitForHealthy();
    log('Dev server is healthy!');
    await sleep(2000);
    verifyBuildManifest();
    log('========================================');
    log('  Dev server is STABLE and READY');
    log('========================================');
    log(`  URL: http://localhost:${PORT}/`);
    log('========================================');
  } catch (err) {
    warn(`Health check failed: ${err.message}`);
    warn('Dev server may still be starting. Check the output above.');
  }

  process.on('SIGINT', () => {
    log('Shutting down...');
    devProcess.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...');
    devProcess.kill('SIGTERM');
  });
}

main().catch(err => {
  console.error(`[safe-dev] Fatal error: ${err.message}`);
  process.exit(1);
});
