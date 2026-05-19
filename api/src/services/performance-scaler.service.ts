import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { generateWithAI } from './ai.service';
import { extractJson } from '../utils/parse-ai-response';

export interface ChannelPerformanceScore {
  channelId: string;
  channelTitle: string;
  performanceScore: number;
  avgViews: number;
  avgCTR: number;
  avgRetention: number;
  growthRate: number;
  velocity: 'accelerating' | 'growing' | 'stagnant' | 'declining' | 'critical';
  recommendedFrequency: string;
  recommendedNiche: string | null;
  shouldScaleUp: boolean;
  shouldScaleDown: boolean;
  shouldPivotNiche: boolean;
}

export class PerformanceScaler {
  private readonly HIGH_PERFORMANCE_THRESHOLD = 70;
  private readonly LOW_PERFORMANCE_THRESHOLD = 30;
  private readonly CRITICAL_THRESHOLD = 15;

  async evaluateChannel(channelId: string): Promise<ChannelPerformanceScore | null> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) return null;

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (projects.length === 0) {
      return {
        channelId, channelTitle: channel.channelTitle || '',
        performanceScore: 50, avgViews: 0, avgCTR: 0, avgRetention: 0,
        growthRate: 0, velocity: 'stagnant',
        recommendedFrequency: 'daily', recommendedNiche: null,
        shouldScaleUp: false, shouldScaleDown: false, shouldPivotNiche: false,
      };
    }

    const withAnalytics = projects.filter(p => p.analytics);
    const recentProjects = projects.slice(0, 10);
    const olderProjects = projects.slice(10);

    const avgViews = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.views || 0), 0) / withAnalytics.length
      : 0;
    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / withAnalytics.length
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.retention || 0), 0) / withAnalytics.length
      : 0;

    const recentAvgViews = recentProjects.length > 0
      ? recentProjects.reduce((s, p) => s + (p.analytics?.views || 0), 0) / recentProjects.length
      : 0;
    const olderAvgViews = olderProjects.length > 0
      ? olderProjects.reduce((s, p) => s + (p.analytics?.views || 0), 0) / olderProjects.length
      : 0;

    const growthRate = olderAvgViews > 0 ? ((recentAvgViews - olderAvgViews) / olderAvgViews) * 100 : 0;

    const performanceScore = Math.round(
      Math.min(100, (avgCTR * 3) + (avgRetention * 0.4) + Math.min(30, growthRate))
    );

    let velocity: ChannelPerformanceScore['velocity'] = 'stagnant';
    if (growthRate > 50) velocity = 'accelerating';
    else if (growthRate > 15) velocity = 'growing';
    else if (growthRate < -10) velocity = 'declining';
    else if (growthRate < -30) velocity = 'critical';

    let recommendedFrequency: string;
    let shouldScaleUp = false;
    let shouldScaleDown = false;
    let shouldPivotNiche = false;
    let recommendedNiche: string | null = null;

    if (performanceScore >= this.HIGH_PERFORMANCE_THRESHOLD || velocity === 'accelerating') {
      const currentFreq = await this.getChannelFrequency(channelId);
      recommendedFrequency = this.scaleUpFrequency(currentFreq);
      shouldScaleUp = true;
    } else if (performanceScore <= this.CRITICAL_THRESHOLD || velocity === 'critical') {
      recommendedFrequency = 'weekly';
      shouldScaleDown = true;
      shouldPivotNiche = true;
      recommendedNiche = await this.findHigherPerformingNiche(channel.userId, channelId);
    } else if (performanceScore <= this.LOW_PERFORMANCE_THRESHOLD || velocity === 'declining') {
      recommendedFrequency = this.scaleDownFrequency(await this.getChannelFrequency(channelId));
      shouldScaleDown = true;
    } else {
      recommendedFrequency = await this.getChannelFrequency(channelId) || 'daily';
    }

    await prisma.uploadSchedule.updateMany({
      where: { channelId, status: 'active' },
      data: { frequency: recommendedFrequency },
    });

    logger.info(`[PerformanceScaler] Channel ${channel.channelTitle}: score=${performanceScore}, velocity=${velocity}, freq=${recommendedFrequency}`);

    return {
      channelId, channelTitle: channel.channelTitle || '',
      performanceScore, avgViews, avgCTR, avgRetention, growthRate, velocity,
      recommendedFrequency, recommendedNiche,
      shouldScaleUp, shouldScaleDown, shouldPivotNiche,
    };
  }

  async evaluateAllChannels(): Promise<ChannelPerformanceScore[]> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const results = await Promise.all(
      channels.map(c => this.evaluateChannel(c.channelId))
    );
    return results.filter((r): r is ChannelPerformanceScore => r !== null);
  }

  async killUnderperformingChannels(dryRun = true): Promise<{ killed: string[]; warnings: string[] }> {
    const evaluations = await this.evaluateAllChannels();
    const killed: string[] = [];
    const warnings: string[] = [];

    for (const evalResult of evaluations) {
      if (evalResult.performanceScore <= this.CRITICAL_THRESHOLD && evalResult.velocity === 'critical') {
        if (!dryRun) {
          const acct = await prisma.youTubeAccount.findFirst({ where: { channelId: evalResult.channelId } });
          if (!acct) continue;
          await prisma.youTubeAccount.update({
            where: { id: acct.id },
            data: { isConnected: false },
          });
          await prisma.uploadSchedule.updateMany({
            where: { channelId: evalResult.channelId },
            data: { status: 'paused' },
          });
          killed.push(evalResult.channelTitle);
          logger.warn(`[PerformanceScaler] KILLED channel ${evalResult.channelTitle} (score: ${evalResult.performanceScore})`);
        } else {
          warnings.push(`DRY RUN: Would kill "${evalResult.channelTitle}" (score: ${evalResult.performanceScore}, velocity: ${evalResult.velocity})`);
        }
      }
    }

    return { killed, warnings };
  }

  private async getChannelFrequency(channelId: string): Promise<string> {
    const schedule = await prisma.uploadSchedule.findFirst({
      where: { channelId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    return schedule?.frequency || 'daily';
  }

  private scaleUpFrequency(current: string): string {
    const scale: Record<string, string> = {
      'weekly': 'twice-weekly',
      'twice-weekly': 'every-other-day',
      'every-other-day': 'daily',
      'daily': 'daily',
    };
    return scale[current] || 'daily';
  }

  private scaleDownFrequency(current: string): string {
    const scale: Record<string, string> = {
      'daily': 'every-other-day',
      'every-other-day': 'twice-weekly',
      'twice-weekly': 'weekly',
      'weekly': 'weekly',
    };
    return scale[current] || 'weekly';
  }

  private async findHigherPerformingNiche(userId: string, currentChannelId: string): Promise<string | null> {
    const allChannels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true, id: { not: currentChannelId } },
    });

    if (allChannels.length === 0) return null;

    const channelScores = await Promise.all(
      allChannels.map(c => this.evaluateChannel(c.channelId))
    );

    const bestChannel = channelScores
      .filter((r): r is ChannelPerformanceScore => r !== null)
      .sort((a, b) => b.performanceScore - a.performanceScore)[0];

    if (bestChannel && bestChannel.performanceScore > this.LOW_PERFORMANCE_THRESHOLD) {
      return bestChannel.recommendedNiche || null;
    }

    return null;
  }
}
