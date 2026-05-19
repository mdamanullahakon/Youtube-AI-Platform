import { google } from 'googleapis';
import { env } from '../config/env';
import { generateWithAI } from './ai.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface ViralTopicIdea {
  title: string;
  niche: string;
  hookPreview: string;
  curiosityScore: number;
  emotionalTriggers: string[];
  searchVolume: number;
  competition: number;
  monetizationScore: number;
  overallScore: number;
  whyViral: string;
}

const MONETIZATION_SCORES: Record<string, number> = {
  'true crime': 85, 'paranormal': 78, 'conspiracy': 82,
  'missing persons': 80, 'unsolved mysteries': 85, 'horror documentary': 75,
  'analog horror': 70, 'psychological horror': 72, 'creepy stories': 68,
  'scary mysteries': 74, 'haunted': 76, 'occult': 80,
};

export class ViralTopicFinder {
  async findDailyTopics(niches: string[] = ['horror', 'paranormal', 'true crime', 'unsolved mysteries']): Promise<ViralTopicIdea[]> {
    logger.info(`[ViralTopicFinder] Finding trending topics across ${niches.length} niches`);
    const allIdeas: ViralTopicIdea[] = [];

    for (const niche of niches) {
      const trending = await this.searchTrending(niche);
      const aiIdeas = await this.generateAIIdeas(niche, trending);
      const scored = this.scoreIdeas(aiIdeas, niche);
      allIdeas.push(...scored.slice(0, 5));
    }

    allIdeas.sort((a, b) => b.overallScore - a.overallScore);

    await this.saveDailyTopics(allIdeas);

    logger.info(`[ViralTopicFinder] Generated ${allIdeas.length} scored ideas, top: "${allIdeas[0]?.title?.substring(0, 60)}"`);

    return allIdeas.slice(0, 10);
  }

  async getTopIdeasForNiche(niche: string, count: number = 10): Promise<ViralTopicIdea[]> {
    const topics = await this.findDailyTopics([niche]);
    return topics.slice(0, count);
  }

  private async searchTrending(niche: string): Promise<string[]> {
    if (!env.YOUTUBE_API_KEY) {
      return [
        `The ${niche} case that was hidden from public`,
        `I investigated ${niche} for 30 days: what I found`,
        `Top 10 ${niche} mysteries that remain unsolved`,
        `The ${niche} documentary they tried to delete`,
      ];
    }

    try {
      const youtube = google.youtube({ version: 'v3', auth: env.YOUTUBE_API_KEY });
      const response = await youtube.search.list({
        part: ['snippet'],
        q: niche,
        order: 'viewCount',
        maxResults: 15,
        type: ['video'],
        relevanceLanguage: 'en',
      });

      return response.data.items
        ?.map(i => i.snippet?.title)
        .filter(Boolean) as string[] || [];
    } catch {
      return [];
    }
  }

  private async generateAIIdeas(niche: string, trending: string[]): Promise<ViralTopicIdea[]> {
    const response = await generateWithAI(`
      You are a viral YouTube topic researcher. Generate 8 high-potential video ideas in "${niche}".

      Currently trending in niche:
      ${trending.map(t => `- "${t}"`).join('\n')}

      For each idea, provide:
      1. Video title (CTR-optimized, curiosity gap)
      2. Hook preview (first 15 words)
      3. Why it will go viral
      4. Emotional triggers activated
      5. Monetization potential (0-100)

      Rules:
      - Never repeat existing trending topics exactly
      - Find angles competitors missed
      - Focus on curiosity gaps and fear/mystery
      - Prioritize searchable topics with high RPM

      Return as JSON array:
      [{"title": "", "hookPreview": "", "whyViral": "", "emotionalTriggers": [""], "monetizationScore": 0}]
    `, 'ollama', { temperature: 0.8 });

    try {
      const parsed = extractJsonArray<any>(response);
      if (parsed?.length) return parsed;
    } catch {}

    return [
      { title: `The ${niche} File They Don't Want You To See`, hookPreview: `What if everything you knew about ${niche} was just the surface...`, whyViral: `Curiosity gap + conspiracy appeal`, emotionalTriggers: ['curiosity', 'mystery', 'distrust'], monetizationScore: 80, niche, curiosityScore: 80, searchVolume: 50000, competition: 40, overallScore: 75 },
      { title: `I Solved The ${niche} Case In 24 Hours`, hookPreview: `They said it was unsolvable. Here is what I found.`, whyViral: `Challenge narrative + resolution promise`, emotionalTriggers: ['curiosity', 'suspense', 'satisfaction'], monetizationScore: 75, niche, curiosityScore: 85, searchVolume: 45000, competition: 35, overallScore: 78 },
    ];
  }

  private scoreIdeas(ideas: ViralTopicIdea[], niche: string): ViralTopicIdea[] {
    return ideas.map(idea => {
      const curiosityScore = this.scoreCuriosity(idea.title);
      const emotionalScore = (idea.emotionalTriggers?.length || 0) * 10;
      const monetizationScore = MONETIZATION_SCORES[niche.toLowerCase()] || idea.monetizationScore || 65;
      const competition = this.estimateCompetition(idea.title);
      const searchVolume = this.estimateSearchVolume(idea.title);

      const overallScore = Math.round(
        curiosityScore * 0.30 +
        emotionalScore * 0.20 +
        monetizationScore * 0.25 +
        (100 - competition) * 0.15 +
        Math.min(searchVolume / 10000, 100) * 0.10
      );

      return {
        ...idea,
        niche,
        curiosityScore,
        searchVolume,
        competition,
        monetizationScore,
        overallScore: Math.min(100, overallScore),
      };
    }).sort((a, b) => b.overallScore - a.overallScore);
  }

  private scoreCuriosity(title: string): number {
    let score = 30;
    const t = title.toLowerCase();
    if (t.includes('?')) score += 15;
    if (t.includes('truth') || t.includes('real') || t.includes('secret')) score += 15;
    if (t.includes('found') || t.includes('discovered') || t.includes('revealed')) score += 15;
    if (t.includes('never') || t.includes('before') || t.includes('hidden')) score += 15;
    if (t.includes('you') || t.includes('your')) score += 10;
    if (t.match(/^\d+/)) score += 10;
    if (t.length < 40) score += 5;
    if (t.length > 80) score -= 10;
    return Math.min(100, score);
  }

  private estimateCompetition(title: string): number {
    const highCompetition = ['top 10', 'best', 'scary', 'creepy', 'mystery'];
    const t = title.toLowerCase();
    const matches = highCompetition.filter(kw => t.includes(kw)).length;
    return Math.min(90, 30 + matches * 20);
  }

  private estimateSearchVolume(title: string): number {
    const words = title.toLowerCase().split(/\s+/);
    const highVolume = ['true crime', 'unsolved', 'mystery', 'murder', 'missing', 'haunted', 'paranormal', 'ghost', 'documentary'];
    const matches = highVolume.filter(kw => words.some(w => kw.includes(w))).length;
    return 10000 + matches * 5000;
  }

  private async saveDailyTopics(ideas: ViralTopicIdea[]): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      for (const idea of ideas) {
        await prisma.trendResearch.create({
          data: {
            projectId: `trend_${today}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            topic: idea.title.substring(0, 200),
            viralScore: idea.overallScore,
            competition: idea.competition,
            audience: idea.niche,
            format: 'long-form',
            trends: idea as any,
            source: 'viral-topic-finder',
          },
        }).catch(() => {});
      }
    } catch {}
  }
}
