import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson } from '../../utils/parse-ai-response';

export interface CommercialIntentScore {
  topic: string;
  commercialIntentScore: number;
  affiliateCompatibilityScore: number;
  cpmTier: 'low' | 'medium' | 'high' | 'premium';
  estimatedCPM: number;
  hasConversionPath: boolean;
  recommendedOfferType: 'affiliate' | 'digital-product' | 'saas-upsell' | 'ad-only' | 'none';
  meetsThreshold: boolean;
  reasoning: string;
}

const HIGH_CPM_NICHES = [
  'finance', 'insurance', 'business', 'real estate', 'investing', 'crypto',
  'software', 'saas', 'ai tools', 'productivity', 'health', 'wealth',
  'marketing', 'ecommerce', 'courses', 'education',
];

const MEDIUM_CPM_NICHES = [
  'tech', 'science', 'true crime', 'howto', 'self improvement',
  'relationships', 'fitness', 'diet', 'career',
];

const LOW_MONETIZATION_KEYWORDS = [
  'gaming', 'funny moments', 'memes', 'compilation', 'music video',
  'vlog', 'daily life', 'reaction', 'asmr', 'satisfying',
];

export class CommercialContentFilter {
  async evaluateTopic(topic: string, keywords: string[]): Promise<CommercialIntentScore> {
    logger.info(`[CommercialFilter] Evaluating topic: ${topic}`);

    const response = await generateWithAI(`
      Analyze this YouTube topic for MONETIZATION POTENTIAL:

      Topic: "${topic}"
      Keywords: ${keywords.join(', ')}

      Score each dimension 0-100:
      - commercialIntentScore: Does this topic lead to purchasing decisions?
      - affiliateCompatibilityScore: Can affiliate products be naturally integrated?
      - estimatedCPM: Realistic CPM for this niche ($2-$20)

      Return JSON:
      {
        "commercialIntentScore": 0-100,
        "affiliateCompatibilityScore": 0-100,
        "estimatedCPM": number between 2-20,
        "hasConversionPath": true/false,
        "recommendedOfferType": "affiliate" | "digital-product" | "saas-upsell" | "ad-only" | "none",
        "reasoning": "why this topic does/doesn't monetize well"
      }

      Rules:
      - Topics involving purchases, investments, tools, health, business = HIGH commercial intent
      - Topics about entertainment, gossip, daily life = LOW commercial intent
      - If no product/service can be naturally recommended = fails affiliate check
      - CPM should reflect realistic YouTube ad rates for the niche

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(response) as any;

      const commercialIntentScore = this.clampScore(parsed.commercialIntentScore);
      const affiliateCompatibilityScore = this.clampScore(parsed.affiliateCompatibilityScore);
      const estimatedCPM = Math.max(2, Math.min(20, typeof parsed.estimatedCPM === 'number' ? parsed.estimatedCPM : 5));
      const hasConversionPath = parsed.hasConversionPath === true;
      const recommendedOfferType = parsed.recommendedOfferType || 'ad-only';

      const topicLower = topic.toLowerCase();
      let nicheBoost = 0;
      for (const niche of HIGH_CPM_NICHES) {
        if (topicLower.includes(niche)) nicheBoost += 15;
      }
      for (const niche of MEDIUM_CPM_NICHES) {
        if (topicLower.includes(niche)) nicheBoost += 8;
      }
      for (const kw of LOW_MONETIZATION_KEYWORDS) {
        if (topicLower.includes(kw)) nicheBoost -= 20;
      }

      const finalCommercialScore = Math.min(100, Math.max(0, commercialIntentScore + nicheBoost));

      let cpmTier: 'low' | 'medium' | 'high' | 'premium';
      if (estimatedCPM >= 12 || finalCommercialScore >= 80) cpmTier = 'premium';
      else if (estimatedCPM >= 8 || finalCommercialScore >= 60) cpmTier = 'high';
      else if (estimatedCPM >= 5 || finalCommercialScore >= 40) cpmTier = 'medium';
      else cpmTier = 'low';

      const meetsThreshold = finalCommercialScore >= 40 && affiliateCompatibilityScore >= 30 && cpmTier !== 'low';

      return {
        topic,
        commercialIntentScore: finalCommercialScore,
        affiliateCompatibilityScore,
        cpmTier,
        estimatedCPM,
        hasConversionPath,
        recommendedOfferType,
        meetsThreshold,
        reasoning: parsed.reasoning || '',
      };
    } catch {
      const topicLower = topic.toLowerCase();
      const isHighCPM = HIGH_CPM_NICHES.some(n => topicLower.includes(n));
      const isLowMonetization = LOW_MONETIZATION_KEYWORDS.some(k => topicLower.includes(k));

      const baseScore = isHighCPM ? 75 : isLowMonetization ? 20 : 50;
      const cpm = isHighCPM ? 12 : isLowMonetization ? 3 : 6;

      return {
        topic,
        commercialIntentScore: baseScore,
        affiliateCompatibilityScore: isLowMonetization ? 15 : 55,
        cpmTier: isHighCPM ? 'high' : isLowMonetization ? 'low' : 'medium',
        estimatedCPM: cpm,
        hasConversionPath: !isLowMonetization,
        recommendedOfferType: isLowMonetization ? 'ad-only' : 'affiliate',
        meetsThreshold: !isLowMonetization,
        reasoning: isLowMonetization ? 'Low commercial intent topic. Consider a different angle with purchase intent.' : 'Topic has monetization potential with proper offer integration.',
      };
    }
  }

  async gateContent(topic: string, keywords: string[], format?: string): Promise<{
    allowed: boolean;
    score: CommercialIntentScore;
    blockReason?: string;
  }> {
    const score = await this.evaluateTopic(topic, keywords);

    if (!score.meetsThreshold) {
      const reasons: string[] = [];
      if (score.commercialIntentScore < 40) reasons.push('Low commercial intent');
      if (score.affiliateCompatibilityScore < 30) reasons.push('No affiliate product fit');
      if (score.cpmTier === 'low') reasons.push('Low CPM niche');

      return {
        allowed: false,
        score,
        blockReason: `MONETIZATION GATE BLOCKED: ${reasons.join(', ')}. ${score.reasoning}`,
      };
    }

    return { allowed: true, score };
  }

  async getHighCPMTopics(limit = 10): Promise<string[]> {
    return prisma.viralOpportunity.findMany({
      where: { monetizationScore: { gte: 60 } },
      orderBy: { monetizationScore: 'desc' },
      take: limit,
      select: { topic: true },
    }).then(r => r.map(r => r.topic));
  }

  private clampScore(v: any): number {
    return Math.min(100, Math.max(0, typeof v === 'number' ? Math.round(v) : 50));
  }
}
