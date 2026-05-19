import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

export interface FullGrowthReport {
  projectId: string;
  videoId: string;
  channelId: string;
  title: string;
  topic: string;
  hoursSinceUpload: number;
  views: number;
  watchTime: number;
  ctr: number;
  retention: number;
  likes: number;
  comments: number;
  shares: number;
  estimatedRevenue: number;
  rpm: number;
  growthTrend: 'accelerating' | 'stable' | 'slowing' | 'stalled';
  performanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  winningPatterns: {
    titleStyle: string;
    hookStyle: string;
    thumbnailStyle: string;
    pacing: string;
    ctaStyle: string;
    topicType: string;
  };
  recommendations: string[];
  canImproveTomorrow: boolean;
  generatedAt: Date;
}

export class FullGrowthReportService {
  async generateFullReport(projectId: string): Promise<FullGrowthReport | null> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        uploadHistory: true,
        monetizationConversion: true,
        contentPerformance: true,
      },
    });

    if (!project?.uploadHistory?.videoId || !project.analytics) return null;

    const uploadTime = project.uploadHistory.publishedAt || project.uploadHistory.createdAt;
    const hoursSince = (Date.now() - uploadTime.getTime()) / 3600000;

    const a = project.analytics;
    const convs = project.monetizationConversion || [];
    const totalConversions = Array.isArray(convs)
      ? convs.reduce((s: number, c: any) => s + (c.revenue || 0), 0)
      : 0;

    const estimatedRPM = a.views > 0 ? ((a.views / 1000) * 4 + totalConversions) / (a.views / 1000) : 0;
    const estimatedRevenue = (a.views / 1000) * 4 + totalConversions;

    const ctrScore = a.ctr >= 8 ? 5 : a.ctr >= 5 ? 4 : a.ctr >= 3 ? 3 : a.ctr >= 1.5 ? 2 : 1;
    const retentionScore = a.retention >= 60 ? 5 : a.retention >= 45 ? 4 : a.retention >= 30 ? 3 : a.retention >= 20 ? 2 : 1;
    const viewsScore = a.views >= 2000 ? 5 : a.views >= 1000 ? 4 : a.views >= 500 ? 3 : a.views >= 100 ? 2 : 1;
    const engagementScore = (a.likes + a.comments + a.shares) >= 50 ? 5
      : (a.likes + a.comments + a.shares) >= 20 ? 4
      : (a.likes + a.comments + a.shares) >= 10 ? 3
      : (a.likes + a.comments + a.shares) >= 5 ? 2 : 1;

    const totalScore = (ctrScore + retentionScore + viewsScore + engagementScore) / 4;
    const performanceGrade = totalScore >= 4.5 ? 'A' : totalScore >= 3.5 ? 'B' : totalScore >= 2.5 ? 'C' : totalScore >= 1.5 ? 'D' : 'F';

    const hourlyGrowth = hoursSince > 0 ? a.views / hoursSince : 0;
    let growthTrend: 'accelerating' | 'stable' | 'slowing' | 'stalled';
    if (hourlyGrowth > 50 && a.ctr > 5) growthTrend = 'accelerating';
    else if (hourlyGrowth > 10) growthTrend = 'stable';
    else if (hourlyGrowth > 2) growthTrend = 'slowing';
    else growthTrend = 'stalled';

    const report: FullGrowthReport = {
      projectId,
      videoId: project.uploadHistory.videoId,
      channelId: project.channelId || '',
      title: project.title || 'Untitled',
      topic: project.topic,
      hoursSinceUpload: Math.round(hoursSince * 10) / 10,
      views: a.views,
      watchTime: a.watchTime,
      ctr: a.ctr,
      retention: a.retention,
      likes: a.likes,
      comments: a.comments,
      shares: a.shares,
      estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
      rpm: Math.round(estimatedRPM * 100) / 100,
      growthTrend,
      performanceGrade,
      winningPatterns: {
        titleStyle: this.detectTitleStyle(project.title),
        hookStyle: a.retention > 50 ? 'curiosity-gap' : 'pattern-interrupt',
        thumbnailStyle: a.ctr > 6 ? 'high-contrast-text' : 'face-closeup',
        pacing: a.retention > 50 ? 'fast-paced' : 'varied',
        ctaStyle: a.comments > 10 ? 'question-based' : 'direct',
        topicType: project.format === 'shorts' ? 'short-form-viral' : 'long-form-educational',
      },
      recommendations: this.generateRecommendations(performanceGrade, a, growthTrend),
      canImproveTomorrow: performanceGrade !== 'A',
      generatedAt: new Date(),
    };

    await this.saveFullReport(projectId, report);
    await this.storeWinningPattern(report);

    logger.info(`[FullGrowth] ${project.title}: Grade ${performanceGrade} — Views: ${a.views}, CTR: ${a.ctr}%, Retention: ${a.retention}%, Revenue: $${estimatedRevenue.toFixed(2)}`);

    return report;
  }

  async generateReportsForAllPublished(hoursMin = 10): Promise<FullGrowthReport[]> {
    const published = await prisma.videoProject.findMany({
      where: {
        status: 'published',
        uploadHistory: { status: 'published' },
      },
      include: { analytics: true, uploadHistory: true },
      orderBy: { uploadHistory: { publishedAt: 'desc' } },
      take: 30,
    });

    const reports: FullGrowthReport[] = [];
    for (const p of published) {
      if (!p.uploadHistory?.publishedAt) continue;
      const hoursSince = (Date.now() - p.uploadHistory.publishedAt.getTime()) / 3600000;
      if (hoursSince < hoursMin) continue;

      const report = await this.generateFullReport(p.id);
      if (report) reports.push(report);
    }

    return reports;
  }

  private async saveFullReport(projectId: string, report: FullGrowthReport): Promise<void> {
    await prisma.appConfig.upsert({
      where: { key: `full_report:${projectId}` },
      update: { value: JSON.stringify(report) },
      create: {
        key: `full_report:${projectId}`,
        value: JSON.stringify(report),
        description: `12-hour full growth report for ${projectId}`,
      },
    });
  }

  private async storeWinningPattern(report: FullGrowthReport): Promise<void> {
    const pattern = report.performanceGrade >= 'B'
      ? report.winningPatterns : null;
    if (!pattern) return;

    await prisma.winningPattern.upsert({
      where: { id: `wp_${report.projectId}` },
      update: {
        content: JSON.stringify(pattern),
        score: this.gradeToScore(report.performanceGrade),
        avgRetention: report.retention,
        avgCTR: report.ctr,
        lastUsedAt: new Date(),
        sampleSize: { increment: 1 },
      },
      create: {
        id: `wp_${report.projectId}`,
        category: 'pattern',
        niche: report.topic.split(' ')[0],
        content: JSON.stringify(pattern),
        patternType: `${report.winningPatterns.topicType}-${report.winningPatterns.hookStyle}`,
        score: this.gradeToScore(report.performanceGrade),
        avgRetention: report.retention,
        avgCTR: report.ctr,
        sampleSize: 1,
        lastUsedAt: new Date(),
        source: 'daily-income-system',
      },
    });
  }

  private detectTitleStyle(title: string | null): string {
    if (!title) return 'descriptive';
    if (title.includes('How to') || title.includes('How I')) return 'how-to';
    if (title.match(/^\d+/)) return 'numbered-list';
    if (title.includes(' vs ')) return 'comparison';
    if (title.includes('Why') || title.includes('The Truth')) return 'curiosity-gap';
    if (title.includes('Best') || title.includes('Top')) return 'best-of';
    return 'descriptive';
  }

  private generateRecommendations(grade: string, a: any, trend: string): string[] {
    const recs: string[] = [];
    if (grade === 'A') {
      recs.push('Excellent performance — use this exact pattern for tomorrow\'s videos');
      recs.push('Create a follow-up video on this topic while momentum is high');
    } else if (grade === 'B') {
      recs.push('Good performance — minor optimizations can push to A grade');
      if (a.ctr < 5) recs.push('Improve CTR with stronger title/thumbnail contrast');
      if (a.retention < 40) recs.push('Boost retention with tighter pacing and more pattern interrupts');
    } else if (grade === 'C') {
      recs.push('Average performance — needs significant optimization');
      recs.push('Rewrite hook to be stronger in first 5 seconds');
      recs.push('Test new thumbnail style with bolder text overlay');
    } else {
      recs.push('Poor performance — avoid this topic/format/style tomorrow');
      recs.push('Consider a different niche angle or content format');
      recs.push('Analyze drop-off points and restructure content flow');
    }
    if (trend === 'accelerating') recs.push('Video gaining momentum — promote further');
    if (trend === 'stalled') recs.push('Video not gaining traction — learn from it and move on');
    return recs;
  }

  private gradeToScore(grade: string): number {
    const map: Record<string, number> = { 'A': 90, 'B': 75, 'C': 55, 'D': 35, 'F': 15 };
    return map[grade] || 50;
  }
}
