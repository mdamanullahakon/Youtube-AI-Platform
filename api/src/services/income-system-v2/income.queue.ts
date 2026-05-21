import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '../../config/redis';
import { INCOME_SYSTEM_QUEUES } from './types';

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 } as const,
  removeOnComplete: { age: 86400 * 3, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 50 },
};

function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions: JOB_OPTS,
  });
}

export const incomeTopicQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeTopic);
export const incomeContentQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeContent);
export const incomeMonetizationQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeMonetization);
export const incomeUploadQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeUpload);
export const incomeAnalyticsQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeAnalytics);
export const incomeLearningQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeLearning);
export const incomeRiskQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeRisk);
export const incomeCycleQueue = createQueue(INCOME_SYSTEM_QUEUES.incomeCycle);

export const incomeQueues = {
  topic: incomeTopicQueue,
  content: incomeContentQueue,
  monetization: incomeMonetizationQueue,
  upload: incomeUploadQueue,
  analytics: incomeAnalyticsQueue,
  learning: incomeLearningQueue,
  risk: incomeRiskQueue,
  cycle: incomeCycleQueue,
} as const;

export const INCOME_QUEUE_NAMES = Object.values(INCOME_SYSTEM_QUEUES);

export async function closeAllIncomeQueues(): Promise<void> {
  await Promise.all(
    Object.values(incomeQueues).map(q => q.close().catch(() => {})),
  );
}

export const incomeQueueEvents = {
  topic: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeTopic, { connection: redisConnection }),
  content: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeContent, { connection: redisConnection }),
  monetization: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeMonetization, { connection: redisConnection }),
  upload: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeUpload, { connection: redisConnection }),
  analytics: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeAnalytics, { connection: redisConnection }),
  learning: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeLearning, { connection: redisConnection }),
  risk: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeRisk, { connection: redisConnection }),
  cycle: new QueueEvents(INCOME_SYSTEM_QUEUES.incomeCycle, { connection: redisConnection }),
} as const;
