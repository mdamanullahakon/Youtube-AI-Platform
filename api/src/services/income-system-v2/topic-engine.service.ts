import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import {
  IncomeTopicScore,
  IncomeChannelConfig,
  IncomeWinningPattern,
  DEFAULT_VIDEOS_PER_DAY,
} from './types';

export class TopicEngine {
  async selectTopics(config: IncomeChannelConfig): Promise<IncomeTopicScore[]> {
    const { channelId, userId, niche, videosPerDay } = config;
    const count = videosPerDay || DEFAULT_VIDEOS_PER_DAY;

    const existing = await this.getCachedTopics(channelId, niche);
    if (existing.length >= count) {
      logger.info(`Using ${existing.length} cached topics for channel ${channelId}`);
      return existing.slice(0, count);
    }

    const hotPatterns = await this.getHotPatterns(niche, channelId);
    const winnerPatterns = await this.getWinnerPatterns(niche, channelId);
    const hasHotWinner = hotPatterns.length > 0;

    // 70% winner-based / 30% exploration
    const winnerCount = hasHotWinner ? Math.ceil(count * 0.7) : 0;
    const exploreCount = count - winnerCount;

    const existingTopics = new Set(existing.map(t => t.topic.toLowerCase().trim()));
    const allTopics: string[] = [];

    if (winnerCount > 0) {
      const patternTopics = await this.generateTopicsForPatterns(niche, winnerCount, hotPatterns);
      allTopics.push(...patternTopics.filter(t => !existingTopics.has(t.toLowerCase().trim()) && !allTopics.includes(t)));
    }

    if (exploreCount > 0) {
      const exploreTopics = (await this.generateTopicsWithAI(niche, exploreCount * 2, winnerPatterns))
        .filter(t => !existingTopics.has(t.toLowerCase().trim()));
      allTopics.push(...exploreTopics.filter(t => !allTopics.includes(t)));
    }

    const scored = await this.scoreTopics(allTopics.slice(0, count * 2), niche, winnerPatterns, hotPatterns);
    const sorted = scored.sort((a, b) => b.totalScore - a.totalScore);

    await this.cacheTopics(channelId, userId, niche, sorted);
    return sorted.slice(0, count);
  }

  async generateReplicationTopics(pattern: IncomeWinningPattern, count: number): Promise<IncomeTopicScore[]> {
    const topics = await this.generateTopicsForPatterns(pattern.niche || 'tech', count, [pattern]);
    const scored = await this.scoreTopics(topics, pattern.niche || 'tech', [pattern.patternValue], [pattern]);
    return scored.sort((a, b) => b.totalScore - a.totalScore).slice(0, count);
  }

  private async getCachedTopics(channelId: string, niche: string): Promise<IncomeTopicScore[]> {
    const cached = await prisma.incomeTopicCache.findMany({
      where: {
        channelId,
        niche,
        expiresAt: { gt: new Date() },
      },
      orderBy: { totalScore: 'desc' },
      take: 10,
    });
    return cached.map((c: { topic: string; niche: string; viralScore: number; competitionScore: number; monetizationScore: number; ctrPrediction: number; retentionPrediction: number; totalScore: number; reasoning: string; source: string }) => ({
      topic: c.topic,
      niche: c.niche,
      viralScore: c.viralScore,
      competitionScore: c.competitionScore,
      monetizationScore: c.monetizationScore,
      ctrPrediction: c.ctrPrediction,
      retentionPrediction: c.retentionPrediction,
      totalScore: c.totalScore,
      reasoning: c.reasoning,
      source: c.source as IncomeTopicScore['source'],
    }));
  }

  private async getHotPatterns(niche: string, channelId?: string): Promise<IncomeWinningPattern[]> {
    const patterns = await prisma.incomeWinnerPattern.findMany({
      where: {
        ...(channelId ? { channelId } : { niche }),
        OR: [
          { avgViews: { gt: 50 } },
          { avgCtr: { gt: 5 } },
        ],
      },
      orderBy: { score: 'desc' },
      take: 5,
    });
    return patterns.map(p => ({
      patternType: p.patternType as IncomeWinningPattern['patternType'],
      patternValue: p.patternValue,
      niche: p.niche,
      score: p.score,
      sampleSize: p.sampleSize,
      avgViews: p.avgViews,
      avgCtr: p.avgCtr,
      avgRetention: p.avgRetention,
      confidence: p.confidence,
    }));
  }

  private async getWinnerPatterns(niche: string, channelId?: string): Promise<string[]> {
    const patterns = await prisma.incomeWinnerPattern.findMany({
      where: {
        patternType: 'topic-type',
        niche,
        ...(channelId ? { channelId } : {}),
        confidence: { gte: 0.3 },
      },
      orderBy: { score: 'desc' },
      take: 5,
    });
    return patterns.map((p: { patternValue: string }) => p.patternValue);
  }

  private async generateTopicsForPatterns(
    niche: string,
    count: number,
    hotPatterns: IncomeWinningPattern[],
  ): Promise<string[]> {
    const patternContext = hotPatterns.map(p => `- ${p.patternType}: "${p.patternValue}" (avg CTR: ${p.avgCtr}%, avg views: ${p.avgViews})`).join('\n');

    const prompt = `You are a YouTube topic strategist for "${niche}".
Generate ${count * 2} video topics that EXPLOIT these proven winning patterns:

${patternContext}

Each topic MUST follow these winning patterns exactly.
- If title-style is "numbered" → all topics must start with a number
- If topic-type is "comparison" → all topics must compare things
- If hook-style is "curiosity-gap" → all topics must create mystery

Rules:
- Each topic must be clickable and specific
- Include "2026" in each topic
- Must be in "${niche}" niche
- Prioritize topics with high affiliate/product potential

Return ONLY a JSON array of strings: ["topic1", "topic2", ...]`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.7, maxTokens: 1000 });
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, count * 2);
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const extracted = JSON.parse(match[0]);
        if (Array.isArray(extracted)) return extracted.slice(0, count * 2);
      }
    } catch { /* fallback */ }

    return this.getFallbackTopics(niche, count * 2);
  }

  private async generateTopicsWithAI(
    niche: string,
    count: number,
    winnerPatterns: string[],
  ): Promise<string[]> {
    const winnerContext = winnerPatterns.length
      ? `\nWinning topic types to prioritize: ${winnerPatterns.join(', ')}`
      : '';

    const prompt = `You are a YouTube topic strategist for the "${niche}" niche. 
Generate ${count * 2} high-income YouTube video topics that will:
1. Get high CTR (click-through rate)
2. Have high retention (audience stays watching)
3. Have high monetization potential (affiliate products, high CPM ads)
4. Be trending or evergreen with search volume
5. Be specific, not generic
${winnerContext}

Return ONLY a JSON array of strings, each being a specific video topic.
Format: ["topic1", "topic2", ...]`;

    const raw = await generateWithAI(prompt, 'ollama', {
      temperature: 0.8,
      maxTokens: 1000,
    });

    const seen = new Set<string>();
    const dedup = (arr: string[]) => {
      const result: string[] = [];
      for (const item of arr) {
        const key = item.toLowerCase().trim();
        if (!seen.has(key)) { seen.add(key); result.push(item); }
      }
      return result;
    };

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return dedup(parsed.slice(0, count * 2));
      const match = raw.match(/\[[\s\S]*?\]/);
      if (match) {
        const extracted = JSON.parse(match[0]);
        if (Array.isArray(extracted)) return dedup(extracted.slice(0, count * 2));
      }
    } catch {
      const lines = raw.split('\n').filter(l => l.trim().startsWith('"') || l.trim().startsWith('-'));
      if (lines.length) return dedup(lines.map(l => l.replace(/^["\-\s]*/, '').replace(/["",]*$/, '')).slice(0, count * 2));
    }

    return this.getFallbackTopics(niche, count * 2);
  }

  private async scoreTopics(
    topics: string[],
    niche: string,
    winnerPatterns: string[],
    hotPatterns?: IncomeWinningPattern[],
  ): Promise<IncomeTopicScore[]> {
    const scores: IncomeTopicScore[] = [];

    for (const topic of topics) {
      const aiScore = await this.aiScoreTopic(topic, niche);
      const winnerBoost = this.calculateWinnerBoost(topic, winnerPatterns);
      const hotBoost = hotPatterns ? this.calculateHotBoost(topic, hotPatterns) : 0;
      const computedScore = (aiScore.viralScore + aiScore.competitionScore + aiScore.ctrPrediction + aiScore.retentionPrediction) / 4;
      const totalScore = computedScore * (1 + winnerBoost + hotBoost);

      scores.push({
        ...aiScore,
        topic,
        niche,
        totalScore,
        source: hotBoost > 0 ? 'winner-pattern' : (winnerPatterns.length > 0 && winnerBoost > 0 ? 'winner-pattern' : 'ai-generated'),
      });
    }

    return scores;
  }

  private async aiScoreTopic(topic: string, niche: string): Promise<Omit<IncomeTopicScore, 'topic' | 'niche' | 'totalScore' | 'source'>> {
    const prompt = `Score this YouTube video topic for the "${niche}" niche.
Topic: "${topic}"

Rate each from 0-100:
- viralScore: viral potential (hookability, shareability)
- competitionScore: INVERTED - higher means lower competition (good)
- ctrPrediction: click-through rate potential
- retentionPrediction: audience retention potential
- monetizationScore: affiliate/revenue potential (how much can this earn?)
- reasoning: brief why this topic scores well

Return ONLY valid JSON:
{"viralScore": 75, "competitionScore": 60, "ctrPrediction": 70, "retentionPrediction": 65, "monetizationScore": 50, "reasoning": "..."}`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.5, maxTokens: 500 });
    try {
      return JSON.parse(raw);
    } catch {
      return {
        viralScore: 50,
        competitionScore: 50,
        ctrPrediction: 50,
        retentionPrediction: 50,
        monetizationScore: 50,
        reasoning: 'AI score generation failed, using default',
      } as Omit<IncomeTopicScore, 'topic' | 'niche' | 'totalScore' | 'source'>;
    }
  }

  private calculateWinnerBoost(topic: string, winnerPatterns: string[]): number {
    if (!winnerPatterns.length) return 0;
    const matched = winnerPatterns.filter(p => topic.toLowerCase().includes(p.toLowerCase()));
    return matched.length * 0.15;
  }

  private calculateHotBoost(topic: string, hotPatterns: IncomeWinningPattern[]): number {
    if (!hotPatterns.length) return 0;
    let boost = 0;
    for (const p of hotPatterns) {
      const val = p.patternValue.toLowerCase();
      if (topic.toLowerCase().includes(val)) {
        boost += p.avgCtr > 5 ? 0.3 : 0.2;
      }
    }
    return Math.min(boost, 0.7);
  }

  private async cacheTopics(
    channelId: string,
    userId: string,
    niche: string,
    topics: IncomeTopicScore[],
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const data = topics.map(t => ({
      channelId,
      userId,
      niche,
      topic: t.topic,
      viralScore: t.viralScore,
      competitionScore: t.competitionScore,
      monetizationScore: t.monetizationScore,
      ctrPrediction: t.ctrPrediction,
      retentionPrediction: t.retentionPrediction,
      totalScore: t.totalScore,
      reasoning: t.reasoning,
      source: t.source,
      expiresAt,
    }));

    await prisma.incomeTopicCache.createMany({ data, skipDuplicates: true });
  }

  private getFallbackTopics(niche: string, count: number): string[] {
    const fallbacks: Record<string, string[]> = {
      'tech': ['7 AI Secrets Nobody Tells You in 2026', '5 Best Budget Smartphones 2026 — Shocked', 'How to Make Money with AI in 2026 (Real)'],
      'gaming': ['10 Insane Gaming Secrets in 2026', '3 Games That Will Change Your Life', 'The Truth About Gaming in 2026'],
      'finance': ['5 Money Secrets Banks Don\'t Want You to Know in 2026', 'How to Save $10k Fast in 2026', '3 Investments That Will Make You Rich in 2026'],
      'health': ['7 Health Myths Nobody Tells You in 2026', 'The Secret to Weight Loss in 2026', '3 Exercises That Change Your Body Fast'],
    };
    const nicheFallbacks = fallbacks[niche.toLowerCase()] || [
      `7 ${niche} Secrets Nobody Tells You in 2026`,
      `How to Start with ${niche} in 2026 (Full Guide)`,
      `5 ${niche} Mistakes That Cost You Money`,
      `The Truth About ${niche} in 2026`,
      `3 ${niche} Hacks That Changed Everything`,
      `10 ${niche} Trends You Need to Know in 2026`,
    ];
    return nicheFallbacks.slice(0, count);
  }
}
