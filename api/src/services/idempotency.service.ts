import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const LOCK_TTL_SEC = 30;
const IDEMPOTENCY_TTL_SEC = 86400;

export class IdempotencyService {
  async acquireLock(lockKey: string, ttlSec: number = LOCK_TTL_SEC): Promise<boolean> {
    try {
      const key = `lock:${lockKey}`;
      const result = await redisConnection.set(key, Date.now().toString(), 'PX', ttlSec * 1000, 'NX');
      return result === 'OK';
    } catch (err: any) {
      logger.warn(`[Idempotency] Lock acquire failed for ${lockKey}`, { error: err.message });
      return false;
    }
  }

  async releaseLock(lockKey: string): Promise<void> {
    try {
      await redisConnection.del(`lock:${lockKey}`);
    } catch { /* best effort */ }
  }

  async isAlreadyProcessed(jobKey: string): Promise<boolean> {
    try {
      const key = `idempotency:${jobKey}`;
      const exists = await redisConnection.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  async markProcessed(jobKey: string, ttlSec: number = IDEMPOTENCY_TTL_SEC): Promise<void> {
    try {
      const key = `idempotency:${jobKey}`;
      await redisConnection.setex(key, ttlSec, '1');
    } catch { /* best effort */ }
  }

  async deduplicate<T>(jobKey: string, fn: () => Promise<T>, ttlSec?: number): Promise<T | null> {
    if (await this.isAlreadyProcessed(jobKey)) {
      logger.debug(`[Idempotency] Skipping already processed job: ${jobKey}`);
      return null;
    }

    const lockAcquired = await this.acquireLock(jobKey, LOCK_TTL_SEC);
    if (!lockAcquired) {
      logger.debug(`[Idempotency] Another worker is processing: ${jobKey}`);
      return null;
    }

    try {
      if (await this.isAlreadyProcessed(jobKey)) {
        logger.debug(`[Idempotency] Double-check: already processed ${jobKey}`);
        return null;
      }

      const result = await fn();
      await this.markProcessed(jobKey, ttlSec);
      return result;
    } finally {
      await this.releaseLock(jobKey);
    }
  }

  async getLockOwner(lockKey: string): Promise<string | null> {
    try {
      const val = await redisConnection.get(`lock:${lockKey}`);
      return val;
    } catch {
      return null;
    }
  }
}

export const idempotency = new IdempotencyService();
