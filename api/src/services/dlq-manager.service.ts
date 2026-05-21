import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export type RetryReason = 'transient' | 'permanent' | 'quota' | 'config';

export interface DlqJob {
  jobId: string;
  queueName: string;
  error: string;
  classifiedReason: RetryReason;
  retryCount: number;
  maxRetries: number;
  firstFailedAt: string;
  lastFailedAt: string;
  jobData: string;
}

export interface FailureCluster {
  errorHash: string;
  errorMessage: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  jobIds: string[];
}

export interface DlqStats {
  total: number;
  transient: number;
  permanent: number;
  quota: number;
  config: number;
  exhausted: number;
}

export interface DlqFilter {
  status?: 'pending' | 'exhausted';
  queueName?: string;
}

const DLQ_JOB_PREFIX = 'dlq:job:';
const DLQ_CLUSTER_PREFIX = 'dlq:cluster:';
const DLQ_RETRY_SCHEDULE_KEY = 'dlq:retry-schedule';
const DLQ_STATS_KEY = 'dlq:stats';
const MAX_RETRIES = 5;

const BACKOFF_MS: number[] = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
];

const ERROR_PATTERNS: { pattern: RegExp; reason: RetryReason }[] = [
  { pattern: /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ECONNRESET|socket hang up|request aborted/i, reason: 'transient' },
  { pattern: /timeout/i, reason: 'transient' },
  { pattern: /rate.?limit|too many requests/i, reason: 'transient' },
  { pattern: /quota.*(exceeded|exhausted|limit)|dailyLimitExceeded|insufficient tokens|quota_reached/i, reason: 'quota' },
  { pattern: /misconfig|invalid.*config|missing.*config/i, reason: 'config' },
  { pattern: /unauthorized|invalid.*credential|access.?denied|auth.*fail/i, reason: 'permanent' },
  { pattern: /404|not found/i, reason: 'permanent' },
  { pattern: /validation.*fail|invalid.*param|bad request/i, reason: 'permanent' },
  { pattern: /forbidden|permission/i, reason: 'permanent' },
];

export class DlqManager {
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  classifyError(error: string): RetryReason {
    for (const { pattern, reason } of ERROR_PATTERNS) {
      if (pattern.test(error)) {
        return reason;
      }
    }
    return 'transient';
  }

  computeBackoff(retryCount: number): number {
    const index = Math.min(retryCount, BACKOFF_MS.length - 1);
    return BACKOFF_MS[index];
  }

  private hashError(error: string): string {
    return crypto.createHash('sha256').update(error.trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  async registerFailedJob(jobId: string, queueName: string, error: string, jobData: string): Promise<void> {
    const reason = this.classifyError(error);
    const now = new Date().toISOString();
    const existing = await this.getJob(jobId);

    if (existing) {
      const updated: DlqJob = {
        ...existing,
        error,
        classifiedReason: reason,
        retryCount: existing.retryCount + 1,
        lastFailedAt: now,
        jobData,
      };
      await redisConnection.set(`${DLQ_JOB_PREFIX}${jobId}`, JSON.stringify(updated));
    } else {
      const job: DlqJob = {
        jobId,
        queueName,
        error,
        classifiedReason: reason,
        retryCount: 0,
        maxRetries: MAX_RETRIES,
        firstFailedAt: now,
        lastFailedAt: now,
        jobData,
      };
      await redisConnection.set(`${DLQ_JOB_PREFIX}${jobId}`, JSON.stringify(job));
    }

    await this.incrementStats(reason);

    const errorHash = this.hashError(error);
    await this.addToCluster(errorHash, error, jobId, now);

    if (reason !== 'permanent' && reason !== 'config') {
      await this.scheduleRetry(jobId);
    }

    if (reason === 'permanent') {
      await this.incrementStatsExhausted();
    }

    logger.warn(`[DlqManager] Registered failed job ${jobId} on queue ${queueName} as ${reason}`);
  }

  private async incrementStats(reason: RetryReason): Promise<void> {
    await redisConnection.hincrby(DLQ_STATS_KEY, 'total', 1);
    await redisConnection.hincrby(DLQ_STATS_KEY, reason, 1);
  }

  private async incrementStatsExhausted(): Promise<void> {
    await redisConnection.hincrby(DLQ_STATS_KEY, 'exhausted', 1);
  }

  private async addToCluster(errorHash: string, errorMessage: string, jobId: string, timestamp: string): Promise<void> {
    const clusterKey = `${DLQ_CLUSTER_PREFIX}${errorHash}`;
    const existing = await redisConnection.get(clusterKey);

    if (existing) {
      const cluster: FailureCluster = JSON.parse(existing);
      cluster.count += 1;
      cluster.lastSeenAt = timestamp;
      if (!cluster.jobIds.includes(jobId)) {
        cluster.jobIds.push(jobId);
      }
      await redisConnection.set(clusterKey, JSON.stringify(cluster));
    } else {
      const cluster: FailureCluster = {
        errorHash,
        errorMessage: errorMessage.trim().toLowerCase().slice(0, 200),
        count: 1,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        jobIds: [jobId],
      };
      await redisConnection.set(clusterKey, JSON.stringify(cluster));
    }
  }

  async scheduleRetry(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    const nextRetryMs = this.computeBackoff(job.retryCount);
    const nextRetryTimestamp = Date.now() + nextRetryMs;

    await redisConnection.zadd(DLQ_RETRY_SCHEDULE_KEY, nextRetryTimestamp, jobId);
    logger.info(`[DlqManager] Scheduled retry for ${jobId} at ${new Date(nextRetryTimestamp).toISOString()} (attempt ${job.retryCount + 1}/${MAX_RETRIES})`);
  }

  async processRetrySchedule(): Promise<void> {
    const now = Date.now();
    const dueJobs = await redisConnection.zrangebyscore(DLQ_RETRY_SCHEDULE_KEY, '-inf', now);

    if (dueJobs.length === 0) return;

    logger.info(`[DlqManager] Processing ${dueJobs.length} due retries`);

    for (const jobId of dueJobs) {
      try {
        const job = await this.getJob(jobId);
        if (!job) {
          await redisConnection.zrem(DLQ_RETRY_SCHEDULE_KEY, jobId);
          continue;
        }

        if (job.retryCount >= MAX_RETRIES) {
          await this.markExhausted(jobId);
          continue;
        }

        await this.requeueJob(jobId);
        await redisConnection.zrem(DLQ_RETRY_SCHEDULE_KEY, jobId);
        logger.info(`[DlqManager] Requeued ${jobId} to ${job.queueName} for retry ${job.retryCount + 1}/${MAX_RETRIES}`);
      } catch (err: any) {
        logger.error(`[DlqManager] Failed to process retry for ${jobId}: ${err.message}`);
      }
    }
  }

  private async markExhausted(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!job) return;

    await redisConnection.hincrby(DLQ_STATS_KEY, 'exhausted', 1);
    await redisConnection.zrem(DLQ_RETRY_SCHEDULE_KEY, jobId);
    logger.warn(`[DlqManager] Job ${jobId} exhausted after ${MAX_RETRIES} retries`);
  }

  async requeueJob(jobId: string): Promise<boolean> {
    const job = await this.getJob(jobId);
    if (!job) return false;

    const queueKey = `bull:${job.queueName}:wait`;
    await redisConnection.lpush(queueKey, job.jobData);
    logger.info(`[DlqManager] Requeued job ${jobId} to ${job.queueName}`);
    return true;
  }

  async getStats(): Promise<DlqStats> {
    const raw = await redisConnection.hgetall(DLQ_STATS_KEY);
    return {
      total: parseInt(raw?.total || '0', 10),
      transient: parseInt(raw?.transient || '0', 10),
      permanent: parseInt(raw?.permanent || '0', 10),
      quota: parseInt(raw?.quota || '0', 10),
      config: parseInt(raw?.config || '0', 10),
      exhausted: parseInt(raw?.exhausted || '0', 10),
    };
  }

  async getClusters(): Promise<FailureCluster[]> {
    const keys = await redisConnection.keys(`${DLQ_CLUSTER_PREFIX}*`);
    if (keys.length === 0) return [];

    const values = await redisConnection.mget(...keys);
    return values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as FailureCluster);
  }

  async getJob(jobId: string): Promise<DlqJob | null> {
    const raw = await redisConnection.get(`${DLQ_JOB_PREFIX}${jobId}`);
    if (!raw) return null;
    return JSON.parse(raw) as DlqJob;
  }

  async getJobs(filter?: DlqFilter): Promise<DlqJob[]> {
    const keys = await redisConnection.keys(`${DLQ_JOB_PREFIX}*`);
    if (keys.length === 0) return [];

    const values = await redisConnection.mget(...keys);
    let jobs = values
      .filter((v): v is string => v !== null)
      .map((v) => JSON.parse(v) as DlqJob);

    if (filter?.queueName) {
      jobs = jobs.filter((j) => j.queueName === filter.queueName);
    }

    if (filter?.status === 'exhausted') {
      jobs = jobs.filter((j) => j.retryCount >= j.maxRetries);
    } else if (filter?.status === 'pending') {
      jobs = jobs.filter((j) => j.retryCount < j.maxRetries);
    }

    return jobs;
  }

  async purgeJob(jobId: string): Promise<void> {
    await redisConnection.del(`${DLQ_JOB_PREFIX}${jobId}`);
    await redisConnection.zrem(DLQ_RETRY_SCHEDULE_KEY, jobId);
    logger.info(`[DlqManager] Purged job ${jobId}`);
  }

  startRetryProcessor(intervalMs: number = 30000): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
    }

    this.retryTimer = setInterval(() => {
      this.processRetrySchedule().catch((err: any) => {
        logger.error(`[DlqManager] Retry processor error: ${err.message}`);
      });
    }, intervalMs);

    logger.info(`[DlqManager] Retry processor started (interval: ${intervalMs}ms)`);
  }

  stopRetryProcessor(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
      logger.info('[DlqManager] Retry processor stopped');
    }
  }
}

export const dlqManager = new DlqManager();
