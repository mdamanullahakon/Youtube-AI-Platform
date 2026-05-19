import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface CTRPrediction {
  predictedCTR: number;
  confidence: number;
  styleScore: number;
  emotionalTriggerScore: number;
  curiosityGapScore: number;
  nicheBenchmark: number;
  historicalAvg: number;
  improvements: string[];
}

export class CTRPredictor {
  async predictThumbnailCTR(style: string, topic: string, niche?: string): Promise<CTRPrediction> {
    logger.info(`Predicting CTR for style=${style}, topic=${topic}`);

    const historicalData = await prisma.thumbnailPerformance.findMany({
      where: { style },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const historicalCTRs = historicalData.filter(t => t.actualCTR > 0).map(t => t.actualCTR);
    const historicalAvg = historicalCTRs.length > 0
      ? historicalCTRs.reduce((a, b) => a + b, 0) / historicalCTRs.length
      : 0;

    const nicheData = niche ? await prisma.thumbnailPerformance.findMany({
      where: { project: { topic: { contains: niche } } },
      take: 20,
    }) : [];
    const nicheCTRs = nicheData.filter(t => t.actualCTR > 0).map(t => t.actualCTR);
    const nicheBenchmark = nicheCTRs.length > 0
      ? nicheCTRs.reduce((a, b) => a + b, 0) / nicheCTRs.length
      : 0;

    const analysis = await generateWithAI(`
      Predict CTR (click-through rate) for a YouTube thumbnail.

      Style: ${style}
      Topic: ${topic}
      Niche: ${niche || 'General'}
      Historical avg CTR for this style: ${historicalAvg.toFixed(1)}%
      Niche benchmark: ${nicheBenchmark.toFixed(1)}%

      Return JSON:
      {
        "predictedCTR": 0-100 (percentage),
        "emotionalTriggerScore": 0-100,
        "curiosityGapScore": 0-100,
        "styleScore": 0-100,
        "improvements": ["2-3 specific ways to improve CTR"]
      }

      Consider:
      - ${style} style typical performance
      - Niche competition level
      - Emotional triggers in topic
      - Curiosity gap potential
      - Historical data patterns
      - Be realistic, not optimistic

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      const predictedCTR = Math.min(100, Math.max(0, parsed.predictedCTR || historicalAvg || 5));
      const confidence = historicalCTRs.length > 10 ? 0.7 : historicalCTRs.length > 3 ? 0.4 : 0.2;

      return {
        predictedCTR,
        confidence,
        styleScore: Math.min(100, Math.max(0, parsed.styleScore || 50)),
        emotionalTriggerScore: Math.min(100, Math.max(0, parsed.emotionalTriggerScore || 50)),
        curiosityGapScore: Math.min(100, Math.max(0, parsed.curiosityGapScore || 50)),
        nicheBenchmark,
        historicalAvg,
        improvements: parsed.improvements || [],
      };
    } catch {
      return {
        predictedCTR: historicalAvg || 5,
        confidence: 0.2,
        styleScore: 50,
        emotionalTriggerScore: 50,
        curiosityGapScore: 50,
        nicheBenchmark,
        historicalAvg,
        improvements: ['Gather more historical data for better predictions'],
      };
    }
  }

  async predictTitleCTR(title: string, topic: string, niche?: string): Promise<{
    predictedCTR: number; powerWordScore: number; curiosityGap: number; emotionalAppeal: number; clarityScore: number;
  }> {
    const analysis = await generateWithAI(`
      Predict CTR for this YouTube title:
      "${title}"
      Topic: ${topic}
      Niche: ${niche || 'General'}

      Return JSON:
      {
        "predictedCTR": 0-100,
        "powerWordScore": 0-100,
        "curiosityGap": 0-100,
        "emotionalAppeal": 0-100,
        "clarityScore": 0-100
      }

      Score based on:
      - Power words presence (shocking, secret, never, etc.)
      - Curiosity gap strength
      - Emotional trigger intensity
      - Title clarity and relevance
      - Length optimization (40-70 chars ideal)

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;
      return {
        predictedCTR: Math.min(100, Math.max(0, parsed.predictedCTR || 50)),
        powerWordScore: Math.min(100, Math.max(0, parsed.powerWordScore || 50)),
        curiosityGap: Math.min(100, Math.max(0, parsed.curiosityGap || 50)),
        emotionalAppeal: Math.min(100, Math.max(0, parsed.emotionalAppeal || 50)),
        clarityScore: Math.min(100, Math.max(0, parsed.clarityScore || 50)),
      };
    } catch {
      return { predictedCTR: 5, powerWordScore: 50, curiosityGap: 50, emotionalAppeal: 50, clarityScore: 50 };
    }
  }

  async recordActualCTR(projectId: string, style: string, actualCTR: number): Promise<void> {
    await prisma.thumbnailPerformance.updateMany({
      where: { projectId, style },
      data: { actualCTR },
    });
    logger.info(`Recorded actual CTR ${actualCTR}% for project ${projectId} (${style})`);
  }
}
