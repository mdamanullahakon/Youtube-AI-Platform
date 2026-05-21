import IORedis, { RedisOptions } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '10', 10);
const tlsEnabled = process.env.REDIS_TLS_ENABLED === 'true';

const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  retryStrategy: (times: number) => {
    if (times >= maxRetries) {
      console.error(`[Redis] Max retries (${maxRetries}) reached. Giving up.`);
      return null;
    }
    const delay = Math.min(Math.pow(2, times) * 200, 30000);
    console.warn(`[Redis] Reconnecting attempt ${times + 1}/${maxRetries} in ${delay}ms...`);
    return delay;
  },
  reconnectOnError: (err: Error) => {
    const targetError = 'READONLY';
    if (err.message.includes(targetError)) {
      console.warn('[Redis] READONLY mode detected. Reconnecting...');
      return true;
    }
    return false;
  },
  lazyConnect: true,
  keepAlive: 10000,
  connectTimeout: 10000,
};

if (tlsEnabled) {
  redisOptions.tls = {};
  redisOptions.host = process.env.REDIS_HOST || undefined;
  redisOptions.port = parseInt(process.env.REDIS_PORT || '6380', 10);
}

export const redisConnection = new IORedis(REDIS_URL, redisOptions);

let _redisMajorVersion: number | null = null;

export async function detectRedisVersion(): Promise<number> {
  if (_redisMajorVersion !== null) return _redisMajorVersion;
  try {
    if (redisConnection.status !== 'ready') {
      await redisConnection.connect();
    }
    const info = await redisConnection.info('server');
    const match = info.match(/redis_version:(\d+)\.\d+\.\d+/);
    _redisMajorVersion = match ? parseInt(match[1], 10) : 0;
    console.log(`[Redis] Detected version: ${match ? match[0] : 'unknown'}`);
  } catch (err: any) {
    console.error(`[Redis] Version detection failed: ${err.message}`);
    _redisMajorVersion = 0;
  }
  return _redisMajorVersion;
}

export function getRedisMajorVersion(): number | null {
  return _redisMajorVersion;
}

export function isRedisCompatible(): boolean {
  return _redisMajorVersion !== null && _redisMajorVersion >= 5;
}

redisConnection.on('connect', () => {
  console.log('[Redis] Connected');
});

redisConnection.on('ready', () => {
  console.log('[Redis] Ready');
});

redisConnection.on('error', (err: Error) => {
  const msg = err.message || '';
  if (msg.includes('ECONNREFUSED') || msg.includes('ENETUNREACH')) {
    console.warn('[Redis] Connection refused — will retry automatically');
  } else {
    console.error('[Redis] Error:', msg);
  }
});

redisConnection.on('close', () => {
  console.warn('[Redis] Connection closed');
});

redisConnection.on('reconnecting', (delay: number) => {
  console.log(`[Redis] Reconnecting in ${delay}ms...`);
});

redisConnection.on('end', () => {
  console.error('[Redis] Connection ended (all retries exhausted)');
  console.warn('[Redis] Queue features will be unavailable until Redis is restarted');
});

// Graceful shutdown
export async function disconnectRedis(): Promise<void> {
  console.log('[Redis] Disconnecting...');
  await redisConnection.quit();
}
