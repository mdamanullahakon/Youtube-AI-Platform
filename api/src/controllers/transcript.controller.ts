import { Request, Response } from 'express';
import { transcriptQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';

export async function analyzeTranscripts(req: Request, res: Response) {
  try {
    const { videoIds } = req.body;
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ success: false, message: 'videoIds array is required' });
    }

    const job = await transcriptQueue.add('transcript-analysis', { videoIds });

    logger.info(`Transcript analysis job ${job.id} enqueued for ${videoIds.length} videos`);

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: 'Transcript analysis queued.',
    });
  } catch (error: any) {
    logger.error('Transcript analysis enqueue failed', { error: error.message });
    res.status(500).json({ success: false, message: 'Transcript analysis failed' });
  }
}
