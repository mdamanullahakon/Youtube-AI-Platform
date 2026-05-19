import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray, extractJson } from '../utils/parse-ai-response';

export interface ThumbnailConcept {
  style: string;
  prompt: string;
  contrastScore: number;
  facialEmotionIntensity: number;
  mobileReadability: number;
  clickTriggerScore: number;
  colorPsychologyScore: number;
  overallScore: number;
  textOverlay: string;
  composition: string;
  reasoning: string;
}

export class ThumbnailIntelligence {
  async generateMultipleConcepts(topic: string, hook: string, niche?: string): Promise<ThumbnailConcept[]> {
    logger.info(`[Thumbnail Intelligence] Generating scored concepts for: ${topic}`);

    const response = await generateWithAI(`
      You are a YouTube thumbnail CTR optimization expert. Generate 5 thumbnail concepts.

      Topic: "${topic}"
      Hook: "${hook}"

      Score each concept on these dimensions 0-100:
      - contrastScore: Luminance/brightness contrast, complementary colors
      - facialEmotionIntensity: How readable/extreme the emotion is
      - mobileReadability: How it looks on a small phone screen
      - clickTriggerScore: Psychological urge to click
      - colorPsychologyScore: Color choices that drive attention

      Thumbnail rules for VIRAL CTR:
      - 80% of top thumbnails use face close-ups with extreme emotion
      - Red, yellow, and bright blue outperform all other colors
      - Dark background with bright subject = 40% higher CTR
      - Text max 3 words, bold sans-serif font
      - Face should take up 60%+ of frame
      - Eyes should be wide, mouth open or extreme expression
      - Curiosity gap in expression + text overlay

      Return JSON array of 5 concepts:
      [{
        "style": "face-closeup-shock" | "bold-text-contrast" | "curiosity-gap-emotional" | "before-after" | "number-list" | "reaction-meme" | "minimalist-mystery" | "split-face-duality" | "arrow-pointer" | "zoom-crop",
        "prompt": "detailed DALL-E/Midjourney prompt optimized for thumbnail generation",
        "contrastScore": 0-100,
        "facialEmotionIntensity": 0-100,
        "mobileReadability": 0-100,
        "clickTriggerScore": 0-100,
        "colorPsychologyScore": 0-100,
        "textOverlay": "max 3 words, bold uppercase",
        "composition": "describe visual composition in 10 words",
        "reasoning": "why this gets clicks on mobile"
      }]
      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.8 });

    try {
      const parsed = extractJsonArray(response);
      if (!parsed || !Array.isArray(parsed) || parsed.length === 0) {
        return this.getDefaultConcepts(topic, hook);
      }

      return parsed.map((t: any) => {
        const contrastScore = this.clampScore(t.contrastScore);
        const facialEmotionIntensity = this.clampScore(t.facialEmotionIntensity);
        const mobileReadability = this.clampScore(t.mobileReadability);
        const clickTriggerScore = this.clampScore(t.clickTriggerScore);
        const colorPsychologyScore = this.clampScore(t.colorPsychologyScore);

        const overallScore = Math.round(
          contrastScore * 0.25 +
          facialEmotionIntensity * 0.25 +
          mobileReadability * 0.20 +
          clickTriggerScore * 0.20 +
          colorPsychologyScore * 0.10
        );

        return {
          style: t.style || 'face-closeup-shock',
          prompt: t.prompt || '',
          contrastScore,
          facialEmotionIntensity,
          mobileReadability,
          clickTriggerScore,
          colorPsychologyScore,
          overallScore,
          textOverlay: (t.textOverlay || '').substring(0, 15),
          composition: t.composition || '',
          reasoning: t.reasoning || '',
        };
      }).sort((a: ThumbnailConcept, b: ThumbnailConcept) => b.overallScore - a.overallScore);

    } catch (err) {
      logger.warn('[Thumbnail Intelligence] Failed to parse concepts, using defaults');
      return this.getDefaultConcepts(topic, hook);
    }
  }

  async pickBestConcept(concepts: ThumbnailConcept[]): Promise<ThumbnailConcept> {
    if (concepts.length === 0) return this.getDefaultConcepts('Topic', 'Hook')[0];

    const history = await prisma.thumbnailPerformance.findMany({
      where: { actualCTR: { gt: 0 } },
      orderBy: { actualCTR: 'desc' },
      take: 20,
      include: { project: { include: { thumbnail: true } } },
    });

    const styleCTR: Record<string, { total: number; count: number }> = {};
    for (const hp of history) {
      const style = hp.style || 'unknown';
      if (!styleCTR[style]) styleCTR[style] = { total: 0, count: 0 };
      styleCTR[style].total += hp.actualCTR;
      styleCTR[style].count++;
    }

    const scored = concepts.map(c => {
      const hist = styleCTR[c.style];
      const historyBonus = hist ? Math.min(20, (hist.total / hist.count) * 2) : 0;
      return {
        ...c,
        overallScore: Math.min(100, c.overallScore + historyBonus),
      };
    });

    scored.sort((a, b) => b.overallScore - a.overallScore);
    return scored[0];
  }

  async recordThumbnailPerformance(projectId: string, style: string, actualCTR: number, impressions: number, clicks: number): Promise<void> {
    const existing = await prisma.thumbnailPerformance.findUnique({ where: { projectId } });
    if (existing) {
      await prisma.thumbnailPerformance.update({
        where: { projectId },
        data: { actualCTR, impressions, clicks, analyzedAt: new Date() },
      });
    } else {
      await prisma.thumbnailPerformance.create({
        data: { projectId, style, actualCTR, impressions, clicks },
      });
    }
  }

  async getBestPerformingStyle(niche?: string): Promise<{ style: string; avgCTR: number } | null> {
    const where: any = { actualCTR: { gt: 0 } };
    if (niche) {
      const projects = await prisma.videoProject.findMany({
        where: { topic: { contains: niche } },
        select: { id: true },
      });
      where.projectId = { in: projects.map(p => p.id) };
    }

    const performances = await prisma.thumbnailPerformance.findMany({ where });
    if (performances.length === 0) return null;

    const styleMap = new Map<string, { total: number; count: number }>();
    for (const p of performances) {
      const style = p.style || 'unknown';
      const entry = styleMap.get(style) || { total: 0, count: 0 };
      entry.total += p.actualCTR;
      entry.count++;
      styleMap.set(style, entry);
    }

    let bestStyle: string | null = null;
    let bestCTR = 0;
    for (const [style, data] of styleMap) {
      const avg = data.total / data.count;
      if (avg > bestCTR) {
        bestCTR = avg;
        bestStyle = style;
      }
    }

    return bestStyle ? { style: bestStyle, avgCTR: Math.round(bestCTR * 10) / 10 } : null;
  }

  private getDefaultConcepts(topic: string, hook: string): ThumbnailConcept[] {
    return [
      { style: 'face-closeup-shock', prompt: `Close-up face shocked expression about ${topic}, wide eyes open mouth, dramatic lighting, dark background`, contrastScore: 75, facialEmotionIntensity: 95, mobileReadability: 85, clickTriggerScore: 88, colorPsychologyScore: 70, overallScore: 84, textOverlay: 'SHOCKING', composition: 'Face center, blurred dark BG', reasoning: 'Extreme face emotion = highest CTR on mobile' },
      { style: 'bold-text-contrast', prompt: `Bold red yellow text on black background about ${topic}, minimal dramatic design`, contrastScore: 95, facialEmotionIntensity: 30, mobileReadability: 90, clickTriggerScore: 82, colorPsychologyScore: 92, overallScore: 79, textOverlay: 'YOU WON\'T BELIEVE', composition: 'Text center, gradient BG', reasoning: 'High contrast = readable on any screen' },
      { style: 'curiosity-gap-emotional', prompt: `Half-lit emotional face, mysterious expression about ${topic}, cinematic lighting, curiosity gap`, contrastScore: 70, facialEmotionIntensity: 88, mobileReadability: 75, clickTriggerScore: 90, colorPsychologyScore: 75, overallScore: 80, textOverlay: 'THE REAL REASON', composition: 'Split lighting on face', reasoning: 'Mystery + emotion = high curiosity click' },
      { style: 'before-after', prompt: `Split screen dramatic transformation ${topic}, left dark grainy, right bright successful`, contrastScore: 88, facialEmotionIntensity: 60, mobileReadability: 70, clickTriggerScore: 78, colorPsychologyScore: 85, overallScore: 77, textOverlay: 'BEFORE VS AFTER', composition: 'Vertical split contrast', reasoning: 'Transformation story = high engagement' },
      { style: 'number-list', prompt: `Large bold numbers colorful background ${topic}, eye-catching gradient, list format`, contrastScore: 90, facialEmotionIntensity: 20, mobileReadability: 88, clickTriggerScore: 75, colorPsychologyScore: 88, overallScore: 74, textOverlay: '3 REASONS', composition: 'Number center, colorful BG', reasoning: 'Numbers + colors = easy mobile scan' },
    ];
  }

  private clampScore(v: any): number {
    return Math.min(100, Math.max(0, typeof v === 'number' ? Math.round(v) : 50));
  }
}
