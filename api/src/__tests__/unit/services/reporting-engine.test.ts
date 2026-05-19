import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockAiFn = vi.hoisted(() => vi.fn());
mockAiFn.mockResolvedValue(JSON.stringify({
  mistakes: ['Weak hook in first 15 seconds', 'Thumbnail lacks contrast', 'Scene pacing too slow at 4:32'],
  improvements: ['Strengthen opening with curiosity gap', 'Add red overlay to thumbnail', 'Cut scene 4 to under 15 seconds'],
  score: 65,
  trends: ['Face close-up thumbnails trending', 'Question-based titles up 20%'],
  lessons: ['Videos with hooks in first 3 seconds perform 40% better', 'Thumbnails with text overlay get 25% more CTR'],
  nextWeekPlan: ['Focus on stronger hooks', 'A/B test thumbnail styles'],
}));
vi.mock('../../../services/ai.service', () => ({
  generateWithAI: mockAiFn,
}));

const mockPrisma = vi.hoisted(() => ({
  analytics: { findUnique: vi.fn() },
  uploadHistory: { findMany: vi.fn(), groupBy: vi.fn() },
  videoProject: { findMany: vi.fn() },
  youTubeAccount: { findMany: vi.fn().mockResolvedValue([]) },
  analyticsLearning: { findMany: vi.fn() },
}));

vi.mock('../../../config/db', () => ({ prisma: mockPrisma }));

import { ReportingEngine } from '../../../services/reporting-engine.service';

describe('ReportingEngine', () => {
  let engine: ReportingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ReportingEngine();
  });

  describe('generateVideoReport', () => {
    it('should throw when no analytics found', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue(null);
      await expect(engine.generateVideoReport('project-nonexistent')).rejects.toThrow();
    });

    it('should generate a complete video report', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        views: 15000,
        likes: 1200,
        comments: 340,
        ctr: 8.5,
        retention: 62,
        watchTime: 450000,
        avgViewDuration: 30,
        impressions: 176000,
        subscribersGained: 185,
        estimatedRevenue: 75.5,
        estimatedRPM: 5.03,
        retentionCurve: [],
        project: {
          uploadHistory: { videoId: 'video-1', title: 'Test Video', publishedAt: new Date(), channelId: 'channel-1' },
          analyticsLearning: {
            dropOffPoints: [
              { second: 30, dropRate: 15 },
              { second: 60, dropRate: 25 },
              { second: 120, dropRate: 35 },
            ],
          },
        },
      });

      const report = await engine.generateVideoReport('project-1');
      expect(report.projectId).toBe('project-1');
      expect(report.views).toBe(15000);
      expect(report.ctr).toBe(8.5);
      expect(report.avgRetention).toBe(62);
      expect(report.estimatedRevenue).toBeGreaterThan(0);
      expect(report.retentionCurve.length).toBeGreaterThan(0);
      expect(Array.isArray(report.mistakes)).toBe(true);
      expect(Array.isArray(report.improvements)).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('should generate retention curve from drop-off points', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        views: 1000, likes: 50, comments: 10, ctr: 5.0, retention: 50,
        watchTime: 30000, avgViewDuration: 30, impressions: 20000,
        subscribersGained: 10, estimatedRevenue: 0, estimatedRPM: 0,
        retentionCurve: [],
        project: {
          uploadHistory: { videoId: 'video-1', title: 'Test', publishedAt: new Date() },
          analyticsLearning: {
            dropOffPoints: [
              { second: 0, dropRate: 0 },
              { second: 30, dropRate: 20 },
              { second: 60, dropRate: 40 },
              { second: 120, dropRate: 60 },
              { second: 300, dropRate: 80 },
            ],
          },
        },
      });

      const report = await engine.generateVideoReport('project-1');
      expect(report.retentionCurve.length).toBeGreaterThanOrEqual(5);
      expect(report.retentionCurve[0].retention).toBe(100);
    });
  });

  describe('generateDailyReport', () => {
    it('should generate a daily report with zero uploads', async () => {
      mockPrisma.uploadHistory.findMany.mockResolvedValue([]);
      mockAiFn.mockResolvedValue(JSON.stringify({
        recommendations: ['No videos published today'],
        trends: [],
      }));

      const report = await engine.generateDailyReport('user-1');
      expect(report.date).toBeTruthy();
      expect(report.totalVideosPublished).toBe(0);
      expect(report.totalViews).toBe(0);
      expect(report.totalRevenue).toBe(0);
    });

    it('should aggregate multiple uploads', async () => {
      mockPrisma.uploadHistory.findMany.mockResolvedValue([
        {
          id: 'u1', projectId: 'p1', videoId: 'v1', title: 'Video 1', status: 'uploaded',
          publishedAt: new Date(), channelId: 'c1', userId: 'user-1',
          project: { analytics: { views: 1000, ctr: 6.0, retention: 55, watchTime: 500000, estimatedRevenue: 5 } },
        },
        {
          id: 'u2', projectId: 'p2', videoId: 'v2', title: 'Video 2', status: 'uploaded',
          publishedAt: new Date(), channelId: 'c1', userId: 'user-1',
          project: { analytics: { views: 500, ctr: 4.0, retention: 45, watchTime: 250000, estimatedRevenue: 2.5 } },
        },
      ]);
      mockAiFn.mockResolvedValue(JSON.stringify({
        recommendations: ['Increase upload frequency', 'Test different thumbnail styles'],
        trends: ['Retention improving week over week'],
      }));

      const report = await engine.generateDailyReport('user-1');
      expect(report.totalVideosPublished).toBe(2);
      expect(report.totalViews).toBe(1500);
      expect(report.totalRevenue).toBeGreaterThan(0);
      expect(report.topVideo).toBeTruthy();
      expect(report.worstVideo).toBeTruthy();
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('generateWeeklyReport', () => {
    it('should generate a weekly report with channel breakdown', async () => {
      mockPrisma.uploadHistory.findMany.mockResolvedValue([
        {
          projectId: 'p1', videoId: 'v1', title: 'Weekly Vid 1', status: 'uploaded',
          publishedAt: new Date(Date.now() - 86400000), channelId: 'c1', userId: 'user-1',
          project: { topic: 'horror', analytics: { views: 2000, ctr: 7.0, retention: 60, watchTime: 1000000, estimatedRevenue: 10 } },
        },
        {
          projectId: 'p2', videoId: 'v2', title: 'Weekly Vid 2', status: 'uploaded',
          publishedAt: new Date(Date.now() - 172800000), channelId: 'c2', userId: 'user-1',
          project: { topic: 'paranormal', analytics: { views: 3000, ctr: 5.0, retention: 50, watchTime: 1500000, estimatedRevenue: 15 } },
        },
      ]);
      mockPrisma.youTubeAccount.findMany.mockResolvedValue([
        { channelId: 'c1', channelName: 'Horror Channel' },
        { channelId: 'c2', channelName: 'Paranormal Channel' },
      ]);
      mockPrisma.analyticsLearning.findMany.mockResolvedValue([
        { project: { uploadHistory: [{ videoId: 'v1' }] }, recommendations: { weakPoints: ['Retention drop at 30s'] } },
      ]);
      mockAiFn.mockResolvedValue(JSON.stringify({
        lessons: ['Pattern interrupts improve retention by 15%', 'Shorter titles (under 50 chars) get higher CTR'],
        nextWeekPlan: ['Increase scene frequency', 'A/B test 3 thumbnail variations'],
      }));

      const report = await engine.generateWeeklyReport('user-1');
      expect(report.totalVideos).toBe(2);
      expect(report.totalViews).toBe(5000);
      expect(report.totalRevenue).toBeGreaterThan(0);
      expect(report.channelBreakdown.length).toBeGreaterThanOrEqual(2);
      expect(report.lessons.length).toBeGreaterThan(0);
      expect(report.nextWeekPlan.length).toBeGreaterThan(0);
      expect(report.bestPerformer).toBeTruthy();
    });

    it('should handle empty weekly data', async () => {
      mockPrisma.uploadHistory.findMany.mockResolvedValue([]);
      mockPrisma.youTubeAccount.findMany.mockResolvedValue([]);
      mockPrisma.analyticsLearning.findMany.mockResolvedValue([]);
      mockAiFn.mockResolvedValue(JSON.stringify({
        lessons: ['No data for this week'],
        nextWeekPlan: ['Start publishing content'],
      }));

      const report = await engine.generateWeeklyReport('user-1');
      expect(report.totalVideos).toBe(0);
      expect(report.channelBreakdown).toEqual([]);
    });
  });
});
