import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';

const UPLOAD_COST = 1605;
const DAILY_QUOTA = 10000;
const SAFE_THRESHOLD = 2000;
const QUOTA_KEY_PREFIX = 'youtube:quota:usage:';
const LOCK_KEY_PREFIX = 'youtube:quota:lock:';

export class QuotaManager {
  async preCheck(channelId: string): Promise<{ canUpload: boolean; remaining: number; resetAt: Date }> {
    try {
      const today = this.todayKey();
      const used = await this.getDailyUsage(channelId, today);
      const remaining = DAILY_QUOTA - used;

      if (remaining < SAFE_THRESHOLD) {
        const resetAt = this.nextReset();
        logger.warn(`[QuotaManager] Channel ${channelId} quota low: ${remaining} units remaining, reset at ${resetAt.toISOString()}`);
        return { canUpload: false, remaining, resetAt };
      }

      return { canUpload: true, remaining, resetAt: this.nextReset() };
    } catch (err: any) {
      logger.warn(`[QuotaManager] preCheck failed for ${channelId}: ${err.message}`);
      return { canUpload: true, remaining: DAILY_QUOTA, resetAt: this.nextReset() };
    }
  }

  async recordUsage(channelId: string, units: number = UPLOAD_COST): Promise<void> {
    try {
      const today = this.todayKey();
      const key = `${QUOTA_KEY_PREFIX}${channelId}:${today}`;
      await redisConnection.incrby(key, units);
      await redisConnection.expire(key, 86400);
      const used = await this.getDailyUsage(channelId, today);
      logger.info(`[QuotaManager] Channel ${channelId}: +${units} units (total: ${used}/${DAILY_QUOTA})`);

      await prisma.youTubeAccount.updateMany({
        where: { channelId },
        data: { lastSyncedAt: new Date() },
      }).catch(() => {});
    } catch (err: any) {
      logger.warn(`[QuotaManager] recordUsage failed: ${err.message}`);
      throw err;
    }
  }

  async getStatus(channelId: string): Promise<{ used: number; remaining: number; total: number; resetAt: Date }> {
    const today = this.todayKey();
    const used = await this.getDailyUsage(channelId, today);
    return { used, remaining: Math.max(0, DAILY_QUOTA - used), total: DAILY_QUOTA, resetAt: this.nextReset() };
  }

  async resetDaily(channelId?: string): Promise<void> {
    const today = this.todayKey();
    if (channelId) {
      await redisConnection.del(`${QUOTA_KEY_PREFIX}${channelId}:${today}`);
    } else {
      const keys = await redisConnection.keys(`${QUOTA_KEY_PREFIX}*:${today}`);
      if (keys.length > 0) await redisConnection.del(...keys);
    }
  }

  private async getDailyUsage(channelId: string, dateKey: string): Promise<number> {
    const val = await redisConnection.get(`${QUOTA_KEY_PREFIX}${channelId}:${dateKey}`);
    return val ? parseInt(val, 10) : 0;
  }

  private todayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private nextReset(): Date {
    const next = new Date();
    next.setUTCHours(24, 0, 0, 0);
    return next;
  }
}

export const quotaManager = new QuotaManager();
