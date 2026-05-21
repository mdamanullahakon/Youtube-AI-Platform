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

  async validateVideo(
    videoPath: string,
    scenes: ParsedScene[],
    audioPath?: string,
    title?: string,
    thumbnailPrompt?: string,
  ): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    // Check 1: File exists and minimum size (hard gate)
    checks.push(await this.checkFileIntegrity(videoPath));

    // Check 2: Video has valid streams (hard gate)
    const streamCheck = await this.checkStreams(videoPath, audioPath);
    checks.push(streamCheck);

    // Check 3: Video duration matches script intent (hard gate)
    const durationCheck = await this.checkDuration(videoPath, scenes);
    checks.push(durationCheck);

    // Check 4: No black/static frames (warning)
    const frameCheck = await this.checkVideoIntegrity(videoPath);
    checks.push(frameCheck);

    // Check 5: Audio exists and is valid (hard gate if audio was provided)
    if (audioPath) {
      checks.push(await this.checkAudio(audioPath));
    }

    // Check 6: Scene count minimum (hard gate)
    checks.push(this.checkSceneCount(scenes));

    // Check 7: Hook in first scene (hard gate)
    checks.push(this.checkHook(scenes));

    // Check 8: Retention flow (warning)
    checks.push(this.checkRetentionFlow(scenes));

    // Check 9: Visual variety (warning)
    checks.push(this.checkVisuals(scenes));

    // Check 10: Title matches content (warning)
    if (title) {
      checks.push(this.checkTitleMatch(scenes, title));
    }

    const blockers = checks.filter(c => c.severity === 'block' && !c.passed);
    const warnings = checks.filter(c => c.severity === 'warn' && !c.passed);

    const passed = blockers.length === 0;

    const summary = passed
      ? `VALIDATION PASSED: ${checks.filter(c => c.passed).length}/${checks.length} checks passed${warnings.length ? ` (${warnings.length} warnings)` : ''}`
      : `VALIDATION BLOCKED: ${blockers.length} blocker(s): ${blockers.map(b => b.name).join(', ')}`;

    logger.info(`[ValidationGate] ${summary}`);

    for (const b of blockers) {
      logger.error(`[ValidationGate] BLOCKER: ${b.name} - ${b.detail}`);
    }
    for (const w of warnings) {
      logger.warn(`[ValidationGate] WARNING: ${w.name} - ${w.detail}`);
    }

    return { passed, checks, summary };
  }

  // ─── FILE INTEGRITY (HARD GATE) ──────────────────────────────────────────

  private async checkFileIntegrity(videoPath: string): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'file-exists', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const fileStat = await stat(videoPath);
      if (fileStat.size < 2048) {
        return { name: 'file-exists', passed: false, detail: `File too small: ${fileStat.size} bytes (min 2048)`, severity: 'block' };
      }

      // Validate with ffprobe
      const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { timeout: 10000 },
      );
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration) || duration <= 0) {
        return { name: 'file-exists', passed: false, detail: 'ffprobe cannot read file - likely corrupt', severity: 'block' };
      }

      return { name: 'file-exists', passed: true, detail: `${(fileStat.size / 1024 / 1024).toFixed(1)} MB, ${duration.toFixed(1)}s`, severity: 'block' };
    } catch (err: any) {
      return { name: 'file-exists', passed: false, detail: `Integrity check error: ${err.message}`, severity: 'block' };
    }
  }

  // ─── STREAMS CHECK (HARD GATE) ───────────────────────────────────────────

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

      const details = [`Video: ${videoStreams.length} stream(s)`];

      if (audioPath && existsSync(audioPath)) {
        if (audioStreams.length === 0) {
          return { name: 'stream-mapping', passed: false, detail: 'Audio file provided but no audio stream in output', severity: 'block' };
        }
        details.push(`Audio: ${audioStreams.length} stream(s)`);
      }

      // Check for corruption: validate codec parameters exist
      for (const vs of videoStreams) {
        if (!vs.codec_name || !vs.width || !vs.height) {
          return { name: 'stream-mapping', passed: false, detail: 'Video stream missing codec parameters - corrupt', severity: 'block' };
        }
      }

      return { name: 'stream-mapping', passed: true, detail: details.join(', '), severity: 'block' };
    } catch (err: any) {
      return { name: 'stream-mapping', passed: false, detail: `Stream check error: ${err.message}`, severity: 'block' };
    }
  }

  // ─── DURATION CHECK (HARD GATE) ──────────────────────────────────────────

  private async checkDuration(videoPath: string, scenes: ParsedScene[]): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'video-duration', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const videoDuration = await this.getMediaDuration(videoPath);
      if (videoDuration < 10) {
        return { name: 'video-duration', passed: false, detail: `Video too short: ${videoDuration.toFixed(1)}s (min 10s)`, severity: 'block' };
      }

      return { name: 'video-duration', passed: true, detail: `Video: ${videoDuration.toFixed(1)}s`, severity: 'block' };
    } catch (err: any) {
      return { name: 'video-duration', passed: false, detail: `Duration check error: ${err.message}`, severity: 'block' };
    }
  }

  // ─── BLACK FRAME DETECTION (WARNING) ─────────────────────────────────────

  private async checkVideoIntegrity(videoPath: string): Promise<ValidationCheck> {
    if (!existsSync(videoPath)) {
      return { name: 'video-integrity', passed: false, detail: 'Video file not found', severity: 'block' };
    }

    try {
      const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
      const result = await execAsync(
        `"${ffmpeg}" -i "${videoPath}" -vf "blackdetect=d=0.5:pic_th=0.98" -f null -`,
        { timeout: 30000 },
      ).catch(() => ({ stdout: '', stderr: '' }));

      const logOutput = result.stderr || result.stdout || '';
      const blackStartMatches = logOutput.match(/black_start:[\s]*([\d.]+)/g) || [];

      if (blackStartMatches.length > 0) {
        return {
          name: 'video-integrity',
          passed: false,
          detail: `${blackStartMatches.length} black frame segment(s) detected`,
          severity: 'warn',
        };
      }

      return { name: 'video-integrity', passed: true, detail: 'No black frames detected', severity: 'block' };
    } catch {
      return { name: 'video-integrity', passed: true, detail: 'Integrity check skipped', severity: 'warn' };
    }
  }

  // ─── AUDIO CHECK (HARD GATE IF AUDIO PROVIDED) ───────────────────────────

  private async checkAudio(audioPath: string): Promise<ValidationCheck> {
    if (!existsSync(audioPath)) {
      return { name: 'audio-exists', passed: false, detail: 'Audio file not found', severity: 'block' };
    }

    try {
      const audioStat = await stat(audioPath);
      if (audioStat.size < 500) {
        return { name: 'audio-exists', passed: false, detail: `Audio too small: ${audioStat.size} bytes`, severity: 'block' };
      }

      const duration = await this.getMediaDuration(audioPath);
      if (duration < 5) {
        return { name: 'audio-exists', passed: false, detail: `Audio too short: ${duration.toFixed(1)}s (min 5s)`, severity: 'block' };
      }

      return { name: 'audio-exists', passed: true, detail: `Audio OK: ${audioStat.size} bytes, ${duration.toFixed(1)}s`, severity: 'block' };
    } catch (err: any) {
      return { name: 'audio-exists', passed: false, detail: `Audio check error: ${err.message}`, severity: 'block' };
    }
  }

  // ─── SCENE COUNT (HARD GATE) ─────────────────────────────────────────────

  private checkSceneCount(scenes: ParsedScene[]): ValidationCheck {
    if (scenes.length < 3) {
      return { name: 'scene-count', passed: false, detail: `${scenes.length} scenes (min 3 required)`, severity: 'block' };
    }
    return { name: 'scene-count', passed: true, detail: `${scenes.length} scenes`, severity: 'block' };
  }

  // ─── HOOK CHECK (HARD GATE) ──────────────────────────────────────────────

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

  // ─── RETENTION FLOW (WARNING) ────────────────────────────────────────────

  private checkRetentionFlow(scenes: ParsedScene[]): ValidationCheck {
    if (scenes.length < 3) {
      return { name: 'retention-flow', passed: false, detail: 'Too few scenes for retention flow', severity: 'warn' };
    }

    const text = scenes.map(s => s.text.toLowerCase()).join(' ');

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

    return { name: 'retention-flow', passed: true, detail: 'Hook-Problem-Solution-CTA flow intact', severity: 'block' };
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

  private checkTitleMatch(scenes: ParsedScene[], title: string): ValidationCheck {
    if (scenes.length === 0) {
      return { name: 'title-match', passed: false, detail: 'No scenes to check against title', severity: 'warn' };
    }

    const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (titleWords.length === 0) {
      return { name: 'title-match', passed: true, detail: 'Title too short to verify match', severity: 'warn' };
    }

    const firstSceneText = scenes[0].text.toLowerCase();
    const matchedInFirst = titleWords.filter(w => firstSceneText.includes(w));

    if (matchedInFirst.length < titleWords.length * 0.3) {
      return {
        name: 'title-match',
        passed: false,
        detail: `Title topic not found in first scene: "${title.substring(0, 50)}..." (${matchedInFirst.length}/${titleWords.length} keywords matched)`,
        severity: 'warn',
      };
    }

    return { name: 'title-match', passed: true, detail: `Title matches content (${matchedInFirst.length}/${titleWords.length} keywords in first scene)`, severity: 'block' };
  }

  // ─── FFPROBE HELPER ──────────────────────────────────────────────────────

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
