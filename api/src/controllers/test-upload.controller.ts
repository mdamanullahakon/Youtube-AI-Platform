import { Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, statSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { uploadToYouTube } from '../services/youtube.service';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const OUTPUT_DIR = path.join(process.cwd(), 'temp', 'test-uploads');

export async function testUploadHandler(req: Request, res: Response) {
  const userId = (req as any).userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const stepLog = (step: string, msg: string) => {
    logger.info(`[TEST_PIPELINE] ${step}: ${msg}`);
    console.log(`[TEST_PIPELINE] ${step}: ${msg}`);
  };

  const stepWarn = (step: string, msg: string) => {
    logger.warn(`[TEST_PIPELINE] ${step}: ${msg}`);
    console.warn(`[TEST_PIPELINE] ${step}: ${msg}`);
  };

  const stepError = (step: string, msg: string) => {
    logger.error(`[TEST_PIPELINE] ${step}: ${msg}`);
    console.error(`[TEST_PIPELINE] ${step}: ${msg}`);
  };

  try {
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const videoId = randomUUID().slice(0, 8);
    const outputPath = path.join(OUTPUT_DIR, `test_video_${videoId}.mp4`);

    // ─── STEP 1: Render minimal test video ──────────────────────────────────
    stepLog('Render', `Starting minimal render -> ${outputPath}`);

    const title = 'YouTube AI Platform - Test Upload';
    const description = 'This is a test video uploaded automatically by the YouTube AI Platform system.';
    const duration = 10;
    const safeTitle = 'YouTube AI Platform - Test Upload';
    const fontFile = process.env.FONT_PATH?.replace(/\\/g, '/').replace(/:/g, '\\:') || 'C\\:/Windows/Fonts/arial.ttf';

    const renderCmd = [
      `"${FFMPEG}"`,
      `-f lavfi -i "color=c=0x1a1a3e:s=1920x1080:d=${duration}:r=30,format=rgba"`,
      `-vf "`,
      `drawtext=text='${safeTitle}':x=(w-text_w)/2:y='(h-text_h)/2-40':fontsize=48:fontcolor=white:`,
      `shadowx=2:shadowy=2:shadowcolor=black@0.5:fontfile='${fontFile}',`,
      `drawtext=text='Test Video':x=(w-text_w)/2:y='(h-text_h)/2+20':fontsize=36:fontcolor=white:`,
      `shadowx=2:shadowy=2:shadowcolor=black@0.5:fontfile='${fontFile}',`,
      `drawtext=text='%{eif\\\\:n+1\\\\:d}' :x=w-tw-20:y=h-th-20:fontsize=24:fontcolor=white@0.3:fontfile='${fontFile}'"`,
      `-c:v libx264 -preset ultrafast -crf 24 -pix_fmt yuv420p "${outputPath}" -y`,
    ].join(' ');

    stepLog('Render', 'Executing ffmpeg...');
    await execAsync(renderCmd, { timeout: 60000 });
    stepLog('Render', 'Render success');

    // ─── STEP 2: Validate output ───────────────────────────────────────────
    stepLog('Validation', 'Checking output file...');

    if (!existsSync(outputPath)) {
      stepError('Validation', 'File not found after render');
      return res.status(500).json({ success: false, message: 'Render produced no output file' });
    }

    const fileSize = statSync(outputPath).size;
    stepLog('Validation', `File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

    if (fileSize < 1024 * 1024) {
      stepWarn('Validation', `File size ${(fileSize / 1024).toFixed(0)} KB is under 1MB — quality may be poor`);
    }

    let probeStdout = '';
    try {
      const { stdout } = await execAsync(
        `"${FFPROBE}" -v error -show_entries format=duration:stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        { timeout: 10000 },
      );
      probeStdout = stdout;
    } catch (probeErr: any) {
      stepError('Validation', `ffprobe failed: ${probeErr.message}`);
      return res.status(500).json({ success: false, message: `Output file validation failed: ${probeErr.message}` });
    }

    const lines = probeStdout.trim().split('\n').filter(Boolean);
    const hasVideo = lines.includes('video');
    const hasAudio = lines.includes('audio');
    const durationLine = lines.find(l => l.includes('.'));
    const outputDuration = durationLine ? parseFloat(durationLine) : 0;

    stepLog('Validation', `Has video stream: ${hasVideo}, Duration: ${outputDuration.toFixed(1)}s`);

    if (!hasVideo || outputDuration < 3) {
      stepError('Validation', 'Output file is not a valid playable mp4');
      return res.status(500).json({ success: false, message: 'Output file is not a valid playable mp4' });
    }

    stepLog('Validation', 'Output validation passed');

    // ─── STEP 3: Upload to YouTube ─────────────────────────────────────────
    stepLog('Upload', 'Starting YouTube upload...');
    stepLog('Upload', `File: ${outputPath}`);
    stepLog('Upload', `Title: ${title}`);

    let youtubeVideoId: string;
    try {
      youtubeVideoId = await uploadToYouTube({
        title,
        description,
        tags: ['test', 'ai-platform', 'automation'],
        privacyStatus: 'unlisted',
        videoPath: outputPath,
        userId,
      });
    } catch (uploadErr: any) {
      stepError('Upload', `Upload failed: ${uploadErr.message}`);
      return res.status(500).json({
        success: false,
        message: `YouTube upload failed: ${uploadErr.message}`,
        localVideo: outputPath,
      });
    }

    stepLog('Upload', `Upload success — videoId: ${youtubeVideoId}`);

    // ─── STEP 4: Cleanup temp file ─────────────────────────────────────────
    try { unlinkSync(outputPath); } catch { }

    // ─── SUCCESS ────────────────────────────────────────────────────────────
    const youtubeUrl = `https://youtube.com/watch?v=${youtubeVideoId}`;
    stepLog('Done', '═══════════════════════════════════════');
    stepLog('Done', '  FIRST VIDEO UPLOAD SUCCESS');
    stepLog('Done', '═══════════════════════════════════════');
    stepLog('Done', `  videoId: ${youtubeVideoId}`);
    stepLog('Done', `  url:     ${youtubeUrl}`);
    stepLog('Done', '═══════════════════════════════════════');

    return res.status(200).json({
      success: true,
      videoId: youtubeVideoId,
      url: youtubeUrl,
      title,
      description,
      privacyStatus: 'unlisted',
      fileSize,
      duration: outputDuration,
    });
  } catch (err: any) {
    stepError('Fatal', err.message);
    return res.status(500).json({
      success: false,
      message: `Test upload failed: ${err.message}`,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    });
  }
}
