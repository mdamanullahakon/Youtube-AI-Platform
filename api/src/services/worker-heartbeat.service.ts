import os from 'os';
import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { queueMap } from '../queues/video.queue';

const HEARTBEAT_TTL = 60;
const LOCK_TTL = 30;
const REGISTRY_KEY = 'worker:registry';

export interface WorkerInfo {
  workerId: string;
  queue: string;
  hostname: string;
  instanceId: string;
  jobsProcessed: number;
  jobsFailed: number;
  lastHeartbeat: string;
  startedAt: string;
}

interface HeartbeatData {
  queue: string;
  hostname: string;
  instanceId: string;
  jobsProcessed: number;
  jobsFailed: number;
  lastHeartbeat: string;
  startedAt: string;
}

export class WorkerHeartbeatService {
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private currentWorkerId: string | null = null;

  // ─── Heartbeat ───────────────────────────────────

  async beat(
    workerId: string,
    queue: string,
    options?: {
      hostname?: string;
      instanceId?: string;
      jobsProcessed?: number;
      jobsFailed?: number;
    },
  ): Promise<void> {
    const hostname = options?.hostname ?? os.hostname();
    const instanceId = options?.instanceId ?? `instance-${hostname}-${process.pid}`;
    const now = new Date().toISOString();

    const key = `worker:heartbeat:${workerId}`;

    const data: HeartbeatData = {
      queue,
      hostname,
      instanceId,
      jobsProcessed: 0,
      jobsFailed: 0,
      lastHeartbeat: now,
      startedAt: now,
    };

    const existing = await redisConnection.get(key);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as HeartbeatData;
        data.startedAt = parsed.startedAt;
        data.jobsProcessed = options?.jobsProcessed ?? parsed.jobsProcessed;
        data.jobsFailed = options?.jobsFailed ?? parsed.jobsFailed;
      } catch { /* use defaults */ }
    }

    await redisConnection
      .multi()
      .set(key, JSON.stringify(data))
      .expire(key, HEARTBEAT_TTL)
      .sadd(REGISTRY_KEY, workerId)
      .exec();

    logger.debug(`Heartbeat recorded for worker ${workerId} on queue ${queue}`);
  }

  startHeartbeat(
    workerId: string,
    queue: string,
    options?: {
      hostname?: string;
      instanceId?: string;
      intervalMs?: number;
    },
  ): void {
    this.stopHeartbeat();
    this.currentWorkerId = workerId;

    const intervalMs = options?.intervalMs ?? 15_000;

    this.beat(workerId, queue, options).catch(err => {
      logger.error(`Initial heartbeat failed for worker ${workerId}`, { error: err.message });
    });

    this.heartbeatInterval = setInterval(() => {
      this.beat(workerId, queue, options).catch(err => {
        logger.error(`Heartbeat failed for worker ${workerId}`, { error: err.message });
      });
    }, intervalMs);

    logger.info(`Heartbeat started for worker ${workerId} on queue ${queue} (every ${intervalMs}ms)`);
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.currentWorkerId) {
      const wid = this.currentWorkerId;
      this.currentWorkerId = null;
      this.unregisterWorker(wid).catch(err => {
        logger.error(`Failed to unregister worker ${wid} on stop`, { error: err.message });
      });
    }
  }

  // ─── Worker Registry ───────────────────────────

  async registerWorker(
    workerId: string,
    queue: string,
    hostname: string,
    instanceId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const key = `worker:heartbeat:${workerId}`;

    const data: HeartbeatData = {
      queue,
      hostname,
      instanceId,
      jobsProcessed: 0,
      jobsFailed: 0,
      lastHeartbeat: now,
      startedAt: now,
    };

    await redisConnection
      .multi()
      .set(key, JSON.stringify(data))
      .expire(key, HEARTBEAT_TTL)
      .sadd(REGISTRY_KEY, workerId)
      .exec();

    logger.info(`Worker registered: ${workerId} on queue ${queue} (instance: ${instanceId})`);
  }

  async unregisterWorker(workerId: string): Promise<void> {
    await redisConnection
      .multi()
      .del(`worker:heartbeat:${workerId}`)
      .srem(REGISTRY_KEY, workerId)
      .exec();

    logger.info(`Worker unregistered: ${workerId}`);
  }

  async getActiveWorkers(): Promise<WorkerInfo[]> {
    const workerIds = await redisConnection.smembers(REGISTRY_KEY);
    if (workerIds.length === 0) return [];

    const keys = workerIds.map(id => `worker:heartbeat:${id}`);
    const results = await redisConnection.mget(...keys);

    const workers: WorkerInfo[] = [];
    for (let i = 0; i < workerIds.length; i++) {
      const raw = results[i];
      if (!raw) continue;
      try {
        const data = JSON.parse(raw) as HeartbeatData;
        workers.push({ workerId: workerIds[i], ...data });
      } catch {
        logger.warn(`Corrupt heartbeat data for worker ${workerIds[i]}`);
      }
    }

    return workers;
  }

  async getActiveWorkerCount(queue?: string): Promise<number> {
    if (!queue) {
      return redisConnection.scard(REGISTRY_KEY);
    }
    const workers = await this.getActiveWorkers();
    return workers.filter(w => w.queue === queue).length;
  }

  // ─── Instance Tracking ──────────────────────────

  async registerInstance(instanceId: string, workers: string[]): Promise<void> {
    const key = `worker:instance:${instanceId}`;
    const data = { workers, registeredAt: new Date().toISOString() };

    await redisConnection
      .multi()
      .set(key, JSON.stringify(data))
      .expire(key, HEARTBEAT_TTL)
      .exec();

    logger.info(`Instance registered: ${instanceId} with ${workers.length} workers`);
  }

  async getInstanceWorkers(instanceId: string): Promise<string[]> {
    const key = `worker:instance:${instanceId}`;
    const raw = await redisConnection.get(key);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as { workers: string[]; registeredAt: string };
      return parsed.workers;
    } catch {
      return [];
    }
  }

  async unregisterInstance(instanceId: string): Promise<void> {
    await redisConnection.del(`worker:instance:${instanceId}`);
    logger.info(`Instance unregistered: ${instanceId}`);
  }

  // ─── Job Lock (Duplicate Prevention) ────────────

  async acquireJobLock(jobId: string): Promise<boolean> {
    const key = `job:lock:${jobId}`;
    const result = await redisConnection.set(key, 'locked', 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
  }

  async releaseJobLock(jobId: string): Promise<void> {
    await redisConnection.del(`job:lock:${jobId}`);
  }

  // ─── Auto-Recovery ──────────────────────────────

  async findStaleWorkers(staleThresholdMs = 60_000): Promise<string[]> {
    const workers = await this.getActiveWorkers();
    const now = Date.now();
    const stale: string[] = [];

    for (const worker of workers) {
      const lastHeartbeat = new Date(worker.lastHeartbeat).getTime();
      if (now - lastHeartbeat > staleThresholdMs) {
        stale.push(worker.workerId);
      }
    }

    return stale;
  }

  async recoverJobsForWorker(workerId: string): Promise<number> {
    const raw = await redisConnection.get(`worker:heartbeat:${workerId}`);
    if (!raw) return 0;

    let workerData: HeartbeatData;
    try {
      workerData = JSON.parse(raw) as HeartbeatData;
    } catch {
      return 0;
    }

    const queue = queueMap[workerData.queue];
    if (!queue) {
      logger.warn(`No queue found for worker ${workerId} queue ${workerData.queue}`);
      return 0;
    }

    return this.requeueStalledForQueue(queue);
  }

  async requeueStalledJobs(): Promise<number> {
    let total = 0;

    for (const queue of Object.values(queueMap)) {
      total += await this.requeueStalledForQueue(queue);
    }

    if (total > 0) {
      logger.info(`Requeued ${total} stalled jobs globally`);
    }

    return total;
  }

  private async requeueStalledForQueue(queue: Queue): Promise<number> {
    let count = 0;

    try {
      const activeJobs = await queue.getActive();
      const now = Date.now();

      for (const job of activeJobs) {
        if (!job.processedOn || now - job.processedOn <= 60_000) continue;

        const lockKey = `job:lock:${queue.name}:${job.id}`;
        const acquired = await redisConnection.set(lockKey, 'recovery', 'EX', LOCK_TTL, 'NX');
        if (acquired !== 'OK') continue;

        try {
          await job.retry();
          count++;
          logger.info(`Requeued stalled job ${job.id} from queue ${queue.name}`);
        } catch (err: any) {
          logger.warn(`Failed to requeue job ${job.id} on ${queue.name}`, { error: err.message });
        }
      }
    } catch (err: any) {
      logger.error(`Error requeueing stalled jobs for queue ${queue.name}`, { error: err.message });
    }

    return count;
  }
}

export const workerHeartbeat = new WorkerHeartbeatService();
