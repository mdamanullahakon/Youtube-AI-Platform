import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { pipelineLogger } from '../utils/logger';

export enum PipelineState {
  TOPIC_SELECTED = 'TOPIC_SELECTED',
  SCRIPT_GENERATED = 'SCRIPT_GENERATED',
  VOICE_GENERATED = 'VOICE_GENERATED',
  VIDEO_RENDERED = 'VIDEO_RENDERED',
  THUMBNAIL_CREATED = 'THUMBNAIL_CREATED',
  READY_FOR_UPLOAD = 'READY_FOR_UPLOAD',
  UPLOADED = 'UPLOADED',
  ANALYTICS_COLLECTED = 'ANALYTICS_COLLECTED',
  FAILED = 'FAILED',
}

const VALID_TRANSITIONS: Record<PipelineState, PipelineState[]> = {
  [PipelineState.TOPIC_SELECTED]: [PipelineState.SCRIPT_GENERATED, PipelineState.FAILED],
  [PipelineState.SCRIPT_GENERATED]: [PipelineState.VOICE_GENERATED, PipelineState.THUMBNAIL_CREATED, PipelineState.VIDEO_RENDERED, PipelineState.READY_FOR_UPLOAD, PipelineState.FAILED],
  [PipelineState.VOICE_GENERATED]: [PipelineState.VIDEO_RENDERED, PipelineState.FAILED],
  [PipelineState.VIDEO_RENDERED]: [PipelineState.READY_FOR_UPLOAD, PipelineState.FAILED],
  [PipelineState.THUMBNAIL_CREATED]: [PipelineState.READY_FOR_UPLOAD, PipelineState.FAILED],
  [PipelineState.READY_FOR_UPLOAD]: [PipelineState.UPLOADED, PipelineState.FAILED],
  [PipelineState.UPLOADED]: [PipelineState.ANALYTICS_COLLECTED, PipelineState.FAILED],
  [PipelineState.ANALYTICS_COLLECTED]: [],
  [PipelineState.FAILED]: [],
};

const STEP_TO_STATE: Record<string, PipelineState> = {
  TopicEngine: PipelineState.TOPIC_SELECTED,
  ScriptEngine: PipelineState.SCRIPT_GENERATED,
  VoiceEngine: PipelineState.VOICE_GENERATED,
  VideoEngine: PipelineState.VIDEO_RENDERED,
  ThumbnailEngine: PipelineState.THUMBNAIL_CREATED,
  UploadEngine: PipelineState.UPLOADED,
  AnalyticsEngine: PipelineState.ANALYTICS_COLLECTED,
};

const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSITION_LOCK_TTL_MS = 10000;

const STATE_TO_DB_STATUS: Record<PipelineState, string> = {
  [PipelineState.TOPIC_SELECTED]: 'trending_analyzed',
  [PipelineState.SCRIPT_GENERATED]: 'script_generated',
  [PipelineState.VOICE_GENERATED]: 'script_generated',
  [PipelineState.VIDEO_RENDERED]: 'rendered',
  [PipelineState.THUMBNAIL_CREATED]: 'script_generated',
  [PipelineState.READY_FOR_UPLOAD]: 'rendered',
  [PipelineState.UPLOADED]: 'published',
  [PipelineState.ANALYTICS_COLLECTED]: 'published',
  [PipelineState.FAILED]: 'failed',
};

function stateKey(projectId: string): string {
  return `pipeline:state:${projectId}`;
}

function stateLockKey(projectId: string): string {
  return `pipeline:lock:${projectId}`;
}

export class PipelineStateMachine {
  private projectId: string;
  private cachedState: PipelineState | null = null;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async getCurrentState(): Promise<PipelineState | null> {
    if (this.cachedState) return this.cachedState;
    try {
      const state = await redisConnection.get(stateKey(this.projectId));
      if (state && Object.values(PipelineState).includes(state as PipelineState)) {
        this.cachedState = state as PipelineState;
        return this.cachedState;
      }
      return null;
    } catch {
      const project = await prisma.videoProject.findUnique({
        where: { id: this.projectId },
        select: { status: true },
      });
      this.cachedState = this.mapDbStatusToState(project?.status);
      return this.cachedState;
    }
  }

  async canTransition(targetState: PipelineState): Promise<boolean> {
    const currentState = await this.getCurrentState();
    if (currentState === null) {
      return targetState === PipelineState.TOPIC_SELECTED;
    }
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed) return false;
    return allowed.includes(targetState);
  }

  async transitionTo(targetState: PipelineState): Promise<boolean> {
    const canTransition = await this.canTransition(targetState);
    if (!canTransition) {
      pipelineLogger.error(`State transition rejected: ${await this.getCurrentState()} -> ${targetState} for ${this.projectId}`);
      return false;
    }

    try {
      const lockKey = stateLockKey(this.projectId);
      const lock = await redisConnection.set(lockKey, Date.now().toString(), 'PX', TRANSITION_LOCK_TTL_MS, 'NX');
      if (!lock) return false;

      try {
        await redisConnection.set(stateKey(this.projectId), targetState, 'PX', STATE_TTL_MS);
        this.cachedState = targetState;
        const dbStatus = STATE_TO_DB_STATUS[targetState];
        if (dbStatus) {
          await prisma.videoProject.update({
            where: { id: this.projectId },
            data: { status: dbStatus },
          }).catch(() => {});
        }
        pipelineLogger.info(`State transition: -> ${targetState} for project ${this.projectId}`);
        return true;
      } finally {
        await redisConnection.del(lockKey).catch(() => {});
      }
    } catch (err: any) {
      pipelineLogger.error(`State transition failed for ${this.projectId}: ${err.message}`);
      return false;
    }
  }

  async transitionAfterStep(stepName: string): Promise<boolean> {
    const targetState = STEP_TO_STATE[stepName];
    if (!targetState) return true;
    return this.transitionTo(targetState);
  }

  async markFailed(): Promise<void> {
    await this.transitionTo(PipelineState.FAILED);
  }

  isAllowed(stepName: string): boolean {
    const targetState = STEP_TO_STATE[stepName];
    if (!targetState) return false;
    if (this.cachedState) {
      return VALID_TRANSITIONS[this.cachedState]?.includes(targetState) ?? false;
    }
    return true;
  }

  private mapDbStatusToState(status: string | undefined | null): PipelineState | null {
    if (!status) return null;
    const mapping: Record<string, PipelineState> = {
      'trending_analyzed': PipelineState.TOPIC_SELECTED,
      'script_generated': PipelineState.SCRIPT_GENERATED,
      'rendered': PipelineState.VIDEO_RENDERED,
      'published': PipelineState.UPLOADED,
      'failed': PipelineState.FAILED,
    };
    return mapping[status] || null;
  }
}
