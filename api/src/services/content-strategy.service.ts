import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { CompetitorIntelligenceEngine, type CompetitiveAnalysis } from './competitor-intelligence.service';
import { CrossChannelIntelligence } from './cross-channel-intelligence.service';

export interface ChannelStrategy {
  channelId: string;
  channelName: string;
  niche: string;
  language: string;
  uploadSchedule: string;
  contentStyle: string;
  thumbnailStyle: string;
  hookStyle: string;
  pacingProfile: string;
  avgLength: number;
  competitorInformed: boolean;
  competitiveEdge: string[];
}

export class ContentStrategyEngine {
  private competitorIntel: CompetitorIntelligenceEngine;
  private crossChannelIntel: CrossChannelIntelligence;

  constructor() {
    this.competitorIntel = new CompetitorIntelligenceEngine();
    this.crossChannelIntel = new CrossChannelIntelligence();
  }

  async generateStrategy(channelId: string, userId: string): Promise<ChannelStrategy> {
    logger.info(`[ContentStrategy] Generating strategy for channel ${channelId}`);
    const account = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!account) throw new Error(`Channel not found: ${channelId}`);

    const niche = account.channelTitle?.split(' ').slice(-1)[0]?.toLowerCase() || 'horror';
    const competitorAnalysis = await this.competitorIntel.analyzeNiche(niche, 3);
    const crossChannel = await this.crossChannelIntel.analyzeAllChannels(userId);

    const strategy = await this.buildStrategy(account, niche, competitorAnalysis, crossChannel);

    await this.saveStrategy(strategy);
    return strategy;
  }

  async getChannelStrategy(channelId: string): Promise<ChannelStrategy | null> {
    try {
      const saved = await prisma.strategyDecision.findFirst({
        where: { channelId, decisionType: 'CONTENT_STRATEGY' },
        orderBy: { decidedAt: 'desc' },
      });
      if (saved?.actions) return saved.actions as any;
    } catch {}
    return null;
  }

  private async buildStrategy(
    account: any,
    niche: string,
    competitorAnalysis: CompetitiveAnalysis,
    crossChannel: any
  ): Promise<ChannelStrategy> {
    const response = await generateWithAI(`
      You are a YouTube content strategist. Create a content strategy for channel "${account.channelTitle}" in "${niche}" niche.

      Competitor insights:
      ${JSON.stringify(competitorAnalysis.recommendations.slice(0, 3))}

      Cross-channel best practices:
      ${JSON.stringify(crossChannel.topStrategies?.slice(0, 2) || [])}

      Define:
      - contentStyle: specific video style (documentary/narrative/essay/reaction)
      - thumbnailStyle: specific visual approach
      - hookStyle: how to open videos
      - pacingProfile: fast/moderate/slow with pattern interrupt frequency
      - avgLength: target video length in seconds
      - competitiveEdge: 3 specific advantages over competitors

      Return as JSON object.
    `, 'ollama', { temperature: 0.5 });

    let parsed: any = {};
    try { parsed = JSON.parse(response); } catch {}

    return {
      channelId: account.channelId,
      channelName: account.channelTitle || 'Channel',
      niche,
      language: niche.includes('es') ? 'es' : niche.includes('pt') ? 'pt' : 'en',
      uploadSchedule: '3 times per week (Mon, Wed, Fri)',
      contentStyle: parsed.contentStyle || 'cinematic horror documentary with fast pacing',
      thumbnailStyle: parsed.thumbnailStyle || 'face-closeup with high contrast red/black',
      hookStyle: parsed.hookStyle || 'cold open with shocking statement + question',
      pacingProfile: parsed.pacingProfile || 'fast (pattern interrupt every 25s)',
      avgLength: parsed.avgLength || 720,
      competitorInformed: true,
      competitiveEdge: parsed.competitiveEdge || [
        `Faster pacing than ${competitorAnalysis.channels[0]?.title || 'competitors'}`,
        'More frequent uploads',
        'Better thumbnail CTR through testing',
      ],
    };
  }

  private async saveStrategy(strategy: ChannelStrategy): Promise<void> {
    try {
      await prisma.strategyDecision.create({
        data: {
          channelId: strategy.channelId,
          userId: 'system',
          decisionType: 'CONTENT_STRATEGY',
          growthScore: 85,
          reasoning: `Strategy generated for ${strategy.channelName}: ${strategy.contentStyle}, ${strategy.uploadSchedule}`,
          actions: strategy as any,
          applied: true,
        },
      });
    } catch (err: any) {
      logger.warn(`[ContentStrategy] Save failed: ${err.message}`);
    }
  }
}
