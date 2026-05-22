export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  FALLBACK = 'fallback',
  SKIPPED = 'skipped',
}

export enum PipelineStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PARTIALLY_COMPLETED = 'partially_completed',
}

export interface StepResult<TOutput = unknown> {
  stepName: string;
  status: StepStatus;
  output: TOutput | null;
  error: string | null;
  retries: number;
  durationMs: number;
  fallbackUsed: boolean;
}

export interface PipelineContext {
  projectId: string;
  userId: string;
  channelId?: string;
  topic: string;
  status: PipelineStatus;
  steps: Record<string, StepResult>;
  startedAt: number;
  completedAt?: number;
}

export interface PipelineStepInput {
  projectId: string;
  topic: string;
  channelId?: string;
  userId: string;
}

export interface TopicEngineInput extends PipelineStepInput {}
export interface TopicEngineOutput {
  topic: string;
  viralScore: number;
  competition: number;
  audience: string;
  format: string;
  reasoning: string;
}

export interface ScriptEngineInput extends PipelineStepInput {
  trendAnalysis: TopicEngineOutput;
}
export interface ScriptEngineOutput {
  scriptId: string;
  content: string;
  hook: string;
  wordCount: number;
  scenes: {
    text: string;
    duration: number;
    visualPrompt: string;
    mood?: string;
    pacing?: string;
    retentionHook?: string;
  }[];
}

export interface VoiceEngineInput extends PipelineStepInput {
  script: ScriptEngineOutput;
}
export interface VoiceEngineOutput {
  audioUrl: string | null;
  duration: number;
  voiceoverId: string | null;
}

export interface VideoEngineInput extends PipelineStepInput {
  script: ScriptEngineOutput;
  voiceover: VoiceEngineOutput;
}
export interface VideoEngineOutput {
  renderId: string;
  videoUrl: string;
  duration: number;
}

export interface VideoValidationInput extends PipelineStepInput {
  script: ScriptEngineOutput;
  voiceover: VoiceEngineOutput;
  video: VideoEngineOutput;
}
export interface VideoValidationOutput {
  validated: boolean;
  videoUrl: string;
  durationSec: number;
  resolution: string;
}

export interface ThumbnailEngineInput extends PipelineStepInput {
  script: ScriptEngineOutput;
}
export interface ThumbnailEngineOutput {
  thumbnailId: string;
  imageUrl: string | null;
  style: string;
  predictedCtr: number;
}

export interface UploadEngineInput extends PipelineStepInput {
  video: VideoEngineOutput;
  thumbnail: ThumbnailEngineOutput;
  script: ScriptEngineOutput;
}
export interface UploadEngineOutput {
  uploadId: string;
  videoId: string;
  publishedAt: Date;
}

export interface AnalyticsEngineInput extends PipelineStepInput {
  upload: UploadEngineOutput;
}
export interface AnalyticsEngineOutput {
  analyticsId: string;
  views: number;
  ctr: number;
  retention: number;
}

export const MAX_STEP_RETRIES = 3;
export const STEP_RETRY_BASE_DELAY_MS = 2000;
export const TOPIC_SCORE_THRESHOLD = 50;
export const VIRAL_SCORE_THRESHOLD = 60;
export const RETENTION_SCORE_THRESHOLD = 55;
