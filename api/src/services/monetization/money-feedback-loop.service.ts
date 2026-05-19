import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJsonArray } from '../../utils/parse-ai-response';
import { MonetizationAnalytics, MonetizationMetrics } from './monetization-analytics.service';

export interface RevenuePattern {
  topic: string;
  hook: string;
  offerType: string;
  revenuePerView: number;
  totalRevenue: number;
  profit: number;
  conversionRate: number;
  rpm: number;
  confidence: number;
}

export class MoneyFeedbackLoop {
  private monetizationAnalytics: MonetizationAnalytics;

  constructor() {
    this.monetizationAnalytics = new MonetizationAnalytics();
  }

  async identifyTopRevenueVideos(limit = 20): Promise<MonetizationMetrics[]> {
    const projects = await prisma.videoProject.findMany({
      where: {
        uploadHistory: { status: 'published' },
        analytics: { views: { gt: 0 } },
      },
      include: { analytics: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const metricsList: MonetizationMetrics[] = [];
    for (const project of projects) {
      const metrics = await this.monetizationAnalytics.computeVideoMonetization(project.id);
      if (metrics && metrics.totalRevenue > 0) {
        metricsList.push(metrics);
      }
    }

    return metricsList
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
  }

  async extractRevenuePatterns(): Promise<RevenuePattern[]> {
    const topVideos = await this.identifyTopRevenueVideos(20);
    if (topVideos.length === 0) return [];

    const patterns: RevenuePattern[] = [];

    for (const video of topVideos) {
      const project = await prisma.videoProject.findUnique({
        where: { id: video.projectId },
        include: { script: true, monetizationConversion: true },
      });

      if (!project) continue;

      const conversions = project.monetizationConversion || [];
      const primaryOfferType = conversions.length > 0
        ? conversions.sort((a: any, b: any) => b.revenue - a.revenue)[0]?.productId || 'affiliate'
        : 'ad-only';

      patterns.push({
        topic: project.topic,
        hook: project.script?.hook || '',
        offerType: primaryOfferType,
        revenuePerView: video.revenuePerView,
        totalRevenue: video.totalRevenue,
        profit: video.profit,
        conversionRate: video.conversionRate,
        rpm: video.rpm,
        confidence: Math.min(1, video.totalRevenue / 100),
      });
    }

    return patterns.sort((a, b) => b.revenuePerView - a.revenuePerView);
  }

  async getTopRevenueTopics(limit = 5): Promise<{ topic: string; avgRevenuePerView: number; totalRevenue: number; count: number }[]> {
    const patterns = await this.extractRevenuePatterns();
    if (patterns.length === 0) return [];

    const topicMap = new Map<string, { totalRevPerView: number; totalRev: number; count: number }>();
    for (const p of patterns) {
      const existing = topicMap.get(p.topic) || { totalRevPerView: 0, totalRev: 0, count: 0 };
      existing.totalRevPerView += p.revenuePerView;
      existing.totalRev += p.totalRevenue;
      existing.count++;
      topicMap.set(p.topic, existing);
    }

    return Array.from(topicMap.entries())
      .map(([topic, data]) => ({
        topic,
        avgRevenuePerView: Math.round((data.totalRevPerView / data.count) * 100000) / 100000,
        totalRevenue: Math.round(data.totalRev * 100) / 100,
        count: data.count,
      }))
      .sort((a, b) => b.avgRevenuePerView - a.avgRevenuePerView)
      .slice(0, limit);
  }

  async getTopRevenueHookPatterns(limit = 3): Promise<string[]> {
    const patterns = await this.extractRevenuePatterns();
    if (patterns.length === 0) return [];

    const hookMap = new Map<string, { totalRev: number; count: number }>();
    for (const p of patterns) {
      const hookType = p.hook.substring(0, 50);
      const existing = hookMap.get(hookType) || { totalRev: 0, count: 0 };
      existing.totalRev += p.totalRevenue;
      existing.count++;
      hookMap.set(hookType, existing);
    }

    return Array.from(hookMap.entries())
      .map(([hook, data]) => ({ hook, avgRevenue: data.totalRev / data.count }))
      .sort((a, b) => b.avgRevenue - a.avgRevenue)
      .slice(0, limit)
      .map(r => r.hook);
  }

  async getRevenueGenerationGuidance(): Promise<string[]> {
    const [topics, hooks] = await Promise.all([
      this.getTopRevenueTopics(3),
      this.getTopRevenueHookPatterns(3),
    ]);

    const guidance: string[] = [];

    if (topics.length > 0) {
      guidance.push(`💰 PRIORITY TOPICS: ${topics.map(t => `${t.topic} ($${t.avgRevenuePerView}/view, $${t.totalRevenue} total)`).join(' | ')}`);
    }
    if (hooks.length > 0) {
      guidance.push(`🎯 WINNING HOOKS: ${hooks.join(' | ')}`);
    }

    const bestTopic = topics[0];
    if (bestTopic) {
      const response = await generateWithAI(`
        Given that "${bestTopic.topic}" generates $${bestTopic.totalRevenue} in revenue,
        suggest 3 specific, high-monetization video ideas in this space.

        Each idea should have:
        - Clear affiliate or product integration
        - High CPM potential
        - Purchasing intent angle

        Return JSON array of 3 strings.
      `, 'ollama', { temperature: 0.4 });

      try {
        const parsed = extractJsonArray<string>(response);
        if (parsed) guidance.push(...parsed.slice(0, 3));
      } catch {}
    }

    return guidance;
  }

  async enrichPromptWithRevenueData(basePrompt: string): Promise<string> {
    const guidance = await this.getRevenueGenerationGuidance();
    if (guidance.length === 0) return basePrompt;

    const enrichment = `
--- REVENUE OPTIMIZATION GUIDANCE ---
${guidance.map(g => `- ${g}`).join('\n')}

CRITICAL: This content MUST have a monetization path. Include natural opportunities for:
1. Affiliate product recommendations
2. Digital product or course mentions
3. High-CTR CTA that drives to a conversion goal
`;

    return basePrompt + enrichment;
  }
}
