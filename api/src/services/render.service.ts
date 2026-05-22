import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { StorageManager } from './storage.service';
import { planScenes, type ScenePlan } from './scene.service';
import { writeSrtFile, generateSrtFilterPath, getSubtitleStyle } from './subtitle.service';
import { escapeFilter } from './motion.service';
import { resolveFontPath, escapeFontPath } from '../config/font-resolver';
import { fetchBackgroundImage } from './image.service';
import { generateBackgroundAudio, selectMood } from './music.service';
import {
  buildCameraMotionFilter,
  buildColorGradeFilter,
  buildCinematicOverlayFilter,
  buildSceneFadeFilter,
  detectMoodFromTopic,
  xfadeTransitionForMood,
  type CameraMotion,
} from './cinematic-effects';
import type { ParsedScene } from '../utils/helpers';

const execAsync = promisify(exec);
const FPS = 30;
const RESOLUTION = '1920x1080';
const TRANSITION_DURATION = 0.5;
const MIN_OUTPUT_DURATION_SEC = 30;
const MIN_SCENE_DURATION = 6;
const MAX_SCENE_DURATION = 16;
const SCENE_RETRIES = 3;
const MAX_COMMAND_LENGTH = 7000;
const MAX_FILTER_NODES = 12;
const MIN_OUTPUT_SIZE = 2048;

interface RenderOptions {
  scenes: ParsedScene[];
  topic?: string;
  title?: string;
  voiceoverPath?: string;
  musicPath?: string;
  outputPath: string;
  mood?: string;
  encoder?: string;
}

interface TempFiles {
  sceneFiles: string[];
  srtFile?: string;
  titleCard?: string;
}

interface ValidationResult {
  valid: boolean;
  issues: string[];
  audioDuration: number;
  videoDuration: number;
  sceneCount: number;
}

// ─── PUBLIC ENTRY POINT ──────────────────────────────────────────────────────

export async function renderVideo(options: RenderOptions): Promise<string> {
  const tempDir = join(process.cwd(), 'temp', `render_${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  const tempFiles: TempFiles = { sceneFiles: [] };
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  try {
    await checkDiskSpace();

    logger.info(`[RENDER_TRACE] scene_start: ${options.scenes.length} scenes`);

    // ── 1. Plan scenes with safety limits ──────────────────────────────────
    const scenePlans = await planScenes(options.scenes, options.topic);
    logger.info(`[RENDER_TRACE] scene_plan_complete: ${scenePlans.length} scenes`);

    // ── 2. Reject empty scenes ─────────────────────────────────────────────
    const validScenes = scenePlans.filter(s => s.text.trim().length > 0);
    if (validScenes.length === 0) {
      throw new Error('All scenes rejected: empty text content');
    }
    if (validScenes.length < scenePlans.length) {
      logger.warn(`[RENDER_TRACE] Rejected ${scenePlans.length - validScenes.length} empty scenes`);
    }

    // ── 3. Generate SRT subtitles from ALL scene text ──────────────────────
    // This is the PRIMARY text rendering mechanism - replaces per-scene drawtext
    const transitionMs = Math.round(TRANSITION_DURATION * 1000);
    tempFiles.srtFile = await writeSrtFile(validScenes, tempDir, 'subtitles.srt', transitionMs);
    logger.info(`[RENDER_TRACE] SRT generated as primary text layer: ${validScenes.length} scenes`);

    // ── 4. Title card (1-2 drawtext max) ───────────────────────────────────
    const titleCardPath = join(tempDir, 'title_card.mp4');
    tempFiles.titleCard = titleCardPath;
    await renderTitleCard(options.title || options.topic || 'Video', ffmpegPath, titleCardPath);
    tempFiles.sceneFiles.push(titleCardPath);
    logger.info('[RENDER_TRACE] Title card rendered');

    // ── 5. Fetch background images ─────────────────────────────────────────
    const bgImages = await Promise.all(
      validScenes.map((s, i) =>
        fetchBackgroundImage(s.visualPrompt || options.topic || s.text.slice(0, 40)).catch(() => null)
      )
    );

    // ── 6. Render each scene (background + zoom only - NO drawtext) ────────
    logger.info(`[RENDER_TRACE] Rendering ${validScenes.length} base scenes (no inline text)...`);
    for (let i = 0; i < validScenes.length; i++) {
      const scenePath = join(tempDir, `scene_${i}.mp4`);
      tempFiles.sceneFiles.push(scenePath);
      await renderBaseSceneWithRetry(validScenes[i], bgImages[i], ffmpegPath, scenePath, i);
    }

    // ── 7. Background music + ambient layer (immersive mix) ────────────────
    if (!options.musicPath && options.voiceoverPath && existsSync(options.voiceoverPath)) {
      const musicTempPath = join(tempDir, 'bgm_mixed.wav');
      const cinematicMood = options.mood || detectMoodFromTopic(options.topic || '');
      const mood = selectMood(cinematicMood === 'dark' || cinematicMood === 'suspense' ? 'suspense' : cinematicMood);
      const musicResult = await generateBackgroundAudio(options.voiceoverPath, musicTempPath, mood);
      if (musicResult) {
        options = { ...options, musicPath: musicTempPath };
      }
    }

    // ── 8. Compose final video ─────────────────────────────────────────────
    logger.info('[RENDER_TRACE] Composing final video: xfade + SRT subtitles + audio...');
    let composeSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await composeFinalVideo(ffmpegPath, tempFiles, options);
        composeSuccess = true;
        break;
      } catch (err: any) {
        logger.warn(`[RENDER_TRACE] Compose attempt ${attempt}/2 failed: ${err.message}`);
        if (attempt < 2) {
          // Try without SRT subtitles if subtitle burn caused issue
          logger.info('[RENDER_TRACE] Retrying compose without SRT overlay...');
        }
      }
    }
    if (!composeSuccess) {
      throw new Error('Final video composition failed after 2 attempts');
    }

    // ── 9. Validate output ────────────────────────────────────────────────
    const validation = await validateOutput(options.outputPath, options.voiceoverPath, validScenes.length);
    if (!validation.valid) {
      for (const issue of validation.issues) {
        logger.error(`[VALIDATION] ${issue}`);
      }
      throw new Error(`Output validation failed: ${validation.issues.join('; ')}`);
    }

    // ── 10. Final corruption check ─────────────────────────────────────────
    try {
      const finalDuration = await getDuration(options.outputPath);
      if (finalDuration < 3.0) {
        throw new Error(`Final video duration ${finalDuration}s is too short (< 3s) - likely corrupted`);
      }
    } catch (err: any) {
      if (err.message && err.message.includes('too short')) throw err;
      throw new Error(`Cannot read final video duration: ${err.message}`);
    }

    // ── 11. Cleanup ────────────────────────────────────────────────────────
    await cleanupTempFiles(tempDir, tempFiles);

    logger.info(`[RENDER_TRACE] success: ${options.outputPath} (${validation.videoDuration.toFixed(1)}s, ${validation.audioDuration.toFixed(1)}s audio, ${validation.sceneCount} scenes)`);
    return options.outputPath;
  } catch (error: any) {
    logger.error(`[RENDER_TRACE] failure: ${error.message}`, { tempDir });
    await cleanupTempFiles(tempDir, tempFiles).catch(() => {});
    throw error;
  }
}

// ─── DISK SPACE ──────────────────────────────────────────────────────────────

async function checkDiskSpace(): Promise<void> {
  const isOverLimit = await StorageManager.isTempOverLimit();
  if (isOverLimit) {
    logger.warn('[RENDER_TRACE] Temp directory over limit, cleaning before render');
    await StorageManager.cleanupTempRenders();
  }
}

// ─── COMMAND LENGTH SAFETY ───────────────────────────────────────────────────

function checkCommandLength(cmd: string, label: string): void {
  logger.info(`[RENDER_TRACE] command_length: ${label}=${cmd.length} chars`);
  if (cmd.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command too long: ${cmd.length} chars (max ${MAX_COMMAND_LENGTH}) for ${label}`);
  }
}

// ─── TITLE CARD (MAX 2 DRAWTEXT) ─────────────────────────────────────────────

async function renderTitleCard(
  title: string,
  ffmpegPath: string,
  outputPath: string,
): Promise<void> {
  const duration = 4;
  const safeTitle = title.substring(0, 60).replace(/:/g, '\uFF1A');
  const escapedTitle = escapeFilter(safeTitle);
  const fontPath = resolveFontPath();
  const fontfile = `:fontfile='${escapeFontPath(fontPath)}'`;

  // MAX 2 drawtext: title line + optional subtitle line
  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=0x0a0a23:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
    `-vf "`,
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.2:t=fill[bg];`,
    `[bg]drawtext=`,
    `text='${escapedTitle}':`,
    `x=(w-text_w)/2:y='(h-text_h)/2-20':`,
    `fontsize=52:fontcolor=white:`,
    `alpha='if(lt(t,0.8),t/0.8,1)':`,
    `shadowx=3:shadowy=3:shadowcolor=black@0.5${fontfile}[titledone]"`,
    `-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p "${outputPath}" -y`,
  ].join(' ');

  checkCommandLength(cmd, 'title_card');
  const filterCount = 3;
  logger.info(`[RENDER_TRACE] filter_complex_size: title_card=${filterCount} nodes`);
  await execAsync(cmd, { timeout: 60000 });
}

// ─── PER-SCENE BASE RENDER (NO DRAWTEXT) ─────────────────────────────────────

async function renderBaseSceneWithRetry(
  scene: ScenePlan,
  bgImagePath: string | null,
  ffmpegPath: string,
  outputPath: string,
  sceneIndex: number,
): Promise<void> {
  for (let attempt = 1; attempt <= SCENE_RETRIES; attempt++) {
    const mode = attempt === 1 ? 'full' : attempt === 2 ? 'simplified' : 'fallback';
    try {
      logger.info(`[RENDER_TRACE] scene_start: scene=${sceneIndex} attempt=${attempt}/${SCENE_RETRIES} mode=${mode}`);

      if (mode === 'fallback') {
        await renderFallbackScene(scene, ffmpegPath, outputPath, sceneIndex);
      } else if (mode === 'simplified') {
        await renderBaseScene(scene, bgImagePath, ffmpegPath, outputPath, true);
      } else {
        await renderBaseScene(scene, bgImagePath, ffmpegPath, outputPath, false);
      }

      const sceneDuration = await getDuration(outputPath);
      if (sceneDuration < 1.0) {
        throw new Error(`Scene duration ${sceneDuration}s too short (< 1s)`);
      }

      logger.info(`[RENDER_TRACE] success: scene=${sceneIndex} duration=${sceneDuration}s mode=${mode}`);
      return;
    } catch (err: any) {
      logger.warn(`[RENDER_TRACE] failure: scene=${sceneIndex} attempt=${attempt} error="${err.message}" fallback_triggered=${mode !== 'full'}`);
    }
  }
  throw new Error(`Scene ${sceneIndex} failed after ${SCENE_RETRIES} attempts`);
}

// ─── BASE SCENE: BACKGROUND + ZOOM ONLY (0 DRAWTEXT) ─────────────────────────

// Updated renderBaseScene to use camera motion filter and handle static scenes longer than 7s
async function renderBaseScene(
  scene: ScenePlan,
  bgImagePath: string | null,
  ffmpegPath: string,
  outputPath: string,
  simplified: boolean,
): Promise<void> {
  const duration = simplified
    ? Math.max(4, Math.min(scene.duration, 10))
    : Math.max(MIN_SCENE_DURATION, Math.min(scene.duration, MAX_SCENE_DURATION));

  type LocalCameraMotion = 'none' | 'slow-zoom' | 'shake';
  let motion: LocalCameraMotion = (scene.zoomDirection as LocalCameraMotion) || 'none';
  if (!simplified && duration > 7 && (motion === 'none')) {      motion = (Math.random() < 0.5 ? 'slow-zoom' : 'shake') as LocalCameraMotion;
  }

  let cmd: string;

  if (bgImagePath) {
    const escapedBg = bgImagePath.replace(/\\/g, '/').replace(/'/g, "'\\''");

    if (simplified) {
      // Simplified: just scale + overlay, no zoom
      cmd = [
        `"${ffmpegPath}"`,
        `-i "${escapedBg}"`,
        `-f lavfi -i "color=c=0x${scene.bgColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
        `-filter_complex "`,
        `[0:v]scale=1920:1080:force_original_aspect_ratio=1,crop=1920:1080,setsar=1,format=rgba,`,
        `colorchannelmixer=aa=0.6[bg];`,
        `[1][bg]overlay=0:0,format=yuv420p"`,
        `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`,
      ].join(' ');
    } else {
      const grade = buildColorGradeFilter(scene.mood || 'story');
      const overlay = buildCinematicOverlayFilter(scene.mood || 'story');
      const fade = buildSceneFadeFilter(duration);
      const zoomFilter = buildCameraMotionFilter(motion as CameraMotion, duration);
      const filterChain = `${zoomFilter},${grade},${overlay},${fade}`;
      cmd = [
        `"${ffmpegPath}"`,
        `-i "${escapedBg}"`,
        `-f lavfi -i "color=c=0x${scene.bgColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
        `-filter_complex "[0:v]scale=1920:1080:force_original_aspect_ratio=1,crop=1920:1080,setsar=1,format=rgba[bg];[1][bg]overlay=0:0[bgo];[bgo]${filterChain}[vout]"`,
        `-map "[vout]" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p "${outputPath}" -y`,
      ].join(' ');
    }
  } else {
    if (simplified) {
      cmd = [
        `"${ffmpegPath}"`,
        `-f lavfi -i "color=c=0x${scene.bgColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
        `-vf "colorchannelmixer=aa=0.9,format=yuv420p"`,
        `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`,
      ].join(' ');
    } else {
      const grade = buildColorGradeFilter(scene.mood || 'story');
      const fade = buildSceneFadeFilter(duration);
      const zoomFilter = buildCameraMotionFilter(motion as CameraMotion, duration);
      const filterChain = `${zoomFilter},${grade},${fade}`;
      cmd = [
        `"${ffmpegPath}"`,
        `-f lavfi -i "color=c=0x${scene.accentColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
        `-filter_complex "color=c=0x${scene.bgColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba[bg];[bg][0]overlay=0:0[combined];[combined]${filterChain}[vout]"`,
        `-map "[vout]" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p "${outputPath}" -y`,
      ].join(' ');
    }
  }

  const filterNodes = countFilterNodes(cmd);
  logger.info(`[RENDER_TRACE] filter_complex_size: scene=${scene.index} nodes=${filterNodes} duration=${duration}s${simplified ? ' SIMPLIFIED' : ''} bg=${!!bgImagePath}`);

  checkCommandLength(cmd, `scene_${scene.index}`);

  if (filterNodes > MAX_FILTER_NODES) {
    logger.warn(`[RENDER_TRACE] fallback_triggered: scene=${scene.index} filter_nodes=${filterNodes} > max=${MAX_FILTER_NODES}`);
    throw new Error(`Filter chain too complex: ${filterNodes} nodes (max ${MAX_FILTER_NODES})`);
  }

  const timeoutMs = Math.max(30000, duration * 2000);
  await execAsync(cmd, { timeout: timeoutMs });
}

// ─── FALLBACK SCENE: SOLID COLOR + SINGLE DRAWTEXT ───────────────────────────

async function renderFallbackScene(
  scene: ScenePlan,
  ffmpegPath: string,
  outputPath: string,
  sceneIndex: number,
): Promise<void> {
  const duration = Math.max(4, Math.min(scene.duration, 8));
  const shortText = scene.text.substring(0, 100).replace(/:/g, '\uFF1A');
  const escapedText = escapeFilter(shortText);
  const fontPath = resolveFontPath();
  const fontfile = `:fontfile='${escapeFontPath(fontPath)}'`;

  // EXACTLY 1 drawtext - single line centered
  const cmd = [
    `"${ffmpegPath}"`,
    `-f lavfi -i "color=c=0x1a1a3e:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba"`,
    `-vf "drawtext=text='${escapedText}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=20${fontfile}"`,
    `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`,
  ].join(' ');

  checkCommandLength(cmd, `fallback_scene_${sceneIndex}`);
  logger.info(`[RENDER_TRACE] filter_complex_size: fallback_scene=${sceneIndex} nodes=1`);
  await execAsync(cmd, { timeout: 30000 });
}

// ─── FFPROBE DURATION ────────────────────────────────────────────────────────

function getDuration(path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
    exec(
      `"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`,
      { timeout: 10000 },
      (err, stdout) => {
        if (err) { reject(new Error(`ffprobe failed: ${err.message}`)); return; }
        if (!stdout || !stdout.trim()) { reject(new Error('ffprobe returned empty duration')); return; }
        const parsed = parseFloat(stdout.trim());
        if (isNaN(parsed) || parsed <= 0) { reject(new Error(`ffprobe returned invalid duration: "${stdout.trim()}"`)); return; }
        resolve(parsed);
      },
    );
  });
}

// ─── FINAL COMPOSITION: XFADE + SUBTITLE BURN + AUDIO MIX ────────────────────

function videoCodec(encoder?: string): string {
  if (encoder && ['h264_nvenc', 'h264_qsv', 'h264_amf'].includes(encoder)) {
    return `-c:v ${encoder} -preset p5 -cq 22 -b:v 8M`;
  }
  return '-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p';
}

async function composeFinalVideo(
  ffmpegPath: string,
  tempFiles: TempFiles,
  options: RenderOptions,
): Promise<void> {
  const { sceneFiles } = tempFiles;
  const outputPath = options.outputPath;

  let durations: number[];
  try {
    durations = await Promise.all(sceneFiles.map(f => getDuration(f).catch(() => 5)));
  } catch {
    durations = sceneFiles.map(() => 5);
  }
  durations = durations.map(d => Math.max(1, d));

  const totalVideoDuration = durations.reduce((a, b) => a + b, 0) -
    Math.max(0, (sceneFiles.length - 1) * TRANSITION_DURATION);

  let audioDuration = 0;
  if (options.voiceoverPath && existsSync(options.voiceoverPath)) {
    try {
      audioDuration = await getDuration(options.voiceoverPath);
    } catch {
      audioDuration = 0;
    }
  }

  const sceneInputs = sceneFiles.map(f => `-i "${f}"`).join(' ');

  let cmd = `"${ffmpegPath}" ${sceneInputs}`;

  let voiceoverIndex = -1;
  let musicIndex = -1;

  if (options.voiceoverPath && existsSync(options.voiceoverPath)) {
    cmd += ` -i "${options.voiceoverPath}"`;
    voiceoverIndex = sceneFiles.length;
  }

  if (options.musicPath && existsSync(options.musicPath)) {
    cmd += ` -i "${options.musicPath}"`;
    musicIndex = voiceoverIndex >= 0 ? sceneFiles.length + 1 : sceneFiles.length;
  }

  // ─── Build filter_complex ─────────────────────────────────────────────────
  let filterComplex = '';

  const composeMood = detectMoodFromTopic(options.topic || '');
  const xfadeType = xfadeTransitionForMood(composeMood);

  if (sceneFiles.length >= 2) {
    const filterParts: string[] = [];

    for (let i = 1; i < sceneFiles.length; i++) {
      const offset = Math.max(0,
        durations.slice(0, i).reduce((a, b) => a + b, 0) - (i * TRANSITION_DURATION),
      );
      const prevLabel = i === 1 ? `[0:v:0][1:v:0]` : `[v${i - 1}][${i}:v:0]`;
      const outLabel = i < sceneFiles.length - 1 ? `[v${i}]` : `[vpre]`;
      filterParts.push(`${prevLabel}xfade=transition=${xfadeType}:duration=${TRANSITION_DURATION}:offset=${offset}${outLabel}`);
    }

    let videoOut = '[vpre]';

    // Pad if audio is longer than video
    const extraDuration = audioDuration > totalVideoDuration ? audioDuration - totalVideoDuration : 0;
    if (extraDuration > 0.5) {
      filterParts.push(`${videoOut}format=yuv420p,tpad=stop_mode=clone:stop_duration=${extraDuration.toFixed(1)}[vpadded]`);
      videoOut = '[vpadded]';
      logger.info(`[RENDER_TRACE] Extending last frame by ${extraDuration.toFixed(1)}s to match audio duration`);
    }

    // ── SRT SUBTITLE BURN (PRIMARY TEXT RENDERING) ──────────────────────────
    if (tempFiles.srtFile && existsSync(tempFiles.srtFile)) {
      const srtPath = generateSrtFilterPath(tempFiles.srtFile);
      const style = getSubtitleStyle(composeMood);
      filterParts.push(
        `${videoOut}subtitles='${srtPath}':force_style='${style}'[vsub]`,
      );
      videoOut = '[vsub]';
      logger.info(`[RENDER_TRACE] SRT subtitles burned into video: ${tempFiles.srtFile}`);
    }

    filterParts.push(`${videoOut}format=yuv420p[vfinal]`);

    filterComplex = filterParts.join(';');
    cmd += ` -filter_complex "${filterComplex}" -map "[vfinal]"`;
  } else {
    // Single scene
    if (tempFiles.srtFile && existsSync(tempFiles.srtFile)) {
      const srtPath = generateSrtFilterPath(tempFiles.srtFile);
      const style = getSubtitleStyle(composeMood);
      cmd += ` -vf "subtitles='${srtPath}':force_style='${style}',format=yuv420p"`;
    }
    cmd += ` -map 0:v:0`;
  }

  // ─── Audio mapping ────────────────────────────────────────────────────────
  const codec = videoCodec(options.encoder);
  if (voiceoverIndex >= 0 && musicIndex >= 0) {
    const mixLabel = `[${voiceoverIndex}:a:0]volume=1.0[voice];[${musicIndex}:a:0]volume=0.22[bgm];[voice][bgm]amix=inputs=2:duration=first:weights=1 0.22[aout]`;
    cmd += ` -filter_complex "${mixLabel}" -map "[aout]" -c:a aac ${codec} -pix_fmt yuv420p -shortest`;
  } else if (voiceoverIndex >= 0) {
    cmd += ` -map ${voiceoverIndex}:a:0 -c:a aac ${codec} -pix_fmt yuv420p -shortest`;
  } else {
    cmd += ` ${codec} -pix_fmt yuv420p`;
  }

  cmd += ` "${outputPath}" -y`;

  logger.info(`[RENDER_TRACE] command_length: compose=${cmd.length} chars`);
  logger.info(`[RENDER_TRACE] filter_complex_size: compose=${sceneFiles.length} scenes, ${voiceoverIndex >= 0 ? 'voiceover' : 'no_audio'}${musicIndex >= 0 ? '+music' : ''} ${tempFiles.srtFile ? '+subtitles' : ''}`);

  checkCommandLength(cmd, 'compose');

  const timeoutMs = Math.max(300000, sceneFiles.length * 45000);
  await execAsync(cmd, { timeout: timeoutMs });
}

// ─── OUTPUT VALIDATION ───────────────────────────────────────────────────────

async function validateOutput(
  videoPath: string,
  audioPath: string | undefined,
  sceneCount: number,
): Promise<ValidationResult> {
  const issues: string[] = [];

  if (!existsSync(videoPath)) {
    issues.push('Output video file does not exist');
    return { valid: false, issues, audioDuration: 0, videoDuration: 0, sceneCount };
  }

  const stat = await import('fs/promises').then(m => m.stat(videoPath));
  if (stat.size < MIN_OUTPUT_SIZE) {
    issues.push(`Output video too small: ${stat.size} bytes (min ${MIN_OUTPUT_SIZE})`);
  }

  let videoDuration = 0;
  try {
    videoDuration = await getDuration(videoPath);
  } catch {
    issues.push('Failed to read video duration');
  }

  if (videoDuration < MIN_OUTPUT_DURATION_SEC) {
    issues.push(`Video too short: ${videoDuration.toFixed(1)}s (minimum ${MIN_OUTPUT_DURATION_SEC}s)`);
  }

  const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
  try {
    const { stdout } = await execAsync(
      `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 10000 },
    );
    if (!stdout.trim()) {
      issues.push('No video stream found in output');
    }
  } catch {
    issues.push('Failed to probe video streams');
  }

  let audioDuration = 0;
  if (audioPath && existsSync(audioPath)) {
    // Voice is mandatory when provided — output must contain audio stream
    try {
      audioDuration = await getDuration(audioPath);
    } catch {
      audioDuration = 0;
    }

    try {
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { timeout: 10000 },
      );
      if (!stdout.trim()) {
        issues.push('No audio stream found in output video — silent render rejected');
      }
    } catch {
      issues.push('Failed to probe audio stream');
    }
  } else if (audioPath) {
    issues.push('Voiceover path provided but file missing — cannot publish silent video');
  }

  try {
    const { stdout: resOut } = await execAsync(
      `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x:p=0 "${videoPath}"`,
      { timeout: 10000 },
    );
    const [w, h] = resOut.trim().split('x').map(Number);
    if (h && h < 720) issues.push(`Resolution ${w}x${h} below 720p minimum`);
  } catch {
    issues.push('Failed to read video resolution');
  }

  return {
    valid: issues.length === 0,
    issues,
    audioDuration,
    videoDuration,
    sceneCount,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function countFilterNodes(cmd: string): number {
  const fcMatch = cmd.match(/-filter_complex\s+"([^"]+)"/);
  if (!fcMatch) {
    const vfMatch = cmd.match(/-vf\s+"([^"]+)"/);
    if (!vfMatch) return 1;
    return vfMatch[1].split(',').length + 1;
  }
  return fcMatch[1].split(';').length + 1;
}

async function cleanupTempFiles(tempDir: string, tempFiles: TempFiles): Promise<void> {
  for (const sceneFile of tempFiles.sceneFiles) {
    try { await unlink(sceneFile); } catch { /* ignore */ }
  }
  if (tempFiles.srtFile) {
    try { await unlink(tempFiles.srtFile); } catch { /* ignore */ }
  }
  try { await rm(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
}
