import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson } from '../../utils/parse-ai-response';

export type DecisionAction = 'scale-hard' | 'normal' | 'reduce' | 'pause' | 'kill';
export type ContentType = 'long-form' | 'shorts' | 'high-cpm' | 'viral-trend';

export interface ChannelDecision {
  channelId: string;
  channelTitle: string;
  decisionScore: number;
  action: DecisionAction;
  recommendedUploadsPerDay: number;
  recommendedContentType: ContentType;
  recommendedNiche: string | null;
  priority: number;
  reasoning: string[];
  revenue: number;
  ctr: number;
  retention: number;
  conversionRate: number;
  growthTrend: number;
}

export interface GlobalDecision {
  timestamp: Date;
  channelDecisions: ChannelDecision[];
  topPriorityChannel: ChannelDecision | null;
  channelsToKill: string[];
  channelsToScale: string[];
  channelsToPause: string[];
  totalRevenue: number;
  totalProfit: number;
  overallHealth: 'excellent' | 'good' | 'fair' | 'critical';
  dailyUploadBudget: number;
  resourceAllocation: Record<string, number>;
}

export class DecisionEngine {
  async evaluateChannel(channelId: string): Promise<ChannelDecision> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) {
      return {
        channelId, channelTitle: 'Unknown',
        decisionScore: 0, action: 'kill',
        recommendedUploadsPerDay: 0,
        recommendedContentType: 'long-form',
        recommendedNiche: null,
        priority: 0,
        reasoning: ['Channel not found in database'],
        revenue: 0, ctr: 0, retention: 0, conversionRate: 0, growthTrend: 0,
      };
    }

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, monetizationConversion: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (projects.length === 0) {
      return {
        channelId, channelTitle: channel.channelTitle || 'New Channel',
        decisionScore: 25, action: 'reduce',
        recommendedUploadsPerDay: 0.5,
        recommendedContentType: 'viral-trend',
        recommendedNiche: null,
        priority: 1,
        reasoning: ['New channel — start with viral trends to build audience'],
        revenue: 0, ctr: 0, retention: 0, conversionRate: 0, growthTrend: 0,
      };
    }

    const withAnalytics = projects.filter(p => p.analytics);
    const recent10 = projects.slice(0, 10);
    const older10 = projects.slice(10, 20);

    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / withAnalytics.length : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, p) => s + (p.analytics?.retention || 0), 0) / withAnalytics.length : 0;

    let totalRevenue = 0;
    for (const p of projects) {
      const views = p.analytics?.views || 0;
      totalRevenue += (views / 1000) * 5;
      const conversions = p.monetizationConversion || [];
      totalRevenue += Array.isArray(conversions)
        ? conversions.reduce((s: number, c: any) => s + (c.revenue || 0), 0)
        : 0;
    }

    const recentRevenue = recent10.reduce((s, p) => {
      const views = p.analytics?.views || 0;
      return s + (views / 1000) * 5;
    }, 0);
    const olderRevenue = older10.length > 0
      ? older10.reduce((s, p) => {
          const views = p.analytics?.views || 0;
          return s + (views / 1000) * 5;
        }, 0)
      : recentRevenue;

    const growthTrend = olderRevenue > 0 ? ((recentRevenue - olderRevenue) / olderRevenue) * 100 : 10;

    const conversionRate = projects.length > 0
      ? projects.filter(p => {
          const convs = p.monetizationConversion;
          return Array.isArray(convs) ? convs.some((c: any) => c.conversions > 0) : false;
        }).length / projects.length * 100
      : 0;

    const decisionScore = Math.round(
      (Math.min(100, totalRevenue * 2) * 0.30) +
      (avgCTR * 5 * 0.20) +
      (avgRetention * 0.20) +
      (Math.min(100, conversionRate * 2) * 0.20) +
      (Math.min(100, Math.max(-100, growthTrend)) * 0.10)
    );

    let action: DecisionAction;
    let uploadsPerDay: number;

    if (decisionScore >= 80) {
      action = 'scale-hard';
      uploadsPerDay = 2;
    } else if (decisionScore >= 50) {
      action = 'normal';
      uploadsPerDay = 1;
    } else if (decisionScore >= 30) {
      action = 'reduce';
      uploadsPerDay = 0.5;
    } else if (decisionScore >= 15) {
      action = 'pause';
      uploadsPerDay = 0;
    } else {
      action = 'kill';
      uploadsPerDay = 0;
    }

    const bestNiche = await this.detectBestNiche(channelId);
    const contentType = await this.recommendContentType(channelId, decisionScore);

    const reasoning: string[] = [
      `Revenue: $${totalRevenue.toFixed(2)}`,
      `CTR: ${avgCTR.toFixed(1)}%`,
      `Retention: ${avgRetention.toFixed(1)}%`,
      `Conversion rate: ${conversionRate.toFixed(1)}%`,
      `Growth trend: ${growthTrend.toFixed(1)}%`,
      `Score: ${decisionScore} → ${action}`,
    ];

    logger.info(`[DecisionEngine] ${channel.channelTitle}: score=${decisionScore}, action=${action}, uploads=${uploadsPerDay}/day`);

    return {
      channelId, channelTitle: channel.channelTitle || '',
      decisionScore, action,
      recommendedUploadsPerDay: uploadsPerDay,
      recommendedContentType: contentType,
      recommendedNiche: bestNiche,
      priority: decisionScore,
      reasoning,
      revenue: totalRevenue,
      ctr: avgCTR,
      retention: avgRetention,
      conversionRate,
      growthTrend,
    };
  }

  async evaluateAllChannels(): Promise<GlobalDecision> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    if (channels.length === 0) {
      return {
        timestamp: new Date(),
        channelDecisions: [],
        topPriorityChannel: null,
        channelsToKill: [],
        channelsToScale: [],
        channelsToPause: [],
        totalRevenue: 0,
        totalProfit: 0,
        overallHealth: 'fair',
        dailyUploadBudget: 0,
        resourceAllocation: {},
      };
    }

    const decisions = await Promise.all(
      channels.map(c => this.evaluateChannel(c.channelId))
    );

    const sorted = decisions.sort((a, b) => b.decisionScore - a.decisionScore);
    const totalScore = sorted.reduce((s, d) => s + Math.max(0, d.decisionScore), 0);

    const resourceAllocation: Record<string, number> = {};
    for (const d of sorted) {
      resourceAllocation[d.channelId] = totalScore > 0 ? d.decisionScore / totalScore : 0;
    }

    const dailyUploadBudget = sorted.reduce((s, d) => s + d.recommendedUploadsPerDay, 0);

    return {
      timestamp: new Date(),
      channelDecisions: sorted,
      topPriorityChannel: sorted[0] || null,
      channelsToKill: sorted.filter(d => d.action === 'kill').map(d => d.channelId),
      channelsToScale: sorted.filter(d => d.action === 'scale-hard').map(d => d.channelId),
      channelsToPause: sorted.filter(d => d.action === 'pause').map(d => d.channelId),
      totalRevenue: sorted.reduce((s, d) => s + d.revenue, 0),
      totalProfit: sorted.reduce((s, d) => s + (d.decisionScore > 50 ? d.revenue * 0.7 : -d.revenue * 0.3), 0),
      overallHealth: sorted.filter(d => d.action === 'scale-hard' || d.action === 'normal').length >= sorted.length * 0.6
        ? 'excellent' : sorted.filter(d => d.action === 'kill').length > sorted.length * 0.3
        ? 'critical' : 'good',
      dailyUploadBudget,
      resourceAllocation,
    };
  }

  async executeDecisions(decisions: GlobalDecision, dryRun = true): Promise<{ executed: string[]; errors: string[] }> {
    const executed: string[] = [];
    const errors: string[] = [];

    for (const d of decisions.channelDecisions) {
      try {
        if (d.action === 'kill' && !dryRun) {
          await prisma.youTubeAccount.updateMany({
            where: { channelId: d.channelId },
            data: { isConnected: false },
          });
          await prisma.uploadSchedule.updateMany({
            where: { channelId: d.channelId },
            data: { status: 'paused' },
          });
          executed.push(`KILLED ${d.channelTitle} (score: ${d.decisionScore})`);
          logger.warn(`[DecisionEngine] KILLED channel ${d.channelTitle}`);
        } else if ((d.action === 'scale-hard' || d.action === 'normal') && !dryRun) {
          await prisma.uploadSchedule.updateMany({
            where: { channelId: d.channelId, status: 'active' },
            data: {
              frequency: d.action === 'scale-hard' ? 'daily' : 'every-other-day',
            },
          });
          executed.push(`${d.action === 'scale-hard' ? 'SCALED' : 'MAINTAINED'} ${d.channelTitle}`);
        } else if (d.action === 'reduce' && !dryRun) {
          await prisma.uploadSchedule.updateMany({
            where: { channelId: d.channelId, status: 'active' },
            data: { frequency: 'weekly' },
          });
          executed.push(`REDUCED ${d.channelTitle}`);
        } else if (d.action === 'pause' && !dryRun) {
          await prisma.uploadSchedule.updateMany({
            where: { channelId: d.channelId },
            data: { status: 'paused' },
          });
          executed.push(`PAUSED ${d.channelTitle}`);
        } else {
          executed.push(`[DRY RUN] Would ${d.action} ${d.channelTitle}`);
        }
      } catch (err: any) {
        errors.push(`Failed to ${d.action} ${d.channelTitle}: ${err.message}`);
      }
    }

    return { executed, errors };
  }

  async analyzeChannelProfitability(channelId: string): Promise<{
    profitScore: number;
    revenuePerView: number;
    conversionRate: number;
    affiliateCTR: number;
    rpm: number;
    recommendation: string;
  }> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) {
      return { profitScore: 0, revenuePerView: 0, conversionRate: 0, affiliateCTR: 0, rpm: 0, recommendation: 'KILL - No channel found' };
    }

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, monetizationConversion: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (projects.length === 0) {
      return { profitScore: 0, revenuePerView: 0, conversionRate: 0, affiliateCTR: 0, rpm: 0, recommendation: 'NEW CHANNEL - No data yet' };
    }

    let totalViews = 0;
    let totalRevenue = 0;
    let totalConversions = 0;
    let totalAffiliateClicks = 0;
    let totalAffiliateImpressions = 0;

    for (const p of projects) {
      const views = p.analytics?.views || 0;
      totalViews += views;
      totalRevenue += (views / 1000) * 5;

      const convs = p.monetizationConversion || [];
      if (Array.isArray(convs)) {
        for (const c of convs) {
          totalRevenue += c.revenue || 0;
          totalConversions += c.conversions || 0;
          totalAffiliateClicks += c.clicks || 0;
          if (views > 0) totalAffiliateImpressions++;
        }
      }
    }

    const revenuePerView = totalViews > 0 ? totalRevenue / totalViews : 0;
    const conversionRate = totalViews > 0 ? (totalConversions / totalViews) * 100 : 0;
    const affiliateCTR = totalAffiliateImpressions > 0 ? (totalAffiliateClicks / totalAffiliateImpressions) * 100 : 0;
    const rpm = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;

    const profitScore = Math.round(
      (Math.min(100, revenuePerView * 500) * 0.4) +
      (Math.min(100, conversionRate * 20) * 0.3) +
      (Math.min(100, affiliateCTR * 10) * 0.2) +
      (Math.min(100, rpm / 10) * 0.1)
    );

    let recommendation: string;
    if (profitScore >= 80) recommendation = 'SCALE HARD - High profitability';
    else if (profitScore >= 60) recommendation = 'MAINTAIN - Stable income';
    else if (profitScore >= 40) recommendation = 'OPTIMIZE - Improve conversion funnel';
    else if (profitScore >= 20) recommendation = 'REDUCE - Cut losses, pivot niche';
    else recommendation = 'KILL - Not profitable';

    return { profitScore, revenuePerView, conversionRate, affiliateCTR, rpm, recommendation };
  }

  private async detectBestNiche(channelId: string): Promise<string | null> {
    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
    return strategy?.niche || null;
  }

  private async recommendContentType(channelId: string, score: number): Promise<ContentType> {
    if (score >= 80) return 'high-cpm';
    if (score >= 50) return 'long-form';
    if (score >= 30) return 'viral-trend';
    return 'shorts';
  }

  async getChannelPriority(channelId: string): Promise<number> {
    const decision = await this.evaluateChannel(channelId);
    return decision.priority;
  }

  async getOptimizationSuggestions(channelId: string): Promise<string[]> {
    const decision = await this.evaluateChannel(channelId);
    const profit = await this.analyzeChannelProfitability(channelId);
    const suggestions: string[] = [];

    if (decision.ctr < 5) suggestions.push('Improve CTR: Test more thumbnails, stronger titles');
    if (decision.retention < 40) suggestions.push('Boost retention: Shorten hooks, add pattern interrupts');
    if (decision.conversionRate < 5) suggestions.push('Increase conversions: Stronger CTAs, better offers');
    if (profit.rpm < 3) suggestions.push('Low RPM: Target higher CPM niches, increase video length');
    if (decision.growthTrend < 0) suggestions.push('Negative growth: Pivot content strategy, test new formats');

    if (suggestions.length === 0) suggestions.push('Channel performing well — maintain strategy');

    return suggestions;
  }

  async predictFuturePerformance(channelId: string, days = 30): Promise<{
    predictedRevenue: number;
    predictedViews: number;
    predictedGrowth: number;
    confidence: 'high' | 'medium' | 'low';
  }> {
    const decision = await this.evaluateChannel(channelId);
    const uploadsInPeriod = Math.round(decision.recommendedUploadsPerDay * days);
    const avgRevenuePerVideo = decision.revenue / Math.max(1, decision.revenue / 5);
    const predictedRevenue = avgRevenuePerVideo * uploadsInPeriod * (decision.growthTrend > 0 ? 1.2 : 0.8);

    let confidence: 'high' | 'medium' | 'low';
    if (decision.revenue > 100) confidence = 'high';
    else if (decision.revenue > 10) confidence = 'medium';
    else confidence = 'low';

    return {
      predictedRevenue: Math.round(predictedRevenue * 100) / 100,
      predictedViews: Math.round(uploadsInPeriod * 500 * (decision.ctr / 5)),
      predictedGrowth: decision.growthTrend,
      confidence,
    };
  }
}
