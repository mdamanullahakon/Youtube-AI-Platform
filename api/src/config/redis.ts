import IORedis, { RedisOptions } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const maxRetries = parseInt(process.env.REDIS_MAX_RETRIES || '10', 10);
const isProduction = process.env.NODE_ENV === 'production';
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

// Patch BullMQ RedisConnection to accept older Redis versions
try {
  const bullmqPath = require.resolve('bullmq/dist/cjs/classes/redis-connection');
  const { RedisConnection: BullMqRedisConnection } = require(bullmqPath);
  if (BullMqRedisConnection?.minimumVersion > '3.0.0') {
    BullMqRedisConnection.minimumVersion = '3.2.0';
  }
} catch {
  // BullMQ not yet installed or different version layout
}

export const redisConnection = new IORedis(REDIS_URL, redisOptions);

redisConnection.on('connect', () => {
  console.log('[Redis] Connected');
});

redisConnection.on('ready', () => {
  console.log('[Redis] Ready');
});

redisConnection.on('error', (err: Error) => {
  console.error('[Redis] Error:', err.message);
});

redisConnection.on('close', () => {
  console.warn('[Redis] Connection closed');
});

redisConnection.on('reconnecting', (delay: number) => {
  console.log(`[Redis] Reconnecting in ${delay}ms...`);
});

redisConnection.on('end', () => {
  console.error('[Redis] Connection ended (all retries exhausted)');
});

// Graceful shutdown
export async function disconnectRedis(): Promise<void> {
  console.log('[Redis] Disconnecting...');
  await redisConnection.quit();
}
