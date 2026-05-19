import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface ChannelInsight {
  channelId: string;
  channelName: string;
  niche: string;
  avgCTR: number;
  avgRetention: number;
  avgViews: number;
  totalVideos: number;
  bestPerformingStyle: string;
  bestThumbnailStyle: string;
}

export interface CrossChannelStrategy {
  globalBestCTR: number;
  globalBestRetention: number;
  bestPacingNiche: string;
  bestThumbnailNiche: string;
  topStrategies: StrategyTransfer[];
  recommendations: string[];
}

interface StrategyTransfer {
  fromNiche: string;
  toNiche: string;
  strategy: string;
  expectedImprovement: string;
  confidence: number;
}

export class CrossChannelIntelligence {
  async analyzeAllChannels(userId: string): Promise<CrossChannelStrategy> {
    logger.info(`[CrossChannelIntel] Analyzing all channels for user ${userId}`);
    const channels = await this.getChannelInsights(userId);
    if (channels.length === 0) {
      return {
        globalBestCTR: 0, globalBestRetention: 0,
        bestPacingNiche: '', bestThumbnailNiche: '',
        topStrategies: [], recommendations: [],
      };
    }

    const bestCTR = Math.max(...channels.map(c => c.avgCTR));
    const bestRetention = Math.max(...channels.map(c => c.avgRetention));
    const topCTRChannel = channels.find(c => c.avgCTR === bestCTR);
    const topRetentionChannel = channels.find(c => c.avgRetention === bestRetention);

    const strategies = this.generateTransfers(channels, topCTRChannel, topRetentionChannel);

    return {
      globalBestCTR: bestCTR,
      globalBestRetention: bestRetention,
      bestPacingNiche: topRetentionChannel?.niche || '',
      bestThumbnailNiche: topCTRChannel?.niche || '',
      topStrategies: strategies,
      recommendations: this.generateRecommendations(channels),
    };
  }

  async transferStrategy(fromChannelId: string, toChannelId: string, strategyType: string): Promise<void> {
    logger.info(`[CrossChannelIntel] Transferring "${strategyType}" from ${fromChannelId} to ${toChannelId}`);

    await prisma.strategyDecision.create({
      data: {
        channelId: toChannelId,
        userId: 'system',
        decisionType: `TRANSFER_${strategyType.toUpperCase().replace(/\s+/g, '_')}`,
        growthScore: 0,
        reasoning: `Strategy transfer from channel ${fromChannelId}: apply ${strategyType}`,
        actions: { fromChannel: fromChannelId, strategyType } as any,
      },
    });
  }

  async getGlobalBestPractices(): Promise<{
    bestTitlePatterns: string[];
    bestThumbnailPatterns: string[];
    bestPacingFormula: string;
  }> {
    const topPerformers = await prisma.analytics.findMany({
      where: { ctr: { gt: 0 } },
      orderBy: { ctr: 'desc' },
      take: 10,
      include: { project: { include: { script: true, thumbnail: true } } },
    });

    const patterns = {
      bestTitlePatterns: [] as string[],
      bestThumbnailPatterns: [] as string[],
      bestPacingFormula: 'Pattern interrupt every 25-30s with emotional shifts',
    };

    for (const p of topPerformers) {
      if (p.project?.script?.content) {
        const hook = p.project.script.content.split('---HOOK---')[1]?.split('---')[0]?.trim();
        if (hook && hook.length < 100) patterns.bestTitlePatterns.push(hook);
      }
      if (p.project?.thumbnail?.style) {
        patterns.bestThumbnailPatterns.push(p.project.thumbnail.style);
      }
    }

    return patterns;
  }

  private async getChannelInsights(userId: string): Promise<ChannelInsight[]> {
    const accounts = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const insights: ChannelInsight[] = [];

    for (const acc of accounts) {
      const uploads = await prisma.uploadHistory.findMany({
        where: { channelId: acc.channelId },
        include: { project: { include: { analytics: true, thumbnail: true } } },
      });

      if (uploads.length === 0) continue;

      const withAnalytics = uploads.filter(u => u.project?.analytics);
      const avgCTR = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.ctr || 0), 0) / withAnalytics.length
        : 0;
      const avgRetention = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.retention || 0), 0) / withAnalytics.length
        : 0;
      const avgViews = withAnalytics.length > 0
        ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.views || 0), 0) / withAnalytics.length
        : 0;

      const topByViews = [...uploads].sort((a, b) =>
        (b.project?.analytics?.views || 0) - (a.project?.analytics?.views || 0)
      );
      const bestStyle = topByViews[0]?.project?.thumbnail?.style || 'unknown';

      insights.push({
        channelId: acc.channelId,
        channelName: acc.channelTitle || `Channel ${acc.channelId.slice(0, 8)}`,
        niche: `${acc.channelTitle?.split(' ').slice(-1)[0] || 'horror'}`,
        avgCTR: Math.round(avgCTR * 100) / 100,
        avgRetention: Math.round(avgRetention),
        avgViews: Math.round(avgViews),
        totalVideos: uploads.length,
        bestPerformingStyle: bestStyle,
        bestThumbnailStyle: bestStyle,
      });
    }

    return insights;
  }

  private generateTransfers(
    channels: ChannelInsight[],
    topCTR?: ChannelInsight,
    topRetention?: ChannelInsight
  ): StrategyTransfer[] {
    const transfers: StrategyTransfer[] = [];

    if (topCTR && channels.length > 1) {
      for (const ch of channels) {
        if (ch.channelId !== topCTR.channelId && ch.avgCTR < topCTR.avgCTR * 0.8) {
          transfers.push({
            fromNiche: topCTR.niche,
            toNiche: ch.niche,
            strategy: `Apply thumbnail style "${topCTR.bestThumbnailStyle}" from ${topCTR.channelName}`,
            expectedImprovement: `+${Math.round((topCTR.avgCTR - ch.avgCTR) * 100)}% CTR`,
            confidence: 0.7,
          });
        }
      }
    }

    if (topRetention && channels.length > 1) {
      for (const ch of channels) {
        if (ch.channelId !== topRetention.channelId && ch.avgRetention < topRetention.avgRetention * 0.8) {
          transfers.push({
            fromNiche: topRetention.niche,
            toNiche: ch.niche,
            strategy: `Adopt pacing formula from ${topRetention.channelName} (retention: ${topRetention.avgRetention}%)`,
            expectedImprovement: `+${Math.round(topRetention.avgRetention - ch.avgRetention)}% retention`,
            confidence: 0.65,
          });
        }
      }
    }

    return transfers;
  }

  private generateRecommendations(channels: ChannelInsight[]): string[] {
    const recs: string[] = [];
    const lowCTR = channels.filter(c => c.avgCTR < 4);
    const lowRetention = channels.filter(c => c.avgRetention < 40);

    if (lowCTR.length > 0) {
      recs.push(`Improve thumbnails on ${lowCTR.map(c => c.channelName).join(', ')} — CTR below 4%`);
    }
    if (lowRetention.length > 0) {
      recs.push(`Increase pattern interrupts on ${lowRetention.map(c => c.channelName).join(', ')} — retention below 40%`);
    }
    if (channels.length < 5) {
      recs.push('Scale to more channels — cross-channel data improves all metrics by 15-20%');
    }

    return recs;
  }
}
