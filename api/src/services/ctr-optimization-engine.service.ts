import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray, extractJson } from '../utils/parse-ai-response';

export interface ScoredTitle {
  title: string;
  curiosityGap: number;
  emotionalTrigger: number;
  keywordDensity: number;
  ctrPrediction: number;
  viralPotential: number;
  overallScore: number;
  type: string;
  powerWords: string[];
  reasoning: string;
}

export interface TitlePerformanceRecord {
  title: string;
  impressions: number;
  clicks: number;
  ctr: number;
  retention: number;
  tested: boolean;
  winner: boolean;
}

export class CTROptimizationEngine {
  async generateAndScoreTitles(topic: string, hook: string, niche?: string, keywords?: string[]): Promise<ScoredTitle[]> {
    logger.info(`[CTR Engine] Generating scored titles for: ${topic}`);

    const keywordContext = keywords?.length ? `\nTarget keywords: ${keywords.join(', ')}` : '';

    const response = await generateWithAI(`
      You are a YouTube CTR optimization expert. Generate 5 title variations for MAXIMUM CTR.

      Topic: "${topic}"
      Hook: "${hook}"${keywordContext}

      For each title, score these dimensions 0-100:
      - curiosityGap: Information asymmetry that forces clicks
      - emotionalTrigger: Emotional response (fear, anger, joy, shock, curiosity)
      - keywordDensity: SEO keyword inclusion without stuffing
      - ctrPrediction: Predicted click-through rate
      - viralPotential: Shareability and engagement probability

      Power words: shocking, incredible, never, secret, revealed, destroyed, exposed, mind-blowing, genius, dangerous, illegal, banned, terrifying, unstoppable, ultimate

      Return JSON array of 5 titles:
      [{
        "title": "title (max 70 chars, use title case)",
        "type": "curiosity-gap" | "emotional-trigger" | "shocking-reveal" | "list-number" | "how-to" | "question" | "controversial" | "personal-story",
        "curiosityGap": 0-100,
        "emotionalTrigger": 0-100,
        "keywordDensity": 0-100,
        "ctrPrediction": 0-100,
        "viralPotential": 0-100,
        "powerWords": ["word1", "word2"],
        "reasoning": "why this title drives clicks"
      }]

      Title optimization rules:
      - Use odd numbers (3, 5, 7, 10) for list titles
      - Create curiosity gaps that can ONLY be satisfied by watching
      - Use emotional power words in the first 30 chars
      - Keep under 60 chars for full display on mobile
      - No clickbait that doesn't deliver - curiosity must be satisfied
      - Brackets [ ] and parentheses ( ) increase CTR by 30%

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.8 });

    try {
      const parsed = extractJsonArray(response);
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        return this.getDefaultScoredTitles(topic);
      }

      return parsed.map((t: any) => {
        const curiosityGap = this.clampScore(t.curiosityGap);
        const emotionalTrigger = this.clampScore(t.emotionalTrigger);
        const keywordDensity = this.clampScore(t.keywordDensity);
        const ctrPrediction = this.clampScore(t.ctrPrediction);
        const viralPotential = this.clampScore(t.viralPotential);

        const overallScore = Math.round(
          curiosityGap * 0.25 +
          emotionalTrigger * 0.25 +
          keywordDensity * 0.15 +
          ctrPrediction * 0.20 +
          viralPotential * 0.15
        );

        return {
          title: (t.title || topic).substring(0, 70),
          curiosityGap,
          emotionalTrigger,
          keywordDensity,
          ctrPrediction,
          viralPotential,
          overallScore,
          type: t.type || 'curiosity-gap',
          powerWords: Array.isArray(t.powerWords) ? t.powerWords : [],
          reasoning: t.reasoning || '',
        };
      }).sort((a: ScoredTitle, b: ScoredTitle) => b.overallScore - a.overallScore);
    } catch (err) {
      logger.warn('[CTR Engine] Failed to parse title variants, using defaults');
      return this.getDefaultScoredTitles(topic);
    }
  }

  async selectBestTitle(variants: ScoredTitle[]): Promise<ScoredTitle> {
    if (variants.length === 0) {
      return this.getDefaultScoredTitles('Topic')[0];
    }

    const history = await prisma.aBTestResult.findMany({
      where: { testType: 'title', status: 'completed', statisticallySignificant: true },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });

    const winningPatterns = history
      .filter(t => t.winner !== null)
      .map(t => t.winner === 'A' ? t.variantA : t.variantB);

    const scored = variants.map(v => {
      let historyBoost = 0;
      for (const pattern of winningPatterns) {
        if (pattern.toLowerCase().includes(v.title.substring(0, 20).toLowerCase())) {
          historyBoost += 5;
        }
      }

      return {
        ...v,
        overallScore: Math.min(100, v.overallScore + historyBoost),
      };
    });

    scored.sort((a, b) => b.overallScore - a.overallScore);
    return scored[0];
  }

  async recordTitlePerformance(projectId: string, title: string, ctr: number, retention: number): Promise<void> {
    await prisma.aBTestResult.updateMany({
      where: {
        projectId,
        testType: 'title',
        OR: [
          { variantA: { contains: title.substring(0, 50) } },
          { variantB: { contains: title.substring(0, 50) } },
        ],
      },
      data: {
        ctrA: ctr,
        retentionA: retention,
      },
    });
  }

  async getHighPerformingTitlePatterns(niche?: string): Promise<string[]> {
    const where: any = { testType: 'title', status: 'completed', statisticallySignificant: true };
    const tests = await prisma.aBTestResult.findMany({
      where,
      orderBy: { confidence: 'desc' },
      take: 50,
    });

    const winningTitles = tests
      .filter(t => t.winner !== null)
      .map(t => t.winner === 'A' ? t.variantA : t.variantB)
      .filter(Boolean);

    if (winningTitles.length < 3) return [];

    const analysis = await generateWithAI(`
      Analyze these winning YouTube titles and extract 3 title formula patterns:

      ${winningTitles.slice(0, 20).map((t, i) => `${i + 1}. "${t}"`).join('\n')}

      Return JSON array of 3 pattern strings:
      ["pattern 1 with {placeholder} syntax", "pattern 2", "pattern 3"]

      Example: "I {tried/did} {topic} For {number} Days — Here's What Happened"
      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJsonArray<string>(analysis);
      return parsed || [];
    } catch {
      return [];
    }
  }

  private getDefaultScoredTitles(topic: string): ScoredTitle[] {
    return [
      { title: `${topic}: The Shocking Truth Nobody Talks About`, curiosityGap: 92, emotionalTrigger: 85, keywordDensity: 60, ctrPrediction: 88, viralPotential: 80, overallScore: 83, type: 'curiosity-gap', powerWords: ['shocking', 'truth'], reasoning: 'Curiosity gap + emotional trigger' },
      { title: `I Tried ${topic} For 30 Days — Here's What Happened`, curiosityGap: 88, emotionalTrigger: 75, keywordDensity: 55, ctrPrediction: 85, viralPotential: 82, overallScore: 79, type: 'personal-story', powerWords: ['tried'], reasoning: 'Personal experiment story creates curiosity' },
      { title: `${topic} Explained In 5 Minutes`, curiosityGap: 65, emotionalTrigger: 40, keywordDensity: 90, ctrPrediction: 70, viralPotential: 55, overallScore: 64, type: 'how-to', powerWords: [], reasoning: 'SEO-optimized clear value proposition' },
      { title: `10 ${topic} Facts That Will Blow Your Mind`, curiosityGap: 80, emotionalTrigger: 78, keywordDensity: 65, ctrPrediction: 82, viralPotential: 88, overallScore: 79, type: 'list-number', powerWords: ['blow', 'mind'], reasoning: 'List format + odd number + emotional reaction' },
      { title: `Why ${topic} Is More Dangerous Than You Think`, curiosityGap: 90, emotionalTrigger: 88, keywordDensity: 55, ctrPrediction: 86, viralPotential: 75, overallScore: 81, type: 'shocking-reveal', powerWords: ['dangerous'], reasoning: 'Fear trigger + curiosity gap = high CTR' },
    ];
  }

  private clampScore(v: any): number {
    return Math.min(100, Math.max(0, typeof v === 'number' ? Math.round(v) : 50));
  }
}
