// Patch BullMQ RedisConnection to accept Redis 3.x (our local version)
// This is a temporary workaround until Redis is upgraded to >= 5.0
try {
  const bullmq = require('bullmq');
  if (bullmq.RedisConnection) {
    bullmq.RedisConnection.minimumVersion = '3.2.0';
    console.log('[RedisPatch] BullMQ minimumVersion patched to 3.2.0');
  }
} catch {
  // BullMQ may not be loaded yet
}

export {};
