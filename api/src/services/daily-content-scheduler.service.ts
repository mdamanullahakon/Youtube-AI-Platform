import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { AIOrchestrator } from '../ai/orchestrator';
import { TrendHunterAgent } from '../agents/trend-hunter.agent';

export interface DailyScheduleResult {
  channelId: string;
  channelTitle: string;
  action: 'generated' | 'skipped_exists' | 'skipped_no_topic' | 'error';
  projectId?: string;
  topic?: string;
  error?: string;
}

const DAILY_VIDEOS_PER_CHANNEL = 1;
const TOPIC_POOL_SIZE = 5;

export class DailyContentScheduler {
  async runDailyForAllChannels(): Promise<DailyScheduleResult[]> {
    logger.info('[DailyScheduler] Starting daily content check for all channels');
    const results: DailyScheduleResult[] = [];

    try {
      const channels = await prisma.youTubeAccount.findMany({
        where: {
          isConnected: true,
        },
        include: {
          user: { select: { id: true, name: true } },
        },
      });

      if (channels.length === 0) {
        logger.info('[DailyScheduler] No connected channels found');
        return results;
      }

      logger.info(`[DailyScheduler] Found ${channels.length} active channels`);

      for (const channel of channels) {
        const result = await this.processChannel(channel);
        results.push(result);
      }
    } catch (err: any) {
      logger.error(`[DailyScheduler] Fatal error: ${err.message}`);
    }

    const generated = results.filter(r => r.action === 'generated').length;
    const skipped = results.filter(r => r.action !== 'generated').length;
    logger.info(`[DailyScheduler] Complete: ${generated} videos generated, ${skipped} channels skipped`);
    return results;
  }

  private async processChannel(channel: {
    id: string;
    channelId: string;
    channelTitle: string | null;
    userId: string;
  }): Promise<DailyScheduleResult> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayCount = await prisma.videoProject.count({
        where: {
          channelId: channel.channelId,
          createdAt: { gte: today, lt: tomorrow },
          status: { not: 'failed' },
        },
      });

      if (todayCount >= DAILY_VIDEOS_PER_CHANNEL) {
        logger.info(`[DailyScheduler] Channel ${channel.channelTitle || channel.channelId} already has ${todayCount} videos today — skipping`);
        return {
          channelId: channel.channelId,
          channelTitle: channel.channelTitle || channel.channelId,
          action: 'skipped_exists',
        };
      }

      const topic = await this.selectBestTopic(channel.channelId, channel.userId);
      if (!topic) {
        logger.warn(`[DailyScheduler] No suitable topic found for channel ${channel.channelTitle || channel.channelId}`);
        return {
          channelId: channel.channelId,
          channelTitle: channel.channelTitle || channel.channelId,
          action: 'skipped_no_topic',
        };
      }

      const project = await prisma.videoProject.create({
        data: {
          userId: channel.userId,
          channelId: channel.channelId,
          topic,
          status: 'draft',
        },
      });

      const orchestrator = new AIOrchestrator(project.id, channel.channelId, channel.userId);
      orchestrator.runFullPipeline(topic).catch(err => {
        logger.error(`[DailyScheduler] Pipeline failed for project ${project.id}: ${err.message}`);
      });

      logger.info(`[DailyScheduler] Queued video for channel ${channel.channelTitle || channel.channelId}: topic="${topic}" project=${project.id}`);
      return {
        channelId: channel.channelId,
        channelTitle: channel.channelTitle || channel.channelId,
        action: 'generated',
        projectId: project.id,
        topic,
      };
    } catch (err: any) {
      logger.error(`[DailyScheduler] Error processing channel ${channel.channelTitle || channel.channelId}: ${err.message}`);
      return {
        channelId: channel.channelId,
        channelTitle: channel.channelTitle || channel.channelId,
        action: 'error',
        error: err.message,
      };
    }
  }

  private async selectBestTopic(channelId: string, userId: string): Promise<string | null> {
    const topTopics = await this.getTopNicheTrends();
    if (topTopics.length === 0) return null;

    const feedbackInsights = await prisma.contentInsight.findMany({
      where: {
        source: 'performance-correlation',
        applicationCount: { lt: 5 },
      },
      orderBy: { confidence: 'desc' },
      take: 3,
    });

    const topPerformingTopics = await this.getTopPerformingTopics(userId);
    const topicPool = [...topTopics, ...topPerformingTopics];
    const uniqueTopics = [...new Set(topicPool)];

    if (uniqueTopics.length === 0) return null;

    const weighted = uniqueTopics.slice(0, TOPIC_POOL_SIZE);
    return weighted[Math.floor(Math.random() * weighted.length)];
  }

  private async getTopNicheTrends(): Promise<string[]> {
    try {
      const opportunities = await prisma.viralOpportunity.findMany({
        where: { viralScore: { gte: 50 } },
        orderBy: { viralScore: 'desc' },
        take: 10,
        select: { topic: true },
      });
      if (opportunities.length > 0) {
        return opportunities.map(o => o.topic);
      }
    } catch {}

    try {
      const hunter = new TrendHunterAgent();
      const scans = await hunter.scanAllSources();
      return scans.slice(0, 10).map(s => s.keyword).filter(Boolean);
    } catch {}

    return [
      'Most terrifying true horror stories that will keep you awake',
      'The scariest paranormal encounters caught on camera',
      'Real abandoned places with dark secrets revealed',
      'True crime stories that shocked the world',
      'Unexplained mysteries science cannot solve',
      'Creepy past events that changed history forever',
      'Horror stories from around the world you never heard',
      'Dark psychological experiments that went too far',
      'Mysterious disappearances that remain unsolved',
      'Supernatural legends that turned out to be real',
    ];
  }

  private async getTopPerformingTopics(userId: string): Promise<string[]> {
    try {
      const performances = await prisma.contentPerformance.findMany({
        where: {
          project: { userId },
          actualViews: { gt: 0 },
        },
        orderBy: { actualViews: 'desc' },
        take: 5,
        include: { project: { select: { topic: true } } },
      });
      return performances
        .filter(p => p.project?.topic)
        .map(p => `${p.project!.topic} (similar style, new story)`);
    } catch {
      return [];
    }
  }
}
