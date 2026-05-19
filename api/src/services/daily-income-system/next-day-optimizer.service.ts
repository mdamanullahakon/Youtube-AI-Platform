import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson } from '../../utils/parse-ai-response';
import { VideoPerformanceRanking, DailyWinnerResult } from './best-video-detector.service';
import { ScoredTopic } from './daily-content-planner.service';

export interface NextDayOptimizationPlan {
  channelId: string;
  channelTitle: string;
  date: string;
  winningPatternSummary: string;
  improvedTopicScores: {
    topicType: string;
    priorScore: number;
    adjustedScore: number;
    reason: string;
  }[];
  newTopicsInfluence: string[];
  strategyChanges: string[];
  expectedImprovement: number;
}

export class NextDayOptimizer {
  async optimizeForTomorrow(
    channelId: string,
    winnerResult: DailyWinnerResult
  ): Promise<NextDayOptimizationPlan> {
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    const channelTitle = channel?.channelTitle || 'Unknown';

    const priorScores = await this.getPriorTopicScores(channelId);
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const newTopicsInfluence: string[] = [];
    const strategyChanges: string[] = [];
    const improvedTopicScores: NextDayOptimizationPlan['improvedTopicScores'] = [];

    if (winnerResult.winner) {
      const w = winnerResult.winner;

      newTopicsInfluence.push(
        `Create follow-up on "${w.topic}" with deeper insights`,
        `Use "${w.winningPattern.hookStyle}" hook style — proven to work`,
        `Apply "${w.winningPattern.thumbnailStyle}" thumbnail approach`,
      );

      if (w.performanceGrade === 'A' || w.performanceGrade === 'B') {
        strategyChanges.push(`KEEP: "${w.topic}" topic type (${w.winningPattern.topicType})`);
        strategyChanges.push(`KEEP: "${w.winningPattern.hookStyle}" hook style`);
        strategyChanges.push(`KEEP: "${w.winningPattern.thumbnailStyle}" thumbnail style`);
        strategyChanges.push(`KEEP: "${w.winningPattern.pacing}" pacing`);
      } else {
        strategyChanges.push(`AVOID: "${w.topic}" topic type (underperforming)`);
        strategyChanges.push(`IMPROVE: hook from "${w.winningPattern.hookStyle}" to stronger curiosity gap`);
        strategyChanges.push(`IMPROVE: thumbnail from "${w.winningPattern.thumbnailStyle}" to higher contrast`);
      }

      if (w.ctr < 4) {
        strategyChanges.push('IMPROVE CTR: Use stronger power words, add numbers to titles, test bolder thumbnails');
      }
      if (w.retention < 35) {
        strategyChanges.push('IMPROVE RETENTION: Add pattern interrupts every 20s, shorten hook, faster pacing');
      }
      if (w.revenue < 1) {
        strategyChanges.push('IMPROVE MONETIZATION: Add stronger CTA, better affiliate alignment, funnel integration');
      }

      for (const prior of priorScores) {
        const adjustedScore = this.adjustTopicScore(prior, winnerResult);
        improvedTopicScores.push({
          topicType: prior.topicType,
          priorScore: prior.score,
          adjustedScore,
          reason: adjustedScore > prior.score
            ? `Boosted based on winning pattern (${w.winningPattern.topicType})`
            : `Reduced — similar topics underperformed`,
        });
      }
    } else {
      strategyChanges.push('No winner data — use safe fallback topics');
      strategyChanges.push('Focus on broad-appeal topics with proven retention');
      newTopicsInfluence.push('General trending topics in niche');
    }

    strategyChanges.push('Generate 4 diverse topics — cover different angles');
    strategyChanges.push('Prioritize topics with high monetization potential');
    strategyChanges.push('Ensure all topics pass minimum quality threshold');

    const expectedImprovement = winnerResult.winner?.performanceScore
      ? Math.min(30, Math.round(winnerResult.winner.performanceScore * 0.15))
      : 5;

    await this.saveOptimizationPlan(channelId, tomorrowStr, {
      winningPatternSummary: winnerResult.patternSummary,
      strategyChanges,
      newTopicsInfluence,
    });

    logger.info(`[NextDayOptimizer] ${channelTitle}: Optimized for ${tomorrowStr} — ${strategyChanges.length} strategy changes, expected +${expectedImprovement}% improvement`);

    return {
      channelId,
      channelTitle,
      date: tomorrowStr,
      winningPatternSummary: winnerResult.patternSummary,
      improvedTopicScores,
      newTopicsInfluence,
      strategyChanges,
      expectedImprovement,
    };
  }

  async augmentPromptWithWinningPattern(channelId: string): Promise<{
    winningPatternInfluence: string;
    avoidedTopics: string[];
    boostedFormats: string[];
  }> {
    const winnerRecord = await prisma.winningPattern.findFirst({
      where: { category: 'daily-winner' },
      orderBy: { lastUsedAt: 'desc' },
    });

    if (!winnerRecord?.content) {
      return { winningPatternInfluence: 'No winning pattern available — use default strategy', avoidedTopics: [], boostedFormats: [] };
    }

    let pattern: any;
    try { pattern = JSON.parse(winnerRecord.content); } catch { pattern = {}; }

    return {
      winningPatternInfluence: pattern.topicType
        ? `Prioritize ${pattern.topicType} content with ${pattern.hookStyle || 'curiosity-gap'} hooks and ${pattern.thumbnailStyle || 'high-contrast'} thumbnails`
        : 'Standard content approach',
      avoidedTopics: [],
      boostedFormats: pattern.topicType ? [pattern.topicType] : [],
    };
  }

  async getOptimizationHistory(channelId: string, days = 7): Promise<{
    date: string; winnerScore: number; strategyCount: number; improvement: number;
  }[]> {
    const history: any[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const record = await prisma.appConfig.findUnique({
        where: { key: `income:optimization:${channelId}:${dateStr}` },
      });

      if (record) {
        try {
          const data = JSON.parse(record.value);
          history.push({ date: dateStr, winnerScore: data.winnerScore || 0, strategyCount: data.strategies?.length || 0, improvement: data.expectedImprovement || 0 });
        } catch {}
      }
    }

    return history;
  }

  private async getPriorTopicScores(channelId: string): Promise<{ topicType: string; score: number }[]> {
    const projects = await prisma.videoProject.findMany({
      where: { channelId },
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const scores: Record<string, { totalScore: number; count: number }> = {};
    for (const p of projects) {
      const type = p.format || 'long-form';
      const a = p.analytics;
      const score = a ? (a.ctr || 0) * 3 + (a.retention || 0) * 0.4 : 0;
      if (!scores[type]) scores[type] = { totalScore: 0, count: 0 };
      scores[type].totalScore += score;
      scores[type].count++;
    }

    return Object.entries(scores).map(([topicType, data]) => ({
      topicType,
      score: data.count > 0 ? Math.round(data.totalScore / data.count) : 50,
    }));
  }

  private adjustTopicScore(prior: { topicType: string; score: number }, winnerResult: DailyWinnerResult): number {
    if (!winnerResult.winner) return prior.score;
    const w = winnerResult.winner;
    const winnerType = w.winningPattern.topicType;

    if (prior.topicType === winnerType) {
      return Math.min(100, prior.score + 15);
    }
    if (prior.topicType.includes(winnerType.split('-')[0])) {
      return Math.min(100, prior.score + 5);
    }
    return Math.max(0, prior.score - 5);
  }

  private async saveOptimizationPlan(channelId: string, date: string, plan: any): Promise<void> {
    const key = `income:optimization:${channelId}:${date}`;
    await prisma.appConfig.upsert({
      where: { key },
      update: { value: JSON.stringify(plan) },
      create: {
        key,
        value: JSON.stringify(plan),
        description: `Next-day optimization plan for ${channelId} on ${date}`,
      },
    });
  }
}
