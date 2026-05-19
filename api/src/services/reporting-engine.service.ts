import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';

interface VideoReport {
  projectId: string;
  videoId: string;
  title: string;
  publishedAt: string;
  views: number;
  ctr: number;
  avgRetention: number;
  retentionCurve: { second: number; retention: number }[];
  estimatedRevenue: number;
  estimatedRPM: number;
  mistakes: string[];
  improvements: string[];
  score: number;
}

interface DailyReport {
  date: string;
  totalVideosPublished: number;
  totalViews: number;
  totalRevenue: number;
  averageCTR: number;
  averageRetention: number;
  topVideo: string;
  worstVideo: string;
  recommendations: string[];
  trends: string[];
}

interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  totalVideos: number;
  totalViews: number;
  totalRevenue: number;
  avgCTR: number;
  avgRetention: number;
  growthRate: number;
  bestPerformer: string;
  worstPerformer: string;
  channelBreakdown: {
    channelId: string;
    channelName: string;
    videos: number;
    views: number;
    avgCTR: number;
    avgRetention: number;
  }[];
  lessons: string[];
  nextWeekPlan: string[];
}

function getRPM(topic: string): number {
  const lower = topic.toLowerCase();
  if (lower.includes('true crime')) return 12.50;
  if (lower.includes('paranormal')) return 8.75;
  if (lower.includes('mystery')) return 10.30;
  if (lower.includes('horror')) return 7.20;
  return 6.0;
}

export class ReportingEngine {
  async generateVideoReport(projectId: string): Promise<VideoReport> {
    const analytics = await prisma.analytics.findUnique({
      where: { projectId },
      include: {
        project: {
          include: {
            uploadHistory: true,
            analyticsLearning: true,
          },
        },
      },
    });

    if (!analytics) throw new Error(`No analytics for project ${projectId}`);

    const upload = analytics.project?.uploadHistory;
    const learning = analytics.project?.analyticsLearning;

    const retentionCurve = learning?.dropOffPoints
      ? (learning.dropOffPoints as any[]).map((d: any) => ({
          second: d.second || d.position || 0,
          retention: 100 - (d.dropRate || 0),
        }))
      : Array.from({ length: 10 }, (_, i) => ({ second: i * 60, retention: Math.max(0, 100 - i * 12) }));

    const rpm = await this.estimateRPM(analytics.project?.topic || '');
    const estimatedRevenue = (analytics.watchTime || 0) * (rpm / 1000);

    const mistakes: string[] = [];
    const improvements: string[] = [];

    if (analytics.ctr < 4) {
      mistakes.push(`Low CTR (${analytics.ctr}%) — thumbnail/title underperforming`);
      improvements.push('Regenerate thumbnail with face close-up + high contrast colors');
    }
    if (analytics.retention < 40) {
      mistakes.push(`Low retention (${analytics.retention}%) — viewers dropping early`);
      improvements.push('Increase pattern interrupt frequency to every 20-25s');
    }
    if (analytics.subscribersGained < 5) {
      mistakes.push('Low subscriber conversion');
      improvements.push('Add stronger subscribe CTA in first 60 seconds');
    }

    const score = Math.round(
      (Math.min(analytics.ctr || 0, 10) / 10 * 30) +
      (Math.min(analytics.retention || 0, 100) / 100 * 40) +
      (Math.min(estimatedRevenue, 100) / 100 * 30)
    );

    return {
      projectId,
      videoId: upload?.videoId || '',
      title: upload?.title || 'Untitled',
      publishedAt: upload?.publishedAt?.toISOString() || '',
      views: analytics.views,
      ctr: analytics.ctr,
      avgRetention: analytics.retention,
      retentionCurve,
      estimatedRevenue: Math.round(estimatedRevenue * 100) / 100,
      estimatedRPM: rpm,
      mistakes,
      improvements,
      score: Math.min(100, score),
    };
  }

  async generateDailyReport(userId: string): Promise<DailyReport> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayUploads = await prisma.uploadHistory.findMany({
      where: {
        userId,
        publishedAt: { gte: startOfDay },
      },
      include: { project: { include: { analytics: true } } },
    });

    const totalViews = todayUploads.reduce((s, u) => s + (u.project?.analytics?.views || 0), 0);
    const totalRevenue = todayUploads.reduce((s, u) => {
      const rpm = getRPM(u.project?.topic || '');
      return s + ((u.project?.analytics?.watchTime || 0) * (rpm / 1000));
    }, 0);

    const withAnalytics = todayUploads.filter(u => u.project?.analytics);
    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.ctr || 0), 0) / withAnalytics.length
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.retention || 0), 0) / withAnalytics.length
      : 0;

    const sorted = [...todayUploads].sort((a, b) => (b.project?.analytics?.views || 0) - (a.project?.analytics?.views || 0));

    return {
      date: startOfDay.toISOString(),
      totalVideosPublished: todayUploads.length,
      totalViews,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      averageCTR: Math.round(avgCTR * 100) / 100,
      averageRetention: Math.round(avgRetention),
      topVideo: sorted[0]?.title || 'No videos today',
      worstVideo: sorted[sorted.length - 1]?.title || 'No videos today',
      recommendations: [
        todayUploads.length === 0 ? 'Publish at least 1 video today to maintain growth' : 'Daily upload target met',
        avgCTR < 4 ? 'Improve thumbnail CTR across all videos' : 'CTR performance good',
        avgRetention < 40 ? 'Work on retention — faster pacing needed' : 'Retention on track',
      ],
      trends: [
        `Views: ${totalViews > 0 ? '+' : ''}${totalViews}`,
        `Revenue: $${Math.round(totalRevenue * 100) / 100}`,
      ],
    };
  }

  async generateWeeklyReport(userId: string): Promise<WeeklyReport> {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekUploads = await prisma.uploadHistory.findMany({
      where: {
        userId,
        publishedAt: { gte: weekStart, lt: weekEnd },
      },
      include: { project: { include: { analytics: true } } },
    });

    const accounts = await prisma.youTubeAccount.findMany({ where: { userId, isConnected: true } });
    const totalViews = weekUploads.reduce((s, u) => s + (u.project?.analytics?.views || 0), 0);
    const totalRevenue = weekUploads.reduce((s, u) => {
      const rpm = getRPM(u.project?.topic || '');
      return s + ((u.project?.analytics?.watchTime || 0) * (rpm / 1000));
    }, 0);

    const withAnalytics = weekUploads.filter(u => u.project?.analytics);
    const avgCTR = withAnalytics.length > 0
      ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.ctr || 0), 0) / withAnalytics.length
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? withAnalytics.reduce((s, u) => s + (u.project!.analytics!.retention || 0), 0) / withAnalytics.length
      : 0;

    const sorted = [...weekUploads].sort((a, b) => (b.project?.analytics?.views || 0) - (a.project?.analytics?.views || 0));
    const lastWeekUploads = await prisma.uploadHistory.findMany({
      where: {
        userId,
        publishedAt: {
          gte: new Date(weekStart.getTime() - 7 * 86400000),
          lt: weekStart,
        },
      },
    });
    const growthRate = lastWeekUploads.length > 0
      ? Math.round(((weekUploads.length - lastWeekUploads.length) / lastWeekUploads.length) * 100)
      : 100;

    const channelBreakdown = await Promise.all(
      accounts.map(async (acc) => {
        const chUploads = weekUploads.filter(u => u.channelId === acc.channelId);
        const chAnalytics = chUploads.filter(u => u.project?.analytics);
        return {
          channelId: acc.channelId,
          channelName: acc.channelTitle || 'Channel',
          videos: chUploads.length,
          views: chUploads.reduce((s, u) => s + (u.project?.analytics?.views || 0), 0),
          avgCTR: chAnalytics.length > 0
            ? Math.round(chAnalytics.reduce((s, u) => s + (u.project!.analytics!.ctr || 0), 0) / chAnalytics.length * 100) / 100
            : 0,
          avgRetention: chAnalytics.length > 0
            ? Math.round(chAnalytics.reduce((s, u) => s + (u.project!.analytics!.retention || 0), 0) / chAnalytics.length)
            : 0,
        };
      })
    );

    return {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      totalVideos: weekUploads.length,
      totalViews,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      avgCTR: Math.round(avgCTR * 100) / 100,
      avgRetention: Math.round(avgRetention),
      growthRate,
      bestPerformer: sorted[0]?.title || 'N/A',
      worstPerformer: sorted[sorted.length - 1]?.title || 'N/A',
      channelBreakdown,
      lessons: [
        channelBreakdown.filter(c => c.avgCTR > 5).length > 0 ? 'High CTR channels: ' + channelBreakdown.filter(c => c.avgCTR > 5).map(c => c.channelName).join(', ') : 'All channels need CTR improvement',
        `Best niche: ${channelBreakdown.sort((a, b) => b.avgRetention - a.avgRetention)[0]?.channelName || 'N/A'}`,
        avgRetention > 50 ? 'Retention strategy working well' : 'Increase pattern interrupt frequency across all channels',
      ],
      nextWeekPlan: [
        `Publish ${Math.max(1, 7 - weekUploads.length)} more videos this week`,
        avgCTR < 4 ? 'Run A/B thumbnail tests on all new uploads' : 'Maintain current thumbnail strategy',
        avgRetention < 40 ? 'Apply faster pacing to scripts' : 'Experiment with longer-form content',
        accounts.length < 3 ? 'Connect more channels for scaling' : 'Optimize existing channels before scaling',
      ],
    };
  }

  async generateMistakeAnalysis(projectId: string): Promise<{
    timestamp: number;
    mistake: string;
    severity: string;
    impact: string;
    fix: string;
  }[]> {
    const mistakes: any[] = [];
    const analytics = await prisma.analytics.findUnique({
      where: { projectId },
      include: { project: { include: { analyticsLearning: true } } },
    });

    if (!analytics) return [];

    if (analytics.ctr < 5) {
      mistakes.push({ timestamp: 0, mistake: `Low CTR: ${analytics.ctr}%`, severity: 'critical', impact: 'Reduced impressions and views', fix: 'Redesign thumbnail with face close-up + high contrast + curiosity text' });
    }
    if (analytics.retention < 40) {
      mistakes.push({ timestamp: 30, mistake: `Early drop-off (retention ${analytics.retention}%)`, severity: 'critical', impact: 'Lost viewers before key content', fix: 'Strengthen opening hook with pattern interrupt at 15s' });
    }

    const dropOffs = (analytics.project?.analyticsLearning?.dropOffPoints as any[]) || [];
    for (const d of dropOffs.slice(0, 5)) {
      if (d.dropRate > 20) {
        mistakes.push({
          timestamp: d.second || d.position || 0,
          mistake: `${d.dropRate}% viewer drop at ${d.second || d.position}s`,
          severity: d.dropRate > 30 ? 'critical' : 'moderate',
          impact: 'Significant audience loss',
          fix: 'Add micro-cliffhanger or emotional shift before this point',
        });
      }
    }

    return mistakes;
  }

  private async estimateRPM(topic: string): Promise<number> {
    const rpmMap: Record<string, number> = {
      'true crime': 12.50, 'paranormal': 8.75, 'horror': 7.20,
      'unsolved mysteries': 10.30, 'conspiracy': 9.80,
    };
    const lower = topic.toLowerCase();
    for (const [key, val] of Object.entries(rpmMap)) {
      if (lower.includes(key)) return val;
    }
    return 6.0;
  }
}
