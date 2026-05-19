import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import type { ThumbnailCTRAnalysis } from '../types';

const THUMBNAIL_STYLES = [
  'curiosity-gap-emotional',
  'bold-text-contrast',
  'face-closeup-shock',
  'before-after',
  'number-list',
  'comparison-split',
  'minimalist-mystery',
  'reaction-highlight',
  'arrow-pointer',
  'color-explosion',
] as const;

export class CTRAnalyzer {
  async analyzeProjectThumbnail(projectId: string): Promise<ThumbnailCTRAnalysis> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { thumbnail: true, analytics: true, thumbnailPerformance: true },
    });

    if (!project) {
      return this.defaultAnalysis('project-not-found');
    }

    const thumbnail = project.thumbnail;
    const analytics = project.analytics;
    const perf = project.thumbnailPerformance;

    const style = perf?.style || thumbnail?.style || 'unknown';
    const predictedCTR = perf?.predictedCTR || thumbnail?.ctr || 0;
    const actualCTR = analytics?.ctr || perf?.actualCTR || 0;
    const impressions = perf?.impressions || analytics?.impressions || 0;
    const clicks = Math.round((actualCTR / 100) * impressions);

    const performance = this.classifyCTRPerformance(actualCTR);
    const recommendations = this.generateRecommendations(style, actualCTR, performance);

    return {
      style,
      predictedCTR,
      actualCTR,
      impressions,
      clicks,
      performance,
      recommendations,
    };
  }

  async analyzeAllThumbnails(): Promise<{
    styleRankings: { style: string; avgCTR: number; count: number }[];
    topPerformingStyles: string[];
    overallRecommendations: string[];
  }> {
    const performances = await prisma.thumbnailPerformance.findMany({
      where: { actualCTR: { gt: 0 } },
      include: { project: { include: { analytics: true } } },
      orderBy: { actualCTR: 'desc' },
    });

    if (performances.length < 3) {
      return {
        styleRankings: [],
        topPerformingStyles: [],
        overallRecommendations: ['Collect more data to identify CTR patterns. Need at least 3 analyzed thumbnails.'],
      };
    }

    const styleMap = new Map<string, { totalCTR: number; count: number }>();
    for (const p of performances) {
      const style = p.style || 'unknown';
      const existing = styleMap.get(style) || { totalCTR: 0, count: 0 };
      existing.totalCTR += p.actualCTR;
      existing.count++;
      styleMap.set(style, existing);
    }

    const styleRankings = Array.from(styleMap.entries())
      .map(([style, data]) => ({
        style,
        avgCTR: Math.round((data.totalCTR / data.count) * 10) / 10,
        count: data.count,
      }))
      .sort((a, b) => b.avgCTR - a.avgCTR);

    const topPerformingStyles = styleRankings
      .filter(s => s.count >= 2)
      .slice(0, 3)
      .map(s => s.style);

    const overallRecommendations: string[] = [];

    if (styleRankings.length > 1) {
      const best = styleRankings[0];
      const worst = styleRankings[styleRankings.length - 1];
      const gap = best.avgCTR - worst.avgCTR;
      if (gap > 3) {
        overallRecommendations.push(
          `${best.style} style outperforms ${worst.style} by ${gap.toFixed(1)}% CTR. Prefer ${best.style} for future thumbnails.`
        );
      }
    }

    const totalAvgCTR = styleRankings.reduce((s, r) => s + r.avgCTR * r.count, 0) /
      styleRankings.reduce((s, r) => s + r.count, 0);

    if (totalAvgCTR < 4) {
      overallRecommendations.push(
        'Overall CTR is below 4%. Consider brighter colors, stronger curiosity gap, and emotional facial expressions in thumbnails.'
      );
    }

    return { styleRankings, topPerformingStyles, overallRecommendations };
  }

  async predictThumbnailCTR(style: string, topic: string): Promise<number> {
    const performances = await prisma.thumbnailPerformance.findMany({
      where: { style, actualCTR: { gt: 0 } },
      orderBy: { actualCTR: 'desc' },
      take: 10,
    });

    if (performances.length === 0) {
      const allPerformances = await prisma.thumbnailPerformance.findMany({
        where: { actualCTR: { gt: 0 } },
        orderBy: { actualCTR: 'desc' },
        take: 20,
      });

      if (allPerformances.length === 0) return 5;
      const avg = allPerformances.reduce((s, p) => s + p.actualCTR, 0) / allPerformances.length;
      return Math.round(avg * 10) / 10;
    }

    const avgCTR = performances.reduce((s, p) => s + p.actualCTR, 0) / performances.length;

    const topicBoost = /how|why|secret|best|top|worst|never|always/i.test(topic) ? 1.5 : 0;
    const styleBoost = style === 'bold-text-contrast' || style === 'face-closeup-shock' ? 1 : 0;

    return Math.min(20, Math.round((avgCTR + topicBoost + styleBoost) * 10) / 10);
  }

  async saveThumbnailPerformance(
    projectId: string,
    style: string,
    prompt: string,
    predictedCTR: number,
  ): Promise<void> {
    await prisma.thumbnailPerformance.upsert({
      where: { projectId },
      update: { style, prompt, predictedCTR, analyzedAt: new Date() },
      create: { projectId, style, prompt, predictedCTR },
    });
  }

  async updateWithActualCTR(projectId: string, actualCTR: number, impressions?: number): Promise<void> {
    const clicks = impressions ? Math.round((actualCTR / 100) * impressions) : 0;
    await prisma.thumbnailPerformance.upsert({
      where: { projectId },
      update: {
        actualCTR,
        impressions: impressions || { increment: 0 },
        clicks,
        analyzedAt: new Date(),
      },
      create: { projectId, actualCTR, impressions: impressions || 0, clicks },
    });
  }

  private classifyCTRPerformance(ctr: number): ThumbnailCTRAnalysis['performance'] {
    if (ctr >= 10) return 'excellent';
    if (ctr >= 6) return 'good';
    if (ctr >= 3) return 'average';
    return 'poor';
  }

  private generateRecommendations(
    style: string,
    ctr: number,
    performance: string,
  ): string[] {
    const recs: string[] = [];

    if (performance === 'poor') {
      recs.push('Completely redesign thumbnail. Use a close-up face with strong emotional expression.');
      recs.push('Add bold, high-contrast text (max 3 words) that creates a curiosity gap.');
      recs.push('Use bright, saturated colors that stand out in the YouTube recommendations sidebar.');
    }

    if (performance === 'average') {
      recs.push('Increase contrast between subject and background.');
      recs.push('Test adding an arrow or circle highlighting a key element.');
      recs.push('Ensure the thumbnail tells a story at a glance.');
    }

    if (style === 'face-closeup-shock' && ctr < 5) {
      recs.push('Face close-up is underperforming. Try adding more extreme emotion or color grading.');
    }

    if (style === 'bold-text-contrast' && ctr < 5) {
      recs.push('Bold text underperforming. Test different font colors and text placement (top-left or center).');
    }

    if (recs.length === 0) {
      recs.push('Current thumbnail style is working well. Test A/B variations to further optimize.');
    }

    return recs;
  }

  private defaultAnalysis(reason: string): ThumbnailCTRAnalysis {
    return {
      style: 'unknown',
      predictedCTR: 0,
      actualCTR: 0,
      impressions: 0,
      clicks: 0,
      performance: 'poor',
      recommendations: [`Unable to analyze: ${reason}`],
    };
  }
}
