import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

const HOURLY_LIMIT = 2;
const DAILY_LIMIT = 10;
const HOURLY_PREFIX = 'youtube:rate:hourly:';
const DAILY_PREFIX = 'youtube:rate:daily:';

export class ChannelLimiter {
  async check(channelId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    try {
      const [hourly, daily] = await Promise.all([
        this.getHourlyCount(channelId),
        this.getDailyCount(channelId),
      ]);

      if (hourly >= HOURLY_LIMIT) {
        return { allowed: false, retryAfterSeconds: 3600 };
      }
      if (daily >= DAILY_LIMIT) {
        return { allowed: false, retryAfterSeconds: 86400 };
      }

      return { allowed: true, retryAfterSeconds: 0 };
    } catch (err: any) {
      logger.warn(`[ChannelLimiter] check failed for ${channelId}: ${err.message}`);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  async recordUpload(channelId: string): Promise<void> {
    try {
      const now = Date.now();
      const hourKey = `${HOURLY_PREFIX}${channelId}:${this.hourKey()}`;
      const dayKey = `${DAILY_PREFIX}${channelId}:${this.dayKey()}`;

      await Promise.all([
        redisConnection.incr(hourKey).then(() => redisConnection.expire(hourKey, 7200)),
        redisConnection.incr(dayKey).then(() => redisConnection.expire(dayKey, 90000)),
      ]);

      await redisConnection.zadd(`youtube:rate:timeline:${channelId}`, now, `${now}`);
    } catch (err: any) {
      logger.warn(`[ChannelLimiter] recordUpload failed: ${err.message}`);
      throw err;
    }
  }

  private async getHourlyCount(channelId: string): Promise<number> {
    const val = await redisConnection.get(`${HOURLY_PREFIX}${channelId}:${this.hourKey()}`);
    return val ? parseInt(val, 10) : 0;
  }

  private async getDailyCount(channelId: string): Promise<number> {
    const val = await redisConnection.get(`${DAILY_PREFIX}${channelId}:${this.dayKey()}`);
    return val ? parseInt(val, 10) : 0;
  }

  private hourKey(): string {
    return new Date().toISOString().slice(0, 13);
  }

  private dayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

export const channelLimiter = new ChannelLimiter();
