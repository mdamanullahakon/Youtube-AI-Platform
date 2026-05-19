import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

interface LearningInsight {
  metric: string;
  value: number;
  trend: 'improving' | 'declining' | 'stable';
  recommendation: string;
}

interface ScriptImprovement {
  change: string;
  reason: string;
  expectedImpact: string;
}

export class AnalyticsSelfImproveEngine {
  async analyzePastPerformance(niche: string = 'horror'): Promise<{
    insights: LearningInsight[];
    improvements: ScriptImprovement[];
  }> {
    const recentProjects = await prisma.videoProject.findMany({
      where: { topic: { contains: niche } },
      include: { analytics: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const withData = recentProjects.filter(p => p.analytics);
    const insights = this.generateInsights(withData);
    const improvements = this.generateImprovements(withData);

    return { insights, improvements };
  }

  async generateNextScriptGuidance(projectId: string, topic: string): Promise<string[]> {
    const pastPerformance = await this.analyzePastPerformance(topic);
    const guidance: string[] = [];

    for (const insight of pastPerformance.insights) {
      if (insight.trend === 'declining') {
        guidance.push(`IMPROVEMENT NEEDED: ${insight.recommendation}`);
      }
    }

    for (const improvement of pastPerformance.improvements) {
      guidance.push(`SCRIPT CHANGE: ${improvement.change} — ${improvement.reason} (Expected: ${improvement.expectedImpact})`);
    }

    const avgRetention = await this.getAverageRetention(topic);
    if (await guidance.length === 0) {
      guidance.push(`Maintain current approach. Average retention: ${avgRetention}%`);
    }

    return guidance;
  }

  async recordRetentionDropPoint(projectId: string, second: number, dropRate: number): Promise<void> {
    try {
      const existing = await prisma.analyticsLearning.findUnique({ where: { projectId } });
      const dropOffPoints = (existing?.dropOffPoints as any[]) || [];

      dropOffPoints.push({ second, dropRate, recordedAt: new Date().toISOString() });

      await prisma.analyticsLearning.upsert({
        where: { projectId },
        update: { dropOffPoints: dropOffPoints.slice(-100) },
        create: {
          projectId,
          dropOffPoints: dropOffPoints.slice(-100),
        },
      });
    } catch (err: any) {
      logger.warn(`[AnalyticsSelfImprove] Failed to record drop point: ${err.message}`);
    }
  }

  async identifyWeakSeconds(projectId: string): Promise<number[]> {
    try {
      const learning = await prisma.analyticsLearning.findUnique({ where: { projectId } });
      const dropOffs = (learning?.dropOffPoints as any[]) || [];
      return dropOffs
        .filter(d => d.dropRate > 20)
        .map(d => d.second)
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  private generateInsights(projects: any[]): LearningInsight[] {
    const insights: LearningInsight[] = [];

    if (projects.length === 0) {
      return [{ metric: 'retention', value: 0, trend: 'stable', recommendation: 'Start with standard horror pacing (pattern interrupt every 25s)' }];
    }

    const retentions = projects.map(p => p.analytics.retention).filter(Boolean);
    if (retentions.length > 0) {
      const avgRet = retentions.reduce((s: number, v: number) => s + v, 0) / retentions.length;
      const recent5 = retentions.slice(-5);
      const recentAvg = recent5.reduce((s: number, v: number) => s + v, 0) / recent5.length;
      insights.push({
        metric: 'retention',
        value: Math.round(avgRet),
        trend: recentAvg > avgRet ? 'improving' : recentAvg < avgRet - 5 ? 'declining' : 'stable',
        recommendation: recentAvg < avgRet - 5
          ? 'Increase pattern interrupt frequency. Add more open loops. Shorten slow scenes.'
          : 'Current retention approach is working. Maintain pacing but test new hook styles.',
      });
    }

    const ctrs = projects.map(p => p.analytics.ctr).filter(Boolean);
    if (ctrs.length > 0) {
      const avgCtr = ctrs.reduce((s: number, v: number) => s + v, 0) / ctrs.length;
      insights.push({
        metric: 'ctr',
        value: Math.round(avgCtr * 100) / 100,
        trend: avgCtr > 5 ? 'improving' : 'declining',
        recommendation: avgCtr < 4
          ? 'Use more curiosity-gap thumbnails with face close-ups. Shorter, punchier titles.'
          : 'Thumbnail strategy working well.',
      });
    }

    return insights;
  }

  private generateImprovements(projects: any[]): ScriptImprovement[] {
    const improvements: ScriptImprovement[] = [];

    if (projects.length === 0) {
      return [{
        change: 'Use ultra-short hook sentences (3-5 words max for first 10 seconds)',
        reason: 'Hook retention is critical in first 15 seconds — 33% of viewers leave here',
        expectedImpact: '+15% retention',
      }];
    }

    const withAnalytics = projects.filter(p => p.analytics?.retention > 0);
    const topPerformers = withAnalytics.sort((a: any, b: any) => b.analytics.retention - a.analytics.retention).slice(0, 3);
    const bottomPerformers = withAnalytics.sort((a: any, b: any) => a.analytics.retention - b.analytics.retention).slice(0, 3);

    if (topPerformers.length > 0) {
      improvements.push({
        change: `Model structure after top performer: "${topPerformers[0]?.topic?.substring(0, 40)}"`,
        reason: `Achieved ${topPerformers[0]?.analytics?.retention}% retention`,
        expectedImpact: '+10-20% retention',
      });
    }

    if (bottomPerformers.length > 0) {
      const avgBottom = bottomPerformers.reduce((s: number, p: any) => s + (p.analytics?.retention || 0), 0) / bottomPerformers.length;
      improvements.push({
        change: 'Add more pattern interrupts in first 60 seconds',
        reason: `Bottom performers averaged ${Math.round(avgBottom)}% retention — likely losing viewers early`,
        expectedImpact: '+12% retention',
      });
    }

    improvements.push({
      change: 'Insert a mid-video fake ending at 50-60% mark',
      reason: 'False resolutions reset attention and reduce drop-off',
      expectedImpact: '+8% retention',
    });

    improvements.push({
      change: 'Keep scenes under 15 seconds for first 3 minutes',
      reason: 'Fast pacing in first section builds habit of attention',
      expectedImpact: '+10% retention',
    });

    return improvements.slice(0, 5);
  }

  private async getAverageRetention(topic: string): Promise<number> {
    try {
      const result = await prisma.analytics.findFirst({
        where: { project: { topic: { contains: topic } } },
        orderBy: { collectedAt: 'desc' },
        select: { retention: true },
      });
      return result?.retention || 40;
    } catch {
      return 40;
    }
  }
}
