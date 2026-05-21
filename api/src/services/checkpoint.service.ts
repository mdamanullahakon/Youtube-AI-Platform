import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';

export type PipelineStep =
  | 'TREND_ANALYSIS'
  | 'SCRIPT_GENERATION'
  | 'AGENT_DISPATCH'
  | 'VIDEO_RENDER'
  | 'OUTPUT_VALIDATION'
  | 'YOUTUBE_UPLOAD'
  | 'ANALYTICS_SYNC';

type CheckpointStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

const PREFIX = 'pipeline:checkpoint:';

interface StepState {
  step: PipelineStep;
  status: CheckpointStatus;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  data: Record<string, unknown>;
}

const ALL_STEPS: PipelineStep[] = [
  'TREND_ANALYSIS',
  'SCRIPT_GENERATION',
  'AGENT_DISPATCH',
  'VIDEO_RENDER',
  'OUTPUT_VALIDATION',
  'YOUTUBE_UPLOAD',
  'ANALYTICS_SYNC',
];

export class CheckpointService {
  async initialize(projectId: string, steps: PipelineStep[] = ALL_STEPS): Promise<void> {
    const key = `${PREFIX}${projectId}`;
    const existing = await redisConnection.get(key);
    if (existing) return;

    const state: Record<string, StepState> = {};
    for (const step of steps) {
      state[step] = {
        step,
        status: 'PENDING',
        retryCount: 0,
        maxRetries: 3,
        error: null,
        startedAt: null,
        completedAt: null,
        data: {},
      };
    }
    await redisConnection.set(key, JSON.stringify(state));
    await redisConnection.expire(key, 86400 * 7);
  }

  async start(projectId: string, step: PipelineStep): Promise<void> {
    const state = await this.getAll(projectId);
    if (!state[step]) {
      state[step] = {
        step, status: 'PENDING', retryCount: 0, maxRetries: 3,
        error: null, startedAt: null, completedAt: null, data: {},
      };
    }
    state[step].status = 'RUNNING';
    state[step].startedAt = new Date().toISOString();
    state[step].retryCount = (state[step].retryCount || 0) + 1;
    state[step].error = null;
    await this.saveAll(projectId, state);
  }

  async complete(projectId: string, step: PipelineStep, data?: Record<string, unknown>): Promise<void> {
    const state = await this.getAll(projectId);
    if (state[step]) {
      state[step].status = 'COMPLETED';
      state[step].completedAt = new Date().toISOString();
      if (data) state[step].data = { ...state[step].data, ...data };
    }
    await this.saveAll(projectId, state);
  }

  async fail(projectId: string, step: PipelineStep, error: string): Promise<void> {
    const state = await this.getAll(projectId);
    if (state[step]) {
      const exhausted = (state[step].retryCount || 0) >= (state[step].maxRetries || 3);
      state[step].status = exhausted ? 'FAILED' : 'PENDING';
      state[step].error = error;
      if (exhausted) {
        logger.error(`[Checkpoint] ${step} for ${projectId} exhausted retries: ${error}`);
      }
    }
    await this.saveAll(projectId, state);
  }

  async getStatus(projectId: string): Promise<StepState[]> {
    const state = await this.getAll(projectId);
    return Object.values(state);
  }

  async getNextStep(projectId: string): Promise<PipelineStep | null> {
    const state = await this.getAll(projectId);
    for (const step of ALL_STEPS) {
      const s = state[step];
      if (!s || s.status === 'PENDING' || s.status === 'FAILED') return step;
    }
    return null;
  }

  async isComplete(projectId: string): Promise<boolean> {
    const state = await this.getAll(projectId);
    return ALL_STEPS.every(step => state[step]?.status === 'COMPLETED' || state[step]?.status === 'SKIPPED');
  }

  async getStepData(projectId: string, step: PipelineStep): Promise<Record<string, unknown> | null> {
    const state = await this.getAll(projectId);
    return state[step]?.data || null;
  }

  async reset(projectId: string): Promise<void> {
    await redisConnection.del(`${PREFIX}${projectId}`);
  }

  private async getAll(projectId: string): Promise<Record<string, StepState>> {
    try {
      const raw = await redisConnection.get(`${PREFIX}${projectId}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private async saveAll(projectId: string, state: Record<string, StepState>): Promise<void> {
    await redisConnection.set(`${PREFIX}${projectId}`, JSON.stringify(state));
    await redisConnection.expire(`${PREFIX}${projectId}`, 86400 * 7);
  }
}

export const checkpointService = new CheckpointService();
