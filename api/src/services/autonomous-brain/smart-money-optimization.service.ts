import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson } from '../../utils/parse-ai-response';

export interface RevenueOptimizationReport {
  channelId: string;
  channelTitle: string;
  currentRPM: number;
  targetRPM: number;
  currentRevenuePerView: number;
  conversionRate: number;
  affiliateCTR: number;
  profitScore: number;
  recommendations: OptimizationRecommendation[];
}

export interface OptimizationRecommendation {
  area: 'cpm' | 'video-length' | 'cta' | 'affiliate' | 'niche' | 'funnel';
  action: string;
  expectedImpact: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
}

const CPM_BY_NICHE: Record<string, number> = {
  'finance': 12, 'investing': 12, 'crypto': 11, 'business': 10,
  'ai': 9, 'technology': 8, 'software': 8, 'health': 7,
  'education': 6, 'self-improvement': 6, 'fitness': 5.5,
  'lifestyle': 5, 'horror': 4.5, 'entertainment': 4,
  'gaming': 3.5, 'comedy': 3, 'music': 2.5, 'vlog': 2,
};

export class SmartMoneyOptimization {
  async optimizeChannelRevenue(channelId: string): Promise<RevenueOptimizationReport> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const projects = await prisma.videoProject.findMany({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, monetizationConversion: true, monetizationConversionFunnel: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    let totalViews = 0;
    let totalRevenue = 0;
    let totalConversions = 0;
    let totalAffiliateClicks = 0;
    let totalAffiliateImpressions = 0;
    let longFormCount = 0;
    let shortFormCount = 0;

    for (const p of projects) {
      const views = p.analytics?.views || 0;
      totalViews += views;
      totalRevenue += (views / 1000) * 4;

      const convs = p.monetizationConversion || [];
      if (Array.isArray(convs)) {
        for (const c of convs) {
          totalRevenue += c.revenue || 0;
          totalConversions += c.conversions || 0;
          totalAffiliateClicks += c.clicks || 0;
          totalAffiliateImpressions++;
        }
      }

      if (p.format === 'long-form' || !p.format) longFormCount++;
      else shortFormCount++;
    }

    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
    const niche = strategy?.niche || 'general';
    const currentRPM = totalViews > 0 ? (totalRevenue / totalViews) * 1000 : 0;
    const targetRPM = CPM_BY_NICHE[niche] || 4;
    const revenuePerView = totalViews > 0 ? totalRevenue / totalViews : 0;
    const conversionRate = totalViews > 0 ? (totalConversions / totalViews) * 100 : 0;
    const affiliateCTR = totalAffiliateImpressions > 0 ? (totalAffiliateClicks / totalAffiliateImpressions) * 100 : 0;

    const profitScore = Math.round(
      (Math.min(100, revenuePerView * 500) * 0.4) +
      (Math.min(100, conversionRate * 20) * 0.3) +
      (Math.min(100, affiliateCTR * 10) * 0.2) +
      (Math.min(100, currentRPM / 10) * 0.1)
    );

    const recommendations = await this.generateOptimizations(
      niche, currentRPM, targetRPM, conversionRate, affiliateCTR, longFormCount, shortFormCount
    );

    return {
      channelId,
      channelTitle: channel.channelTitle || 'Unknown',
      currentRPM: Math.round(currentRPM * 100) / 100,
      targetRPM,
      currentRevenuePerView: Math.round(revenuePerView * 10000) / 10000,
      conversionRate: Math.round(conversionRate * 100) / 100,
      affiliateCTR: Math.round(affiliateCTR * 100) / 100,
      profitScore,
      recommendations,
    };
  }

  async optimizeForHighCPM(niche: string): Promise<{
    recommendedNiche: string;
    cpmGain: number;
    contentStrategy: string[];
  }> {
    const currentCPM = CPM_BY_NICHE[niche] || 4;
    const highCPMNiches = Object.entries(CPM_BY_NICHE)
      .filter(([, cpm]) => cpm > currentCPM)
      .sort(([, a], [, b]) => b - a);

    if (highCPMNiches.length === 0) {
      return {
        recommendedNiche: niche,
        cpmGain: 0,
        contentStrategy: [`Continue with ${niche} content`],
      };
    }

    const bestNiche = highCPMNiches[0];
    const cpmGain = bestNiche[1] - currentCPM;

    const prompt = `I have a YouTube channel in the "${niche}" niche (CPM: $${currentCPM}).
Suggest a content strategy to transition into "${bestNiche[0]}" niche (CPM: $${bestNiche[1]}) for higher revenue.

Return JSON array of 3 content strategy ideas:
["idea 1", "idea 2", "idea 3"]`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.6 });
    let contentStrategy: string[] = [];
    try {
      const parsed = JSON.parse(response.trim());
      if (Array.isArray(parsed)) contentStrategy = parsed;
    } catch {
      contentStrategy = [
        `Create content bridging ${niche} and ${bestNiche[0]}`,
        `Focus on ${bestNiche[0]} topics with high CPM keywords`,
        `Optimize video titles for ${bestNiche[0]} search terms`,
      ];
    }

    return {
      recommendedNiche: bestNiche[0],
      cpmGain: Math.round(cpmGain * 100) / 100,
      contentStrategy,
    };
  }

  async increaseVideoLength(channelId: string): Promise<{ recommendation: string; targetLength: string }> {
    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });

    const currentDuration = strategy?.avgDuration || '8-10min';

    const prompt = `A YouTube channel currently creates videos of length "${currentDuration}".
The RPM is low and increasing video length could help.

Recommend the optimal video length that maximizes RPM while maintaining retention.

Return JSON:
{
  "recommendation": "detailed explanation",
  "targetLength": "recommended length (e.g. 10-12min)"
}`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
    const result = extractJson<{ recommendation: string; targetLength: string }>(response);

    return result || {
      recommendation: `Increase from ${currentDuration} to 10-12 minutes for better ad placement and RPM`,
      targetLength: '10-12min',
    };
  }

  async optimizeCTA(channelId: string): Promise<{
    currentCTR: number;
    recommendedCTA: string;
    expectedImprovement: number;
  }> {
    const project = await prisma.videoProject.findFirst({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true, transcriptIntelligence: true },
      orderBy: { createdAt: 'desc' },
    });

    const currentCTR = project?.analytics?.ctr || 0;
    const currentCTA = project?.transcriptIntelligence?.detectedCTAs?.[0] || 'No CTA detected';

    const prompt = `A YouTube video has CTR of ${currentCTR}% and CTA "${currentCTA}".

Suggest a stronger CTA that will increase conversion.
The new CTA must be specific, urgent, and benefit-driven.

Return JSON:
{
  "recommendedCTA": "new CTA text",
  "expectedImprovement": 25
}`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
    const result = extractJson<{ recommendedCTA: string; expectedImprovement: number }>(response);

    return {
      currentCTR,
      recommendedCTA: result?.recommendedCTA || 'Click the link in the description to get the free resource that will transform your results',
      expectedImprovement: result?.expectedImprovement || 20,
    };
  }

  async replaceLowPerformingOffers(channelId: string): Promise<{
    replaced: string[];
    newOffers: string[];
  }> {
    const conversions = await prisma.monetizationConversion.findMany({
      where: { project: { channelId } },
      orderBy: { conversionRate: 'asc' },
      take: 5,
    });

    const replaced: string[] = [];
    const newOffers: string[] = [];

    for (const conv of conversions) {
      if (conv.conversionRate < 0.01) {
        replaced.push(conv.productId);

        const prompt = `The affiliate offer "${conv.productId}" has a very low conversion rate (${(conv.conversionRate * 100).toFixed(2)}%).

Suggest a replacement offer that would perform better. Return a JSON object:
{
  "newOffer": "product or service name",
  "reason": "why this will convert better"
}`;

        const response = await generateWithAI(prompt, 'ollama', { temperature: 0.6 });
        const result = extractJson<{ newOffer: string }>(response);
        if (result) newOffers.push(result.newOffer);
      }
    }

    return { replaced, newOffers };
  }

  async getGlobalOptimizationReport(): Promise<{
    totalPotentialRevenueGain: number;
    channelsOptimized: number;
    averageProfitScore: number;
    topRecommendations: string[];
  }> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const reports = await Promise.allSettled(
      channels.map(c => this.optimizeChannelRevenue(c.channelId))
    );

    const successfulReports = reports.filter(
      (r): r is PromiseFulfilledResult<RevenueOptimizationReport> => r.status === 'fulfilled'
    ).map(r => r.value);

    const totalGain = successfulReports.reduce((s, r) => {
      const rpmGap = r.targetRPM - r.currentRPM;
      return s + (rpmGap > 0 ? rpmGap * 100 : 0);
    }, 0);

    const avgProfitScore = successfulReports.length > 0
      ? successfulReports.reduce((s, r) => s + r.profitScore, 0) / successfulReports.length
      : 0;

    const allRecs = successfulReports.flatMap(r => r.recommendations);
    const priorityRecs = allRecs
      .filter(r => r.priority === 'critical' || r.priority === 'high')
      .map(r => r.action)
      .slice(0, 5);

    return {
      totalPotentialRevenueGain: Math.round(totalGain * 100) / 100,
      channelsOptimized: successfulReports.length,
      averageProfitScore: Math.round(avgProfitScore * 100) / 100,
      topRecommendations: priorityRecs,
    };
  }

  private async generateOptimizations(
    niche: string,
    currentRPM: number,
    targetRPM: number,
    conversionRate: number,
    affiliateCTR: number,
    longFormCount: number,
    shortFormCount: number
  ): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];

    if (currentRPM < targetRPM) {
      recommendations.push({
        area: 'cpm',
        action: `Shift content toward higher CPM topics within ${niche}. Target RPM: $${targetRPM}`,
        expectedImpact: `RPM increase of $${(targetRPM - currentRPM).toFixed(2)}`,
        priority: 'high',
        effort: 'medium',
      });
    }

    if (shortFormCount > longFormCount && niche !== 'entertainment') {
      recommendations.push({
        area: 'video-length',
        action: 'Increase long-form video ratio. Long-form videos earn 3-5x more ad revenue per view.',
        expectedImpact: '3-5x increase in ad revenue per view',
        priority: 'high',
        effort: 'medium',
      });
    }

    if (conversionRate < 5) {
      recommendations.push({
        area: 'cta',
        action: 'Inject stronger CTAs. Add time-limited offers and scarcity triggers.',
        expectedImpact: `${(5 - conversionRate).toFixed(1)}% conversion rate improvement`,
        priority: 'critical',
        effort: 'low',
      });
    }

    if (affiliateCTR < 3) {
      recommendations.push({
        area: 'affiliate',
        action: 'Replace low-CTR affiliate links. Test higher-commission products with better alignment.',
        expectedImpact: `${(3 - affiliateCTR).toFixed(1)}% affiliate CTR improvement`,
        priority: 'medium',
        effort: 'low',
      });
    }

    if (currentRPM < 5) {
      const cpmSuggestion = await this.optimizeForHighCPM(niche);
      if (cpmSuggestion.cpmGain > 0) {
        recommendations.push({
          area: 'niche',
          action: `Pivot to higher CPM niche: ${cpmSuggestion.recommendedNiche}. ${cpmSuggestion.contentStrategy[0]}`,
          expectedImpact: `CPM gain of $${cpmSuggestion.cpmGain.toFixed(2)} per 1000 views`,
          priority: 'medium',
          effort: 'high',
        });
      }
    }

    if (recommendations.length === 0) {
      recommendations.push({
        area: 'funnel',
        action: 'Implement multi-step funnel: video → landing page → email capture → upsell',
        expectedImpact: '2-3x revenue increase through funnel optimization',
        priority: 'medium',
        effort: 'high',
      });
    }

    return recommendations;
  }
}
