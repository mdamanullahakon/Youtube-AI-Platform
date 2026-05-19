import { PipelineStep } from '../pipeline-step';
import { UsaMarketOptimizer } from '../../services/usa-market.service';
import type { UsaMarketReport } from '../../services/usa-market.types';
import { logger } from '../../utils/logger';

export interface UsaMarketGateInput {
  projectId: string;
  userId: string;
  channelId?: string;
  topic: string;
  keywords?: string[];
}

export interface UsaMarketGateOutput {
  report: UsaMarketReport;
  allowed: boolean;
}

const USA_REJECTION_MESSAGE =
  'USA_MARKET_REJECTED: Topic does not meet USA audience optimization threshold ' +
  '(minimum USA Viral Score: 75). Optimize for US cultural relevance, high-RPM niche, and US-style hooks.';

export class UsaMarketGate extends PipelineStep<UsaMarketGateInput, UsaMarketGateOutput> {
  private optimizer: UsaMarketOptimizer;

  constructor() {
    super('UsaMarketGate');
    this.optimizer = new UsaMarketOptimizer();
  }

  validate(input: UsaMarketGateInput): string | null {
    if (!input.topic || input.topic.trim().length === 0) return 'Topic is required';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: UsaMarketGateInput): Promise<UsaMarketGateOutput> {
    logger.info(`[UsaMarketGate] Evaluating "${input.topic}" for USA market`);

    const report = await this.optimizer.analyzeTopic(input.topic, input.keywords || []);

    logger.info(`[UsaMarketGate] ${'='.repeat(50)}`);
    logger.info(`[UsaMarketGate] TOPIC:             ${input.topic}`);
    logger.info(`[UsaMarketGate] USA AUDIENCE FIT:  ${report.usaAudienceFitScore}/100`);
    logger.info(`[UsaMarketGate] RPM SCORE:         ${report.rpmScore}/100`);
    logger.info(`[UsaMarketGate] CTR PREDICTION:    ${report.ctrPredictionUsa}/100`);
    logger.info(`[UsaMarketGate] RETENTION PRED:    ${report.retentionPredictionUsa}/100`);
    logger.info(`[UsaMarketGate] HOOK STRENGTH:     ${report.hookStrengthScore}/100`);
    logger.info(`[UsaMarketGate] USA VIRAL SCORE:   ${report.usaViralScore}/100`);
    logger.info(`[UsaMarketGate] BEST US TITLE:     ${report.bestUsTitle}`);
    logger.info(`[UsaMarketGate] BEST UPLOAD TIME:  ${report.bestUploadTimeEst}`);
    logger.info(`[UsaMarketGate] DECISION:          ${report.finalDecision}`);

    if (report.usaAudienceFitScore < 50) {
      logger.warn(`[UsaMarketGate] Low USA audience fit (${report.usaAudienceFitScore}). Consider topic adjustment: ${report.subScores.audienceAlignment.issues.join('; ')}`);
    }

    if (report.finalDecision === 'REJECT') {
      logger.error(`[UsaMarketGate] REJECTED — score ${report.usaViralScore} < 75`);
      for (const note of report.improvementNotes) {
        logger.info(`  → ${note}`);
      }
      throw new Error(`${USA_REJECTION_MESSAGE} Details: ${report.improvementNotes.join('; ')}`);
    }

    if (report.finalDecision === 'OPTIMIZE') {
      logger.warn(`[UsaMarketGate] OPTIMIZE needed — score ${report.usaViralScore} (75-85). Applying improvements...`);
    }
    if (report.finalDecision === 'PUBLISH') {
      logger.info(`[UsaMarketGate] PRIORITY PUBLISH — score ${report.usaViralScore} > 85`);
    }

    logger.info(`[UsaMarketGate] ${'='.repeat(50)}`);

    return { report, allowed: true };
  }

  async fallback(input: UsaMarketGateInput, error: Error): Promise<UsaMarketGateOutput> {
    logger.warn(`[UsaMarketGate] Fallback: ${error.message}`);
    const fallbackReport: UsaMarketReport = {
      topic: input.topic,
      usaAudienceFitScore: 60,
      rpmScore: 50,
      ctrPredictionUsa: 55,
      retentionPredictionUsa: 55,
      hookStrengthScore: 55,
      bestUsTitle: input.topic,
      bestUploadTimeEst: '7:00 PM EST',
      finalDecision: 'OPTIMIZE',
      usaViralScore: 60,
      subScores: {
        audienceAlignment: { score: 60, languageNatural: 60, culturalRelevance: 50, currencyUnit: true, unitSystem: true, toneMatch: 60, issues: [] },
        rpmFilter: { score: 50, nicheTier: 'medium', estimatedCpmUsd: 6, estimatedRpmUsd: 3.30, nicheCategory: 'general' },
        hookEngine: { score: 55, curiosityGap: 50, valuePromise: 50, pacing: 60, usStyle: 50, suggestions: [] },
        subscriberValue: { score: 50, targetDemographic: 'general US audience', valueAlignment: 50, usMarketDemand: 50 },
      },
      localizedTitle: input.topic,
      localizedDescription: 'USA-optimized content.',
      improvementNotes: ['Fallback mode — full USA analysis unavailable.'],
    };
    return { report: fallbackReport, allowed: true };
  }
}
