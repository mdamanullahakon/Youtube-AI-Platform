import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface UploadTimeRecommendation {
  hour: number;
  day: string;
  timezone: string;
  predictedViews: number;
  predictedCTR: number;
  score: number;
  confidence: number;
  reasoning: string;
}

export class UploadTimeOptimizer {
  async getBestTime(channelId: string, timezone = 'UTC'): Promise<UploadTimeRecommendation> {
    logger.info(`Optimizing upload time for channel: ${channelId}`);

    const metrics = await prisma.uploadTimeMetric.findMany({
      where: { channelId, tested: true },
      orderBy: { score: 'desc' },
      take: 5,
    });

    if (metrics.length > 0) {
      const best = metrics[0];
      return {
        hour: best.uploadHour,
        day: best.uploadDay,
        timezone: best.timezone,
        predictedViews: best.avgViews,
        predictedCTR: best.avgCTR,
        score: best.score,
        confidence: Math.min(1, best.sampleSize / 20),
        reasoning: `Based on ${best.sampleSize} historical uploads at ${best.uploadHour}:00 on ${best.uploadDay}`,
      };
    }

    const globalBest = await prisma.uploadTimeMetric.findFirst({
      where: { tested: true },
      orderBy: { score: 'desc' },
    });

    if (globalBest) {
      return {
        hour: globalBest.uploadHour,
        day: globalBest.uploadDay,
        timezone,
        predictedViews: globalBest.avgViews,
        predictedCTR: globalBest.avgCTR,
        score: globalBest.score,
        confidence: 0.3,
        reasoning: `Based on global data: ${globalBest.uploadHour}:00 on ${globalBest.uploadDay} performs best`,
      };
    }

    const analysis = await generateWithAI(`
      Recommend best YouTube upload time for channel.
      Timezone: ${timezone}

      Return JSON:
      {
        "hour": 0-23,
        "day": "monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday",
        "predictedViews": estimated_views,
        "predictedCTR": estimated_ctr,
        "score": 0-100,
        "reasoning": "why this time works best"
      }

      Consider:
      - Best times: 8-11am and 2-4pm on weekdays
      - Weekends: 9-11am works best
      - Avoid 12am-6am for most niches
      - Educational: weekday mornings
      - Entertainment: evenings and weekends
      - News: early mornings

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      return {
        hour: Math.min(23, Math.max(0, parsed.hour || 10)),
        day: parsed.day || 'tuesday',
        timezone,
        predictedViews: parsed.predictedViews || 500,
        predictedCTR: parsed.predictedCTR || 5,
        score: parsed.score || 50,
        confidence: 0.2,
        reasoning: parsed.reasoning || 'AI recommendation based on general YouTube patterns',
      };
    } catch {
      return {
        hour: 10, day: 'tuesday', timezone,
        predictedViews: 500, predictedCTR: 5, score: 50, confidence: 0.2,
        reasoning: 'Default recommendation: Tuesday 10:00 AM based on general YouTube patterns',
      };
    }
  }

  async trackPerformance(channelId: string, userId: string, uploadHour: number, uploadDay: string, views: number, ctr: number, retention: number): Promise<void> {
    const day = uploadDay.toLowerCase();
    const existing = await prisma.uploadTimeMetric.findFirst({
      where: { channelId, uploadHour, uploadDay: day },
    });

    const score = (views * 0.4 + ctr * 10 * 0.3 + retention * 0.3);

    if (existing) {
      const newSampleSize = existing.sampleSize + 1;
      await prisma.uploadTimeMetric.update({
        where: { id: existing.id },
        data: {
          avgViews: (existing.avgViews * existing.sampleSize + views) / newSampleSize,
          avgCTR: (existing.avgCTR * existing.sampleSize + ctr) / newSampleSize,
          avgRetention: (existing.avgRetention * existing.sampleSize + retention) / newSampleSize,
          sampleSize: newSampleSize,
          score: (existing.score * existing.sampleSize + score) / newSampleSize,
          tested: true,
          lastTestedAt: new Date(),
        },
      });
    } else {
      await prisma.uploadTimeMetric.create({
        data: { channelId, userId, uploadHour, uploadDay: day, avgViews: views, avgCTR: ctr, avgRetention: retention, sampleSize: 1, score, tested: true, lastTestedAt: new Date() },
      });
    }

    logger.info(`Tracked upload time performance: channel=${channelId}, hour=${uploadHour}, day=${day}, score=${score.toFixed(0)}`);
  }

  async getScheduleRecommendation(channelId: string, timezone = 'UTC'): Promise<UploadTimeRecommendation> {
    return this.getBestTime(channelId, timezone);
  }
}
