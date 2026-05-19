import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { FullGrowthReport } from './full-growth-report.service';

export interface VideoPerformanceRanking {
  rank: number;
  projectId: string;
  videoId: string;
  title: string;
  topic: string;
  views: number;
  ctr: number;
  retention: number;
  revenue: number;
  performanceScore: number;
  growthTrend: string;
  performanceGrade: string;
  winningPattern: {
    titleStyle: string;
    hookStyle: string;
    thumbnailStyle: string;
    pacing: string;
    ctaStyle: string;
    topicType: string;
  };
  isWinner: boolean;
}

export interface DailyWinnerResult {
  date: string;
  channelId: string;
  channelTitle: string;
  winner: VideoPerformanceRanking | null;
  allVideos: VideoPerformanceRanking[];
  winningPattern: Record<string, string> | null;
  patternSummary: string;
}

const WINNER_KEY_PREFIX = 'income:winner:';

export class BestVideoDetector {
  async detectDailyWinner(channelId: string): Promise<DailyWinnerResult> {
    const date = new Date().toISOString().split('T')[0];
    const channel = await prisma.youTubeAccount.findFirst({ where: { channelId } });
    const channelTitle = channel?.channelTitle || 'Unknown';

    const todayStart = new Date(date);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const todayVideos = await prisma.videoProject.findMany({
      where: {
        channelId,
        uploadHistory: {
          status: 'published',
          publishedAt: {
            gte: todayStart,
            lt: todayEnd,
          },
        },
      },
      include: {
        analytics: true,
        uploadHistory: true,
        monetizationConversion: true,
      },
      orderBy: { uploadHistory: { publishedAt: 'desc' } },
    });

    const allTimeToday = await prisma.videoProject.findMany({
      where: {
        channelId,
        uploadHistory: { status: 'published' },
      },
      include: {
        analytics: true,
        uploadHistory: true,
        monetizationConversion: true,
      },
      orderBy: { uploadHistory: { publishedAt: 'desc' } },
      take: 10,
    });

    const videosToRank = todayVideos.length >= 2 ? todayVideos : allTimeToday;

    if (videosToRank.length === 0) {
      logger.info(`[BestVideoDetector] ${channelTitle}: No videos found for ${date}`);
      return {
        date, channelId, channelTitle,
        winner: null,
        allVideos: [],
        winningPattern: null,
        patternSummary: 'No videos to analyze today.',
      };
    }

    const ranked = this.rankVideos(videosToRank);
    const winner = ranked[0] || null;

    const winningPattern = winner ? {
      titleStyle: winner.winningPattern.titleStyle,
      hookStyle: winner.winningPattern.hookStyle,
      thumbnailStyle: winner.winningPattern.thumbnailStyle,
      pacing: winner.winningPattern.pacing,
      ctaStyle: winner.winningPattern.ctaStyle,
      topicType: winner.winningPattern.topicType,
    } : null;

    const patternSummary = winner
      ? `Winner: "${winner.title}" (Score: ${winner.performanceScore}) — ${winner.winningPattern.topicType}, ${winner.winningPattern.hookStyle} hook, ${winner.winningPattern.thumbnailStyle} thumbnail`
      : 'No winner detected';

    await this.saveWinner(channelId, date, winner, winningPattern);

    if (winner) {
      logger.info(`[BestVideoDetector] ${channelTitle}: Winner = "${winner.title}" (Score: ${winner.performanceScore}, Views: ${winner.views}, CTR: ${winner.ctr}%)`);

      await prisma.winningPattern.upsert({
        where: { id: `winner_daily_${channelId}_${date}` },
        update: {
          content: JSON.stringify(winningPattern),
          score: winner.performanceScore,
          avgRetention: winner.retention,
          avgCTR: winner.ctr,
          lastUsedAt: new Date(),
        },
        create: {
          id: `winner_daily_${channelId}_${date}`,
          category: 'daily-winner',
          niche: winner.topic.split(' ').slice(0, 3).join(' '),
          content: JSON.stringify(winningPattern),
          patternType: winner.winningPattern.topicType,
          score: winner.performanceScore,
          avgRetention: winner.retention,
          avgCTR: winner.ctr,
          sampleSize: ranked.length,
          lastUsedAt: new Date(),
          source: 'best-video-detector',
        },
      });
    }

    return {
      date, channelId, channelTitle,
      winner,
      allVideos: ranked,
      winningPattern,
      patternSummary,
    };
  }

  async getWinningPatternForChannel(channelId: string): Promise<Record<string, string> | null> {
    const latestWinner = await prisma.winningPattern.findFirst({
      where: { category: 'daily-winner' },
      orderBy: { lastUsedAt: 'desc' },
    });
    if (!latestWinner?.content) return null;

    try {
      return JSON.parse(latestWinner.content);
    } catch {
      return null;
    }
  }

  async getLastWeekWinners(channelId: string): Promise<{ date: string; title: string; score: number }[]> {
    const winners: { date: string; title: string; score: number }[] = [];
    const today = new Date();

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const record = await prisma.appConfig.findUnique({
        where: { key: `${WINNER_KEY_PREFIX}${channelId}:${dateStr}` },
      });

      if (record) {
        try {
          const data = JSON.parse(record.value);
          if (data.title) {
            winners.push({ date: dateStr, title: data.title, score: data.score || 0 });
          }
        } catch {}
      }
    }

    return winners;
  }

  private rankVideos(videos: any[]): VideoPerformanceRanking[] {
    const ranked = videos.map((v, i) => {
      const a = v.analytics || {};
      const views = a.views || 0;
      const ctr = a.ctr || 0;
      const retention = a.retention || 0;

      const convs = v.monetizationConversion || [];
      const revenue = Array.isArray(convs)
        ? convs.reduce((s: number, c: any) => s + (c.revenue || 0), 0) + (views / 1000) * 4
        : (views / 1000) * 4;

      const ctrScore = Math.min(30, ctr * 3);
      const retentionScore = Math.min(30, retention * 0.5);
      const viewsScore = Math.min(20, Math.log10(views + 1) * 5);
      const revenueScore = Math.min(20, revenue * 2);

      const performanceScore = Math.round(ctrScore + retentionScore + viewsScore + revenueScore);

      let growthTrend = 'stable';
      if (ctr > 6 && retention > 45) growthTrend = 'accelerating';
      else if (ctr > 3 && retention > 30) growthTrend = 'stable';
      else growthTrend = 'slowing';

      let grade = 'C';
      if (performanceScore >= 80) grade = 'A';
      else if (performanceScore >= 60) grade = 'B';
      else if (performanceScore >= 40) grade = 'C';
      else if (performanceScore >= 20) grade = 'D';
      else grade = 'F';

      return {
        rank: 0,
        projectId: v.id,
        videoId: v.uploadHistory?.videoId || 'unknown',
        title: v.title || 'Untitled',
        topic: v.topic,
        views,
        ctr,
        retention,
        revenue: Math.round(revenue * 100) / 100,
        performanceScore,
        growthTrend,
        performanceGrade: grade,
        winningPattern: {
          titleStyle: this.detectTitleStyle(v.title),
          hookStyle: retention > 50 ? 'curiosity-gap' : 'pattern-interrupt',
          thumbnailStyle: ctr > 6 ? 'high-contrast-text' : 'face-closeup',
          pacing: retention > 50 ? 'fast-paced' : 'varied',
          ctaStyle: a.comments > 10 ? 'question-based' : 'direct',
          topicType: v.format === 'shorts' ? 'short-form-viral' : 'long-form-educational',
        },
        isWinner: false,
      };
    });

    ranked.sort((a, b) => b.performanceScore - a.performanceScore);
    ranked.forEach((v, i) => {
      v.rank = i + 1;
      v.isWinner = i === 0;
    });

    return ranked;
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

  private async saveWinner(channelId: string, date: string, winner: VideoPerformanceRanking | null, pattern: Record<string, string> | null): Promise<void> {
    const key = `${WINNER_KEY_PREFIX}${channelId}:${date}`;
    await prisma.appConfig.upsert({
      where: { key },
      update: {
        value: JSON.stringify({
          title: winner?.title || null,
          score: winner?.performanceScore || 0,
          pattern,
          rankedAt: new Date().toISOString(),
        }),
      },
      create: {
        key,
        value: JSON.stringify({
          title: winner?.title || null,
          score: winner?.performanceScore || 0,
          pattern,
          rankedAt: new Date().toISOString(),
        }),
        description: `Daily winner for ${channelId} on ${date}`,
      },
    });
  }
}
