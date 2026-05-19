import { Job } from 'bullmq';
import { ALL_QUEUES, DLQ_NAMES } from './video.queue';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
  dlqSize: number;
}

export interface JobInfo {
  id: string;
  name: string;
  queue: string;
  status: 'completed' | 'failed' | 'active' | 'waiting' | 'delayed';
  progress: unknown;
  data: Record<string, unknown>;
  result?: unknown;
  failedReason?: string;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  duration?: number;
}

export class QueueMonitor {
  static async getQueueStatuses(): Promise<QueueStatus[]> {
    const results = await Promise.allSettled(
      ALL_QUEUES.map(async ({ name, queue, dlq }) => {
        try {
          const [waiting, active, completed, failed, delayed, isPaused, dlqCount] = await Promise.all([
            queue.getWaitingCount().catch(() => 0),
            queue.getActiveCount().catch(() => 0),
            queue.getCompletedCount().catch(() => 0),
            queue.getFailedCount().catch(() => 0),
            queue.getDelayedCount().catch(() => 0),
            queue.isPaused().catch(() => false),
            dlq.getJobCounts().then(c => c.waiting + c.active).catch(() => 0),
          ]);

          return {
            name,
            waiting,
            active,
            completed,
            failed,
            delayed,
            paused: isPaused,
            dlqSize: dlqCount,
          };
        } catch (err: any) {
          queueLogger.error(`Queue monitor: failed to get status for ${name}`, { error: err.message });
          return {
            name,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: false,
            dlqSize: 0,
          };
        }
      })
    );

    return results.map(r => r.status === 'fulfilled' ? r.value : {
      name: 'unknown',
      waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, paused: false, dlqSize: 0,
    });
  }

  static async getFailedJobs(queueName: string, limit = 20): Promise<JobInfo[]> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return [];

    const jobs = await entry.queue.getJobs(['failed'], 0, limit);
    return Promise.all(jobs.map(j => QueueMonitor.serializeJob(j, 'failed')));
  }

  static async getActiveJobs(queueName: string, limit = 10): Promise<JobInfo[]> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return [];

    const jobs = await entry.queue.getJobs(['active'], 0, limit);
    return Promise.all(jobs.map(j => QueueMonitor.serializeJob(j, 'active')));
  }

  static async getWaitingJobs(queueName: string, limit = 10): Promise<JobInfo[]> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return [];

    const jobs = await entry.queue.getJobs(['waiting'], 0, limit);
    return Promise.all(jobs.map(j => QueueMonitor.serializeJob(j, 'waiting')));
  }

  static async getJobDetails(queueName: string, jobId: string): Promise<JobInfo | null> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return null;

    const job = await entry.queue.getJob(jobId);
    if (!job) return null;

    const state = await job.getState();
    return QueueMonitor.serializeJob(job, state as JobInfo['status']);
  }

  static async retryJob(queueName: string, jobId: string): Promise<boolean> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return false;

    const job = await entry.queue.getJob(jobId);
    if (!job) return false;

    await job.retry();
    queueLogger.info(`Retrying job ${jobId} on ${queueName}`);
    return true;
  }

  static async retryAllFailed(queueName: string): Promise<number> {
    const entry = ALL_QUEUES.find(q => q.name === queueName);
    if (!entry) return 0;

    const failed = await entry.queue.getJobs(['failed']);
    let count = 0;
    for (const job of failed) {
      try {
        await job.retry();
        count++;
      } catch { /* skip */ }
    }
    queueLogger.info(`Retrying ${count} failed jobs on ${queueName}`);
    return count;
  }

  static async getDLQJobs(limit = 20): Promise<JobInfo[]> {
    const allJobs: JobInfo[] = [];
    for (const entry of ALL_QUEUES) {
      try {
        const dlqJobs = await entry.dlq.getJobs(['waiting', 'active'], 0, limit);
        const serialized = await Promise.all(
          dlqJobs.map(j => QueueMonitor.serializeJob(j, j.data?.__state || 'failed'))
        );
        allJobs.push(...serialized);
      } catch { /* skip */ }
    }
    return allJobs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit);
  }

  static async recoverDLQJob(dlqJobId: string): Promise<boolean> {
    for (const entry of ALL_QUEUES) {
      try {
        const job = await entry.dlq.getJob(dlqJobId);
        if (!job) continue;

        const originalQueueName = job.data?.__queueName;
        const originalQueue = ALL_QUEUES.find(q => q.name === originalQueueName)?.queue;
        if (!originalQueue) return false;

        await originalQueue.add(job.name!, job.data, {
          attempts: job.opts?.attempts || 3,
          backoff: job.opts?.backoff,
        });

        await job.remove();
        queueLogger.info(`Recovered DLQ job ${dlqJobId} to ${originalQueueName}`);
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  static async getPipelineProgress(projectId: string) {
    const { prisma } = require('../config/db');
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        trendResearch: true,
        script: true,
        thumbnail: true,
        voiceover: true,
        videoRender: true,
        analytics: true,
        uploadHistory: true,
      },
    });

    if (!project) return null;

    const steps = [
      { name: 'Trend Analysis', done: !!project.trendResearch, weight: 15 },
      { name: 'Script Generation', done: !!project.script, weight: 20 },
      { name: 'Thumbnail Generation', done: !!project.thumbnail, weight: 10 },
      { name: 'Voiceover Generation', done: !!project.voiceover, weight: 10 },
      { name: 'Video Rendering', done: project.videoRender?.status === 'completed', weight: 25 },
      { name: 'Upload', done: project.uploadHistory?.status === 'uploaded', weight: 10 },
      { name: 'Analytics Collection', done: !!project.analytics, weight: 10 },
    ];

    const totalWeight = steps.reduce((s, s2) => s + s2.weight, 0);
    const completedWeight = steps.filter(s => s.done).reduce((s, s2) => s + s2.weight, 0);

    return {
      projectId,
      status: project.status,
      progress: Math.round((completedWeight / totalWeight) * 100),
      steps,
    };
  }

  private static async serializeJob(job: Job, status: JobInfo['status']): Promise<JobInfo> {
    return {
      id: job.id!,
      name: job.name || 'unknown',
      queue: job.queueName,
      status,
      progress: job.progress,
      data: job.data as Record<string, unknown>,
      result: job.returnvalue,
      failedReason: job.failedReason || undefined,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 3,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
    };
  }
}
