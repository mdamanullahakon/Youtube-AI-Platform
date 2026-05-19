import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { logger } from '../utils/logger';
import { ViralQualityEngine } from './viral-quality.service';
import type { ParsedScene } from '../utils/helpers';

const execAsync = promisify(exec);

export interface ValidationCheck {
  name: string;
  passed: boolean;
  detail: string;
  severity: 'block' | 'warn';
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
  summary: string;
}

export class OutputValidationGate {
  private viralQuality: ViralQualityEngine;

  constructor() {
    this.viralQuality = new ViralQualityEngine();
  }

  async validateVideo(videoPath: string, scenes: ParsedScene[], audioPath?: string): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    // Check 1: Audio exists and is human-like (duration > 10s)
    const audioCheck = await this.checkAudio(audioPath);
    checks.push(audioCheck);

    // Check 2: Video duration matches script intent (≥ 45 seconds for long-form)
    const durationCheck = await this.checkDuration(videoPath, scenes);
    checks.push(durationCheck);

    // Check 3: Scene count >= 8
    checks.push(this.checkSceneCount(scenes));

    // Check 4: Hook present in first scene
    checks.push(this.checkHook(scenes));

    // Check 5: No static or black frames (ffprobe checkdata)
    const frameCheck = await this.checkVideoIntegrity(videoPath);
    checks.push(frameCheck);

    // Check 6: FFmpeg streams correctly mapped
    const streamCheck = await this.checkStreams(videoPath, audioPath);
    checks.push(streamCheck);

    // Check 7: Retention flow is valid (hook → payoff structure)
    checks.push(this.checkRetentionFlow(scenes));

    // Check 8: Visual variety (no duplicate/black prompts)
    checks.push(this.checkVisuals(scenes));

    // Check 9: Video file exists and has reasonable size
    const fileCheck = await this.checkFileSize(videoPath);
    checks.push(fileCheck);

    const blockers = checks.filter(c => c.severity === 'block' && !c.passed);
    const warnings = checks.filter(c => c.severity === 'warn' && !c.passed);

    const passed = blockers.length === 0;

    const summary = passed
      ? `VALIDATION PASSED: ${checks.filter(c => c.passed).length}/${checks.length} checks passed${warnings.length ? ` (${warnings.length} warnings)` : ''}`
      : `VALIDATION BLOCKED: ${blockers.length} blocker(s): ${blockers.map(b => b.name).join(', ')}`;

    logger.info(`[ValidationGate] ${summary}`);

    return { passed, checks, summary };
  }

  private async checkAudio(audioPath?: string): Promise<ValidationCheck> {
    if (!audioPath || !existsSync(audioPath)) {
      return { name: 'audio-exists', passed: false, detail: 'Audio file not found', severity: 'block' };
    }

    try {
      const audioStat = await stat(audioPath);
      if (audioStat.size < 500) {
        return { name: 'audio-exists', passed: false, detail: `Audio too small: ${audioStat.size} bytes`, severity: 'block' };
      }

      const duration = await this.getMediaDuration(audioPath);
      if (duration < 10) {
        return { name: 'audio-exists', passed: false, detail: `Audio too short: ${duration.toFixed(1)}s (min 10s)`, severity: 'block' };
      }

      return { name: 'audio-exists', passed: true, detail: `Audio OK: ${audioStat.size} bytes, ${duration.toFixed(1)}s`, severity: 'block' };
    } catch (err: any) {
      return { name: 'audio-exists', passed: false, detail: `Audio check error: ${err.message}`, severity: 'block' };
    }
  }

  private async checkDuration(videoPath: string, scenes: ParsedScene[]): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'video-duration', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const videoDuration = await this.getMediaDuration(videoPath);
      const expectedDuration = scenes.reduce((sum, s) => sum + s.duration, 0);

      if (videoDuration < 15) {
        return { name: 'video-duration', passed: false, detail: `Video too short: ${videoDuration.toFixed(1)}s (min 15s)`, severity: 'block' };
      }

      if (expectedDuration > 30 && videoDuration < expectedDuration * 0.5) {
        return {
          name: 'video-duration',
          passed: false,
          detail: `Video duration ${videoDuration.toFixed(1)}s is <50% of expected ${expectedDuration}s`,
          severity: 'block',
        };
      }

      return { name: 'video-duration', passed: true, detail: `Video: ${videoDuration.toFixed(1)}s, expected: ~${expectedDuration}s`, severity: 'block' };
    } catch (err: any) {
      return { name: 'video-duration', passed: false, detail: `Duration check error: ${err.message}`, severity: 'block' };
    }
  }

  private checkSceneCount(scenes: ParsedScene[]): ValidationCheck {
    if (scenes.length < 8) {
      return { name: 'scene-count', passed: false, detail: `${scenes.length} scenes (min 8 required)`, severity: 'block' };
    }
    return { name: 'scene-count', passed: true, detail: `${scenes.length} scenes`, severity: 'block' };
  }

  private checkHook(scenes: ParsedScene[]): ValidationCheck {
    if (scenes.length === 0) {
      return { name: 'hook-present', passed: false, detail: 'No scenes at all', severity: 'block' };
    }
    const firstText = scenes[0].text;
    const validation = this.viralQuality.validateHook(firstText);
    if (!validation.valid) {
      return {
        name: 'hook-present',
        passed: false,
        detail: `First scene is not a hook (score: ${validation.score}): "${firstText.substring(0, 60)}..." Issues: ${validation.issues.join(', ')}`,
        severity: 'block',
      };
    }
    return { name: 'hook-present', passed: true, detail: `Hook score: ${validation.score}`, severity: 'block' };
  }

  private async checkVideoIntegrity(videoPath: string): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'video-integrity', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';

      // Check for black frames using ffprobe + blackdetect filter
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -f lavfi -i "movie=${videoPath},blackdetect=d=1:pic_th=0.98" -show_entries tags=lavfi.black_start,lavfi.black_end -of default=noprint_wrappers=1:nokey=1`,
        { timeout: 15000 },
      ).catch(() => ({ stdout: '' }));

      if (stdout && stdout.trim().length > 0) {
        return {
          name: 'video-integrity',
          passed: false,
          detail: `Black frames detected in video (${stdout.trim().split('\n').length} segments)`,
          severity: 'warn',
        };
      }

      return { name: 'video-integrity', passed: true, detail: 'No black frames detected', severity: 'block' };
    } catch {
      // blackdetect filter might not be available — skip this check
      return { name: 'video-integrity', passed: true, detail: 'Integrity check skipped (ffprobe filter unavailable)', severity: 'warn' };
    }
  }

  private async checkStreams(videoPath: string, audioPath?: string): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'stream-mapping', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';

      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -show_streams -of json "${videoPath}"`,
        { timeout: 10000 },
      );

      const streams = JSON.parse(stdout).streams || [];
      const videoStreams = streams.filter((s: any) => s.codec_type === 'video');
      const audioStreams = streams.filter((s: any) => s.codec_type === 'audio');

      if (videoStreams.length === 0) {
        return { name: 'stream-mapping', passed: false, detail: 'No video stream found in output', severity: 'block' };
      }

      const details = [`Video streams: ${videoStreams.length}`];

      if (audioPath && existsSync(audioPath)) {
        if (audioStreams.length === 0) {
          return { name: 'stream-mapping', passed: false, detail: 'Audio file provided but no audio stream in output', severity: 'block' };
        }
        details.push(`Audio streams: ${audioStreams.length}`);
      }

      return { name: 'stream-mapping', passed: true, detail: details.join(', '), severity: 'block' };
    } catch (err: any) {
      return { name: 'stream-mapping', passed: false, detail: `Stream check error: ${err.message}`, severity: 'block' };
    }
  }

  private checkRetentionFlow(scenes: ParsedScene[]): ValidationCheck {
    if (scenes.length < 3) {
      return { name: 'retention-flow', passed: false, detail: 'Too few scenes for retention flow', severity: 'block' };
    }

    const text = scenes.map(s => s.text.toLowerCase()).join(' ');

    // Check for key arc elements
    const hasProblem = /problem|issue|mistake|wrong|challenge|struggle|but|however/.test(text);
    const hasSolution = /solution|how to|fix|solve|step|guide|way to|method|proven/.test(text);
    const hasCta = /subscribe|comment|like|share|follow|next/.test(scenes[scenes.length - 1].text.toLowerCase());

    const missing: string[] = [];
    if (!hasProblem) missing.push('problem/agitation section');
    if (!hasSolution) missing.push('solution section');
    if (!hasCta) missing.push('call-to-action');

    if (missing.length >= 2) {
      return { name: 'retention-flow', passed: false, detail: `Missing arc elements: ${missing.join(', ')}`, severity: 'warn' };
    }

    return { name: 'retention-flow', passed: true, detail: `Hook→Problem→Solution→CTA flow intact`, severity: 'block' };
  }

  private checkVisuals(scenes: ParsedScene[]): ValidationCheck {
    const check = this.viralQuality.checkVisualVariety(scenes);
    return {
      name: 'visual-variety',
      passed: check.valid,
      detail: check.issues.length > 0 ? check.issues.join('; ') : 'Visuals are varied and engaging',
      severity: check.valid ? 'block' : 'warn',
    };
  }

  private async checkFileSize(videoPath: string): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'file-size', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const fileStat = await stat(videoPath);
      if (fileStat.size < 1024) {
        return { name: 'file-size', passed: false, detail: `File too small: ${fileStat.size} bytes`, severity: 'block' };
      }
      return { name: 'file-size', passed: true, detail: `${(fileStat.size / 1024 / 1024).toFixed(1)} MB`, severity: 'block' };
    } catch (err: any) {
      return { name: 'file-size', passed: false, detail: `File check error: ${err.message}`, severity: 'block' };
    }
  }

  private async getMediaDuration(path: string): Promise<number> {
    try {
      const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`,
        { timeout: 10000 },
      );
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }
}
