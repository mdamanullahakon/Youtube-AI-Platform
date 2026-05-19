import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { ChannelGrowthService } from './channel-growth.service';
import { RevenueOptimizationService } from './revenue-optimization.service';
import { ViralIntelligenceService } from './viral-intelligence.service';
import { UsaMarketOptimizer } from './usa-market.service';
import { DecisionEngine, type GlobalDecision, type ChannelDecision } from './autonomous-brain/decision-engine.service';
import { GrowthAI, type NicheOpportunity } from './autonomous-brain/growth-ai.service';
import { GodmodeOrchestrator } from './godmode-orchestrator.service';
import type {
  CeoReport,
  ContentPortfolioPlan,
  UploadScheduleCeo,
  ScalingDecision,
  RiskAnalysis,
} from './ceo.types';

export class CeoService {
  private growth: ChannelGrowthService;
  private revenue: RevenueOptimizationService;
  private viral: ViralIntelligenceService;
  private usa: UsaMarketOptimizer;
  private decisionEngine: DecisionEngine;
  private growthAI: GrowthAI;
  private godmode: GodmodeOrchestrator;

  constructor() {
    this.growth = new ChannelGrowthService();
    this.revenue = new RevenueOptimizationService();
    this.viral = new ViralIntelligenceService();
    this.usa = new UsaMarketOptimizer();
    this.decisionEngine = new DecisionEngine();
    this.growthAI = new GrowthAI();
    this.godmode = new GodmodeOrchestrator();
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 1: BUSINESS STATE ANALYZER
  // ────────────────────────────────────────────────────────────

  private async analyzeBusinessState(channelId: string): Promise<{
    healthScore: number;
    growthStatus: 'EXPANDING' | 'STABLE' | 'DECLINING';
    channelDecision: ChannelDecision;
    globalDecision: GlobalDecision;
  }> {
    const [channelDecision, globalDecision] = await Promise.all([
      this.decisionEngine.evaluateChannel(channelId),
      this.decisionEngine.evaluateAllChannels(),
    ]);

    const growthStatus = channelDecision.growthTrend >= 10
      ? 'EXPANDING'
      : channelDecision.growthTrend >= -5
        ? 'STABLE'
        : 'DECLINING';

    const healthScore = channelDecision.decisionScore;

    return { healthScore, growthStatus, channelDecision, globalDecision };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 2: CONTENT PORTFOLIO STRATEGY
  // ────────────────────────────────────────────────────────────

  private async buildContentPortfolio(channelId: string): Promise<ContentPortfolioPlan> {
    try {
      const growthCycle = await this.growth.runFullGrowthCycle(channelId);
      const mix = growthCycle.strategyPlan.mixRecommendation;
      const weeklyPlan = growthCycle.strategyPlan.weeklyPlan.slice(0, 7).map(w => ({
        day: w.day,
        topic: w.topic,
        type: w.contentType as 'viral' | 'evergreen' | 'authority',
        expectedRevenue: 0,
        confidence: 0,
      }));

      const priorityRanking = growthCycle.strategyPlan.topicPriorityList.slice(0, 10);
      const discardList = growthCycle.strategyPlan.forbiddenTopics.slice(0, 5);

      return {
        viralPct: mix.viralPct,
        evergreenPct: mix.evergreenPct,
        authorityPct: mix.authorityPct,
        weeklyPlan,
        priorityRanking,
        discardList,
      };
    } catch {
      return {
        viralPct: 40,
        evergreenPct: 40,
        authorityPct: 20,
        weeklyPlan: [],
        priorityRanking: [],
        discardList: [],
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 3: REVENUE OPTIMIZATION DECISION ENGINE
  // ────────────────────────────────────────────────────────────

  private async buildRevenueStrategy(channelId: string): Promise<string> {
    try {
      const accuracy = await this.revenue.getRevenuePredictionAccuracy();
      const topOpps = await this.revenue.getTopRevenueOpportunities(5);
      const lines: string[] = [];

      lines.push(`Revenue prediction accuracy: ${accuracy.avgError.toFixed(0)}% avg error (${accuracy.totalPredictions} predictions)`);
      lines.push(`Total tracked revenue: $${accuracy.totalRevenue.toFixed(2)}`);

      if (topOpps.length > 0) {
        lines.push(`Top revenue opportunities: ${topOpps.slice(0, 3).map(o => `${o.topic} ($${o.score})`).join(', ')}`);
      }

      const channelDecision = await this.decisionEngine.analyzeChannelProfitability(channelId);
      lines.push(`Channel profit score: ${channelDecision.profitScore}/100 — ${channelDecision.recommendation}`);

      return lines.join(' | ');
    } catch {
      return 'Revenue analysis unavailable';
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 4: VIRAL SCALING ENGINE
  // ────────────────────────────────────────────────────────────

  private async determineScalingDecision(channelId: string): Promise<ScalingDecision> {
    try {
      const channelDecision = await this.decisionEngine.evaluateChannel(channelId);
      const growthScore = await this.growth.calculateChannelGrowthScore(channelId);

      if (channelDecision.action === 'scale-hard' && growthScore.growthScore >= 70) {
        return 'SCALE_AGGRESSIVELY';
      }
      if (channelDecision.action === 'normal' || channelDecision.action === 'reduce') {
        return 'OPTIMIZE_AND_STABILIZE';
      }
      return 'RESTRUCTURE_STRATEGY';
    } catch {
      return 'OPTIMIZE_AND_STABILIZE';
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 5: EXECUTION SCHEDULER
  // ────────────────────────────────────────────────────────────

  private async buildUploadSchedule(channelId: string): Promise<UploadScheduleCeo> {
    try {
      const schedule = await this.growth.optimizeUploadSchedule(channelId);
      const bestSlot = `${schedule.timezone}`;

      return {
        bestSlot: schedule.bestTimeSlots.length > 0
          ? `${schedule.bestTimeSlots[0].day} ${schedule.bestTimeSlots[0].hour}:00 ${schedule.timezone}`
          : '7:00 PM EST',
        frequencyPerWeek: schedule.optimalFrequencyPerWeek,
        cooldownDays: schedule.cooldownDays,
        timezone: schedule.timezone,
      };
    } catch {
      return {
        bestSlot: '7:00 PM EST',
        frequencyPerWeek: 4,
        cooldownDays: 2,
        timezone: 'America/New_York',
      };
    }
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 6: AUTONOMOUS LEARNING LOOP
  // ────────────────────────────────────────────────────────────

  private async assessRisks(channelId: string): Promise<RiskAnalysis> {
    const risks: string[] = [];
    const mitigations: string[] = [];
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';

    try {
      const health = await this.growth.analyzeChannelMetrics(channelId);
      const corrections = await this.growth.detectAndCorrectDeclines(channelId);
      const growthScore = await this.growth.calculateChannelGrowthScore(channelId);
      const viralAccuracy = await this.viral.getPredictionAccuracyStats();

      for (const c of corrections) {
        risks.push(c.description);
        if (c.severity === 'critical') {
          mitigations.push(`AUTO-FIX: ${c.type} — applying corrective action`);
        }
      }

      if (health.weakPoints.length > 0) {
        risks.push(...health.weakPoints.slice(0, 3));
      }

      if (viralAccuracy.totalPredictions > 0 && (viralAccuracy.avgCtrError > 20 || viralAccuracy.avgRetentionError > 20)) {
        risks.push(`Viral prediction accuracy low — CTR error ${viralAccuracy.avgCtrError.toFixed(0)}pts, retention error ${viralAccuracy.avgRetentionError.toFixed(0)}pts`);
        mitigations.push('Adjust viral intelligence weights via self-learning loop');
      }

      if (growthScore.riskLevel === 'high') {
        level = 'high';
        risks.push('Channel growth score in high-risk territory');
        mitigations.push('Immediate strategy restructuring recommended — reduce uploads, focus on quality');
      } else if (growthScore.riskLevel === 'medium') {
        level = 'medium';
        risks.push('Channel growth score at medium risk');
        mitigations.push('Optimize hooks, pacing, and topic targeting');
      } else {
        level = 'low';
      }

      if (risks.length >= 5) level = 'critical';

      if (risks.length === 0) {
        risks.push('No significant risks detected');
        mitigations.push('Maintain current strategy');
      }
    } catch {
      risks.push('Risk assessment unavailable');
      mitigations.push('Retry on next cycle');
    }

    return { level, risks: risks.slice(0, 8), mitigations: mitigations.slice(0, 5) };
  }

  // ────────────────────────────────────────────────────────────
  //  MODULE 7: CEO DECISION MATRIX — unified report
  // ────────────────────────────────────────────────────────────

  async generateCeoReport(channelId: string): Promise<CeoReport> {
    logger.info(`[CeoService] Generating CEO report for channel ${channelId}`);

    const timestamp = new Date();

    const [businessState, portfolio, revenueStrategy, scalingDecision, uploadSchedule, riskAnalysis] = await Promise.all([
      this.analyzeBusinessState(channelId),
      this.buildContentPortfolio(channelId),
      this.buildRevenueStrategy(channelId),
      this.determineScalingDecision(channelId),
      this.buildUploadSchedule(channelId),
      this.assessRisks(channelId),
    ]);

    const top3Actions = this.generateTop3Actions(
      businessState, scalingDecision, riskAnalysis, portfolio,
    );

    const report: CeoReport = {
      businessHealthScore: businessState.healthScore,
      growthStatus: businessState.growthStatus,
      revenueStrategySummary: revenueStrategy,
      contentPortfolioPlan: portfolio,
      uploadSchedule,
      scalingRecommendation: scalingDecision,
      top3StrategicActions: top3Actions,
      riskAnalysis,
      timestamp,
      channelId,
    };

    logger.info(`[CeoService] Report complete for ${channelId}: health=${businessState.healthScore} growth=${businessState.growthStatus} scaling=${scalingDecision}`);

    return report;
  }

  // ────────────────────────────────────────────────────────────
  //  FULL CYCLE
  // ────────────────────────────────────────────────────────────

  async runFullCeoCycle(channelId: string): Promise<CeoReport> {
    logger.info(`[CeoService] Running full CEO cycle for ${channelId}`);

    const report = await this.generateCeoReport(channelId);

    // Auto-execute scaling decisions via DecisionEngine
    try {
      const globalDecision = await this.decisionEngine.evaluateAllChannels();
      await this.decisionEngine.executeDecisions(globalDecision, true); // dry run by default
    } catch (err: any) {
      logger.warn(`[CeoService] Decision execution failed: ${err.message}`);
    }

    return report;
  }

  // ────────────────────────────────────────────────────────────
  //  HELPERS
  // ────────────────────────────────────────────────────────────

  private generateTop3Actions(
    state: { healthScore: number; growthStatus: string; channelDecision: ChannelDecision },
    scaling: ScalingDecision,
    risk: RiskAnalysis,
    portfolio: ContentPortfolioPlan,
  ): string[] {
    const actions: string[] = [];

    if (scaling === 'SCALE_AGGRESSIVELY') {
      actions.push('SCALE: Increase upload frequency to 2/day — focus on viral + high-CPM topics');
      actions.push('EXPAND: Launch 1-2 adjacent topic clusters to grow audience base');
      actions.push('MONETIZE: Push affiliate integrations and digital product launches');
    } else if (scaling === 'OPTIMIZE_AND_STABILIZE') {
      actions.push('OPTIMIZE: Improve CTR and retention with stronger hooks and pacing variety');
      actions.push('STABILIZE: Maintain consistent upload schedule at current frequency');
      actions.push('ANALYZE: Deep-dive into top 3 performing videos and replicate structure');
    } else {
      actions.push('RESTRUCTURE: Pause uploads for 7 days — audit channel strategy');
      actions.push('PIVOT: Shift topic cluster based on historical performance data');
      actions.push('REBUILD: Redesign title/thumbnail approach — use A/B testing');
    }

    if (risk.level === 'high' || risk.level === 'critical') {
      actions.push(`URGENT: ${risk.risks[0]}`);
    }

    if (state.healthScore < 30) {
      actions.push('CRITICAL: Channel underperforming — consider niche pivot or format change');
    }

    return actions.slice(0, 3);
  }
}
