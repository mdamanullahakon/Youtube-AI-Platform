import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, rm, mkdir, copyFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { StorageManager } from './storage.service';
import { planScenes, type ScenePlan } from './scene.service';
import { generateSubtitles, writeSrtFile } from './subtitle.service';
import { escapeFilter } from './motion.service';
import { fetchBackgroundImage } from './image.service';
import { generateBackgroundAudio, selectMood } from './music.service';
import type { ParsedScene } from '../utils/helpers';

const execAsync = promisify(exec);
const FPS = 30;
const RESOLUTION = '1920x1080';
const TRANSITION_DURATION = 0.4;
const MIN_SCENE_DURATION = 8;
const MAX_SCENE_DURATION = 20;
const RENDER_RETRIES = 3;

interface RenderOptions {
  scenes: ParsedScene[];
  topic?: string;
  title?: string;
  voiceoverPath?: string;
  musicPath?: string;
  outputPath: string;
  mood?: string;
}

interface TempFiles {
  sceneFiles: string[];
  concatFile: string;
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

export async function renderVideo(options: RenderOptions): Promise<string> {
  const tempDir = join(process.cwd(), 'temp', `render_${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });

  const tempFiles: TempFiles = { sceneFiles: [], concatFile: join(tempDir, 'concat.txt') };
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  try {
    await checkDiskSpace();

    logger.info(`Planning ${options.scenes.length} scenes...`);
    const scenePlans = await planScenes(options.scenes, options.topic);
    logger.info(`Scene planning complete`);

    logger.info('Generating subtitles...');
    tempFiles.srtFile = await writeSrtFile(scenePlans, tempDir);
    const { entries: subtitleEntries } = generateSubtitles(scenePlans);
    logger.info(`Subtitles generated: ${subtitleEntries.length} entries`);

    logger.info('Rendering title card...');
    const titleCardPath = join(tempDir, 'title_card.mp4');
    tempFiles.titleCard = titleCardPath;
    await renderTitleCard(options.title || options.topic || 'Video', options.topic, ffmpegPath, titleCardPath);
    tempFiles.sceneFiles.push(titleCardPath);

    logger.info('Fetching background images...');
    const bgImages: (string | null)[] = await Promise.all(
      scenePlans.map((s, i) => fetchBackgroundImage(s.visualPrompt || options.topic || `${s.text.slice(0, 40)}`).catch(() => null))
    );

    logger.info(`Rendering ${scenePlans.length} scenes with backgrounds...`);
    for (let i = 0; i < scenePlans.length; i++) {
      const scenePath = join(tempDir, `scene_${i}.mp4`);
      tempFiles.sceneFiles.push(scenePath);
      await renderCinematicSceneWithRetry(scenePlans[i], bgImages[i], ffmpegPath, scenePath, i);
      logger.info(`  Scene ${i + 1}/${scenePlans.length} rendered`);
    }

    if (!options.musicPath && options.voiceoverPath && existsSync(options.voiceoverPath)) {
      logger.info('Generating background music with auto-ducking...');
      const musicTempPath = join(tempDir, 'bgm_mixed.wav');
      const mood = selectMood(options.mood || 'curiosity');
      const musicResult = await generateBackgroundAudio(options.voiceoverPath, musicTempPath, mood);
      if (musicResult) {
        options = { ...options, musicPath: musicTempPath };
        logger.info('Background music generated and ducked');
      } else {
        logger.info('Background music not available, proceeding without');
      }
    }

    logger.info('Composing final video with transitions + audio...');
    await composeFinalVideo(ffmpegPath, tempFiles, options);
    logger.info('Final composition complete');

    // VALIDATE OUTPUT
    const validation = await validateOutput(options.outputPath, options.voiceoverPath, scenePlans.length);
    if (!validation.valid) {
      for (const issue of validation.issues) {
        logger.error(`[VALIDATION] ${issue}`);
      }
      throw new Error(`Output validation failed: ${validation.issues.join('; ')}`);
    }

    await cleanupTempFiles(tempDir, tempFiles);

    logger.info(`Render complete: ${options.outputPath} (${validation.videoDuration.toFixed(1)}s video, ${validation.audioDuration.toFixed(1)}s audio, ${validation.sceneCount} scenes)`);
    return options.outputPath;
  } catch (error: any) {
    logger.error('Video rendering failed', { error: error.message, tempDir });
    // Keep temp files for debugging
    throw error;
  }
}

async function checkDiskSpace(): Promise<void> {
  const isOverLimit = await StorageManager.isTempOverLimit();
  if (isOverLimit) {
    logger.warn('Temp directory over limit, cleaning before render');
    await StorageManager.cleanupTempRenders();
  }
}

async function renderTitleCard(
  title: string,
  topic: string | undefined,
  ffmpegPath: string,
  outputPath: string,
): Promise<void> {
  const duration = 4;
  const escapedTitle = escapeFilter(title.substring(0, 60).replace(/:/g, '\uFF1A'));

  let cmd = `"${ffmpegPath}" -f lavfi -i "color=c=0x0a0a23:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba" ` +
    `-vf "` +
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@0.2:t=fill[bg];` +
    `[bg]drawbox=` +
    `x='(w-400)/2':y='h/2+40':` +
    `w='if(lt(t,0.8),400*t/0.8,400)':h=3:color=white@0.6[tline];` +
    `[tline]drawtext=` +
    `text='${escapedTitle}':` +
    `x=(w-text_w)/2:y='(h/2-text_h)/2':` +
    `fontsize=56:fontcolor=white:` +
    `alpha='if(lt(t,1),t/1,1)':` +
    `shadowx=3:shadowy=3:shadowcolor=black@0.5" ` +
    `-c:v libx264 -preset ultrafast -crf 28 -pix_fmt yuv420p "${outputPath}" -y`;

  await execAsync(cmd, { timeout: 60000 });
}

async function renderCinematicSceneWithRetry(
  scene: ScenePlan,
  bgImagePath: string | null,
  ffmpegPath: string,
  outputPath: string,
  sceneIndex: number,
): Promise<void> {
  for (let attempt = 1; attempt <= RENDER_RETRIES; attempt++) {
    try {
      await renderCinematicScene(scene, bgImagePath, ffmpegPath, outputPath);

      // Verify the scene has content
      const sceneDuration = await getDuration(outputPath);
      if (sceneDuration < 1.0) {
        throw new Error(`Scene rendered but duration is ${sceneDuration}s (too short)`);
      }
      return;
    } catch (err: any) {
      logger.warn(`Scene ${sceneIndex} render attempt ${attempt}/${RENDER_RETRIES} failed: ${err.message}`);
      if (attempt === RENDER_RETRIES) {
        // Final fallback: render a simple colored scene with text
        await renderFallbackScene(scene, ffmpegPath, outputPath);
      }
    }
  }
}

async function renderFallbackScene(scene: ScenePlan, ffmpegPath: string, outputPath: string): Promise<void> {
  const escapedText = escapeFilter(scene.text.substring(0, 80));
  const cmd = `"${ffmpegPath}" -f lavfi -i "color=c=0x1a1a3e:s=${RESOLUTION}:d=${scene.duration}:r=${FPS},format=rgba" ` +
    `-vf "drawtext=text='${escapedText}':x=(w-text_w)/2:y=(h-text_h)/2:fontsize=48:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=20" ` +
    `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`;
  await execAsync(cmd, { timeout: 30000 });
}

async function renderCinematicScene(
  scene: ScenePlan,
  bgImagePath: string | null,
  ffmpegPath: string,
  outputPath: string,
): Promise<void> {
  const duration = Math.max(MIN_SCENE_DURATION, Math.min(scene.duration, MAX_SCENE_DURATION));
  const fadeIn = Math.min(0.5, duration / 4);

  const lines = splitIntoLines(scene.text, 40);
  const lineHeight = 58;
  const totalTextHeight = lines.length * lineHeight;
  const startY = Math.max(40, (1080 - totalTextHeight) / 2);

  const zoomFilter = buildZoomFilter(scene.zoomDirection, duration);

  const textDrawFilters = lines.map((line, i) => {
    const escaped = escapeFilter(line);
    const yPos = startY + i * lineHeight;
    const isFirst = i === 0;
    const fSize = isFirst ? 50 : 42;
    return `drawtext=` +
      `text='${escaped}':` +
      `x=(w-text_w)/2:` +
      `y=${yPos}:` +
      `fontsize=${fSize}:` +
      `fontcolor=white:` +
      `box=1:boxcolor=black@0.35:boxborderw=14:` +
      `line_spacing=8:` +
      `alpha='if(lt(t,${fadeIn}),t/${fadeIn},1)':` +
      `shadowx=3:shadowy=3:shadowcolor=black@0.5`;
  }).join(',');

  const subtitleEscaped = escapeFilter(scene.subtitle);
  const subtitleFilter = subtitleEscaped.length > 0
    ? `,drawtext=text='${subtitleEscaped}':x=(w-text_w)/2:y=H-55:fontsize=20:fontcolor=white@0.7:box=1:boxcolor=black@0.3:boxborderw=8:alpha='if(lt(t,0.5),t/0.5,1)'`
    : '';

  let cmd: string;

  if (bgImagePath) {
    const escapedBg = bgImagePath.replace(/\\/g, '/').replace(/'/g, "'\\''");
    cmd = `"${ffmpegPath}" -i "${escapedBg}" -f lavfi -i ` +
      `"color=c=0x000000:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba" ` +
      `-filter_complex "` +
      `[0:v]scale=1920:1080:force_original_aspect_ratio=1,` +
      `crop=1920:1080,setsar=1,format=rgba[bg];` +
      `color=black@0.5:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba[black];` +
      `[black]colorchannelmixer=aa=0.45[dark];` +
      `[bg][dark]overlay=0:0[darkened];` +
      `color=c=0x${scene.accentColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},` +
      `format=rgba,colorchannelmixer=aa=0.15[grad];` +
      `[darkened][grad]overlay=0:0[withgrad];` +
      `color=black@s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba,colorchannelmixer=aa=0.3[bb];` +
      `[withgrad][bb]overlay=0:H-10[v];` +
      `[v]${zoomFilter}[vz];` +
      `[vz]${textDrawFilters}${subtitleFilter}" ` +
      `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`;
  } else {
    cmd = `"${ffmpegPath}" -f lavfi -i ` +
      `"color=c=0x${scene.bgColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba" ` +
      `-filter_complex "` +
      `color=c=0x${scene.accentColor}:s=${RESOLUTION}:d=${duration}:r=${FPS},` +
      `format=rgba,colorchannelmixer=aa=0.2[grad];` +
      `[0][grad]overlay=0:0[bg];` +
      `color=black@0.15:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba,colorchannelmixer=aa=0.15[grain];` +
      `[bg][grain]overlay=0:0[g];` +
      `color=black:s=${RESOLUTION}:d=${duration}:r=${FPS},format=rgba,colorchannelmixer=aa=0.3[bb];` +
      `[g][bb]overlay=0:H-10[v];` +
      `[v]${zoomFilter}[vz];` +
      `[vz]${textDrawFilters}${subtitleFilter}" ` +
      `-c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p "${outputPath}" -y`;
  }

  const timeoutMs = Math.max(30000, duration * 2000);
  await execAsync(cmd, { timeout: timeoutMs });
}

function buildZoomFilter(direction: 'in' | 'out' | 'none', duration: number): string {
  const fps = FPS;
  const totalFrames = Math.round(duration * fps);
  const zoomEnd = 1.08;

  if (direction === 'none') {
    // Use a no-op filter chain that preserves input
    return `scale=iw:ih,setsar=1`;
  }

  if (direction === 'in') {
    return `zoompan=z='if(lte(on,1),1,min(${zoomEnd},1+(${zoomEnd}-1)*(on/${totalFrames})))':` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${RESOLUTION}:fps=${fps}`;
  }

  return `zoompan=z='if(lte(on,1),${zoomEnd},max(1,${zoomEnd}-(${zoomEnd}-1)*(on/${totalFrames})))':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${RESOLUTION}:fps=${fps}`;
}

function getDuration(path: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
    exec(`"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${path}"`, { timeout: 10000 }, (err, stdout) => {
      if (err || !stdout) { resolve(5); return; }
      const parsed = parseFloat(stdout.trim());
      resolve(!isNaN(parsed) && parsed > 0 ? parsed : 5);
    });
  });
}

async function composeFinalVideo(
  ffmpegPath: string,
  tempFiles: TempFiles,
  options: RenderOptions,
): Promise<void> {
  const { sceneFiles } = tempFiles;
  const outputPath = options.outputPath;

  let durations = await Promise.all(sceneFiles.map(f => getDuration(f)));
  durations = durations.map(d => Math.max(1, d));

  const totalVideoDuration = durations.reduce((a, b) => a + b, 0) - Math.max(0, (sceneFiles.length - 1) * TRANSITION_DURATION);

  let audioDuration = 0;
  if (options.voiceoverPath && existsSync(options.voiceoverPath)) {
    audioDuration = await getDuration(options.voiceoverPath);
  }

  const sceneInputs = sceneFiles.map(f => `-i "${f}"`).join(' ');

  let cmd = `"${ffmpegPath}" ${sceneInputs}`;

  const audioInputs: string[] = [];
  let voiceoverIndex = -1;
  let musicIndex = -1;

  if (options.voiceoverPath && existsSync(options.voiceoverPath)) {
    cmd += ` -i "${options.voiceoverPath}"`;
    voiceoverIndex = sceneFiles.length + audioInputs.length;
    audioInputs.push(options.voiceoverPath);
  }

  if (options.musicPath && existsSync(options.musicPath)) {
    cmd += ` -i "${options.musicPath}"`;
    musicIndex = sceneFiles.length + audioInputs.length;
    audioInputs.push(options.musicPath);
  }

  let filterComplex = '';

  if (sceneFiles.length >= 2) {
    for (let i = 1; i < sceneFiles.length; i++) {
      const offset = Math.max(0, durations.slice(0, i).reduce((a, b) => a + b, 0) - (i * TRANSITION_DURATION));

      if (i === 1) {
        filterComplex += `[0:v:0][1:v:0]xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset}`;
      } else {
        filterComplex += `[v${i-1}][${i}:v:0]xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset}`;
      }

      if (i < sceneFiles.length - 1) {
        filterComplex += `[v${i}]`;
      } else {
        filterComplex += `[vout]`;
      }
      filterComplex += ';';
    }

    const extraDuration = audioDuration > totalVideoDuration ? audioDuration - totalVideoDuration : 0;
    if (extraDuration > 0.5) {
      filterComplex += `[vout]format=yuv420p,tpad=stop_mode=clone:stop_duration=${extraDuration.toFixed(1)}[vfinal]`;
      logger.info(`Extending last frame by ${extraDuration.toFixed(1)}s to match audio duration (audio: ${audioDuration.toFixed(1)}s, video: ${totalVideoDuration.toFixed(1)}s)`);
    } else {
      filterComplex += `[vout]format=yuv420p[vfinal]`;
    }

    cmd += ` -filter_complex "${filterComplex}" -map "[vfinal]"`;
  } else {
    cmd += ` -map 0:v:0`;
  }

  if (voiceoverIndex >= 0 && musicIndex >= 0) {
    cmd += ` -map ${voiceoverIndex}:a:0 -map ${musicIndex}:a:0`;
    cmd += ` -filter_complex "[${voiceoverIndex}:a:0]volume=1.0[voice];[${musicIndex}:a:0]volume=0.3[bgm];[voice][bgm]amix=inputs=2:duration=first:weights=1 0.3[aout]" -map "[aout]"`;
    cmd += ` -c:a aac -c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p -shortest`;
  } else if (voiceoverIndex >= 0) {
    cmd += ` -map ${voiceoverIndex}:a:0 -c:a aac -c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p -shortest`;
  } else {
    cmd += ` -c:v libx264 -preset ultrafast -crf 26 -pix_fmt yuv420p`;
  }

  cmd += ` "${outputPath}" -y`;

  const timeoutMs = Math.max(300000, sceneFiles.length * 45000);
  await execAsync(cmd, { timeout: timeoutMs });
}

async function validateOutput(
  videoPath: string,
  audioPath: string | undefined,
  sceneCount: number,
): Promise<ValidationResult> {
  const issues: string[] = [];

  // Check file exists
  if (!existsSync(videoPath)) {
    issues.push('Output video file does not exist');
    return { valid: false, issues, audioDuration: 0, videoDuration: 0, sceneCount };
  }

  const stat = await import('fs/promises').then(m => m.stat(videoPath));
  if (stat.size < 1024) {
    issues.push(`Output video too small: ${stat.size} bytes`);
  }

  // Get video duration
  const videoDuration = await getDuration(videoPath);

  // Check video has streams
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

  // Check scene count
  if (sceneCount < 6) {
    issues.push(`Too few scenes: ${sceneCount} (minimum 6 required)`);
  }

  // Check video duration
  if (videoDuration < 10) {
    issues.push(`Video too short: ${videoDuration.toFixed(1)}s (minimum 10s)`);
  }

  // Check audio
  let audioDuration = 0;
  if (audioPath && existsSync(audioPath)) {
    const audioStat = await import('fs/promises').then(m => m.stat(audioPath));
    if (audioStat.size < 100) {
      issues.push('Audio file too small (likely empty)');
    }
    audioDuration = await getDuration(audioPath);
    if (audioDuration < 3) {
      issues.push(`Audio too short: ${audioDuration.toFixed(1)}s`);
    }

    // Check audio stream in video
    try {
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { timeout: 10000 },
      );
      if (!stdout.trim()) {
        issues.push('No audio stream found in output video');
      }
    } catch {
      issues.push('Failed to probe audio stream');
    }

    // Warn if video/audio duration mismatch
    if (Math.abs(videoDuration - audioDuration) > 5) {
      logger.warn(`Duration mismatch: video=${videoDuration.toFixed(1)}s vs audio=${audioDuration.toFixed(1)}s (will use -shortest)`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    audioDuration,
    videoDuration,
    sceneCount,
  };
}

async function cleanupTempFiles(tempDir: string, tempFiles: TempFiles): Promise<void> {
  const errors: string[] = [];

  for (const sceneFile of tempFiles.sceneFiles) {
    try {
      await unlink(sceneFile);
    } catch (err: any) {
      errors.push(`scene: ${err.message}`);
    }
  }

  try { await unlink(tempFiles.concatFile); } catch { }
  if (tempFiles.srtFile) { try { await unlink(tempFiles.srtFile); } catch { } }

  try { await rm(tempDir, { recursive: true, force: true }); } catch { }

  if (errors.length > 0) {
    logger.warn(`Temp cleanup completed with ${errors.length} issues`);
  }
}

function splitIntoLines(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = (currentLine ? currentLine + ' ' : '') + word;
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.length > 0 ? lines : [text.substring(0, maxCharsPerLine)];
}
