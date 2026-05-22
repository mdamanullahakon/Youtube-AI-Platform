import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export const MIN_UPLOAD_DURATION_SEC = 30;
export const MIN_UPLOAD_HEIGHT = 720;
export const MIN_UPLOAD_WIDTH = 1280;

export interface PreUploadValidationResult {
  passed: boolean;
  blockers: string[];
  details: Record<string, string | number | boolean>;
}

export class PreUploadValidationGate {
  async validate(params: {
    videoPath: string;
    thumbnailPath?: string | null;
    requireThumbnail?: boolean;
  }): Promise<PreUploadValidationResult> {
    const blockers: string[] = [];
    const details: Record<string, string | number | boolean> = {};
    const { videoPath, thumbnailPath, requireThumbnail = true } = params;

    if (!existsSync(videoPath)) {
      blockers.push('video-file-missing');
      return { passed: false, blockers, details };
    }

    const fileStat = await stat(videoPath);
    details.fileSizeMb = Number((fileStat.size / 1024 / 1024).toFixed(2));
    if (fileStat.size < 2048) {
      blockers.push('video-file-too-small');
    }

    const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';

    let duration = 0;
    let width = 0;
    let height = 0;
    let hasVideo = false;
    let hasAudio = false;

    try {
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -show_streams -show_format -of json "${videoPath}"`,
        { timeout: 15000 },
      );
      const parsed = JSON.parse(stdout);
      duration = parseFloat(parsed.format?.duration || '0') || 0;
      details.durationSec = duration;

      for (const stream of parsed.streams || []) {
        if (stream.codec_type === 'video') {
          hasVideo = true;
          width = stream.width || 0;
          height = stream.height || 0;
        }
        if (stream.codec_type === 'audio') {
          hasAudio = true;
        }
      }
      details.width = width;
      details.height = height;
      details.hasVideoStream = hasVideo;
      details.hasAudioStream = hasAudio;
    } catch (err: any) {
      blockers.push('ffprobe-failed');
      details.ffprobeError = err.message;
      return { passed: false, blockers, details };
    }

    if (!hasVideo) blockers.push('no-video-stream');
    if (!hasAudio) blockers.push('no-audio-stream');
    if (duration < MIN_UPLOAD_DURATION_SEC) {
      blockers.push(`duration-under-${MIN_UPLOAD_DURATION_SEC}s`);
    }
    if (height < MIN_UPLOAD_HEIGHT || width < MIN_UPLOAD_WIDTH) {
      blockers.push('resolution-below-720p');
    }

    if (requireThumbnail) {
      if (!thumbnailPath) {
        blockers.push('thumbnail-missing');
      } else {
        const thumbAbs = thumbnailPath.startsWith('/')
          ? join(process.cwd(), thumbnailPath.replace(/^\//, ''))
          : thumbnailPath;
        if (!existsSync(thumbAbs)) {
          blockers.push('thumbnail-file-missing');
        } else {
          const thumbStat = await stat(thumbAbs);
          details.thumbnailSizeKb = Math.round(thumbStat.size / 1024);
          if (thumbStat.size < 500) blockers.push('thumbnail-too-small');
        }
      }
    }

    const passed = blockers.length === 0;
    logger.info(`[PreUploadValidation] ${passed ? 'PASSED' : 'BLOCKED'}: ${blockers.join(', ') || 'all checks ok'}`, details);
    return { passed, blockers, details };
  }
}
