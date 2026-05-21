import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { ALL_QUEUES, queueMap } from '../queues/video.queue';
import { guardWorker } from './worker-guard';

const DLQ_NAMES = ALL_QUEUES.map(q => `${q.name}-dlq`);

const MAX_DLQ_RECOVERIES = 2;

async function processDeadLetter(job: Job) {
  const originalQueueName = job.data?.__queueName || job.queueName.replace('-dlq', '');
  const originalJobName = job.data?.__jobName || job.name || 'unknown';
  const failReason = job.data?.__failReason || 'Unknown failure';
  const attempts = job.data?.__attempts || job.opts?.attempts || 3;
  const recoveryCount = job.data?.__recoveryCount || 0;

  if (recoveryCount >= MAX_DLQ_RECOVERIES) {
    queueLogger.error(`DLQ job ${job.id} exceeded max recoveries (${MAX_DLQ_RECOVERIES}). Discarding permanently.`, {
      originalQueue: originalQueueName,
      failReason,
      recoveryCount,
    });
    await job.remove();
    return { recovered: false, reason: `Exceeded max recoveries (${recoveryCount})` };
  }

  queueLogger.warn(`Processing dead-letter job ${job.id} (recovery ${recoveryCount + 1}/${MAX_DLQ_RECOVERIES})`, {
    originalQueue: originalQueueName,
    originalJobName,
    failReason,
    attempts,
  });

  const originalQueue = queueMap[originalQueueName];
  if (!originalQueue) {
    queueLogger.error(`Cannot recover DLQ job ${job.id}: unknown queue ${originalQueueName}`);
    return { recovered: false, reason: `Unknown queue: ${originalQueueName}` };
  }

  const newJobData = { ...job.data, __recoveryCount: recoveryCount + 1 };
  const newJob = await originalQueue.add(originalJobName, newJobData, {
    attempts: Math.min(attempts + 2, 5),
    backoff: { type: 'exponential', delay: 5000 },
  });

  await job.remove();

  queueLogger.info(`DLQ job ${job.id} recovered to ${originalQueueName} as job ${newJob.id}`);
  return { recovered: true, newJobId: newJob.id, queue: originalQueueName };
}

const workers: Worker[] = DLQ_NAMES.map((dlqName) => {
  const w = new Worker(dlqName, processDeadLetter, {
    connection: redisConnection,
    concurrency: 1,
    autorun: false,
    stalledInterval: 60_000,
    lockDuration: 300_000,
  });

  w.on('completed', (job) => {
    queueLogger.info(`DLQ worker completed recovery for ${job.id}`);
  });

  w.on('failed', (job, err) => {
    if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
      queueLogger.error(`DLQ worker Lua script error for ${job?.id}. Worker will be closed to prevent cascade.`, { error: err.message });
      w.close();
      return;
    }
    queueLogger.error(`DLQ worker failed to recover ${job?.id}`, { error: err.message });
  });

  guardWorker(w, `dlq-${dlqName}`, (err) => {
    if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
      queueLogger.error(`DLQ worker Lua/evalsha error on ${dlqName}. Closing worker.`, { error: err.message });
    }
  });

  return w;
});

export function startDeadLetterProcessing() {
  queueLogger.info(`Starting dead-letter workers for ${workers.length} DLQs`);
  workers.forEach(w => w.run());
  queueLogger.info('Dead-letter workers started');
}

export function stopDeadLetterProcessing() {
  queueLogger.info('Stopping dead-letter workers');
  workers.forEach(w => w.close());
}

export { workers };
