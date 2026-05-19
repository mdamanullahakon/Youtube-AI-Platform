import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { logger } from '../utils/logger';
import { renderVideo } from '../services/render.service';
import { prisma } from '../config/db';
import { parseScriptScenes } from '../utils/helpers';
import { join } from 'path';
import { mkdir } from 'fs/promises';


const worker = new Worker(
  'video-render',
  async (job) => {
    logger.info(`Processing render job ${job.id}`);
    await job.updateProgress(0);

    const { projectId } = job.data as { projectId: string };

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { script: true, voiceover: true },
    });

    if (!project?.script) throw new Error('No script found');
    await job.updateProgress(10);

    const scenes = parseScriptScenes(project.script.content);
    const outputDir = join(process.cwd(), 'uploads', 'videos');
    await mkdir(outputDir, { recursive: true });
    const outputFilename = `${projectId}_${Date.now()}.mp4`;
    const outputPath = join(outputDir, outputFilename);

    await job.updateProgress(20);

    const videoPath = await renderVideo({
      scenes,
      topic: project.topic,
      title: project.title || undefined,
      voiceoverPath: project.voiceover?.audioUrl
        ? join(process.cwd(), project.voiceover.audioUrl.replace(/^\//, ''))
        : undefined,
      outputPath,
    });

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
    logger.info(`Render job ${job.id} completed: ${videoUrl}`);
    return { videoPath, scenes: scenes.length };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 600_000,
    stalledInterval: 120_000,
  }
);

worker.on('completed', (job) => logger.info(`Render job ${job.id} completed`));
worker.on('failed', (job, err) => logger.error(`Render job ${job?.id} failed`, { error: err.message }));
worker.on('progress', (job, progress) => logger.debug(`Render job ${job.id} progress: ${progress}%`));
worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    logger.error('Render worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  logger.error('Render worker error', { error: err.message });
});

function getVideoDuration(scenes: { duration: number }[]): number {
  const totalDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  return totalDuration + 4;
}

export { worker };
