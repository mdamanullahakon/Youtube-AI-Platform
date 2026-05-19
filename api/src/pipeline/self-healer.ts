import { pipelineLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { activateFallback } from '../services/youtube-fallback.service';

export enum FailureType {
  SCRIPT_FAILURE = 'script_failure',
  VOICE_FAILURE = 'voice_failure',
  VIDEO_FAILURE = 'video_failure',
  THUMBNAIL_FAILURE = 'thumbnail_failure',
  UPLOAD_FAILURE = 'upload_failure',
  OAUTH_FAILURE = 'oauth_failure',
  ANALYTICS_FAILURE = 'analytics_failure',
  UNKNOWN = 'unknown',
}

export interface SelfHealAction {
  action: string;
  modifiedPrompt?: string;
  fallbackEngine?: string;
  reusePrevious?: boolean;
  retryWithFreshToken?: boolean;
  triggerReconnect?: boolean;
  skipStep?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
}

function classifyFailure(stepName: string, errorMessage: string): FailureType {
  const msg = errorMessage.toLowerCase();
  if (stepName === 'ScriptEngine') return FailureType.SCRIPT_FAILURE;
  if (stepName === 'VoiceEngine') return FailureType.VOICE_FAILURE;
  if (stepName === 'VideoEngine') return FailureType.VIDEO_FAILURE;
  if (stepName === 'ThumbnailEngine') return FailureType.THUMBNAIL_FAILURE;
  if (stepName === 'UploadEngine') {
    if (msg.includes('invalid_grant') || msg.includes('token') || msg.includes('auth') || msg.includes('oauth')) {
      return FailureType.OAUTH_FAILURE;
    }
    return FailureType.UPLOAD_FAILURE;
  }
  if (stepName === 'AnalyticsEngine') return FailureType.ANALYTICS_FAILURE;
  return FailureType.UNKNOWN;
}

function determineHealAction(failureType: FailureType, stepName: string): SelfHealAction {
  switch (failureType) {
    case FailureType.SCRIPT_FAILURE:
      return {
        action: `Retry script generation with modified prompt (max 3 retries)`,
        modifiedPrompt: 'Write a more engaging version with a stronger opening hook and clearer scene descriptions. Each scene must include: [spoken text | duration in seconds | visual description].',
        fallbackEngine: 'script-fallback',
        maxRetries: 3,
        retryDelayMs: 2000,
      };

    case FailureType.VOICE_FAILURE:
      return {
        action: `Retry TTS generation (3 attempts), then fallback to audible sine wave`,
        fallbackEngine: 'sine-wave-audio',
        maxRetries: 3,
        retryDelayMs: 3000,
      };

    case FailureType.VIDEO_FAILURE:
      return {
        action: `Retry render with simplified scene settings (3 attempts)`,
        reusePrevious: false,
        fallbackEngine: 'simple-solid-color-render',
        maxRetries: 3,
        retryDelayMs: 5000,
      };

    case FailureType.THUMBNAIL_FAILURE:
      return {
        action: `Skip thumbnail, upload without thumbnail`,
        skipStep: false,
      };

    case FailureType.UPLOAD_FAILURE:
      return {
        action: `Retry upload with fresh OAuth token, then queue for fallback`,
        retryWithFreshToken: true,
        triggerReconnect: false,
        maxRetries: 3,
        retryDelayMs: 10000,
      };

    case FailureType.OAUTH_FAILURE:
      return {
        action: `Trigger OAuth reconnect, activate fallback mode, retry with fresh token`,
        retryWithFreshToken: true,
        triggerReconnect: true,
      };

    case FailureType.ANALYTICS_FAILURE:
      return {
        action: `Skip analytics, mark completed with defaults`,
        skipStep: true,
      };

    default:
      return {
        action: `No self-heal action for ${stepName}, failing permanently`,
      };
  }
}

export class SelfHealer {
  private projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  async heal(stepName: string, error: Error): Promise<SelfHealAction> {
    const failureType = classifyFailure(stepName, error.message);
    const action = determineHealAction(failureType, stepName);

    pipelineLogger.warn(`Self-heal triggered for ${stepName} (${failureType}): ${action.action}`);

    // Execute recovery actions
    switch (failureType) {
      case FailureType.OAUTH_FAILURE:
        // Disconnect stale account
        await prisma.youTubeAccount.updateMany({
          where: { userId: this.projectId, isConnected: true },
          data: { isConnected: false },
        }).catch(() => {});
        // Activate fallback upload mode
        await activateFallback('token_expired', error).catch(() => {});
        break;

      case FailureType.UPLOAD_FAILURE:
        // Queue for retry with fallback
        await activateFallback('unknown_oauth', error).catch(() => {});
        break;

      case FailureType.SCRIPT_FAILURE: {
        const project = await prisma.videoProject.findUnique({ where: { id: this.projectId } });
        if (project) {
          await prisma.videoProject.update({
            where: { id: this.projectId },
            data: { topic: `${project.topic} (regenerated)` },
          }).catch(() => {});
        }
        break;
      }

      case FailureType.VOICE_FAILURE:
        pipelineLogger.info(`Voice failure — will retry TTS with alternative engine. If all fail, sine wave audio will be used.`);
        break;

      case FailureType.VIDEO_FAILURE:
        pipelineLogger.info(`Video failure — will retry render with simplified settings (solid colors, no effects).`);
        break;

      default:
        break;
    }

    return action;
  }

  canRetry(failureType: FailureType, attempt: number, maxRetries: number): boolean {
    const retryableTypes = [
      FailureType.VOICE_FAILURE,
      FailureType.VIDEO_FAILURE,
      FailureType.SCRIPT_FAILURE,
      FailureType.UPLOAD_FAILURE,
    ];
    return retryableTypes.includes(failureType) && attempt < maxRetries;
  }
}
