import { generateWithAI } from './ai.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';

interface ViralPrediction {
  viralScore: number;
  ctrPrediction: number;
  retentionPrediction: number;
  revenuePotential: number;
  confidence: number;
  thresholdMet: boolean;
  factors: PredictionFactor[];
  recommendation: string;
}

interface PredictionFactor {
  name: string;
  score: number;
  weight: number;
  impact: 'positive' | 'negative' | 'neutral';
  details: string;
}

const CTR_THRESHOLD = 5.0;
const RETENTION_THRESHOLD = 50;
const VIRAL_SCORE_THRESHOLD = 60;

export class ViralPredictionEngine {
  async predict(topic: string, hook: string, title: string, scenes: { text: string; duration: number }[]): Promise<ViralPrediction> {
    logger.info(`[ViralPrediction] Scoring: "${topic}"`);

    const factors: PredictionFactor[] = [];
    let weightedScore = 0;
    let totalWeight = 0;

    const hookFactor = this.scoreHook(hook);
    factors.push(hookFactor);
    weightedScore += hookFactor.score * hookFactor.weight;
    totalWeight += hookFactor.weight;

    const pacingFactor = this.scorePacing(scenes);
    factors.push(pacingFactor);
    weightedScore += pacingFactor.score * pacingFactor.weight;
    totalWeight += pacingFactor.weight;

    const titleFactor = this.scoreTitle(title);
    factors.push(titleFactor);
    weightedScore += titleFactor.score * titleFactor.weight;
    totalWeight += titleFactor.weight;

    const historicalFactor = await this.scoreHistorical(topic);
    factors.push(historicalFactor);
    weightedScore += historicalFactor.score * historicalFactor.weight;
    totalWeight += historicalFactor.weight;

    const viralScore = Math.round(weightedScore / totalWeight);
    const ctrPrediction = Math.round(this.predictCTR(title, hook) * 10) / 10;
    const retentionPrediction = this.predictRetention(scenes, hook);
    const revenuePotential = this.predictRevenue(topic, retentionPrediction);
    const confidence = Math.min(90, 40 + viralScore * 0.4);

    const thresholdMet = viralScore >= VIRAL_SCORE_THRESHOLD &&
      ctrPrediction >= CTR_THRESHOLD &&
      retentionPrediction >= RETENTION_THRESHOLD;

    logger.info(`[ViralPrediction] Score: ${viralScore}/100, CTR: ${ctrPrediction}%, Retention: ${retentionPrediction}%, Threshold: ${thresholdMet ? 'PASS' : 'FAIL'}`);

    return {
      viralScore,
      ctrPrediction,
      retentionPrediction,
      revenuePotential: Math.round(revenuePotential * 100) / 100,
      confidence,
      thresholdMet,
      factors,
      recommendation: thresholdMet
        ? 'Content meets viral thresholds — proceed with production'
        : this.generateImprovementRecommendation(viralScore, ctrPrediction, retentionPrediction),
    };
  }

  private scoreHook(hook: string): PredictionFactor {
    let score = 40;
    const h = hook.toLowerCase();

    if (h.includes('?')) score += 10;
    if (h.includes('...')) score += 10;
    if (h.includes('you') || h.includes('your')) score += 10;
    if (h.includes('never') || h.includes('found') || h.includes('truth')) score += 15;
    if (h.includes('!')) score += 5;
    if (h.length < 30) score += 10;
    if (h.length > 100) score -= 10;
    if (h.includes('today') || h.includes('in this video')) score -= 20;

    const impact = score >= 70 ? 'positive' as const : score >= 50 ? 'neutral' as const : 'negative' as const;

    return {
      name: 'Hook Quality',
      score: Math.min(100, Math.max(0, score)),
      weight: 0.30,
      impact,
      details: h.length < 100
        ? `"${hook.substring(0, 60)}..." — ${score >= 70 ? 'strong emotional hook' : 'needs improvement'}`
        : 'Hook too long — keep under 100 characters',
    };
  }

  private scorePacing(scenes: { text: string; duration: number }[]): PredictionFactor {
    if (scenes.length === 0) return { name: 'Pacing', score: 30, weight: 0.25, impact: 'negative', details: 'No scenes to analyze' };

    const tooLong = scenes.filter(s => s.duration > 20).length;
    const avgDuration = scenes.reduce((s, sc) => s + sc.duration, 0) / scenes.length;
    const interruptors = scenes.filter(s => {
      const t = s.text.toLowerCase();
      return t.includes('but') || t.includes('then') || t.includes('suddenly') || t.includes('however') || t.includes('wait');
    }).length;

    let score = 50;
    if (tooLong === 0) score += 15;
    if (avgDuration >= 8 && avgDuration <= 15) score += 15;
    if (interruptors >= scenes.length / 4) score += 20;
    if (scenes.length > 15) score += 10;
    if (scenes.length < 5) score -= 20;

    return {
      name: 'Scene Pacing',
      score: Math.min(100, Math.max(0, score)),
      weight: 0.25,
      impact: score >= 65 ? 'positive' : score >= 45 ? 'neutral' : 'negative',
      details: `${scenes.length} scenes, avg ${Math.round(avgDuration)}s, ${interruptors} pattern interrupts`,
    };
  }

  private scoreTitle(title: string): PredictionFactor {
    let score = 40;
    const t = title.toLowerCase();

    if (t.includes('?') || t.match(/^\d+/)) score += 15;
    if (t.includes('truth') || t.includes('secret') || t.includes('hidden') || t.includes('found')) score += 15;
    if (t.includes('you') || t.includes('your')) score += 10;
    if (t.length >= 30 && t.length <= 60) score += 15;
    if (t.length > 80) score -= 10;
    if (t.includes('2026') || t.includes('this year')) score += 10;

    return {
      name: 'Title CTR',
      score: Math.min(100, Math.max(0, score)),
      weight: 0.20,
      impact: score >= 65 ? 'positive' : score >= 45 ? 'neutral' : 'negative',
      details: `${title.length} chars — ${score >= 65 ? 'CTR-optimized' : 'optimize for curiosity gap'}`,
    };
  }

  private async scoreHistorical(topic: string): Promise<PredictionFactor> {
    try {
      const similar = await prisma.videoProject.findMany({
        where: { topic: { contains: topic.split(' ').slice(0, 3).join(' ') } },
        include: { analytics: true },
        take: 10,
      });

      const withAnalytics = similar.filter(s => s.analytics);
      if (withAnalytics.length === 0) {
        return { name: 'Historical Performance', score: 50, weight: 0.15, impact: 'neutral', details: 'No historical data for this topic' };
      }

      const avgScore = withAnalytics.reduce((s, p) => {
        const analytics = p.analytics!;
        return s + (analytics.ctr * 0.3 + analytics.retention * 0.4 + Math.min(analytics.views / 1000, 100) * 0.3);
      }, 0) / withAnalytics.length;

      const impact = avgScore >= 55 ? 'positive' as const : avgScore >= 40 ? 'neutral' as const : 'negative' as const;
      return {
        name: 'Historical Performance',
        score: Math.round(avgScore),
        weight: 0.15,
        impact,
        details: `${withAnalytics.length} similar videos, avg score: ${Math.round(avgScore)}`,
      };
    } catch {
      return { name: 'Historical Performance', score: 50, weight: 0.15, impact: 'neutral', details: 'Unable to analyze historical data' };
    }
  }

  private predictCTR(title: string, hook: string): number {
    const combined = `${title} ${hook}`.toLowerCase();
    let base = 3.0;
    if (combined.includes('?')) base += 1.5;
    if (combined.includes('truth') || combined.includes('secret')) base += 1.5;
    if (combined.includes('you') || combined.includes('your')) base += 1.0;
    if (combined.includes('never') || combined.includes('before')) base += 1.0;
    if (combined.match(/^\d+/)) base += 0.5;
    if (title.length >= 30 && title.length <= 60) base += 0.5;
    return Math.min(15, base);
  }

  private predictRetention(scenes: { text: string; duration: number }[], hook: string): number {
    if (scenes.length === 0) return 30;
    const avgDuration = scenes.reduce((s, sc) => s + sc.duration, 0) / scenes.length;
    const totalMinutes = scenes.reduce((s, sc) => s + sc.duration, 0) / 60;
    const hasHook = hook.length > 0;

    let base = 30;
    if (hasHook) base += 10;
    if (avgDuration >= 8 && avgDuration <= 15) base += 10;
    if (totalMinutes >= 10) base += 10;
    if (scenes.length > 15) base += 10;
    if (scenes.length > 30) base += 10;
    if (totalMinutes > 15) base += 5;

    return Math.min(90, base);
  }

  private predictRevenue(topic: string, retention: number): number {
    const rpmMap: Record<string, number> = {
      'true crime': 12.50, 'paranormal': 8.75, 'horror': 7.20,
      'unsolved mysteries': 10.30, 'conspiracy': 9.80,
    };

    const lower = topic.toLowerCase();
    const rpm = Object.entries(rpmMap).find(([k]) => lower.includes(k))?.[1] || 6.0;
    const predictedWatchTime = retention / 100 * 600;
    return predictedWatchTime * (rpm / 1000);
  }

  private generateImprovementRecommendation(viralScore: number, ctr: number, retention: number): string {
    const issues: string[] = [];
    if (viralScore < VIRAL_SCORE_THRESHOLD) issues.push(`Viral score ${viralScore} < ${VIRAL_SCORE_THRESHOLD}`);
    if (ctr < CTR_THRESHOLD) issues.push(`CTR ${ctr}% < ${CTR_THRESHOLD}%`);
    if (retention < RETENTION_THRESHOLD) issues.push(`Retention ${retention}% < ${RETENTION_THRESHOLD}%`);

    return `Content needs improvement: ${issues.join(', ')}. Regenerate with stronger hook and faster pacing.`;
  }
}
