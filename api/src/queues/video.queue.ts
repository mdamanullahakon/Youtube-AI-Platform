import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '../config/redis';

// ─── Typed Job Data Interfaces ────────────────────
export interface TrendJobData {
  projectId: string;
  topic: string;
  channelId?: string;
  pipelineId?: string;
}

export interface ScriptJobData {
  projectId: string;
  topic: string;
  format: string;
  channelId?: string;
  pipelineId?: string;
}

export interface AgentJobData {
  projectId: string;
  channelId?: string;
  scenes?: { text: string; visualPrompt: string }[];
  text?: string;
  topic?: string;
  hook?: string;
  pipelineId?: string;
}

export interface RenderJobData {
  projectId: string;
  channelId?: string;
  pipelineId?: string;
}

export interface UploadJobData {
  projectId: string;
  channelId?: string;
  title: string;
  description: string;
  tags: string[];
  privacyStatus?: string;
  pipelineId?: string;
}

export interface AnalyticsJobData {
  projectId: string;
  channelId?: string;
  videoId?: string;
  pipelineId?: string;
}

export interface PipelineJobData {
  projectId: string;
  channelId?: string;
  topic?: string;
  step?: string;
}

export interface TranscriptJobData {
  videoIds: string[];
  userId?: string;
}

export type JobData =
  | TrendJobData
  | ScriptJobData
  | AgentJobData
  | RenderJobData
  | UploadJobData
  | AnalyticsJobData
  | PipelineJobData
  | TranscriptJobData;

// ─── Dead-Letter Queue Names ─────────────────────
const DLQ_SUFFIX = '-dlq';

export const DLQ_NAMES = {
  video: `video-generation${DLQ_SUFFIX}`,
  trend: `trend-analysis${DLQ_SUFFIX}`,
  script: `script-generation${DLQ_SUFFIX}`,
  agent: `agent-tasks${DLQ_SUFFIX}`,
  render: `video-render${DLQ_SUFFIX}`,
  upload: `youtube-upload${DLQ_SUFFIX}`,
  analytics: `analytics-collection${DLQ_SUFFIX}`,
  transcript: `transcript-analysis${DLQ_SUFFIX}`,
  cleanup: `cleanup${DLQ_SUFFIX}`,
} as const;

// ─── Standardized Job Options (all include timeout) ─
export const STANDARD_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 } as const,
  timeout: 180_000,
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 50 },
};

export const RENDER_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 } as const,
  timeout: 600_000,
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 50 },
};

export const UPLOAD_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10000 } as const,
  timeout: 300_000,
  removeOnComplete: { age: 86400 * 7, count: 100 },
  removeOnFail: { age: 86400 * 30, count: 50 },
};

export const CLEANUP_JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5000 } as const,
  timeout: 300_000,
  removeOnComplete: { age: 86400, count: 10 },
  removeOnFail: { age: 86400, count: 10 },
};

// ─── Lazy Queue/Events Factory ───────────────────
// Prevents BullMQ from connecting at module import time.
// Queues are only materialized when first accessed.
const queueInstances = new Map<string, Queue>();
const eventsInstances = new Map<string, QueueEvents>();
const dlqInstances = new Map<string, Queue>();

function lazyQueue(name: string, opts: any): Queue {
  let inst: Queue | null = null;
  return new Proxy({} as Queue, {
    get(_, prop) {
      if (!inst) {
        inst = new Queue(name, opts);
        queueInstances.set(name, inst);
      }
      return (inst as any)[prop];
    },
  });
}

function lazyQueueEvents(name: string, opts: any): QueueEvents {
  let inst: QueueEvents | null = null;
  return new Proxy({} as QueueEvents, {
    get(_, prop) {
      if (!inst) {
        inst = new QueueEvents(name, opts);
        eventsInstances.set(name, inst);
      }
      return (inst as any)[prop];
    },
  });
}

function lazyDLQ(name: string, opts: any): Queue {
  let inst: Queue | null = null;
  return new Proxy({} as Queue, {
    get(_, prop) {
      if (!inst) {
        inst = new Queue(name, opts);
        dlqInstances.set(name, inst);
      }
      return (inst as any)[prop];
    },
  });
}

// ─── Queue Definitions ───────────────────────────
export const videoQueue = lazyQueue('video-generation', {
  connection: redisConnection,
  defaultJobOptions: STANDARD_JOB_OPTS,
});

export const trendQueue = lazyQueue('trend-analysis', {
  connection: redisConnection,
  defaultJobOptions: STANDARD_JOB_OPTS,
});

export const scriptQueue = lazyQueue('script-generation', {
  connection: redisConnection,
  defaultJobOptions: STANDARD_JOB_OPTS,
});

export const agentQueue = lazyQueue('agent-tasks', {
  connection: redisConnection,
  defaultJobOptions: STANDARD_JOB_OPTS,
});

export const renderQueue = lazyQueue('video-render', {
  connection: redisConnection,
  defaultJobOptions: RENDER_JOB_OPTS,
});

export const uploadQueue = lazyQueue('youtube-upload', {
  connection: redisConnection,
  defaultJobOptions: UPLOAD_JOB_OPTS,
});

export const analyticsQueue = lazyQueue('analytics-collection', {
  connection: redisConnection,
  defaultJobOptions: STANDARD_JOB_OPTS,
});

export const transcriptQueue = lazyQueue('transcript-analysis', {
  connection: redisConnection,
  defaultJobOptions: { ...STANDARD_JOB_OPTS, attempts: 3 },
});

export const cleanupQueue = lazyQueue('cleanup', {
  connection: redisConnection,
  defaultJobOptions: CLEANUP_JOB_OPTS,
});

// ─── Dead-Letter Queues ──────────────────────────
const DLQ_JOB_OPTS = {
  removeOnComplete: { age: 86400 * 3, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 200 },
};

export const deadLetterQueues = {
  video: lazyDLQ(DLQ_NAMES.video, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  trend: lazyDLQ(DLQ_NAMES.trend, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  script: lazyDLQ(DLQ_NAMES.script, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  agent: lazyDLQ(DLQ_NAMES.agent, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  render: lazyDLQ(DLQ_NAMES.render, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  upload: lazyDLQ(DLQ_NAMES.upload, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  analytics: lazyDLQ(DLQ_NAMES.analytics, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  transcript: lazyDLQ(DLQ_NAMES.transcript, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
  cleanup: lazyDLQ(DLQ_NAMES.cleanup, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS }),
} as const;

// ─── Queue Events ────────────────────────────────
export const queueEvents = {
  video: lazyQueueEvents('video-generation', { connection: redisConnection }),
  trend: lazyQueueEvents('trend-analysis', { connection: redisConnection }),
  script: lazyQueueEvents('script-generation', { connection: redisConnection }),
  agent: lazyQueueEvents('agent-tasks', { connection: redisConnection }),
  render: lazyQueueEvents('video-render', { connection: redisConnection }),
  upload: lazyQueueEvents('youtube-upload', { connection: redisConnection }),
  analytics: lazyQueueEvents('analytics-collection', { connection: redisConnection }),
  transcript: lazyQueueEvents('transcript-analysis', { connection: redisConnection }),
  cleanup: lazyQueueEvents('cleanup', { connection: redisConnection }),
};

// ─── Lookup Tables ───────────────────────────────
export const queueMap: Record<string, Queue> = {
  'trend-analysis': trendQueue,
  'script-generation': scriptQueue,
  'agent-tasks': agentQueue,
  'prompt-generation': agentQueue,
  'voiceover-generation': agentQueue,
  'thumbnail-generation': agentQueue,
  'seo-optimization': agentQueue,
  'video-generation': videoQueue,
  'video-render': renderQueue,
  'youtube-upload': uploadQueue,
  'analytics-collection': analyticsQueue,
  'transcript-analysis': transcriptQueue,
  'cleanup': cleanupQueue,
};

export const eventMap: Record<string, QueueEvents> = {
  'trend-analysis': queueEvents.trend,
  'script-generation': queueEvents.script,
  'agent-tasks': queueEvents.agent,
  'prompt-generation': queueEvents.agent,
  'voiceover-generation': queueEvents.agent,
  'thumbnail-generation': queueEvents.agent,
  'seo-optimization': queueEvents.agent,
  'video-generation': queueEvents.video,
  'video-render': queueEvents.render,
  'youtube-upload': queueEvents.upload,
  'analytics-collection': queueEvents.analytics,
  'transcript-analysis': queueEvents.transcript,
  'cleanup': queueEvents.cleanup,
};

export const dlqMap: Record<string, Queue> = {
  'trend-analysis': deadLetterQueues.trend,
  'script-generation': deadLetterQueues.script,
  'prompt-generation': deadLetterQueues.agent,
  'voiceover-generation': deadLetterQueues.agent,
  'thumbnail-generation': deadLetterQueues.agent,
  'seo-optimization': deadLetterQueues.agent,
  'video-generation': deadLetterQueues.video,
  'video-render': deadLetterQueues.render,
  'youtube-upload': deadLetterQueues.upload,
  'analytics-collection': deadLetterQueues.analytics,
  'transcript-analysis': deadLetterQueues.transcript,
  'cleanup': deadLetterQueues.cleanup,
};

// ─── All Queue Names (for monitoring) ────────────
export const ALL_QUEUES = [
  { name: 'video-generation', queue: videoQueue, events: queueEvents.video, dlq: deadLetterQueues.video },
  { name: 'trend-analysis', queue: trendQueue, events: queueEvents.trend, dlq: deadLetterQueues.trend },
  { name: 'script-generation', queue: scriptQueue, events: queueEvents.script, dlq: deadLetterQueues.script },
  { name: 'agent-tasks', queue: agentQueue, events: queueEvents.agent, dlq: deadLetterQueues.agent },
  { name: 'video-render', queue: renderQueue, events: queueEvents.render, dlq: deadLetterQueues.render },
  { name: 'youtube-upload', queue: uploadQueue, events: queueEvents.upload, dlq: deadLetterQueues.upload },
  { name: 'analytics-collection', queue: analyticsQueue, events: queueEvents.analytics, dlq: deadLetterQueues.analytics },
  { name: 'transcript-analysis', queue: transcriptQueue, events: queueEvents.transcript, dlq: deadLetterQueues.transcript },
  { name: 'cleanup', queue: cleanupQueue, events: queueEvents.cleanup, dlq: deadLetterQueues.cleanup },
] as const;

// ─── Accessor for real instances (for shutdown) ───
export function getMaterializedQueues(): Queue[] {
  return Array.from(queueInstances.values());
}

export function getMaterializedEvents(): QueueEvents[] {
  return Array.from(eventsInstances.values());
}
