import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

export type PatternCategory = 'hook-structure' | 'title-formula' | 'thumbnail-style' | 'pacing-style' | 'storytelling-arc' | 'cta-formula' | 'emotional-trigger' | 'retention-loop';

export interface WinningPatternResult {
  category: PatternCategory;
  niche: string;
  content: string;
  patternType: string;
  score: number;
  sampleSize: number;
  avgRetention?: number;
  avgCTR?: number;
}

export class WinningPatternsService {
  async extractFromTranscript(transcript: string, title: string, videoId: string): Promise<void> {
    logger.info(`Extracting winning patterns from video: ${title}`);

    const analysis = await generateWithAI(`
      Analyze this YouTube video transcript and extract winning patterns:

      Title: "${title}"
      Transcript: "${transcript.substring(0, 3000)}"

      Return a JSON array of patterns found:
      [{
        "category": "hook-structure" | "title-formula" | "pacing-style" | "storytelling-arc" | "cta-formula" | "emotional-trigger" | "retention-loop",
        "content": "exact pattern or formula extracted",
        "patternType": "specific type identifier",
        "score": 0-100 (how effective this pattern is),
        "avgRetention": estimated retention impact 0-100,
        "avgCTR": estimated CTR impact 0-100
      }]

      Analyze for:
      1. HOOK STRUCTURE: How does it open? What technique?
      2. TITLE FORMULA: What makes the title clickable?
      3. PACING: Fast cuts? Slow build? Varied?
      4. STORYTELLING ARC: Problem-solution? Hero journey? Reveal?
      5. CTA FORMULA: How does it ask for engagement?
      6. EMOTIONAL TRIGGERS: Fear? Curiosity? Anger? Joy?
      7. RETENTION LOOPS: Pattern interrupts? Curiosity gaps?

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.3 });

    try {
      const patterns = extractJsonArray(analysis) as any[];
      if (!patterns) return;

      for (const pattern of patterns) {
        if (!pattern.category || !pattern.content) continue;

        const existing = await prisma.winningPattern.findFirst({
          where: { patternType: pattern.patternType || 'unknown', content: pattern.content.substring(0, 200) },
        });

        if (existing) {
          await prisma.winningPattern.update({
            where: { id: existing.id },
            data: {
              score: (existing.score * existing.sampleSize + (pattern.score || 50)) / (existing.sampleSize + 1),
              sampleSize: existing.sampleSize + 1,
              avgRetention: pattern.avgRetention,
              avgCTR: pattern.avgCTR,
              lastUsedAt: new Date(),
              confidence: Math.min(1, (existing.sampleSize + 1) / 20),
            },
          });
        } else {
          await prisma.winningPattern.create({
            data: {
              category: pattern.category,
              content: pattern.content,
              patternType: pattern.patternType || 'unknown',
              score: pattern.score || 50,
              avgRetention: pattern.avgRetention,
              avgCTR: pattern.avgCTR,
              confidence: 0.3,
            },
          });
        }
      }
    } catch (err) {
      logger.warn('Failed to parse winning patterns from transcript');
    }
  }

  async getTopPatterns(category?: PatternCategory, niche?: string, limit = 10): Promise<WinningPatternResult[]> {
    const where: any = { confidence: { gte: 0.3 } };
    if (category) where.category = category;
    if (niche) where.niche = niche;

    const patterns = await prisma.winningPattern.findMany({
      where,
      orderBy: [{ score: 'desc' }, { sampleSize: 'desc' }],
      take: limit,
    });

    return patterns.map(p => ({
      category: p.category as PatternCategory,
      niche: p.niche || 'General',
      content: p.content,
      patternType: p.patternType,
      score: p.score,
      sampleSize: p.sampleSize,
      avgRetention: p.avgRetention || undefined,
      avgCTR: p.avgCTR || undefined,
    }));
  }

  async getBestHooks(niche?: string, limit = 5): Promise<string[]> {
    const patterns = await this.getTopPatterns('hook-structure', niche, limit);
    return patterns.map(p => p.content);
  }

  async getBestTitleFormulas(niche?: string, limit = 5): Promise<string[]> {
    const patterns = await this.getTopPatterns('title-formula', niche, limit);
    return patterns.map(p => p.content);
  }

  async enrichScriptPrompt(basePrompt: string, topic: string, niche?: string): Promise<string> {
    const [hooks, titles, pacing, storytelling] = await Promise.all([
      this.getBestHooks(niche, 3),
      this.getBestTitleFormulas(niche, 3),
      this.getTopPatterns('pacing-style', niche, 2),
      this.getTopPatterns('storytelling-arc', niche, 2),
    ]);

    let enrichment = '\n\n--- WINNING PATTERNS FROM SUCCESSFUL VIDEOS ---\n';

    if (hooks.length > 0) {
      enrichment += '\nHigh-performing hook structures (use one):\n';
      hooks.forEach(h => { enrichment += `- ${h}\n`; });
    }

    if (titles.length > 0) {
      enrichment += '\nProven title formulas:\n';
      titles.forEach(t => { enrichment += `- ${t}\n`; });
    }

    if (pacing.length > 0) {
      enrichment += '\nEffective pacing styles:\n';
      pacing.forEach(p => { enrichment += `- ${p.content}\n`; });
    }

    if (storytelling.length > 0) {
      enrichment += '\nWinning storytelling structures:\n';
      storytelling.forEach(s => { enrichment += `- ${s.content}\n`; });
    }

    return basePrompt + enrichment;
  }
}
