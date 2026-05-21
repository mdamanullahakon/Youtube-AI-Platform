import { Queue, QueueEvents } from 'bullmq';
import { redisConnection } from '../config/redis';

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

export const STANDARD_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 } as const,
  timeout: 180_000,
  removeOnComplete: { age: 86400, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 50 },
};

export const RENDER_JOB_OPTS = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 10000 } as const,
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

function mkQueue(name: string, defaultJobOptions: any): Queue {
  return new Queue(name, {
    connection: redisConnection,
    defaultJobOptions,
  });
}

function mkEvents(name: string): QueueEvents {
  return new QueueEvents(name, { connection: redisConnection });
}

// ─── Main Queues ────────────────────────────────
export const videoQueue = mkQueue('video-generation', STANDARD_JOB_OPTS);
export const trendQueue = mkQueue('trend-analysis', STANDARD_JOB_OPTS);
export const scriptQueue = mkQueue('script-generation', STANDARD_JOB_OPTS);
export const agentQueue = mkQueue('agent-tasks', STANDARD_JOB_OPTS);
export const renderQueue = mkQueue('video-render', RENDER_JOB_OPTS);
export const uploadQueue = mkQueue('youtube-upload', UPLOAD_JOB_OPTS);
export const analyticsQueue = mkQueue('analytics-collection', STANDARD_JOB_OPTS);
export const transcriptQueue = mkQueue('transcript-analysis', STANDARD_JOB_OPTS);
export const cleanupQueue = mkQueue('cleanup', CLEANUP_JOB_OPTS);

// ─── Dead-Letter Queues ──────────────────────────
const DLQ_JOB_OPTS = {
  removeOnComplete: { age: 86400 * 3, count: 100 },
  removeOnFail: { age: 86400 * 7, count: 200 },
};

function mkDLQ(name: string): Queue {
  return new Queue(name, { connection: redisConnection, defaultJobOptions: DLQ_JOB_OPTS });
}

export const deadLetterQueues = {
  video: mkDLQ(DLQ_NAMES.video),
  trend: mkDLQ(DLQ_NAMES.trend),
  script: mkDLQ(DLQ_NAMES.script),
  agent: mkDLQ(DLQ_NAMES.agent),
  render: mkDLQ(DLQ_NAMES.render),
  upload: mkDLQ(DLQ_NAMES.upload),
  analytics: mkDLQ(DLQ_NAMES.analytics),
  transcript: mkDLQ(DLQ_NAMES.transcript),
  cleanup: mkDLQ(DLQ_NAMES.cleanup),
} as const;

// ─── Queue Events ────────────────────────────────
export const queueEvents = {
  video: mkEvents('video-generation'),
  trend: mkEvents('trend-analysis'),
  script: mkEvents('script-generation'),
  agent: mkEvents('agent-tasks'),
  render: mkEvents('video-render'),
  upload: mkEvents('youtube-upload'),
  analytics: mkEvents('analytics-collection'),
  transcript: mkEvents('transcript-analysis'),
  cleanup: mkEvents('cleanup'),
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
