import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { prisma } from '../config/db';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface TitleVariant {
  title: string;
  type: 'safest' | 'highest-ctr' | 'seo-friendly' | 'viral-style';
  ctrScore: number;
  curiosityScore: number;
  emotionalScore: number;
  seoScore: number;
  reasoning: string;
}

export class TitleOptimizer {
  async generateVariants(topic: string, hook: string, niche?: string): Promise<TitleVariant[]> {
    logger.info(`Generating title variants for: ${topic}`);

    const strategy = niche ? await prisma.contentStrategy.findUnique({ where: { niche } }) : null;

    const nicheContext = strategy
      ? `\nNiche strategy: ${strategy.tone} tone, ${strategy.hookStyle} hooks`
      : '';

    const analysis = await generateWithAI(`
      Generate 4 YouTube title variations for this video:

      Topic: "${topic}"
      Hook: "${hook}"${nicheContext}

      Return JSON array of 4 titles:
      [
        {
          "title": "the title (max 70 chars)",
          "type": "safest" | "highest-ctr" | "seo-friendly" | "viral-style",
          "ctrScore": 0-100,
          "curiosityScore": 0-100,
          "emotionalScore": 0-100,
          "seoScore": 0-100,
          "reasoning": "why this title works"
        }
      ]

      Title types:
      - safest: Broad appeal, lower risk, guaranteed decent CTR
      - highest-ctr: Maximum click-through, uses power words + curiosity gap
      - seo-friendly: Keyword-optimized for search discovery
      - viral-style: Controversial/emotional, high share probability

      Power words to use: shocking, incredible, never before, secret, revealed, changed my life, destroyed, exposed, mind-blowing, genius
      Curiosity gap: Create information asymmetry (they NEED to click to understand)

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.7 });

    try {
      const parsed = extractJsonArray(analysis);
      if (!parsed) return this.getDefaults(topic);

      return parsed.map((t: any) => ({
        title: t.title?.substring(0, 70) || topic,
        type: t.type || 'safest',
        ctrScore: Math.min(100, Math.max(0, t.ctrScore || 50)),
        curiosityScore: Math.min(100, Math.max(0, t.curiosityScore || 50)),
        emotionalScore: Math.min(100, Math.max(0, t.emotionalScore || 50)),
        seoScore: Math.min(100, Math.max(0, t.seoScore || 50)),
        reasoning: t.reasoning || '',
      }));
    } catch {
      logger.warn('Failed to parse title variants, using defaults');
      return this.getDefaults(topic);
    }
  }

  async pickBestVariant(variants: TitleVariant[]): Promise<TitleVariant> {
    if (variants.length === 0) return { title: 'Untitled', type: 'safest', ctrScore: 0, curiosityScore: 0, emotionalScore: 0, seoScore: 0, reasoning: '' };

    const ranked = variants.sort((a, b) => {
      const aScore = a.ctrScore * 0.4 + a.curiosityScore * 0.3 + a.emotionalScore * 0.2 + a.seoScore * 0.1;
      const bScore = b.ctrScore * 0.4 + b.curiosityScore * 0.3 + b.emotionalScore * 0.2 + b.seoScore * 0.1;
      return bScore - aScore;
    });

    return ranked[0];
  }

  private getDefaults(topic: string): TitleVariant[] {
    return [
      { title: `${topic}: The Shocking Truth Nobody Talks About`, type: 'highest-ctr', ctrScore: 85, curiosityScore: 90, emotionalScore: 75, seoScore: 60, reasoning: 'Curiosity gap + emotional trigger' },
      { title: `I Tried ${topic} For 30 Days — Here's What Happened`, type: 'viral-style', ctrScore: 80, curiosityScore: 85, emotionalScore: 70, seoScore: 55, reasoning: 'Personal story + curiosity' },
      { title: `${topic} Explained: Everything You Need To Know`, type: 'seo-friendly', ctrScore: 65, curiosityScore: 50, emotionalScore: 40, seoScore: 90, reasoning: 'Keyword-optimized for search' },
      { title: `The Real Truth About ${topic}`, type: 'safest', ctrScore: 70, curiosityScore: 75, emotionalScore: 65, seoScore: 65, reasoning: 'Balanced appeal across audiences' },
    ];
  }
}
