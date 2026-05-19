import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJsonArray, extractJson } from '../../utils/parse-ai-response';

export interface ScoredTopic {
  id: string;
  title: string;
  niche: string;
  hookIdea: string;
  estimatedCTR: number;
  estimatedRetention: number;
  estimatedMonetization: number;
  estimatedViralScore: number;
  riskScore: number;
  totalScore: number;
  reasoning: string;
  format: 'long-form' | 'shorts';
  productionCost: number;
  thumbnailIdea: string;
}

export interface DailyTopicReport {
  channelId: string;
  channelTitle: string;
  date: string;
  topics: ScoredTopic[];
  bestTopic: ScoredTopic | null;
  niche: string;
  trendInsights: string[];
  generationTime: number;
  qualityGate: 'pass' | 'fallback' | 'regenerate';
}

const MIN_QUALITY_THRESHOLD = 40;
const TOPICS_PER_DAY = 4;

export class DailyContentPlanner {
  async planDailyContent(channelId: string): Promise<DailyTopicReport> {
    const startTime = Date.now();
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    const niche = await this.detectNiche(channelId);
    const pastTopics = await this.getPastTopics(channelId);
    const trendInsights = await this.getTrendInsights(niche);
    const winningPattern = await this.getLastWinningPattern(channelId);
    const previousFailures = await this.getPreviousFailures(channelId);

    let topics = await this.generateTopics(niche, channelId, pastTopics, trendInsights, winningPattern, previousFailures);
    let qualityGate: 'pass' | 'fallback' | 'regenerate' = 'pass';

    if (topics.length === 0 || topics.every(t => t.totalScore < MIN_QUALITY_THRESHOLD)) {
      logger.warn(`[ContentPlanner] No topics passed quality gate for ${channelId}. Trying fallback.`);
      topics = await this.generateFallbackTopics(niche, channelId, pastTopics);
      qualityGate = 'fallback';

      if (topics.length === 0 || topics.every(t => t.totalScore < MIN_QUALITY_THRESHOLD)) {
        logger.warn(`[ContentPlanner] Fallback also failed for ${channelId}. Forcing regeneration.`);
        topics = this.forceSafeTopics(niche);
        qualityGate = 'regenerate';
      }
    }

    const scored = this.applyHistoricalBoosts(topics, channelId);
    const sorted = scored.sort((a, b) => b.totalScore - a.totalScore);
    const bestTopic = sorted[0] || null;

    await this.saveTopicReport(channelId, sorted);

    logger.info(`[ContentPlanner] ${channel.channelTitle}: ${sorted.length} topics generated (best: ${bestTopic?.title || 'none'}, score: ${bestTopic?.totalScore || 0})`);

    return {
      channelId,
      channelTitle: channel.channelTitle || 'Unknown',
      date: new Date().toISOString(),
      topics: sorted.slice(0, TOPICS_PER_DAY),
      bestTopic,
      niche,
      trendInsights,
      generationTime: Date.now() - startTime,
      qualityGate,
    };
  }

  private async generateTopics(
    niche: string,
    channelId: string,
    pastTopics: string[],
    trendInsights: string[],
    winningPattern: string | null,
    previousFailures: string[]
  ): Promise<ScoredTopic[]> {
    const prompt = `You are a YouTube content strategist. Generate ${TOPICS_PER_DAY} high-potential video topics for a YouTube channel.

Niche: "${niche}"
Avoid these recent topics (already covered): ${pastTopics.slice(0, 10).join(', ') || 'none'}
Previous failures (avoid similar): ${previousFailures.slice(0, 5).join(', ') || 'none'}
Current trends: ${trendInsights.slice(0, 3).join(', ') || 'general trends in niche'}
${winningPattern ? `Winning pattern from best video: ${winningPattern}` : ''}

Each topic must have:
- Strong curiosity gap
- High retention potential (>50%)
- Monetization friendly (products to sell, affiliates to promote)
- Low production risk (easy to script and render)
- Different from each other (diverse angles)

Return a JSON array of ${TOPICS_PER_DAY} topics:
[
  {
    "title": "clickable video title",
    "niche": "${niche}",
    "hookIdea": "first 5 seconds hook description",
    "estimatedCTR": 7.5,
    "estimatedRetention": 65,
    "estimatedMonetization": 70,
    "estimatedViralScore": 60,
    "riskScore": 20,
    "reasoning": "why this topic will perform well",
    "format": "long-form or shorts",
    "productionCost": 15,
    "thumbnailIdea": "thumbnail concept description"
  }
]

IMPORTANT:
- estimatedCTR: 3-15 range (higher = better)
- estimatedRetention: 30-80 range
- estimatedMonetization: 0-100 range (higher = more monetizable)
- estimatedViralScore: 0-100 range
- riskScore: 0-100 range (lower = safer)
- totalScore will be calculated automatically
- Make topics specific, not generic
- Each topic must be unique and differentiated`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.8, maxTokens: 2048 });
    const raw = extractJsonArray<ScoredTopic>(response);

    if (!raw || raw.length === 0) return [];

    return raw.map(t => ({
      ...t,
      id: `topic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      totalScore: this.computeTotalScore(t),
      format: t.format || 'long-form',
    }));
  }

  private async generateFallbackTopics(niche: string, channelId: string, pastTopics: string[]): Promise<ScoredTopic[]> {
    const safeTopics = this.getSafeTopicsForNiche(niche);
    return safeTopics
      .filter(t => !pastTopics.includes(t.title))
      .slice(0, TOPICS_PER_DAY)
      .map((t, i) => ({
        id: `fallback_${Date.now()}_${i}`,
        title: t.title,
        niche,
        hookIdea: t.hook,
        estimatedCTR: 5,
        estimatedRetention: 45,
        estimatedMonetization: 40,
        estimatedViralScore: 35,
        riskScore: 15,
        totalScore: 45,
        reasoning: 'Fallback topic — safe, proven format in this niche',
        format: 'long-form' as const,
        productionCost: 10,
        thumbnailIdea: t.thumbnail,
      }));
  }

  private forceSafeTopics(niche: string): ScoredTopic[] {
    return [
      {
        id: `forced_${Date.now()}_0`, title: `The Truth About ${niche} Nobody Talks About`,
        niche, hookIdea: 'Start with a shocking truth statement', estimatedCTR: 4.5,
        estimatedRetention: 40, estimatedMonetization: 30, estimatedViralScore: 25,
        riskScore: 10, totalScore: 42, reasoning: 'Forced safe topic — broad appeal, low risk',
        format: 'long-form', productionCost: 8, thumbnailIdea: 'Text overlay with bold claim',
      },
      {
        id: `forced_${Date.now()}_1`, title: `How I Mastered ${niche} in 30 Days`,
        niche, hookIdea: 'Personal story hook', estimatedCTR: 5,
        estimatedRetention: 45, estimatedMonetization: 35, estimatedViralScore: 30,
        riskScore: 10, totalScore: 45, reasoning: 'Forced safe topic — personal journey format works',
        format: 'long-form', productionCost: 8, thumbnailIdea: 'Before/after split image',
      },
      {
        id: `forced_${Date.now()}_2`, title: `Top 10 ${niche} Strategies That Actually Work`,
        niche, hookIdea: 'Listicle hook with promise', estimatedCTR: 4.8,
        estimatedRetention: 42, estimatedMonetization: 40, estimatedViralScore: 28,
        riskScore: 8, totalScore: 44, reasoning: 'Forced safe topic — listicle format guarantees retention',
        format: 'long-form', productionCost: 8, thumbnailIdea: 'Number list with icons',
      },
      {
        id: `forced_${Date.now()}_3`, title: `${niche} Experts Don't Want You to Know This`,
        niche, hookIdea: 'Controversy/exclusive info hook', estimatedCTR: 5.5,
        estimatedRetention: 38, estimatedMonetization: 35, estimatedViralScore: 32,
        riskScore: 15, totalScore: 43, reasoning: 'Forced safe topic — controversy drives clicks',
        format: 'long-form', productionCost: 8, thumbnailIdea: 'Shock face with red arrow',
      },
    ];
  }

  private computeTotalScore(t: ScoredTopic): number {
    return Math.round(
      (Math.min(15, t.estimatedCTR) * 0.25) +
      (t.estimatedRetention * 0.25) +
      (t.estimatedMonetization * 0.20) +
      (t.estimatedViralScore * 0.15) +
      (Math.max(0, 100 - t.riskScore) * 0.10) +
      (Math.max(0, 100 - t.productionCost) * 0.05)
    );
  }

  private applyHistoricalBoosts(topics: ScoredTopic[], channelId: string): ScoredTopic[] {
    return topics.map(t => {
      let boost = 0;
      if (t.estimatedMonetization > 60) boost += 5;
      if (t.estimatedCTR > 8) boost += 3;
      if (t.estimatedRetention > 60) boost += 3;
      if (t.riskScore < 20) boost += 2;
      if (t.format === 'long-form') boost += 2;
      return { ...t, totalScore: Math.min(100, t.totalScore + boost) };
    });
  }

  private async detectNiche(channelId: string): Promise<string> {
    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });
    if (strategy?.niche) return strategy.niche;

    const topProject = await prisma.videoProject.findFirst({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { trendResearch: true },
      orderBy: { analytics: { views: 'desc' } },
    });
    if (topProject?.trendResearch?.audience) return topProject.trendResearch.audience;

    return 'general';
  }

  private async getPastTopics(channelId: string): Promise<string[]> {
    const projects = await prisma.videoProject.findMany({
      where: { channelId },
      select: { topic: true, title: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return projects.map(p => p.topic || p.title || '').filter(Boolean);
  }

  private async getTrendInsights(niche: string): Promise<string[]> {
    try {
      const opportunities = await prisma.viralOpportunity.findMany({
        where: { niche, viralScore: { gte: 50 } },
        orderBy: { viralScore: 'desc' },
        take: 5,
      });
      return opportunities.map(o => o.topic);
    } catch {
      return [];
    }
  }

  private async getLastWinningPattern(channelId: string): Promise<string | null> {
    const bestVideo = await prisma.videoProject.findFirst({
      where: { channelId, uploadHistory: { status: 'published' } },
      include: { analytics: true },
      orderBy: { analytics: { views: 'desc' } },
    });
    if (!bestVideo?.title) return null;
    return `Best video: "${bestVideo.title}" (CTR: ${bestVideo.analytics?.ctr || 'N/A'}%, Retention: ${bestVideo.analytics?.retention || 'N/A'}%)`;
  }

  private async getPreviousFailures(channelId: string): Promise<string[]> {
    const failed = await prisma.videoProject.findMany({
      where: { channelId, status: 'failed' },
      select: { topic: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return failed.map(f => f.topic).filter(Boolean) as string[];
  }

  private async saveTopicReport(channelId: string, topics: ScoredTopic[]): Promise<void> {
    const key = `income:topic_report:${channelId}:${new Date().toISOString().split('T')[0]}`;

    await prisma.appConfig.upsert({
      where: { key },
      update: { value: JSON.stringify({ topics, generatedAt: new Date().toISOString() }) },
      create: { key, value: JSON.stringify({ topics, generatedAt: new Date().toISOString() }), description: `Daily topic report for ${channelId}` },
    });
  }

  private getSafeTopicsForNiche(niche: string): { title: string; hook: string; thumbnail: string }[] {
    const templates: Record<string, { title: string; hook: string; thumbnail: string }[]> = {
      'technology': [
        { title: 'Why [Trend] Is the Future of Tech', hook: 'Future prediction hook', thumbnail: 'Futuristic concept art' },
        { title: 'I Tested [Product] for 30 Days — Here\'s What Happened', hook: 'Personal experiment hook', thumbnail: 'Split screen before/after' },
        { title: 'Top 5 [Niche] Tools That Will Save You Hours', hook: 'Productivity promise hook', thumbnail: 'Tool lineup graphic' },
      ],
      'finance': [
        { title: 'How I Made $[Amount] with [Strategy]', hook: 'Money result hook', thumbnail: 'Money visual with bold number' },
        { title: 'The [Strategy] Trap Keeping You Poor', hook: 'Fear of missing out hook', thumbnail: 'Warning style red overlay' },
        { title: '5 [Niche] Mistakes That Cost Me Thousands', hook: 'Mistake confession hook', thumbnail: 'Mistake list with dollar signs' },
      ],
      'horror': [
        { title: 'The Scariest [Topic] Story You\'ll Hear Today', hook: 'Immediate fear hook', thumbnail: 'Dark creepy imagery' },
        { title: '3 True [Niche] Stories That Cannot Be Explained', hook: 'Mystery hook', thumbnail: 'Shadowy figure reveal' },
        { title: 'I Investigated [Location] — What I Found Was Terrifying', hook: 'Investigation hook', thumbnail: 'Dark location with flashlight' },
      ],
    };

    return templates[niche] || [
      { title: `The Ultimate Guide to ${niche} in 2026`, hook: 'Value promise hook', thumbnail: 'Guide style text overlay' },
      { title: `10 ${niche} Tips That Changed Everything`, hook: 'Number list hook', thumbnail: 'Numbered list with icons' },
      { title: `Why ${niche} Matters More Than You Think`, hook: 'Importance hook', thumbnail: 'Thought-provoking image' },
    ];
  }
}
