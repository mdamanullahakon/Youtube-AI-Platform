import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { createFullPipelineFlow } from '../../queues/pipeline.queue';
import { postVideoComment } from '../youtube.service';
import { IncomeVideoPlan, IncomeUploadResult } from './types';

const PEAK_UPLOAD_HOUR = 14;
const TAGS_STRATEGY = { broad: 5, mid: 5, longTail: 5 };

export class UploadEngine {
  async upload(
    plan: IncomeVideoPlan,
    projectId: string,
    cycleId?: string,
  ): Promise<IncomeUploadResult> {
    const { channelId, userId, title, seoDescription, seoTags, topicScore, categoryId, script, thumbnailPrompt, hook, thumbnailStyle } = plan;

    const existing = await this.checkDuplicate(channelId, title);
    if (existing) {
      logger.warn(`[UploadEngine] Duplicate title: "${title}" on ${channelId}`);
      return { projectId, videoId: null, uploadStatus: 'failed', publishedAt: null, error: 'Duplicate video title' };
    }

    const optimizedDesc = this.optimizeDescription(seoDescription || '', hook, title, channelId);
    const optimizedTags = this.optimizeTags(seoTags || [], topicScore.topic, channelId);

    const output = await prisma.incomeVideoOutput.upsert({
      where: { projectId },
      update: {
        title, script, hook, thumbnailPrompt, thumbnailStyle,
        seoTags: JSON.stringify(optimizedTags), seoDescription: optimizedDesc, categoryId,
        uploadStatus: 'processing',
        ...(cycleId ? { cycleId } : {}),
      },
      create: {
        projectId, channelId, userId, topic: topicScore.topic,
        title, script, hook, thumbnailPrompt, thumbnailStyle,
        seoTags: JSON.stringify(optimizedTags), seoDescription: optimizedDesc, categoryId,
        uploadStatus: 'processing',
        ...(cycleId ? { cycleId } : {}),
      },
    });

    try {
      const videoProject = await prisma.videoProject.create({
        data: {
          userId, channelId, topic: topicScore.topic,
          title, description: optimizedDesc, status: 'pending',
        },
      });

      await this.enqueuePipeline(videoProject.id, topicScore.topic, channelId);

      logger.info(`[UploadEngine] Pipeline enqueued for "${title}": project=${videoProject.id}`);
      return {
        projectId,
        videoId: `pending_${videoProject.id}`,
        uploadStatus: 'processing',
        publishedAt: null,
      };
    } catch (err: any) {
      logger.error(`[UploadEngine] Enqueue failed for "${title}": ${err.message}`);
      await prisma.incomeVideoOutput.update({
        where: { id: output.id },
        data: { uploadStatus: 'failed', error: err.message },
      });
      return { projectId, videoId: null, uploadStatus: 'failed', publishedAt: null, error: err.message };
    }
  }

  async postUploadActions(projectId: string): Promise<void> {
    try {
      const uploadHistory = await prisma.uploadHistory.findUnique({ where: { projectId } });
      if (!uploadHistory?.videoId) return;

      const output = await prisma.incomeVideoOutput.findUnique({ where: { projectId } });
      if (!output) return;

      const commentText = `🔥 What's your biggest takeaway from this video? Drop it below! 👇\n\nAlso, watch till the end — I shared something mind-blowing at [timestamp] that most people miss.`;

      await postVideoComment(uploadHistory.videoId, commentText, output.userId || undefined);
      logger.info(`[UploadEngine] Auto-comment posted for ${uploadHistory.videoId}`);
    } catch (err: any) {
      logger.warn(`[UploadEngine] Post-upload action failed for ${projectId}: ${err.message}`);
    }
  }

  private optimizeDescription(desc: string, hook: string, title: string, channelId: string): string {
    const hookLine = hook ? hook.substring(0, 150) : title;
    const ctaLine = `👇 SUBSCRIBE for more videos like this!`;
    return `${hookLine}\n\n${ctaLine}\n\n${desc?.substring(0, 2000) || `In this video, ${title}. Watch till the end for the full breakdown.`}`;
  }

  private optimizeTags(tags: string[], topic: string, channelId: string): string[] {
    const broad = [channelId?.substring(0, 10) || 'youtube', 'viral', 'trending', '2026', 'new'];
    const mid = [topic, `${topic} 2026`, `${topic} guide`, `best ${topic}`, `${topic} explained`];
    const longTail = [`how to ${topic}`, `${topic} for beginners`, `${topic} tips and tricks`, `${topic} full guide`, `${topic} tutorial`];

    const combined = [...broad, ...mid, ...longTail, ...(tags || [])];
    const seen = new Set<string>();
    return combined.filter(t => { const k = t.toLowerCase().trim(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 15);
  }

  private async checkDuplicate(channelId: string, title: string): Promise<boolean> {
    const existing = await prisma.incomeVideoOutput.findFirst({
      where: { channelId, title, uploadStatus: 'uploaded' },
    });
    return !!existing;
  }

  private async enqueuePipeline(projectId: string, topic: string, channelId?: string): Promise<void> {
    try {
      const result = await createFullPipelineFlow(projectId, topic, channelId);
      logger.info(`[UploadEngine] Pipeline flow ${result.pipelineJobId} created for project ${projectId}`);
    } catch (err: any) {
      logger.error(`[UploadEngine] Pipeline flow creation failed for project ${projectId}: ${err.message}`);
      throw err;
    }
  }

  async checkUploadStatus(projectId: string): Promise<IncomeUploadResult> {
    const output = await prisma.incomeVideoOutput.findUnique({ where: { projectId } });
    if (!output) {
      return { projectId, videoId: null, uploadStatus: 'failed', publishedAt: null, error: 'Not found' };
    }

    const uploadHistory = await prisma.uploadHistory.findUnique({ where: { projectId } });

    if (output.uploadStatus === 'processing' && uploadHistory?.videoId) {
      await prisma.incomeVideoOutput.update({
        where: { projectId },
        data: { uploadStatus: 'uploaded', videoId: uploadHistory.videoId, publishedAt: uploadHistory.publishedAt },
      });

      await this.postUploadActions(projectId);

      return { projectId, videoId: uploadHistory.videoId, uploadStatus: 'uploaded', publishedAt: uploadHistory.publishedAt };
    }

    return {
      projectId,
      videoId: output.videoId,
      uploadStatus: output.uploadStatus as 'processing' | 'uploaded' | 'failed',
      publishedAt: output.publishedAt,
      error: output.error || undefined,
    };
  }
}
