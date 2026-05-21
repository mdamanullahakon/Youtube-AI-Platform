const fs = require('fs');
const path = require('path');

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 100;
const JITTER_MAX = 100;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getJitteredDelay() {
  return BASE_DELAY_MS + Math.floor(Math.random() * JITTER_MAX);
}

function log(msg) {
  console.log(`[safe-fs] ${msg}`);
}

function warn(msg) {
  console.warn(`[safe-fs] ${msg}`);
}

function isRetryableError(err) {
  return err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES' || err.code === 'ENOENT';
}

async function safeRename(src, dest, label = '') {
  const tag = label ? ` (${label})` : '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.renameSync(src, dest);
      if (attempt > 1) log(`rename succeeded on attempt ${attempt}${tag}`);
      return true;
    } catch (err) {
      if (isRetryableError(err)) {
        warn(`rename EPERM${tag} (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const delay = getJitteredDelay();
          await sleep(delay);
        }
      } else {
        throw err;
      }
    }
  }
  warn(`rename failed after ${MAX_RETRIES} attempts${tag}, trying copy fallback`);
  try {
    const content = fs.readFileSync(src);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    fs.writeFileSync(dest, content);
    try { fs.unlinkSync(src); } catch { }
    return true;
  } catch (fallbackErr) {
    warn(`copy fallback also failed${tag}: ${fallbackErr.message}`);
    return false;
  }
}

async function safeWriteFile(filePath, content, label = '') {
  const tag = label ? ` (${label})` : '';
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = filePath + '.tmp';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.writeFileSync(tmpPath, content);
      const renamed = await safeRename(tmpPath, filePath, label);
      if (renamed) return true;
    } catch (err) {
      if (isRetryableError(err)) {
        warn(`write EPERM${tag} (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const delay = getJitteredDelay();
          await sleep(delay);
        }
      } else {
        throw err;
      }
    }
  }

  warn(`write failed after ${MAX_RETRIES} attempts${tag}, trying direct write`);
  try {
    fs.writeFileSync(filePath, content);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { }
    return true;
  } catch (finalErr) {
    warn(`direct write also failed${tag}: ${finalErr.message}`);
    return false;
  }
}

async function safeDeleteDir(dirPath) {
  if (!fs.existsSync(dirPath)) return true;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return true;
    } catch (err) {
      if (isRetryableError(err)) {
        warn(`delete EPERM (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const delay = getJitteredDelay();
          await sleep(delay);
        }
      } else {
        warn(`delete error (non-retryable): ${err.message}`);
        return false;
      }
    }
  }

  warn('Retry limit reached, trying per-file forced deletion...');
  try {
    const deleteRecursive = (dir) => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        try {
          fs.chmodSync(fullPath, 0o666);
        } catch { }
        try {
          if (entry.isDirectory()) {
            deleteRecursive(fullPath);
          } else {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {
          warn(`  could not delete ${entry.name}: ${e.message}`);
        }
      }
      try { fs.rmdirSync(dir); } catch (e) { warn(`  could not remove dir ${dir}: ${e.message}`); }
    };
    deleteRecursive(dirPath);
  } catch { }

  return !fs.existsSync(dirPath);
}

async function safeDeleteFile(filePath) {
  if (!fs.existsSync(filePath)) return true;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (err) {
      if (isRetryableError(err)) {
        warn(`unlink EPERM (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
        if (attempt < MAX_RETRIES) {
          const delay = getJitteredDelay();
          await sleep(delay);
        }
      } else {
        return false;
      }
    }
  }
  return false;
}

async function safeReadFile(filePath) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (isRetryableError(err) && attempt < MAX_RETRIES) {
        const delay = getJitteredDelay();
        await sleep(delay);
      } else {
        throw err;
      }
    }
  }
}

module.exports = {
  safeRename,
  safeWriteFile,
  safeDeleteDir,
  safeDeleteFile,
  safeReadFile,
  sleep,
  getJitteredDelay,
};
