import { Worker } from 'bullmq';
import { redisConnection } from '../config/redis';
import { queueLogger } from '../utils/logger';
import { TranscriptIntelligenceService } from '../services/transcript-intelligence.service';
import { fetchMultipleTranscripts } from '../services/transcript.service';


const intelligenceService = new TranscriptIntelligenceService();

interface TranscriptJobData {
  videoIds: string[];
  projectId?: string;
  userId?: string;
  enhanceWithAI?: boolean;
}

const worker = new Worker(
  'transcript-analysis',
  async (job) => {
    queueLogger.info(`Processing transcript analysis job ${job.id}`);
    await job.updateProgress(0);

    const data = job.data as TranscriptJobData;
    const { videoIds, projectId = '', enhanceWithAI = true } = data;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      throw new Error('videoIds array is required');
    }

    await job.updateProgress(10);

    if (videoIds.length === 1 && projectId) {
      await job.updateProgress(20);
      const transcript = await fetchMultipleTranscripts(videoIds);
      await job.updateProgress(40);

      if (transcript.length === 0) {
        throw new Error(`No transcript found for video ${videoIds[0]}`);
      }

      await job.updateProgress(50);
      const result = await intelligenceService.analyze({
        transcript: transcript[0].transcript,
        sourceVideoIds: videoIds,
        projectId,
        enhanceWithAI,
      });
      await job.updateProgress(90);

      await job.updateProgress(100);
      queueLogger.info(`Single transcript analysis complete for project ${projectId}`);
      return { analysis: result, projectId };
    }

    await job.updateProgress(20);
    const transcripts = await fetchMultipleTranscripts(videoIds);
    await job.updateProgress(40);

    if (transcripts.length === 0) {
      throw new Error('No transcripts could be fetched for any of the provided video IDs');
    }

    await job.updateProgress(50);
    const transcriptInputs = transcripts.map(t => ({
      videoId: t.videoId,
      text: t.transcript,
      title: t.title,
    }));
    const batchResult = await intelligenceService.analyzeMultiple(transcriptInputs);
    await job.updateProgress(90);

    await job.updateProgress(100);
    queueLogger.info(`Batch transcript analysis complete for ${videoIds.length} videos (${transcripts.length} successful)`);
    return {
      analysis: batchResult.aggregated,
      individualAnalyses: batchResult.individual,
      projectId,
    };
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 300_000,
    stalledInterval: 60_000,
  }
);

worker.on('completed', (job) => {
  queueLogger.info(`Transcript job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  queueLogger.error(`Transcript job ${job?.id} failed`, { error: err.message });
});

worker.on('progress', (job, progress) => {
  queueLogger.debug(`Transcript job ${job.id} progress: ${progress}%`);
});

worker.on('error', (err) => {
  if (err.message.includes('SCRIPT') || err.message.includes('evalsha') || err.message.includes('NOSCRIPT')) {
    queueLogger.error('Transcript worker FATAL Lua script error — worker shutting down', { error: err.message });
    worker.close();
    return;
  }
  queueLogger.error('Transcript worker error', { error: err.message });
});

export { worker };
