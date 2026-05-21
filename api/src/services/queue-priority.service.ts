import { Queue, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { prisma } from '../config/db';

export enum PriorityTier {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

const TIER_BASES: Record<PriorityTier, number> = {
  [PriorityTier.HIGH]: 100,
  [PriorityTier.MEDIUM]: 50,
  [PriorityTier.LOW]: 10,
};

interface PriorityChannelData {
  rpm: number;
  boost: number;
  lastUpdated: number;
}

export interface PriorityMetrics {
  high: number;
  medium: number;
  low: number;
}

export interface ScheduleOpts {
  tier?: PriorityTier;
  channelId?: string;
  projectId?: string;
}

const DEFAULT_RPM = 3.5;
const DEFAULT_BOOST = 0;
const MAX_PRIORITY = 1000;
const MIN_PRIORITY = 1;
const RPM_BOOST_MIN = 5;
const RPM_BOOST_MAX = 20;
const CHANNEL_CACHE_TTL = 3600;

export class QueuePriorityEngine {
  async calculatePriority(
    projectId: string,
    channelId: string,
    tier: PriorityTier,
  ): Promise<number> {
    const base = TIER_BASES[tier] ?? TIER_BASES[PriorityTier.LOW];

    let rpm = DEFAULT_RPM;
    let boost = DEFAULT_BOOST;

    try {
      const cached = await this.getCachedChannelData(channelId);
      if (cached) {
        rpm = cached.rpm;
        boost = cached.boost;
      } else {
        const [rpmVal, boostVal] = await Promise.all([
          this.getRpmMultiplier(channelId),
          this.getChannelBoost(channelId),
        ]);
        rpm = rpmVal;
        boost = boostVal;
        await this.cacheChannelData(channelId, rpm, boost);
      }
    } catch (err: any) {
      logger.warn(`Failed to fetch priority data for channel ${channelId}: ${err.message}`);
    }

    const rpmBoost = this.computeRpmBoost(rpm);
    const effective = base + rpmBoost + boost;

    return Math.max(MIN_PRIORITY, Math.min(MAX_PRIORITY, Math.round(effective)));
  }

  async getRpmMultiplier(channelId: string): Promise<number> {
    try {
      const metrics = await prisma.channelMetrics.findFirst({
        where: { channelId },
        orderBy: { collectedAt: 'desc' },
      });
      if (metrics?.estimatedRPM && metrics.estimatedRPM > 0) {
        return metrics.estimatedRPM;
      }
    } catch (err: any) {
      logger.error(`Error fetching RPM for channel ${channelId}: ${err.message}`);
    }
    return DEFAULT_RPM;
  }

  async getChannelBoost(channelId: string): Promise<number> {
    try {
      const metrics = await prisma.channelMetrics.findFirst({
        where: { channelId },
        orderBy: { collectedAt: 'desc' },
      });

      if (!metrics) return DEFAULT_BOOST;

      let boost = 0;

      if (metrics.avgCTR > 0) {
        boost += Math.min(5, Math.round(metrics.avgCTR / 2));
      }

      if (metrics.subscriberGrowth > 100) {
        boost += 3;
      } else if (metrics.subscriberGrowth > 50) {
        boost += 2;
      } else if (metrics.subscriberGrowth > 10) {
        boost += 1;
      }

      if (metrics.returningViewerPct > 50) {
        boost += 3;
      } else if (metrics.returningViewerPct > 30) {
        boost += 1;
      }

      if (metrics.subscribers > 100000) {
        boost += 4;
      } else if (metrics.subscribers > 10000) {
        boost += 2;
      } else if (metrics.subscribers > 1000) {
        boost += 1;
      }

      return Math.min(boost, 20);
    } catch (err: any) {
      logger.error(`Error fetching channel boost for ${channelId}: ${err.message}`);
    }
    return DEFAULT_BOOST;
  }

  async scheduleJob(
    queue: Queue,
    jobName: string,
    data: any,
    opts?: ScheduleOpts,
  ): Promise<Job> {
    const tier = opts?.tier ?? PriorityTier.MEDIUM;
    const channelId = opts?.channelId;
    const projectId = opts?.projectId;

    let priority = TIER_BASES[tier];

    if (channelId && projectId) {
      priority = await this.calculatePriority(projectId, channelId, tier);
    }

    const job = await queue.add(jobName, data, { priority });

    await this.updateQueueMetrics(queue.name, tier, 1);

    logger.info(`Scheduled job ${jobName} on ${queue.name} with priority ${priority} (tier: ${tier})`);

    return job;
  }

  async getQueueMetrics(): Promise<PriorityMetrics> {
    const metrics: PriorityMetrics = { high: 0, medium: 0, low: 0 };

    try {
      const keys = await redisConnection.keys('priority:queue:*:tiers');
      for (const key of keys) {
        const data = await redisConnection.hgetall(key);
        metrics.high += parseInt(data?.high || '0', 10);
        metrics.medium += parseInt(data?.medium || '0', 10);
        metrics.low += parseInt(data?.low || '0', 10);
      }
    } catch (err: any) {
      logger.error(`Error fetching queue metrics: ${err.message}`);
    }

    return metrics;
  }

  private computeRpmBoost(rpm: number): number {
    if (rpm <= 0) return 0;
    if (rpm >= 10) return RPM_BOOST_MAX;
    if (rpm >= 7) return 15;
    if (rpm >= 5) return 10;
    return RPM_BOOST_MIN;
  }

  private async getCachedChannelData(channelId: string): Promise<PriorityChannelData | null> {
    try {
      const raw = await redisConnection.get(`priority:channel:${channelId}`);
      if (raw) {
        return JSON.parse(raw) as PriorityChannelData;
      }
    } catch {
      // ignore cache read errors
    }
    return null;
  }

  private async cacheChannelData(channelId: string, rpm: number, boost: number): Promise<void> {
    try {
      const data: PriorityChannelData = {
        rpm,
        boost,
        lastUpdated: Date.now(),
      };
      await redisConnection.setex(
        `priority:channel:${channelId}`,
        CHANNEL_CACHE_TTL,
        JSON.stringify(data),
      );
    } catch (err: any) {
      logger.warn(`Failed to cache priority data for channel ${channelId}: ${err.message}`);
    }
  }

  private async updateQueueMetrics(queueName: string, tier: PriorityTier, delta: number): Promise<void> {
    try {
      const key = `priority:queue:${queueName}:tiers`;
      const field = tier.toLowerCase();
      await redisConnection.hincrby(key, field, delta);

      const ttl = await redisConnection.ttl(key);
      if (ttl === -1) {
        await redisConnection.expire(key, 86400);
      }
    } catch (err: any) {
      logger.warn(`Failed to update queue metrics for ${queueName}: ${err.message}`);
    }
  }
}

export const queuePriority = new QueuePriorityEngine();
