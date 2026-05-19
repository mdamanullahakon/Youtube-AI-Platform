import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { getVideoAnalytics } from '../youtube.service';
import { IncomeAnalyticsSnapshot } from './types';

export class AnalyticsEngine {
  async collectSnapshot(
    projectId: string,
    videoId: string,
    channelId: string,
    snapshotType: 'early' | 'full',
    minutesSinceUpload: number,
  ): Promise<IncomeAnalyticsSnapshot | null> {
    try {
      let resolvedVideoId = videoId;
      let resolvedChannelId = channelId;

      const output = await prisma.incomeVideoOutput.findUnique({
        where: { projectId },
        select: { videoId: true, channelId: true, uploadStatus: true },
      });

      if (output?.videoId && !output.videoId.startsWith('pending_')) {
        resolvedVideoId = output.videoId;
        resolvedChannelId = output.channelId || channelId;
      } else {
        const uploadHistory = await prisma.uploadHistory.findUnique({
          where: { projectId },
          select: { videoId: true, channelId: true },
        });
        if (uploadHistory?.videoId) {
          resolvedVideoId = uploadHistory.videoId;
          resolvedChannelId = uploadHistory.channelId || channelId;
        }
      }

      if (!resolvedVideoId || resolvedVideoId.startsWith('pending_')) {
        logger.warn(`[AnalyticsEngine] Video not yet uploaded for ${projectId}, storing zero snapshot`);
        return await this.storeZeroSnapshot(projectId, videoId, channelId, snapshotType, minutesSinceUpload);
      }

      const stats = await getVideoAnalytics(resolvedVideoId);

      const snapshot: IncomeAnalyticsSnapshot = {
        projectId,
        videoId: resolvedVideoId,
        snapshotType,
        minutesSinceUpload,
        views: stats?.views ?? 0,
        likes: stats?.likes ?? 0,
        comments: stats?.comments ?? 0,
        shares: stats?.shares ?? 0,
        ctr: stats?.ctr ?? 0,
        retention: stats?.retention ?? 0,
        watchTime: stats?.watchTime ?? 0,
        subscribersGained: stats?.subscribersGained ?? 0,
        impressions: stats?.impressions ?? 0,
        avgViewDuration: stats?.avgViewDuration ?? 0,
        collectedAt: new Date(),
      };

      await prisma.incomeAnalyticsSnapshot.create({
        data: {
          projectId: snapshot.projectId,
          videoId: snapshot.videoId,
          channelId: resolvedChannelId,
          snapshotType: snapshot.snapshotType,
          minutesSinceUpload: snapshot.minutesSinceUpload,
          views: snapshot.views,
          likes: snapshot.likes,
          comments: snapshot.comments,
          shares: snapshot.shares,
          ctr: snapshot.ctr,
          retention: snapshot.retention,
          watchTime: snapshot.watchTime,
          subscribersGained: snapshot.subscribersGained,
          impressions: snapshot.impressions,
          avgViewDuration: snapshot.avgViewDuration,
          collectedAt: snapshot.collectedAt,
        },
      });

      logger.info(`[AnalyticsEngine] ${snapshotType} snapshot for ${resolvedVideoId}: ${snapshot.views} views, ${snapshot.ctr}% CTR`);
      return snapshot;
    } catch (err: any) {
      logger.error(`[AnalyticsEngine] Failed ${snapshotType} for ${projectId}: ${err.message}`);
      return null;
    }
  }

  private async storeZeroSnapshot(
    projectId: string,
    videoId: string,
    channelId: string,
    snapshotType: 'early' | 'full',
    minutesSinceUpload: number,
  ): Promise<IncomeAnalyticsSnapshot> {
    const snapshot: IncomeAnalyticsSnapshot = {
      projectId, videoId, snapshotType, minutesSinceUpload,
      views: 0, likes: 0, comments: 0, shares: 0,
      ctr: 0, retention: 0, watchTime: 0,
      subscribersGained: 0, impressions: 0, avgViewDuration: 0,
      collectedAt: new Date(),
    };

    await prisma.incomeAnalyticsSnapshot.create({
      data: {
        projectId, videoId, channelId, snapshotType, minutesSinceUpload,
        views: 0, likes: 0, comments: 0, shares: 0,
        ctr: 0, retention: 0, watchTime: 0,
        subscribersGained: 0, impressions: 0, avgViewDuration: 0,
        collectedAt: new Date(),
      },
    });

    return snapshot;
  }

  async getVideoStats(projectId: string): Promise<{
    early: IncomeAnalyticsSnapshot | null;
    full: IncomeAnalyticsSnapshot | null;
  }> {
    const snapshots = await prisma.incomeAnalyticsSnapshot.findMany({
      where: { projectId },
      orderBy: { collectedAt: 'desc' },
    });

    return {
      early: (snapshots.find(s => s.snapshotType === 'early') as unknown as IncomeAnalyticsSnapshot) || null,
      full: (snapshots.find(s => s.snapshotType === 'full') as unknown as IncomeAnalyticsSnapshot) || null,
    };
  }
}
