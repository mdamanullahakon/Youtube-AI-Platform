import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { renderVideo } from '../services/render.service';
import { prisma } from '../config/db';
import { parseScriptScenes } from '../utils/helpers';
import { join } from 'path';
import { mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { guardWorker } from './worker-guard';
import { uploadQueue } from '../queues/video.queue';
import { OutputValidationGate } from '../services/output-validation.service';
import { detectGpuEncoder, isGpuAvailable } from '../utils/helpers';

const MIN_OUTPUT_SIZE = 2048;
const VALIDATION_TIMEOUT = 30000;

// Detect GPU encoder at module init (once, cached via memoization in detectGpuEncoder)
let gpuEncoder: string | null = null;
let encoderResolved = false;

async function getEncoder(): Promise<string> {
  if (encoderResolved && gpuEncoder !== null) return gpuEncoder;
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  gpuEncoder = await detectGpuEncoder(ffmpegPath);
  encoderResolved = true;
  logger.info(`[RENDER_TRACE] GPU encoder detected: ${gpuEncoder}${isGpuAvailable(gpuEncoder) ? ' (hardware accelerated)' : ' (software fallback)'}`);
  return gpuEncoder;
}

// Kick off detection early (non-blocking, result cached)
getEncoder().catch(() => {});

const worker = new Worker(
  'video-render',
  async (job) => {
    const { projectId } = job.data as { projectId: string };
    logger.info(`[UPLOAD_TRACE] Render job ${job.id} started - projectId: ${projectId}, isFlowChild: ${!!job.parentKey}`);

    await job.updateProgress(0);

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { script: true, voiceover: true },
    });

    if (!project?.script) throw new Error('No script found');

    if (!project.voiceover?.audioUrl) {
      throw new Error(
        'Voiceover is required before render. Use the canonical pipeline (POST /api/videos/generate/new) so voice completes before render.',
      );
    }

    await job.updateProgress(10);

    const scenes = parseScriptScenes(project.script.content);
    if (scenes.length === 0) {
      throw new Error('No scenes parsed from script');
    }

    const outputDir = join(process.cwd(), 'uploads', 'videos');
    await mkdir(outputDir, { recursive: true });
    const outputFilename = `${projectId}_${Date.now()}.mp4`;
    const outputPath = join(outputDir, outputFilename);

    await job.updateProgress(20);

    const rawPath = join(process.cwd(), project.voiceover.audioUrl.replace(/^\//, ''));
    if (!existsSync(rawPath) || (await stat(rawPath)).size < 100) {
      throw new Error(`Voiceover file missing or invalid: ${rawPath}. Pipeline cannot render without audio.`);
    }
    const voiceoverPath = rawPath;
    logger.info(`[RENDER_TRACE] Voiceover file validated: ${rawPath}`);

    // ─── RENDER WITH SCENE RETRY BUILT-IN ─────────────────────────────────
    const encoder = await getEncoder();
    const videoPath = await renderVideo({
      scenes,
      topic: project.topic,
      title: project.title || undefined,
      voiceoverPath,
      outputPath,
      encoder,
    });

    // ─── HARD OUTPUT GUARANTEE ────────────────────────────────────────────
    // NEVER mark success unless ALL conditions are met

    // Condition 1: file exists
    if (!existsSync(outputPath)) {
      throw new Error(`[RENDER_TRACE] Output file does not exist after render: ${outputPath}`);
    }

    // Condition 2: file size >= 2048 bytes
    const fileStat = await stat(outputPath);
    if (fileStat.size < MIN_OUTPUT_SIZE) {
      throw new Error(`[RENDER_TRACE] Output file too small (${fileStat.size} bytes) at: ${outputPath}`);
    }

    // Condition 3: ffprobe validates duration
    const ffprobe = process.env.FFPROBE_PATH || process.env.FFMPEG_PATH?.replace('ffmpeg', 'ffprobe') || 'ffprobe';
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        { timeout: 10000 },
      );
      const duration = parseFloat(stdout.trim());
      if (isNaN(duration) || duration <= 0) {
        throw new Error(`ffprobe returned invalid duration: "${stdout.trim()}"`);
      }
      if (duration < 3.0) {
        throw new Error(`Output duration ${duration}s too short (< 3s) - corrupt`);
      }
      logger.info(`[RENDER_TRACE] ffprobe validated: ${duration.toFixed(1)}s`);
    } catch (err: any) {
      throw new Error(`[RENDER_TRACE] Output corruption check failed: ${err.message}`);
    }

    // Condition 4: no corruption - check video stream exists
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      const { stdout } = await execAsync(
        `"${ffprobe}" -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
        { timeout: 10000 },
      );
      if (!stdout.trim()) {
        throw new Error('No video stream found in output');
      }
    } catch (err: any) {
      throw new Error(`[RENDER_TRACE] Stream validation failed: ${err.message}`);
    }

    logger.info(`[RENDER_TRACE] Output validated: ${outputPath} (${fileStat.size} bytes)`);

    await job.updateProgress(80);

    const videoUrl = `/uploads/videos/${outputFilename}`;

    await prisma.videoRender.upsert({
      where: { projectId },
      update: { videoUrl, status: 'completed', progress: 100, duration: getVideoDuration(scenes) },
      create: { projectId, videoUrl, status: 'completed', progress: 100, duration: getVideoDuration(scenes) },
    });

    await prisma.videoProject.update({
      where: { id: projectId },
      data: { status: 'rendered' },
    });

    await job.updateProgress(100);
    logger.info(`[RENDER_TRACE] Render job ${job.id} completed - videoUrl: ${videoUrl}, file: ${outputPath}, size: ${fileStat.size} bytes`);
    return { videoPath, scenes: scenes.length };
  },
  {
    connection: redisConnection,
    concurrency: 3,
    lockDuration: 600_000,
    stalledInterval: 120_000,
  },
);

worker.on('completed', async (job) => {
  logger.info(`[UPLOAD_TRACE] Render completed handler - jobId: ${job.id}, parentKey: ${job.parentKey}, projectId: ${job.data?.projectId}`);

  const projectId = job.data?.projectId as string | undefined;
  if (!projectId) {
    logger.warn(`[UPLOAD_TRACE] No projectId in render job ${job.id} - skipping upload trigger`);
    return;
  }

  const isFlowChild = !!job.parentKey;
  if (isFlowChild) {
    logger.info(`[UPLOAD_TRACE] Render job ${job.id} is FlowProducer child - FlowProducer will trigger upload`);
    return;
  }

  logger.info(`[UPLOAD_TRACE] Standalone render detected - triggering upload for project ${projectId}`);

  try {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { script: true },
    });
    if (!project) {
      logger.warn(`[UPLOAD_TRACE] Project ${projectId} not found - cannot trigger upload`);
      return;
    }

    const videoRender = await prisma.videoRender.findUnique({ where: { projectId } });
    if (!videoRender?.videoUrl) {
      logger.warn(`[UPLOAD_TRACE] No videoRender record for ${projectId} - upload skipped`);
      return;
    }

    // ─── OutputValidationGate: block upload if video fails quality checks ──
    try {
      const videoFullPath = join(process.cwd(), videoRender.videoUrl.replace(/^\//, ''));
      const scenes = project.script?.content ? parseScriptScenes(project.script.content) : [];
      const validationGate = new OutputValidationGate();
      const validationResult = await validationGate.validateVideo(
        videoFullPath, scenes, undefined, project.title || project.topic,
      );
      if (!validationResult.passed) {
        const blockerNames = validationResult.checks
          .filter(c => c.severity === 'block' && !c.passed)
          .map(c => c.name);
        logger.error(`[UPLOAD_TRACE] Validation BLOCKED upload for project ${projectId}: ${blockerNames.join(', ')}`);
        return;
      }
      logger.info(`[UPLOAD_TRACE] Validation passed for ${projectId} - triggering upload`);
    } catch (err: any) {
      logger.warn(`[UPLOAD_TRACE] Validation check failed: ${err.message}`);
      return;
    }

    // ─── RESOLVE CHANNEL ID ───────────────────────────────────────────────
    let channelId = project.channelId;

    if (!channelId) {
      const activeChannel = await prisma.youTubeAccount.findFirst({
        where: { userId: project.userId, isConnected: true },
        orderBy: { createdAt: 'asc' },
      });
      if (activeChannel) {
        channelId = activeChannel.channelId;
        logger.info(`[UPLOAD_TRACE] Resolved channelId from user's active YouTube account: ${channelId}`);
      }
    }

    logger.info(`[UPLOAD_TRACE] Triggered upload for project ${projectId} - channelId: ${channelId || 'none'}`);

    const uploadJob = await uploadQueue.add('upload-video', {
      projectId,
      channelId,
      title: project.title || project.topic,
      description: project.description || '',
      tags: [project.topic].filter(Boolean),
      privacyStatus: 'public',
    });

    const uploadCounts = await uploadQueue
      .getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')
      .catch(() => null);

    logger.info(`[UPLOAD_TRACE] Upload job ${uploadJob.id} enqueued from render completed`, {
      queueName: uploadQueue.name,
      jobName: uploadJob.name,
      projectId,
      channelId: channelId || null,
      counts: uploadCounts,
    });
  } catch (err: any) {
    logger.error(`[UPLOAD_TRACE] Failed to trigger upload for project ${projectId}`, { error: err.message });
  }
});

worker.on('failed', (job, err) => logger.error(`[UPLOAD_TRACE] Render job ${job?.id} failed`, { error: err.message }));
worker.on('progress', (job, progress) => logger.debug(`Render job ${job.id} progress: ${progress}%`));

guardWorker(worker, 'render', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    logger.error('Render worker FATAL Lua script error - worker shutting down', { error: err.message });
  }
});

function getVideoDuration(scenes: { duration: number }[]): number {
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  return totalDuration + 4;
}

export { worker };
