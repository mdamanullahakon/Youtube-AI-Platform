const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { safeDeleteDir, getJitteredDelay, sleep } = require('./safe-fs-utils');

const DASHBOARD_DIR = path.join(__dirname, '..');
const NEXT_DIR = path.join(DASHBOARD_DIR, '.next');

function log(msg) {
  console.log(`[clean-dev] ${msg}`);
}

function warn(msg) {
  console.warn(`[clean-dev] ${msg}`);
}

function killStaleProcesses() {
  const isWindows = os.platform() === 'win32';
  if (!isWindows) return;

  try {
    const result = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='node.exe'\\" | Where-Object { $_.CommandLine -match 'next' -or $_.CommandLine -match '\\\\.next' } | ForEach-Object { $_.ProcessId }"`,
      { timeout: 8000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (result) {
      const pids = [...new Set(result.split('\n').map(s => s.trim()).filter(Boolean))];
      if (pids.length > 0) {
        log(`Killing ${pids.length} stale process(es): ${pids.join(', ')}`);
        for (const pid of pids) {
          try {
            execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000, stdio: 'pipe' });
          } catch { }
        }
      }
    }
  } catch { }

  try {
    execSync(
      `powershell -NoProfile -Command "Get-Process -Name 'node' -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $pid } | Stop-Process -Force -ErrorAction SilentlyContinue"`,
      { timeout: 5000, stdio: 'pipe' },
    );
  } catch { }
}

async function cleanAllCaches() {
  log('Clearing turbo/webpack caches...');
  const cacheDirs = [
    path.join(DASHBOARD_DIR, 'node_modules', '.cache', 'turbo'),
    path.join(DASHBOARD_DIR, 'node_modules', '.cache', 'webpack'),
    path.join(DASHBOARD_DIR, '.next', 'dev'),
    path.join(DASHBOARD_DIR, '.next', 'types'),
    path.join(DASHBOARD_DIR, '.next', 'cache'),
  ];
  for (const dir of cacheDirs) {
    if (fs.existsSync(dir)) {
      try {
        await safeDeleteDir(dir);
      } catch { }
    }
  }
}

async function main() {
  log('Starting comprehensive Next.js dev cleanup...');
  log('');

  log('Phase 1: Killing stale processes...');
  killStaleProcesses();
  await sleep(getJitteredDelay());

  log('Phase 2: Deleting .next directory...');
  const cleaned = await safeDeleteDir(NEXT_DIR);
  if (cleaned) {
    log('.next directory deleted successfully');
  } else {
    warn('.next deletion had issues, continuing...');
  }

  log('Phase 3: Clearing caches...');
  await cleanAllCaches();

  log('');
  if (cleaned) {
    log('Cleanup completed successfully');
    process.exit(0);
  } else {
    warn('Cleanup completed with warnings');
    process.exit(0);
  }
}

main();
