import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

interface RevenueStrategy {
  estimatedRPM: number;
  affiliateProducts: AffiliateSuggestion[];
  optimalAdBreaks: number[];
  ctaTiming: number;
  descriptionScore: number;
  improvements: string[];
}

interface AffiliateSuggestion {
  product: string;
  url: string;
  category: string;
  commission: number;
  placementDescription: string;
  expectedCTR: number;
}

export class RevenueOptimizationEngine {
  async optimizeForRevenue(
    topic: string,
    niche: string,
    scriptContent: string,
    description: string
  ): Promise<RevenueStrategy> {
    logger.info(`[RevenueOpt] Optimizing revenue for: "${topic}"`);

    const affiliates = await this.suggestAffiliates(topic, niche);
    const rpm = this.estimateRPM(niche);
    const adBreaks = this.calculateOptimalAdBreaks(scriptContent);
    const ctaTiming = this.findBestCTATiming(scriptContent);

    const response = await generateWithAI(`
      Evaluate and improve this YouTube description for MAXIMUM REVENUE.

      Niche: "${niche}"
      Topic: "${topic}"
      Current description:
      "${description.substring(0, 1000)}"

      Available affiliate products:
      ${affiliates.map((a, i) => `${i + 1}. ${a.product} (${a.category}, ${a.commission}%)`).join('\n')}

      Provide:
      - descriptionScore: 0-100 rating
      - improvements: specific changes to increase affiliate clicks and ad revenue
      - optimal affiliate placement in description

      Return JSON:
      { "descriptionScore": 0, "improvements": [""], "optimalAffiliatePlacement": "" }
    `, 'ollama', { temperature: 0.4 });

    let improvements: string[] = ['Add affiliate links in first 3 lines of description'];
    let descriptionScore = 50;

    try {
      const parsed = JSON.parse(response);
      improvements = parsed.improvements || improvements;
      descriptionScore = parsed.descriptionScore || 50;
    } catch {}

    return {
      estimatedRPM: rpm,
      affiliateProducts: affiliates,
      optimalAdBreaks: adBreaks,
      ctaTiming,
      descriptionScore,
      improvements,
    };
  }

  async optimizeDescription(description: string, strategy: RevenueStrategy): Promise<string> {
    let optimized = description;

    const affiliateBlock = strategy.affiliateProducts.length > 0
      ? `\n\n📚 Resources & Tools:\n${strategy.affiliateProducts.slice(0, 3).map((a, i) =>
        `${i + 1}. ${a.product} — ${a.url}\n   "${a.placementDescription}"`
      ).join('\n\n')}`
      : '';

    const ctaBlock = `\n\n💬 What do you think? Drop your theory in the comments.\n🔔 Subscribe for more — new videos every week.`;

    optimized = `${affiliateBlock}\n\n${optimized}\n${ctaBlock}`;

    for (const imp of strategy.improvements) {
      if (imp.toLowerCase().includes('timing') || imp.toLowerCase().includes('early')) {
        optimized = `📌 Pinned comment: Check the description for resources mentioned in this video 👆\n\n${optimized}`;
      }
      if (imp.toLowerCase().includes('tag')) {
        optimized += `\n\n#${strategy.estimatedRPM > 8 ? 'truecrime' : 'horror'} #mystery #documentary #scary`;
      }
    }

    return optimized;
  }

  async trackAffiliateClick(projectId: string, productName: string): Promise<void> {
    try {
      const existing = await prisma.monetizationConversion.findFirst({
        where: { projectId },
      }).catch(() => null);

      if (existing) {
        await prisma.monetizationConversion.update({
          where: { id: existing.id },
          data: { clicks: { increment: 1 } },
        }).catch(() => {});
      }
    } catch {}
  }

  async getRevenueReport(userId: string): Promise<{
    totalEstimatedRevenue: number;
    topPerformingProducts: string[];
    bestCTATiming: number;
    nicheRPMs: Record<string, number>;
    recommendations: string[];
  }> {
    const accounts = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    let totalRevenue = 0;
    const nicheRPMs: Record<string, number> = {};

    for (const acc of accounts) {
      const uploads = await prisma.uploadHistory.findMany({
        where: { channelId: acc.channelId },
        include: { project: { include: { analytics: true } } },
      });

      for (const u of uploads) {
        if (!u.project?.analytics) continue;
        const rpm = this.estimateRPM(u.project.topic);
        const revenue = (u.project.analytics.watchTime || 0) * (rpm / 1000);
        totalRevenue += revenue;

        const niche = acc.channelTitle?.split(' ').slice(-1)[0] || 'horror';
        nicheRPMs[niche] = rpm;
      }
    }

    return {
      totalEstimatedRevenue: Math.round(totalRevenue * 100) / 100,
      topPerformingProducts: ['Recommended Books', 'Security Equipment', 'Streaming Subscriptions'],
      bestCTATiming: 180,
      nicheRPMs,
      recommendations: [
        totalRevenue < 50 ? 'Focus on high-RPM niches (true crime: $12.50 RPM)' : 'Revenue tracking active',
        'Add affiliate links to all video descriptions',
        'Pin comment with engagement CTA + resource link',
      ],
    };
  }

  private async suggestAffiliates(topic: string, niche: string): Promise<AffiliateSuggestion[]> {
    const response = await generateWithAI(`
      Suggest 5 affiliate products for a YouTube video about "${topic}" in "${niche}" niche.
      Focus on high-commission products that match the content.

      For each: product name, category, commission rate (0-30%), Amazon URL, placement description, expected CTR (0-100).

      Return as JSON array with keys: product, url, category, commission, placementDescription, expectedCTR
      Make URLs realistic Amazon affiliate links with tag=yourchannel-20
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJsonArray<any>(response);
      if (parsed?.length) return parsed.map(p => ({
        product: p.product || 'Recommended Product',
        url: p.url || `https://amazon.com/s?k=${niche}`,
        category: p.category || 'General',
        commission: p.commission || 8,
        placementDescription: p.placementDescription || `Product mentioned in ${niche} video`,
        expectedCTR: p.expectedCTR || 5,
      }));
    } catch {}

    return [
      { product: `${niche} Book Collection`, url: `https://amazon.com/s?k=${niche}+books&tag=yourchannel-20`, category: 'books', commission: 8, placementDescription: 'Books referenced in the video', expectedCTR: 12 },
      { product: 'Home Security Camera', url: 'https://amazon.com/s?k=home+security+camera&tag=yourchannel-20', category: 'security', commission: 10, placementDescription: 'Security footage analysis tool', expectedCTR: 8 },
      { product: 'Streaming Subscription', url: 'https://amazon.com/s?k=streaming+documentaries&tag=yourchannel-20', category: 'streaming', commission: 15, placementDescription: 'Where to watch similar content', expectedCTR: 10 },
    ];
  }

  private estimateRPM(niche: string): number {
    const rpmMap: Record<string, number> = {
      'true crime': 12.50, 'paranormal': 8.75, 'horror': 7.20,
      'unsolved mysteries': 10.30, 'conspiracy': 9.80,
    };
    return rpmMap[niche.toLowerCase()] || 6.0;
  }

  private calculateOptimalAdBreaks(script: string): number[] {
    const wordCount = script.split(/\s+/).length;
    const estimatedMinutes = Math.ceil(wordCount / 150);
    if (estimatedMinutes <= 8) return [240, 480];
    if (estimatedMinutes <= 12) return [180, 420, 660];
    return [120, 300, 480, 660, 840];
  }

  private findBestCTATiming(script: string): number {
    const lines = script.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes('subscribe') || lines[i].toLowerCase().includes('check out')) {
        return Math.max(120, i * 12);
      }
    }
    return 180;
  }
}
