import { PipelineStep } from '../pipeline-step';
import { RevenueOptimizationService } from '../../services/revenue-optimization.service';
import type { RevenueReport } from '../../services/revenue-optimization.types';
import { logger } from '../../utils/logger';

export interface RevenueGateInput {
  projectId: string;
  userId: string;
  channelId?: string;
  topic: string;
  niche?: string;
  keywords?: string[];
}

export interface RevenueGateOutput {
  report: RevenueReport;
  allowed: boolean;
}

export class RevenueGate extends PipelineStep<RevenueGateInput, RevenueGateOutput> {
  private revenueService: RevenueOptimizationService;

  constructor() {
    super('RevenueGate');
    this.revenueService = new RevenueOptimizationService();
  }

  validate(input: RevenueGateInput): string | null {
    if (!input.topic || input.topic.trim().length === 0) return 'Topic is required';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: RevenueGateInput): Promise<RevenueGateOutput> {
    logger.info(`[RevenueGate] Evaluating profitability of "${input.topic}"`);

    const report = await this.revenueService.evaluateTopic(input.topic, input.keywords || [], input.niche);

    logger.info(`[RevenueGate] ${'='.repeat(55)}`);
    logger.info(`[RevenueGate] TOPIC:          ${input.topic}`);
    logger.info(`[RevenueGate] TIER:           ${report.profitabilityTier.toUpperCase()}`);
    logger.info(`[RevenueGate] REVENUE FORECAST: $${report.revenueForecast.minEstimate} – $${report.revenueForecast.maxEstimate}`);
    logger.info(`[RevenueGate]   AdSense:       $${report.revenueForecast.breakdown.adsense}`);
    logger.info(`[RevenueGate]   Affiliate:     $${report.revenueForecast.breakdown.affiliate}`);
    logger.info(`[RevenueGate]   External:      $${report.revenueForecast.breakdown.external}`);
    logger.info(`[RevenueGate] US MULTIPLIER:   ${report.usRevenueMultiplier}x`);
    logger.info(`[RevenueGate] MONETIZATION:    ${report.totalMonetizationScore}/100`);
    logger.info(`[RevenueGate] DECISION:        ${report.decision}`);

    // Log tier badges
    const tierEmoji = report.profitabilityTier === 'viral-cash-machine' ? '🔥' :
      report.profitabilityTier === 'high-profit' ? '💰' :
      report.profitabilityTier === 'profitable' ? '✅' :
      report.profitabilityTier === 'break-even' ? '➖' : '❌';
    logger.info(`[RevenueGate] ${tierEmoji} ${report.profitabilityTier.replace('-', ' ').toUpperCase()}`);

    if (report.decision === 'REJECT') {
      logger.error(`[RevenueGate] REJECTED — monetization score ${report.totalMonetizationScore} < 55`);
      for (const s of report.optimizationSuggestions) {
        logger.info(`  → ${s}`);
      }
      throw new Error(
        `REVENUE_GATE_REJECTED: "${input.topic}" scored ${report.totalMonetizationScore}/100 ` +
        `(tier: ${report.profitabilityTier}, forecast: $${report.revenueForecast.expectedEstimate}). ` +
        `Must be PROFITABLE or higher to proceed. ${report.optimizationSuggestions[0] || ''}`
      );
    }

    if (report.decision === 'OPTIMIZE') {
      logger.warn(`[RevenueGate] OPTIMIZE needed (score ${report.totalMonetizationScore})`);
      for (const s of report.optimizationSuggestions.slice(0, 2)) {
        logger.warn(`  → ${s}`);
      }
    }
    if (report.decision === 'APPROVE') {
      logger.info(`[RevenueGate] ✅ APPROVED — ready for production pipeline`);
    }

    logger.info(`[RevenueGate] ${'='.repeat(55)}`);
    return { report, allowed: true };
  }

  async fallback(input: RevenueGateInput, error: Error): Promise<RevenueGateOutput> {
    logger.warn(`[RevenueGate] Fallback: ${error.message}`);
    const fallbackReport: RevenueReport = {
      topic: input.topic,
      revenueForecast: { minEstimate: 0, maxEstimate: 10, expectedEstimate: 5, confidence: 30, breakdown: { adsense: 3, affiliate: 2, external: 0 } },
      profitabilityTier: 'profitable',
      usRevenueMultiplier: 1.5,
      adsenseRevenue: { potential: 3, confidence: 0.4, factors: ['Fallback estimate'] },
      affiliateRevenue: { potential: 2, confidence: 0.3, factors: ['Fallback estimate'] },
      totalMonetizationScore: 55,
      decision: 'APPROVE',
      optimizationSuggestions: ['Fallback — full revenue analysis unavailable, proceeding with conservative estimate.'],
      subScores: {
        forecast: { score: 30, expectedViews: 5000, rpm: 4, affiliateConversionProb: 0.3, retentionImpact: 50 },
        profitability: { score: 55, tier: 'profitable', rpmTier: 'medium', ctrTier: 'medium' },
        multiStream: { score: 55, adsenseFit: 40, affiliateFit: 30, externalFit: 20 },
      },
    };
    return { report: fallbackReport, allowed: true };
  }
}
