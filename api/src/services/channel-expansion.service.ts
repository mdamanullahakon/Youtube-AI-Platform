import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { generateWithAI } from './ai.service';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';
import { PerformanceScaler, ChannelPerformanceScore } from './performance-scaler.service';

export interface ChannelCloneBlueprint {
  sourceChannelId: string;
  sourceNiche: string;
  targetNiche: string;
  targetName: string;
  strategy: {
    hookStyle: string;
    thumbnailStyle: string;
    pacingStyle: string;
    storytellingArc: string;
    tone: string;
    avgDuration: string;
    uploadFrequency: string;
    colorPalette: string;
  };
  predictedSuccess: number;
  estimatedMonthlyRevenue: number;
}

export class ChannelExpansionService {
  private performanceScaler: PerformanceScaler;

  constructor() {
    this.performanceScaler = new PerformanceScaler();
  }

  async cloneWinningStrategy(sourceChannelId: string, targetNiche: string): Promise<ChannelCloneBlueprint | null> {
    logger.info(`[ChannelExpansion] Cloning strategy from ${sourceChannelId} to niche "${targetNiche}"`);

    const sourceChannel = await prisma.youTubeAccount.findFirst({ where: { channelId: sourceChannelId } });
    if (!sourceChannel) return null;

    const sourceStrategy = await prisma.contentStrategy.findFirst({
      where: { channelId: sourceChannelId },
      orderBy: { createdAt: 'desc' },
    });

    const sourceProjects = await prisma.videoProject.findMany({
      where: { channelId: sourceChannelId },
      include: { analytics: true, script: true, thumbnail: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const winningTopics = sourceProjects
      .filter(p => p.analytics && p.analytics!.views > 1000)
      .map(p => p.topic);

    const response = await generateWithAI(`
      Create a channel expansion blueprint by cloning a winning YouTube strategy.

      Source channel: ${sourceChannel.channelTitle || sourceChannelId}
      Source niche content examples: ${winningTopics.join(', ')}
      Source strategy: ${JSON.stringify(sourceStrategy || {})}

      Target niche: "${targetNiche}"

      Analyze what makes the source channel successful and adapt to the target niche.

      Return JSON:
      {
        "targetName": "optimal channel name for target niche",
        "strategy": {
          "hookStyle": "best hook style for this niche",
          "thumbnailStyle": "best thumbnail approach",
          "pacingStyle": "ideal pacing",
          "storytellingArc": "story structure",
          "tone": "channel tone",
          "avgDuration": "video length",
          "uploadFrequency": "how often to upload",
          "colorPalette": "branding colors"
        },
        "predictedSuccess": 0-100 (confidence of success in this niche),
        "estimatedMonthlyRevenue": estimated USD monthly revenue at 100K views/month,
        "reasoning": "why this strategy translates to the target niche"
      }

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = extractJson(response) as any;
      if (!parsed?.strategy) return null;

      return {
        sourceChannelId,
        sourceNiche: sourceStrategy?.niche || 'General',
        targetNiche,
        targetName: parsed.targetName || `${targetNiche} Channel`,
        strategy: {
          hookStyle: parsed.strategy.hookStyle || sourceStrategy?.hookStyle || 'curiosity-gap',
          thumbnailStyle: parsed.strategy.thumbnailStyle || sourceStrategy?.thumbnailStyle || 'face-closeup-shock',
          pacingStyle: parsed.strategy.pacingStyle || sourceStrategy?.pacingStyle || 'fast-paced',
          storytellingArc: parsed.strategy.storytellingArc || sourceStrategy?.storytellingArc || 'problem-solution',
          tone: parsed.strategy.tone || sourceStrategy?.tone || 'emotional-curiosity',
          avgDuration: parsed.strategy.avgDuration || sourceStrategy?.avgDuration || '8-10min',
          uploadFrequency: parsed.strategy.uploadFrequency || 'daily',
          colorPalette: parsed.strategy.colorPalette || 'vibrant contrast',
        },
        predictedSuccess: Math.min(100, Math.max(0, parsed.predictedSuccess || 50)),
        estimatedMonthlyRevenue: parsed.estimatedMonthlyRevenue || 500,
      };
    } catch (err) {
      logger.warn('[ChannelExpansion] Failed to create clone blueprint');
      return null;
    }
  }

  async testNiches(userId: string, baseNiche: string): Promise<{ niche: string; predictedScore: number; reason: string }[]> {
    logger.info(`[ChannelExpansion] Testing niches related to "${baseNiche}"`);

    const response = await generateWithAI(`
      Given a YouTube channel currently in the "${baseNiche}" niche,
      suggest 3-5 RELATED niches that could be tested for expansion.

      For each niche, provide:
      - Niche name
      - How it relates to the base niche
      - Predicted success score (0-100)
      - Content overlap with base niche

      Return JSON array:
      [{"niche": "niche name", "predictedScore": 0-100, "reason": "why this niche works"}]

      Consider:
      - Audience overlap
      - Content style similarity
      - Production requirements
      - Monetization potential

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = extractJsonArray(response) as any[];
      if (!parsed) return [];

      return parsed.slice(0, 5).map((n: any) => ({
        niche: n.niche,
        predictedScore: Math.min(100, Math.max(0, n.predictedScore || 50)),
        reason: n.reason || '',
      }));
    } catch {
      return [];
    }
  }

  async killUnderperformingChannels(dryRun = true): Promise<{ killed: string[]; warnings: string[] }> {
    return this.performanceScaler.killUnderperformingChannels(dryRun);
  }

  async getExpansionReport(userId: string): Promise<{
    currentChannels: number;
    expansionOpportunities: { niche: string; predictedScore: number; reason: string }[];
    recommendedActions: string[];
  }> {
    const channels = await prisma.youTubeAccount.findMany({
      where: { userId, isConnected: true },
    });

    const channelNiche = channels.length > 0
      ? (await prisma.contentStrategy.findFirst({
          where: { channelId: channels[0].id },
        }))?.niche || 'General'
      : 'General';

    const niches = await this.testNiches(userId, channelNiche);

    const recommendedActions: string[] = [];
    if (niches.length > 0) {
      const bestNiche = niches[0];
      if (bestNiche.predictedScore > 60) {
        recommendedActions.push(`Launch "${bestNiche.niche}" channel - predicted success ${bestNiche.predictedScore}%`);
      }
    }

    const topChannels = await this.performanceScaler.evaluateAllChannels();
    const topPerformer = topChannels.sort((a, b) => b.performanceScore - a.performanceScore)[0];
    if (topPerformer && topPerformer.performanceScore > this.performanceScaler['HIGH_PERFORMANCE_THRESHOLD']) {
      const niche = topPerformer.recommendedNiche || channelNiche;
      recommendedActions.push(`Scale up: Clone strategy from "${topPerformer.channelTitle}" to new "${niche}" channel`);
    }

    return {
      currentChannels: channels.length,
      expansionOpportunities: niches,
      recommendedActions,
    };
  }
}
