import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { generateWithAI } from './ai.service';
import { MonetizationPredictor } from './monetization-predictor.service';
import { CommercialContentFilter } from './monetization/commercial-content-filter.service';
import { SmartAffiliateEngine } from './monetization/smart-affiliate-engine.service';
import { MoneyFeedbackLoop } from './monetization/money-feedback-loop.service';
import type { RevenueReport, RevenueForecast, ProfitabilityTier, RevenueStreamEstimate, ForecastSubScore, ProfitabilitySubScore, MultiStreamSubScore } from './revenue-optimization.types';

const US_TRAFFIC_MULTIPLIER = 1.5;
const NICHE_RPM_MULTIPLIERS: Record<string, number> = {
  finance: 2.0, ai: 2.0, 'artificial intelligence': 2.0, saas: 2.0,
  software: 1.8, business: 1.6, investing: 2.0, 'real estate': 1.6,
  tech: 1.4, productivity: 1.3, marketing: 1.4, crypto: 1.8,
  education: 1.2, health: 1.2,
};

const PROFITABILITY_THRESHOLDS = [
  { minScore: 85, tier: 'viral-cash-machine' as ProfitabilityTier, label: '🔥 VIRAL CASH MACHINE' },
  { minScore: 70, tier: 'high-profit' as ProfitabilityTier, label: '💰 HIGH PROFIT' },
  { minScore: 55, tier: 'profitable' as ProfitabilityTier, label: '✅ PROFITABLE' },
  { minScore: 35, tier: 'break-even' as ProfitabilityTier, label: '➖ BREAK-EVEN' },
  { minScore: 0, tier: 'loss' as ProfitabilityTier, label: '❌ LOSS' },
];

export class RevenueOptimizationService {
  private monetizationPredictor: MonetizationPredictor;
  private commercialFilter: CommercialContentFilter;
  private affiliateEngine: SmartAffiliateEngine;
  private moneyFeedback: MoneyFeedbackLoop;

  constructor() {
    this.monetizationPredictor = new MonetizationPredictor();
    this.commercialFilter = new CommercialContentFilter();
    this.affiliateEngine = new SmartAffiliateEngine();
    this.moneyFeedback = new MoneyFeedbackLoop();
  }

  async evaluateTopic(topic: string, keywords: string[] = [], niche?: string): Promise<RevenueReport> {
    logger.info(`[RevenueOptimization] Evaluating "${topic}" for revenue potential`);

    const [forecast, profitability, affiliateProducts] = await Promise.all([
      this.forecastRevenue(topic, niche),
      this.evaluateProfitability(topic, keywords),
      this.findAffiliateProducts(topic, keywords),
    ]);

    const usMultiplier = this.computeUsRevenueMultiplier(topic);

    // Multi-stream income potentials
    const adsenseRevenue = this.estimateAdsenseRevenue(forecast);
    const affiliateRevenue = this.estimateAffiliateRevenue(forecast, affiliateProducts, profitability);

    // Total monetization score: weighted combination
    const totalMonetizationScore = Math.round(
      forecast.confidence * 0.25 +
      profitability.score * 0.30 +
      usMultiplier * 0.15 +
      adsenseRevenue.confidence * 0.15 +
      affiliateRevenue.confidence * 0.15
    );

    const decision = totalMonetizationScore >= 70 ? 'APPROVE'
      : totalMonetizationScore >= 55 ? 'OPTIMIZE'
      : 'REJECT';

    const optimizationSuggestions = this.generateOptimizationSuggestions(
      totalMonetizationScore, forecast, profitability, usMultiplier, affiliateProducts,
    );

    const report: RevenueReport = {
      topic,
      revenueForecast: forecast,
      profitabilityTier: profitability.tier,
      usRevenueMultiplier: usMultiplier,
      adsenseRevenue,
      affiliateRevenue,
      totalMonetizationScore,
      decision,
      optimizationSuggestions,
      subScores: {
        forecast: { score: Math.round(forecast.confidence), expectedViews: Math.round(forecast.expectedEstimate * 1000), rpm: forecast.breakdown.adsense > 0 ? Math.round((forecast.expectedEstimate / (forecast.expectedEstimate * 1000)) * 1000 * 100) / 100 : 0, affiliateConversionProb: affiliateRevenue.confidence, retentionImpact: 50 },
        profitability: { score: profitability.score, tier: profitability.tier, rpmTier: this.rpmTierLabel(forecast), ctrTier: 'medium' },
        multiStream: { score: totalMonetizationScore, adsenseFit: Math.round(adsenseRevenue.confidence * 100), affiliateFit: Math.round(affiliateRevenue.confidence * 100), externalFit: 40 },
      },
    };

    // Persist prediction log
    await this.savePredictionLog(report, keywords)
      .catch(e => logger.warn(`[RevenueOptimization] Failed to save prediction log: ${e.message}`));

    logger.info(`[RevenueOptimization] ${topic} → tier=${profitability.tier} score=${totalMonetizationScore} decision=${decision}`);
    return report;
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 1: REVENUE FORECAST ENGINE
  // ────────────────────────────────────────────────────────────

  private async forecastRevenue(topic: string, niche?: string): Promise<RevenueForecast> {
    try {
      const prediction = await this.monetizationPredictor.predictEarnings(topic, niche || 'general', 'US');

      const expectedViews = prediction.estimatedViews || 10000;
      const rpm = prediction.estimatedRPM || 5;
      const adsenseRevenue = (expectedViews / 1000) * rpm;

      // Affiliate: based on commercial intent and average conversion
      const affiliatePerView = 0.002 * prediction.categoryScore; // $ per view based on category score
      const affiliateRevenue = expectedViews * affiliatePerView;

      // External funnel (email, courses, etc.) — 10-20% of adsense for most niches
      const externalRevenue = adsenseRevenue * 0.15;

      const total = adsenseRevenue + affiliateRevenue + externalRevenue;

      return {
        minEstimate: Math.round(total * 0.6 * 100) / 100,
        maxEstimate: Math.round(total * 1.5 * 100) / 100,
        expectedEstimate: Math.round(total * 100) / 100,
        confidence: prediction.confidence,
        breakdown: {
          adsense: Math.round(adsenseRevenue * 100) / 100,
          affiliate: Math.round(affiliateRevenue * 100) / 100,
          external: Math.round(externalRevenue * 100) / 100,
        },
      };
    } catch (err: any) {
      logger.warn(`[RevenueOptimization] Forecast AI failed, using fallback: ${err.message}`);

      // Fallback: keyword-based estimate
      const baseViews = topic.length < 30 ? 8000 : 15000;
      const rpm = this.fallbackRpm(topic);
      const adsenseRevenue = (baseViews / 1000) * rpm;
      const affiliateRevenue = baseViews * 0.001;

      return {
        minEstimate: Math.round(adsenseRevenue * 0.5 * 100) / 100,
        maxEstimate: Math.round((adsenseRevenue + affiliateRevenue) * 1.5 * 100) / 100,
        expectedEstimate: Math.round((adsenseRevenue + affiliateRevenue) * 100) / 100,
        confidence: 40,
        breakdown: {
          adsense: Math.round(adsenseRevenue * 100) / 100,
          affiliate: Math.round(affiliateRevenue * 100) / 100,
          external: 0,
        },
      };
    }
  }

  private fallbackRpm(topic: string): number {
    const lower = topic.toLowerCase();
    if (/\b(finance|invest|money|wealth|real estate|insurance)\b/.test(lower)) return 12;
    if (/\b(ai|artificial intelligence|software|saas|tech)\b/.test(lower)) return 8;
    if (/\b(business|entrepreneur|marketing|ecommerce)\b/.test(lower)) return 7;
    if (/\b(education|how to|guide|tutorial|course)\b/.test(lower)) return 5;
    if (/\b(health|fitness|diet|nutrition)\b/.test(lower)) return 4;
    return 3;
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 2: CONTENT PROFITABILITY FILTER
  // ────────────────────────────────────────────────────────────

  private async evaluateProfitability(topic: string, keywords: string[]): Promise<ProfitabilitySubScore> {
    let score = 50;
    let rpmScore = 50;
    let ctrScore = 50;

    try {
      const commercial = await this.commercialFilter.evaluateTopic(topic, keywords);

      // Base score from commercial filter
      score = commercial.commercialIntentScore;
      rpmScore = this.cpmToProfitScore(commercial.estimatedCPM);

      if (commercial.cpmTier === 'premium') { score += 20; rpmScore += 20; }
      if (commercial.cpmTier === 'high') { score += 10; rpmScore += 10; }
      if (commercial.cpmTier === 'low') { score -= 20; rpmScore -= 20; }

      if (commercial.recommendedOfferType === 'none') score -= 15;
      if (commercial.recommendedOfferType === 'saas-upsell' || commercial.recommendedOfferType === 'affiliate') score += 10;
    } catch { /* use keyword-based */ }

    // Keyword boosters
    const lower = topic.toLowerCase();
    if (/\b(best|top|review|comparison|vs|alternative|discount|coupon|deal|save|cheap|affordable)\b/.test(lower)) { score += 10; ctrScore += 10; }
    if (/\b(how to|guide|tutorial|step by step|beginner)\b/.test(lower)) { score += 5; ctrScore += 5; }
    if (/\b(2026|this year|new|latest|updated)\b/.test(lower)) { score += 5; }

    // Affiliate opportunity check
    const matchedKeywords = AFFILIATE_KEYWORDS.filter(k => lower.includes(k));
    if (matchedKeywords.length > 0) { score += matchedKeywords.length * 5; }

    score = Math.min(100, Math.max(0, score));
    rpmScore = Math.min(100, Math.max(0, rpmScore));
    ctrScore = Math.min(100, Math.max(0, ctrScore));

    // Determine tier
    const combined = Math.round(score * 0.5 + rpmScore * 0.3 + ctrScore * 0.2);
    const tier = PROFITABILITY_THRESHOLDS.find(t => combined >= t.minScore)?.tier || 'loss';

    return { score: combined, tier, rpmTier: this.rpmTierLabel({ breakdown: { adsense: score, affiliate: 0, external: 0 }, expectedEstimate: score, confidence: 50, minEstimate: 0, maxEstimate: 0 }), ctrTier: 'medium' };
  }

  private cpmToProfitScore(cpm: number): number {
    if (cpm >= 14) return 90;
    if (cpm >= 10) return 70;
    if (cpm >= 6) return 50;
    if (cpm >= 3) return 30;
    return 15;
  }

  private rpmTierLabel(forecast: RevenueForecast): string {
    const adsense = forecast.breakdown.adsense;
    if (adsense > 50) return 'premium';
    if (adsense > 20) return 'high';
    if (adsense > 10) return 'medium';
    return 'low';
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 3: US MONETIZATION WEIGHTING
  // ────────────────────────────────────────────────────────────

  private computeUsRevenueMultiplier(topic: string): number {
    const lower = topic.toLowerCase();
    let multiplier = US_TRAFFIC_MULTIPLIER; // baseline 1.5x for US traffic

    // Niche RPM multiplier
    for (const [niche, rpmMult] of Object.entries(NICHE_RPM_MULTIPLIERS)) {
      if (lower.includes(niche)) {
        multiplier = Math.max(multiplier, US_TRAFFIC_MULTIPLIER * rpmMult);
      }
    }

    return Math.round(multiplier * 100) / 100;
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 4: MULTI-STREAM INCOME ENGINE
  // ────────────────────────────────────────────────────────────

  private async findAffiliateProducts(topic: string, keywords: string[]): Promise<{ hasProducts: boolean; count: number; maxCommission: number }> {
    try {
      const products = await this.affiliateEngine.selectProductsForVideo(topic, keywords).catch(() => []);
      const maxCommission = products.reduce((max: number, p: { commission?: number }) => Math.max(max, p.commission || 0), 0);
      return { hasProducts: products.length > 0, count: products.length, maxCommission };
    } catch {
      return { hasProducts: false, count: 0, maxCommission: 0 };
    }
  }

  private estimateAdsenseRevenue(forecast: RevenueForecast): RevenueStreamEstimate {
    const adsense = forecast.breakdown.adsense;
    const confidence = forecast.confidence >= 70 ? 0.8 : forecast.confidence >= 50 ? 0.6 : 0.4;

    const factors: string[] = [];
    if (adsense > 20) factors.push('Strong ad revenue potential from US traffic');
    else if (adsense > 10) factors.push('Moderate ad revenue — optimize for longer watch time');
    else factors.push('Low ad revenue — consider affiliate-first strategy');

    return { potential: adsense, confidence, factors };
  }

  private estimateAffiliateRevenue(forecast: RevenueForecast, products: { hasProducts: boolean; count: number; maxCommission: number }, profitability: ProfitabilitySubScore): RevenueStreamEstimate {
    const baseAffiliate = forecast.breakdown.affiliate;

    if (!products.hasProducts) {
      return { potential: 0, confidence: 0.1, factors: ['No matching affiliate products found for this topic'] };
    }

    const commissionBoost = Math.min(2, products.maxCommission / 5);
    const potential = Math.round(baseAffiliate * commissionBoost * 100) / 100;
    const confidence = Math.min(0.9, 0.3 + (products.count * 0.05) + (profitability.score / 200));

    const factors: string[] = [`${products.count} matching affiliate products found`];
    if (products.maxCommission >= 8) factors.push(`High commission potential (up to $${products.maxCommission}/sale)`);
    factors.push('Top 3 description links + pinned comment CTA recommended');

    return { potential, confidence, factors };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 5: PERFORMANCE FEEDBACK LOOP
  // ────────────────────────────────────────────────────────────

  async learnFromPerformance(projectId: string): Promise<void> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: projectId },
        include: { analytics: true, uploadHistory: true, monetizationConversion: true },
      });

      if (!project) {
        logger.warn(`[RevenueOptimization] No project found for ${projectId}`);
        return;
      }

      // Find prediction log
      const predictionLog = await prisma.revenuePredictionLog.findFirst({
        where: { projectId, topic: project.topic },
        orderBy: { createdAt: 'desc' },
      });

      if (!predictionLog) {
        logger.warn(`[RevenueOptimization] No prediction log for ${projectId}`);
        return;
      }

      // Calculate actual revenue
      const views = project.analytics?.views || 0;
      const rpm = predictionLog.revenueForecastExp > 0 && predictionLog.revenueForecastExp > 0
        ? (predictionLog.revenueForecastExp / (predictionLog.revenueForecastExp * 1000)) * 1000
        : 5;
      const actualAdsense = (views / 1000) * rpm;

      const conversions = project.monetizationConversion || [];
      const actualAffiliate = conversions.reduce((sum, c: any) => sum + (c.revenue || 0), 0);
      const actualRevenue = actualAdsense + actualAffiliate;

      // Compute error
      const forecastError = predictionLog.revenueForecastExp > 0
        ? ((actualRevenue - predictionLog.revenueForecastExp) / predictionLog.revenueForecastExp) * 100
        : 0;

      // Update prediction log
      await prisma.revenuePredictionLog.update({
        where: { id: predictionLog.id },
        data: {
          actualRevenue,
          actualAdsense,
          actualAffiliate,
          revenueError: forecastError,
        },
      });

      // Run existing money feedback loop
      await this.moneyFeedback.extractRevenuePatterns().catch(() => {});

      logger.info(`[RevenueOptimization] Feedback for ${projectId}: forecast=$${predictionLog.revenueForecastExp} actual=$${Math.round(actualRevenue * 100) / 100} error=${Math.round(forecastError)}%`);
    } catch (err: any) {
      logger.error(`[RevenueOptimization] Feedback loop failed for ${projectId}: ${err.message}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 6: AUTONOMOUS DECISION ENGINE
  // ────────────────────────────────────────────────────────────

  private generateOptimizationSuggestions(
    score: number, forecast: RevenueForecast, profitability: ProfitabilitySubScore,
    usMultiplier: number, products: { hasProducts: boolean; count: number; maxCommission: number },
  ): string[] {
    const suggestions: string[] = [];

    if (score < 55) {
      suggestions.push('BLOCKED: Revenue score below threshold. Choose a topic with higher commercial intent.');
    }

    if (profitability.tier === 'loss' || profitability.tier === 'break-even') {
      suggestions.push('Reframe topic toward high-CPM angle (AI, finance, or business-related subtopic)');
    }

    if (forecast.breakdown.adsense < 10) {
      suggestions.push('Target longer watch time (8-12 min) to increase ad revenue per view');
    }

    if (forecast.breakdown.affiliate < 5) {
      if (products.hasProducts) {
        suggestions.push('Integrate affiliate offers naturally — include comparison table or honest review');
        suggestions.push('Place top affiliate link in pinned comment + description line 1-2');
      } else {
        suggestions.push('No affiliate products found. Consider adding a "tool" or "software" angle to unlock affiliate revenue');
      }
    }

    if (usMultiplier < 2.0) {
      suggestions.push('Increase US relevance — use US examples, USD pricing, and American references to boost RPM');
    }

    if (score > 85) {
      suggestions.push('SCALE READY: This topic has strong revenue potential. Plan 3-5 variations for batch production');
    }

    if (score >= 70 && score <= 85) {
      suggestions.push('OPTIMIZE OPPORTUNITY: Improve hooks and affiliate placement to push into HIGH PROFIT tier');
    }

    if (!products.hasProducts && forecast.breakdown.adsense > 15) {
      suggestions.push('High ad revenue niche — even without affiliates this is profitable. Add a digital product angle for extra income');
    }

    return suggestions;
  }

  // ────────────────────────────────────────────────────────────
  //  PERSISTENCE
  // ────────────────────────────────────────────────────────────

  private async savePredictionLog(report: RevenueReport, keywords: string[]): Promise<void> {
    await prisma.revenuePredictionLog.create({
      data: {
        topic: report.topic,
        profitabilityTier: report.profitabilityTier,
        revenueForecastMin: report.revenueForecast.minEstimate,
        revenueForecastMax: report.revenueForecast.maxEstimate,
        revenueForecastExp: report.revenueForecast.expectedEstimate,
        forecastConfidence: report.revenueForecast.confidence,
        usRevenueMultiplier: report.usRevenueMultiplier,
        adsensePotential: report.adsenseRevenue.potential,
        affiliatePotential: report.affiliateRevenue.potential,
        totalMonetizationScore: report.totalMonetizationScore,
        decision: report.decision,
        metadata: { keywords, suggestions: report.optimizationSuggestions },
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  //  PUBLIC HELPERS
  // ────────────────────────────────────────────────────────────

  async getTopRevenueOpportunities(limit = 10): Promise<{ topic: string; score: number; tier: string }[]> {
    try {
      return await prisma.revenuePredictionLog.findMany({
        where: { totalMonetizationScore: { gte: 70 } },
        orderBy: { totalMonetizationScore: 'desc' },
        take: limit,
        select: { topic: true, totalMonetizationScore: true, profitabilityTier: true },
      }).then(rows => rows.map(r => ({ topic: r.topic, score: r.totalMonetizationScore, tier: r.profitabilityTier })));
    } catch {
      return [];
    }
  }

  async getRevenuePredictionAccuracy(): Promise<{ avgError: number; totalPredictions: number; totalRevenue: number }> {
    try {
      const logs = await prisma.revenuePredictionLog.findMany({
        where: { actualRevenue: { gt: 0 } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      if (logs.length === 0) return { avgError: 0, totalPredictions: 0, totalRevenue: 0 };

      const errors = logs.filter(l => l.revenueError !== null).map(l => Math.abs(l.revenueError || 0));
      const avgError = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
      const totalRevenue = logs.reduce((sum, l) => sum + (l.actualRevenue || 0), 0);

      return { avgError, totalPredictions: logs.length, totalRevenue: Math.round(totalRevenue * 100) / 100 };
    } catch {
      return { avgError: 0, totalPredictions: 0, totalRevenue: 0 };
    }
  }
}

const AFFILIATE_KEYWORDS = [
  'best', 'review', 'comparison', 'vs', 'alternative', 'top', 'discount',
  'coupon', 'deal', 'save', 'cheap', 'affordable', 'software', 'tool',
  'app', 'platform', 'service', 'course', 'training', 'book', 'guide',
  'equipment', 'gear', 'accessory', 'product',
];
