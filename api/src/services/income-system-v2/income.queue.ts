import { INCOME_SYSTEM_QUEUES } from './types';
import { InMemoryQueue } from './in-memory-queue';

// Using InMemoryQueue fallback for Redis 3.x compatibility
// BullMQ requires Redis >= 5.0 for Lua scripting support

const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400 * 3, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 50 },
};

export const incomeTopicQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeTopic);
export const incomeContentQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeContent);
export const incomeMonetizationQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeMonetization);
export const incomeUploadQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeUpload);
export const incomeAnalyticsQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeAnalytics);
export const incomeLearningQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeLearning);
export const incomeRiskQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeRisk);
export const incomeCycleQueue = new InMemoryQueue(INCOME_SYSTEM_QUEUES.incomeCycle);

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
  for (const q of Object.values(incomeQueues)) {
    await q.close();
  }
}
