import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { DecisionEngine } from './decision-engine.service';
import { GrowthAI } from './growth-ai.service';
import { RiskManager } from './risk-manager.service';
import { SmartMoneyOptimization } from './smart-money-optimization.service';

export interface ScalingDecision {
  channelId: string;
  channelTitle: string;
  niche: string;
  profitScore: number;
  action: 'scale-up' | 'maintain' | 'scale-down' | 'pivot-niche' | 'kill';
  reason: string;
  newUploadFrequency: string;
  newNiches: string[];
  allocateMoreResources: boolean;
}

export interface ScalingReport {
  decisions: ScalingDecision[];
  totalChannelsScaled: number;
  totalChannelsKilled: number;
  totalChannelsPivoted: number;
  totalResourceAllocation: Record<string, number>;
  totalUploadCapacity: number;
  recommendation: string;
}

const PROFIT_THRESHOLD_SCALE = 80;
const PROFIT_THRESHOLD_MAINTAIN = 50;
const PROFIT_THRESHOLD_REDUCE = 30;
const PROFIT_THRESHOLD_KILL = 15;

export class AutoScaling {
  private decisionEngine: DecisionEngine;
  private growthAI: GrowthAI;
  private riskManager: RiskManager;
  private moneyOptimization: SmartMoneyOptimization;

  constructor() {
    this.decisionEngine = new DecisionEngine();
    this.growthAI = new GrowthAI();
    this.riskManager = new RiskManager();
    this.moneyOptimization = new SmartMoneyOptimization();
  }

  async evaluateAndScale(): Promise<ScalingReport> {
    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });
    const decisions: ScalingDecision[] = [];
    const totalAllocation: Record<string, number> = {};
    let totalUploadCapacity = 0;

    for (const channel of channels) {
      const decision = await this.evaluateSingleChannel(channel);
      decisions.push(decision);

      if (decision.action === 'scale-up') {
        totalAllocation[channel.channelId] = 1.0;
        totalUploadCapacity += 2;
      } else if (decision.action === 'maintain') {
        totalAllocation[channel.channelId] = 0.5;
        totalUploadCapacity += 1;
      } else if (decision.action === 'scale-down') {
        totalAllocation[channel.channelId] = 0.25;
        totalUploadCapacity += 0.5;
      } else {
        totalAllocation[channel.channelId] = 0;
      }
    }

    const scaled = decisions.filter(d => d.action === 'scale-up').length;
    const killed = decisions.filter(d => d.action === 'kill').length;
    const pivoted = decisions.filter(d => d.action === 'pivot-niche').length;

    return {
      decisions,
      totalChannelsScaled: scaled,
      totalChannelsKilled: killed,
      totalChannelsPivoted: pivoted,
      totalResourceAllocation: totalAllocation,
      totalUploadCapacity,
      recommendation: this.generateScalingRecommendation(scaled, killed, pivoted, channels.length),
    };
  }

  private async evaluateSingleChannel(channel: any): Promise<ScalingDecision> {
    const channelId = channel.channelId;
    const channelTitle = channel.channelTitle || 'Unknown';

    const profit = await this.decisionEngine.analyzeChannelProfitability(channelId);
    const profitScore = profit.profitScore;

    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
    const niche = strategy?.niche || 'general';

    const riskCheck = await this.riskManager.checkChannelRisk(channelId);
    if (riskCheck.riskLevel === 'critical') {
      return {
        channelId, channelTitle, niche,
        profitScore,
        action: 'kill',
        reason: `Critical risk: ${riskCheck.riskFactors.join(', ')}`,
        newUploadFrequency: 'none',
        newNiches: [],
        allocateMoreResources: false,
      };
    }

    if (profitScore >= PROFIT_THRESHOLD_SCALE) {
      await this.scaleUploadFrequency(channelId, 'daily');

      const similarNiches = await this.growthAI.findExpansionOpportunities(
        channel.userId || ''
      );

      return {
        channelId, channelTitle, niche,
        profitScore,
        action: 'scale-up',
        reason: `Profit score ${profitScore}. Scaling up: 2x uploads/day, exploring new niches.`,
        newUploadFrequency: 'daily',
        newNiches: similarNiches.slice(0, 3).map(n => n.niche),
        allocateMoreResources: true,
      };
    }

    if (profitScore >= PROFIT_THRESHOLD_MAINTAIN) {
      await this.maintainUploadFrequency(channelId);

      return {
        channelId, channelTitle, niche,
        profitScore,
        action: 'maintain',
        reason: `Profit score ${profitScore}. Maintaining current strategy.`,
        newUploadFrequency: 'every-other-day',
        newNiches: [],
        allocateMoreResources: false,
      };
    }

    if (profitScore >= PROFIT_THRESHOLD_REDUCE) {
      await this.scaleDownUploadFrequency(channelId);

      const cpmSuggestion = await this.moneyOptimization.optimizeForHighCPM(niche);

      return {
        channelId, channelTitle, niche,
        profitScore,
        action: 'scale-down',
        reason: `Profit score ${profitScore}. Reducing uploads and attempting niche pivot.`,
        newUploadFrequency: 'weekly',
        newNiches: cpmSuggestion.cpmGain > 0 ? [cpmSuggestion.recommendedNiche] : [],
        allocateMoreResources: false,
      };
    }

    if (profitScore >= PROFIT_THRESHOLD_KILL) {
      return {
        channelId, channelTitle, niche,
        profitScore,
        action: 'pivot-niche',
        reason: `Profit score ${profitScore}. Must pivot niche or be killed.`,
        newUploadFrequency: 'weekly',
        newNiches: [],
        allocateMoreResources: false,
      };
    }

    await this.killChannel(channelId);
    logger.warn(`[AutoScaling] KILLED ${channelTitle} (profit score: ${profitScore})`);

    return {
      channelId, channelTitle, niche,
      profitScore,
      action: 'kill',
      reason: `Profit score ${profitScore} below kill threshold. Channel terminated.`,
      newUploadFrequency: 'none',
      newNiches: [],
      allocateMoreResources: false,
    };
  }

  private async scaleUploadFrequency(channelId: string, targetFrequency: string): Promise<void> {
    await prisma.uploadSchedule.updateMany({
      where: { channelId, status: 'active' },
      data: { frequency: targetFrequency },
    });
    logger.info(`[AutoScaling] Scaled up ${channelId} to ${targetFrequency}`);
  }

  private async maintainUploadFrequency(channelId: string): Promise<void> {
    await prisma.uploadSchedule.updateMany({
      where: { channelId, status: { in: ['paused', 'active'] } },
      data: { status: 'active', frequency: 'every-other-day' },
    });
  }

  private async scaleDownUploadFrequency(channelId: string): Promise<void> {
    await prisma.uploadSchedule.updateMany({
      where: { channelId, status: 'active' },
      data: { frequency: 'weekly' },
    });
  }

  private async killChannel(channelId: string): Promise<void> {
    await prisma.youTubeAccount.updateMany({
      where: { channelId },
      data: { isConnected: false },
    });
    await prisma.uploadSchedule.updateMany({
      where: { channelId },
      data: { status: 'paused' },
    });
  }

  async simulateScaling(channelId: string, days: number): Promise<{
    projectedRevenue: number;
    projectedViews: number;
    scalingEvents: string[];
  }> {
    const events: string[] = [];
    let projectedRevenue = 0;
    let projectedViews = 0;
    let currentUploadsPerDay = 1;

    for (let day = 1; day <= days; day++) {
      const decision = await this.decisionEngine.evaluateChannel(channelId);

      if (decision.action === 'scale-hard' && currentUploadsPerDay < 2) {
        currentUploadsPerDay = 2;
        events.push(`Day ${day}: Scaled to ${currentUploadsPerDay}x/day`);
      } else if (decision.action === 'reduce' && currentUploadsPerDay > 0.5) {
        currentUploadsPerDay = 0.5;
        events.push(`Day ${day}: Reduced to ${currentUploadsPerDay}x/day`);
      } else if (decision.action === 'pause') {
        currentUploadsPerDay = 0;
        events.push(`Day ${day}: Paused uploads`);
      } else if (decision.action === 'kill') {
        events.push(`Day ${day}: Channel killed`);
        break;
      }

      const dailyUploads = currentUploadsPerDay;
      projectedRevenue += dailyUploads * (decision.revenue / Math.max(1, decision.revenue / 5)) * 1.1;
      projectedViews += dailyUploads * 500;
    }

    return {
      projectedRevenue: Math.round(projectedRevenue * 100) / 100,
      projectedViews: Math.round(projectedViews),
      scalingEvents: events,
    };
  }

  private generateScalingRecommendation(scaled: number, killed: number, pivoted: number, total: number): string {
    if (total === 0) return 'No active channels to scale.';

    const healthy = total - killed;
    const healthRatio = healthy / total;

    if (healthRatio < 0.3) {
      return 'CRITICAL: Most channels underperforming. Pause all operations and review strategy.';
    }
    if (killed > 0) {
      return `${killed} channel(s) killed. ${scaled} channel(s) scaling. Focus resources on winners.`;
    }
    if (scaled >= total * 0.5) {
      return `EXCELLENT: ${scaled}/${total} channels scaling. Continue aggressive expansion.`;
    }
    if (pivoted > 0) {
      return `${pivoted} channel(s) pivoted. Monitor new niche performance closely.`;
    }
    return 'Stable operations. Continue monitoring for optimization opportunities.';
  }
}
