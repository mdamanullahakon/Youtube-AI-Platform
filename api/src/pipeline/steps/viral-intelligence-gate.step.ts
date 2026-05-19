import { PipelineStep } from '../pipeline-step';
import { ViralIntelligenceService } from '../../services/viral-intelligence.service';
import type { ViralIntelligenceReport } from '../../services/viral-intelligence.types';
import { logger } from '../../utils/logger';

export interface ViralIntelligenceGateInput {
  projectId: string;
  userId: string;
  channelId?: string;
  topic: string;
}

export interface ViralIntelligenceGateOutput {
  report: ViralIntelligenceReport;
  allowed: boolean;
  decision: 'ALLOW' | 'REJECT' | 'REGENERATE';
}

export class ViralIntelligenceGate extends PipelineStep<ViralIntelligenceGateInput, ViralIntelligenceGateOutput> {
  private intelligence: ViralIntelligenceService;

  constructor() {
    super('ViralIntelligenceGate');
    this.intelligence = new ViralIntelligenceService();
  }

  validate(input: ViralIntelligenceGateInput): string | null {
    if (!input.topic || input.topic.trim().length === 0) return 'Topic is required';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: ViralIntelligenceGateInput): Promise<ViralIntelligenceGateOutput> {
    logger.info(`[ViralIntelligenceGate] Analyzing topic: "${input.topic}"`);

    const report = await this.intelligence.analyzeTopic(input.topic, input.projectId);

    logger.info(`[ViralIntelligenceGate] ${'='.repeat(50)}`);
    logger.info(`[ViralIntelligenceGate] TOPIC:        ${input.topic}`);
    logger.info(`[ViralIntelligenceGate] CATEGORY:     ${report.category}`);
    logger.info(`[ViralIntelligenceGate] CTR SCORE:    ${report.ctrScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] RETENTION:    ${report.retentionScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] MONETIZATION: ${report.monetizationScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] SATURATION:   ${report.saturationScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] TREND:        ${report.trendScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] VIRAL SCORE:  ${report.viralScore.toFixed(1)}/100`);
    logger.info(`[ViralIntelligenceGate] DECISION:     ${report.decision}`);
    if (report.improvementSuggestions.length > 0) {
      logger.info(`[ViralIntelligenceGate] Suggestions:`);
      for (const s of report.improvementSuggestions) {
        logger.info(`  → ${s}`);
      }
    }
    logger.info(`[ViralIntelligenceGate] ${'='.repeat(50)}`);

    const allowed = report.decision === 'ALLOW';

    if (!allowed && report.decision === 'REJECT') {
      throw new Error(
        `VIRAL_INTELLIGENCE_REJECTED: Topic "${input.topic}" scored ${report.viralScore.toFixed(1)}/100 ` +
        `(CTR: ${report.ctrScore.toFixed(0)}, Retention: ${report.retentionScore.toFixed(0)}, ` +
        `Saturation: ${report.saturationScore.toFixed(0)}). ${report.improvementSuggestions[0] || 'Choose a different topic.'}`
      );
    }

    if (!allowed && report.decision === 'REGENERATE') {
      logger.warn(`[ViralIntelligenceGate] REGENERATE needed: "${input.topic}" — ${report.improvementSuggestions[0] || 'Optimize topic/title and retry'}`);
    }

    return { report, allowed, decision: report.decision };
  }

  async fallback(input: ViralIntelligenceGateInput, error: Error): Promise<ViralIntelligenceGateOutput> {
    logger.warn(`[ViralIntelligenceGate] Fallback: ${error.message}`);
    // On fallback, generate a minimal report that allows the pipeline to proceed
    const fallbackReport: ViralIntelligenceReport = {
      topic: input.topic,
      category: 'other',
      trendScore: 50,
      competitionLevel: 'medium',
      searchDemand: 50,
      noveltyScore: 50,
      ctrScore: 60,
      retentionScore: 60,
      monetizationScore: 50,
      saturationScore: 40,
      viralScore: 60,
      decision: 'ALLOW',
      improvementSuggestions: ['Fallback mode — AI analysis unavailable, proceeding with default scores.'],
      subScores: {
        ctr: { score: 60, hookStrength: 50, curiosityGap: 50, emotionalTrigger: 50, powerWords: 50 },
        retention: { score: 60, hookStrength: 50, pacing: 50, storyStructure: 50, emotionalArc: 50 },
        monetization: { score: 50, advertiserDemand: 50, nicheValue: 50, audienceGeo: 50 },
        saturation: { score: 40, keywordCompetition: 40, contentRedundancy: 40, trendSaturation: 40 },
        topic: { score: 50, trend: 50, competition: 50, searchDemand: 50, novelty: 50 },
      },
    };

    return { report: fallbackReport, allowed: true, decision: 'ALLOW' };
  }
}
