import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

const NICHE_RPM: Record<string, number> = {
  'AI News': 8.50, 'Tech Facts': 6.20, 'Business Stories': 12.80, 'Motivation': 3.50,
  'Celebrity Stories': 7.40, 'Horror': 4.80, 'True Crime': 10.20, 'Finance': 15.50,
  'Gaming': 2.80, 'Education': 8.90, 'Entertainment': 3.60, 'Music': 1.80,
  'Sports': 5.20, 'News': 6.50, 'Howto': 9.40, 'Science': 7.80,
  'Travel': 5.50, 'Food': 6.80, 'Fashion': 4.20, 'Health': 8.00,
};

const COUNTRY_CPM: Record<string, number> = {
  'US': 12.00, 'CA': 8.50, 'GB': 9.00, 'AU': 8.00, 'DE': 7.50,
  'FR': 6.00, 'JP': 5.50, 'IN': 1.50, 'BR': 2.00, 'MX': 1.80,
};

const SEASONAL_RPM_MULTIPLIERS: Record<string, number> = {
  'january': 0.85, 'february': 0.80, 'march': 0.90, 'april': 0.95,
  'may': 1.00, 'june': 1.05, 'july': 1.10, 'august': 1.00,
  'september': 0.95, 'october': 1.10, 'november': 1.20, 'december': 1.35,
};

export interface EarningsPrediction {
  nicheRPM: number;
  countryCPM: number;
  seasonalMultiplier: number;
  estimatedViews: number;
  estimatedRPM: number;
  estimatedCPM: number;
  estimatedEarnings: number;
  monthlyProjection: number;
  confidence: number;
  categoryScore: number;
  improvements: string[];
}

export class MonetizationPredictor {
  async predictEarnings(topic: string, niche: string, country = 'US'): Promise<EarningsPrediction> {
    logger.info(`Predicting earnings for topic=${topic}, niche=${niche}`);

    const nicheRPM = this.findNicheRPM(niche);
    const countryCPM = COUNTRY_CPM[country] || 5.0;
    const seasonalMultiplier = this.getSeasonalMultiplier();
    const effectiveRPM = nicheRPM * seasonalMultiplier;

    const projectCount = await prisma.videoProject.count({
      where: { topic: { contains: niche } },
    });

    const estimatedViews = await this.estimateViews(topic, niche, projectCount);
    const estimatedEarnings = (estimatedViews / 1000) * effectiveRPM;
    const monthlyProjection = estimatedEarnings * 30;

    const analysis = await generateWithAI(`
      Predict monetization potential for YouTube content.

      Topic: ${topic}
      Niche: ${niche}
      Niche RPM: $${nicheRPM.toFixed(2)}
      Country CPM: $${countryCPM.toFixed(2)}
      Seasonal multiplier: ${seasonalMultiplier}
      Estimated views per video: ${estimatedViews}

      Return JSON:
      {
        "confidence": 0-100,
        "categoryScore": 0-100 (how profitable is this content category),
        "improvements": ["2-3 ways to increase revenue"]
      }

      Consider:
      - Ad-friendly content suitability
      - Audience demographics
      - Content length impact on RPM
      - Evergreen vs trending value

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      return {
        nicheRPM,
        countryCPM,
        seasonalMultiplier,
        estimatedViews,
        estimatedRPM: effectiveRPM,
        estimatedCPM: countryCPM,
        estimatedEarnings,
        monthlyProjection,
        confidence: Math.min(100, Math.max(0, parsed.confidence || 30)),
        categoryScore: Math.min(100, Math.max(0, parsed.categoryScore || 50)),
        improvements: parsed.improvements || [],
      };
    } catch {
      return {
        nicheRPM, countryCPM, seasonalMultiplier,
        estimatedViews, estimatedRPM: effectiveRPM, estimatedCPM: countryCPM,
        estimatedEarnings, monthlyProjection, confidence: 30, categoryScore: 50, improvements: [],
      };
    }
  }

  private findNicheRPM(niche: string): number {
    for (const [key, rpm] of Object.entries(NICHE_RPM)) {
      if (niche.toLowerCase().includes(key.toLowerCase())) return rpm;
    }
    return 5.0;
  }

  private getSeasonalMultiplier(): number {
    const month = new Date().toLocaleString('en-US', { month: 'long' }).toLowerCase();
    return SEASONAL_RPM_MULTIPLIERS[month] || 1.0;
  }

  private async estimateViews(topic: string, niche: string, projectCount: number): Promise<number> {
    const channelData = await prisma.channelMetrics.findFirst({
      orderBy: { collectedAt: 'desc' },
      where: { topNiche: { contains: niche } },
    });

    if (channelData && channelData.totalVideos > 0) {
      return Math.round(channelData.totalViews / channelData.totalVideos);
    }

    const baseViews = 500;
    const nicheMultiplier = niche === 'Finance' || niche === 'Business' ? 2 : 1;
    const maturityBonus = Math.min(projectCount * 50, 1000);

    return baseViews * nicheMultiplier + maturityBonus;
  }
}
