import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

export interface EarlyGrowthReport {
  projectId: string;
  videoId: string;
  channelId: string;
  title: string;
  timeSinceUpload: number;
  views: number;
  impressions: number;
  ctr: number;
  retention: number;
  engagement: number;
  trafficSource: string[];
  performanceCategory: 'weak' | 'average' | 'strong' | 'breakout-candidate';
  expectedBaseline: {
    expectedViews: number;
    expectedCTR: number;
    expectedRetention: number;
  };
  deviation: {
    viewsDeviation: number;
    ctrDeviation: number;
    retentionDeviation: number;
  };
  recommendations: string[];
  generatedAt: Date;
}

const EARLY_CHECK_WINDOW_MS = 1800000;

export class EarlyGrowthReportService {
  async generateEarlyReport(projectId: string): Promise<EarlyGrowthReport | null> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        uploadHistory: true,
        contentPerformance: true,
      },
    });

    if (!project?.uploadHistory?.videoId) return null;
    if (!project.analytics) return null;

    const uploadTime = project.uploadHistory.publishedAt || project.uploadHistory.createdAt;
    const elapsed = Date.now() - uploadTime.getTime();

    if (elapsed < 600000) {
      logger.info(`[EarlyGrowth] ${project.title}: Too early for 30-min report (${Math.round(elapsed / 60000)}min elapsed)`);
      return null;
    }

    const a = project.analytics;
    const expectedViews = Math.max(50, a.views * 0.1);
    const expectedCTR = 4.0;
    const expectedRetention = 35.0;

    const viewsDev = expectedViews > 0 ? ((a.views - expectedViews) / expectedViews) * 100 : 0;
    const ctrDev = a.ctr - expectedCTR;
    const retentionDev = a.retention - expectedRetention;

    let performanceCategory: 'weak' | 'average' | 'strong' | 'breakout-candidate';
    if (viewsDev > 100 && a.ctr > 8 && a.retention > 50) {
      performanceCategory = 'breakout-candidate';
    } else if (viewsDev > 20 && a.ctr > 5 && a.retention > 40) {
      performanceCategory = 'strong';
    } else if (viewsDev > -30 && a.ctr > 2.5) {
      performanceCategory = 'average';
    } else {
      performanceCategory = 'weak';
    }

    const recommendations = this.generateEarlyRecommendations(performanceCategory, a);

    const report: EarlyGrowthReport = {
      projectId,
      videoId: project.uploadHistory.videoId,
      channelId: project.channelId || '',
      title: project.title || 'Untitled',
      timeSinceUpload: Math.round(elapsed / 60000),
      views: a.views,
      impressions: a.impressions,
      ctr: a.ctr,
      retention: a.retention,
      engagement: (a.likes + a.comments + a.shares),
      trafficSource: ['YouTube suggested', 'Browse features', 'Search'],
      performanceCategory,
      expectedBaseline: { expectedViews, expectedCTR, expectedRetention },
      deviation: {
        viewsDeviation: Math.round(viewsDev * 100) / 100,
        ctrDeviation: Math.round(ctrDev * 100) / 100,
        retentionDeviation: Math.round(retentionDev * 100) / 100,
      },
      recommendations,
      generatedAt: new Date(),
    };

    await this.saveEarlyReport(projectId, report);
    await this.markPerformance(projectId, performanceCategory);

    logger.info(`[EarlyGrowth] ${project.title}: ${performanceCategory.toUpperCase()} — Views: ${a.views}, CTR: ${a.ctr}%, Retention: ${a.retention}%`);

    return report;
  }

  async runEarlyChecksForAllPublished(): Promise<EarlyGrowthReport[]> {
    const published = await prisma.videoProject.findMany({
      where: {
        status: 'published',
        uploadHistory: { status: 'published' },
      },
      include: { analytics: true, uploadHistory: true },
      orderBy: { uploadHistory: { publishedAt: 'desc' } },
      take: 20,
    });

    const reports: EarlyGrowthReport[] = [];
    for (const p of published) {
      if (!p.uploadHistory?.publishedAt) continue;
      const elapsed = Date.now() - p.uploadHistory.publishedAt.getTime();
      if (elapsed >= EARLY_CHECK_WINDOW_MS) continue;

      if (p.analytics?.ctr && p.analytics.ctr > 0) continue;

      const report = await this.generateEarlyReport(p.id);
      if (report) reports.push(report);
    }

    return reports;
  }

  async scheduleEarlyCheck(projectId: string, delayMs = EARLY_CHECK_WINDOW_MS): Promise<void> {
    logger.info(`[EarlyGrowth] Scheduled early check for ${projectId} in ${delayMs / 60000}min`);
    setTimeout(async () => {
      try {
        await this.generateEarlyReport(projectId);
      } catch (err: any) {
        logger.error(`[EarlyGrowth] Scheduled check failed for ${projectId}: ${err.message}`);
      }
    }, delayMs);
  }

  private async saveEarlyReport(projectId: string, report: EarlyGrowthReport): Promise<void> {
    await prisma.appConfig.upsert({
      where: { key: `early_report:${projectId}` },
      update: { value: JSON.stringify(report) },
      create: {
        key: `early_report:${projectId}`,
        value: JSON.stringify(report),
        description: `30-minute early growth report for ${projectId}`,
      },
    });
  }

  private async markPerformance(projectId: string, category: string): Promise<void> {
    await prisma.contentPerformance.upsert({
      where: { projectId },
      update: {
        actualCTR: (await prisma.analytics.findUnique({ where: { projectId } }))?.ctr || 0,
        hookGap: category === 'weak' ? -20 : category === 'strong' ? 10 : 0,
      },
      create: {
        projectId,
        actualViews: 0,
        actualCTR: 0,
        actualRetention: 0,
      },
    });
  }

  private generateEarlyRecommendations(category: string, a: any): string[] {
    switch (category) {
      case 'weak':
        return [
          'Low early performance. Consider updating title/thumbnail if no improvement in 2 hours.',
          'Share video on social media to boost initial views.',
          'Pin a comment asking viewers what they think to boost engagement signals.',
        ];
      case 'average':
        return [
          'Performance is within expected range. Monitor for next 12 hours.',
          'Consider promoting in community tab if CTR improves.',
        ];
      case 'strong':
        return [
          'Above average early signals. Do not change title or thumbnail.',
          'Consider creating a related follow-up video to capitalize on momentum.',
          'Share to relevant communities and subreddits.',
        ];
      case 'breakout-candidate':
        return [
          'BREAKOUT CANDIDATE — Strong early signals across all metrics.',
          'DO NOT change title or thumbnail.',
          'Create a follow-up video immediately while topic is hot.',
          'Consider YouTube ad promotion to accelerate growth.',
          'Pin a strong CTA comment to capture traffic.',
        ];
      default:
        return ['Continue monitoring performance.'];
    }
  }
}
