import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGenerateWithAI = vi.hoisted(() => vi.fn());
vi.mock('../../../services/ai.service', () => ({
  generateWithAI: mockGenerateWithAI,
}));

const mockPrisma = vi.hoisted(() => ({
  analytics: {
    findUnique: vi.fn(),
  },
  videoProject: {
    findMany: vi.fn(),
  },
  analyticsLearning: {
    upsert: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../config/db', () => ({ prisma: mockPrisma }));

import { SelfImprovingContentEngine } from '../../../services/self-improving-content.service';

describe('SelfImprovingContentEngine', () => {
  let engine: SelfImprovingContentEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new SelfImprovingContentEngine();
  });

  describe('analyzeVideoPerformance', () => {
    it('should return default improvement plan when no analytics exist', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue(null);
      const result = await engine.analyzeVideoPerformance('project-nonexistent');
      expect(result.projectId).toBe('project-nonexistent');
      expect(result.improvementPlan.length).toBeGreaterThan(0);
      expect(result.weakPoints).toEqual([]);
      expect(result.strengths).toEqual([]);
    });

    it('should identify weak CTR when below 5% benchmark', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        ctr: 2.5,
        retention: 45,
        views: 100,
        watchTime: 5000,
        avgViewDuration: 50,
        impressions: 4000,
        likes: 10,
        subscribersGained: 2,
        estimatedRevenue: 0,
        estimatedRPM: 0,
        retentionCurve: [],
        project: {
          script: { content: 'Test script content' },
          thumbnail: { imageUrl: 'test.jpg' },
          analyticsLearning: null,
        },
      });

      const result = await engine.analyzeVideoPerformance('project-1');
      const ctrWeakPoint = result.weakPoints.find(w => w.metric === 'CTR');
      expect(ctrWeakPoint).toBeDefined();
      expect(ctrWeakPoint!.severity).toBe('critical');
      expect(ctrWeakPoint!.actualValue).toBe(2.5);
      expect(ctrWeakPoint!.benchmarkValue).toBe(5.0);
    });

    it('should identify weak retention when below 50% benchmark', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        ctr: 6.0,
        retention: 30,
        views: 500,
        watchTime: 15000,
        avgViewDuration: 30,
        impressions: 8000,
        likes: 25,
        subscribersGained: 5,
        estimatedRevenue: 0,
        estimatedRPM: 0,
        retentionCurve: [],
        project: {
          script: { content: 'Test script content' },
          thumbnail: { imageUrl: 'test.jpg' },
          analyticsLearning: null,
        },
      });

      const result = await engine.analyzeVideoPerformance('project-1');
      const retentionWeakPoint = result.weakPoints.find(w => w.metric === 'Retention');
      expect(retentionWeakPoint).toBeDefined();
      expect(retentionWeakPoint!.severity).toBe('moderate');
      expect(retentionWeakPoint!.actualValue).toBe(30);
    });

    it('should identify strengths when benchmarks are met', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        ctr: 7.5,
        retention: 65,
        views: 5000,
        watchTime: 300000,
        avgViewDuration: 60,
        impressions: 60000,
        likes: 200,
        subscribersGained: 50,
        estimatedRevenue: 25,
        estimatedRPM: 5,
        retentionCurve: [],
        project: {
          script: { content: 'Test script content' },
          thumbnail: { imageUrl: 'test.jpg' },
          analyticsLearning: null,
        },
      });

      const result = await engine.analyzeVideoPerformance('project-1');
      expect(result.strengths.length).toBeGreaterThanOrEqual(2);
      expect(result.weakPoints.length).toBe(0);
    });

    it('should generate improvement plan with actions', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        ctr: 3.0,
        retention: 35,
        views: 200,
        watchTime: 7000,
        avgViewDuration: 35,
        impressions: 5000,
        likes: 5,
        subscribersGained: 0,
        estimatedRevenue: 0,
        estimatedRPM: 0,
        retentionCurve: [],
        project: {
          script: { content: 'Test script content' },
          thumbnail: { imageUrl: 'test.jpg' },
          analyticsLearning: null,
        },
      });

      const result = await engine.analyzeVideoPerformance('project-1');
      expect(result.improvementPlan.length).toBeGreaterThan(0);
      for (const action of result.improvementPlan) {
        expect(action).toHaveProperty('component');
        expect(action).toHaveProperty('change');
        expect(action).toHaveProperty('expectedLift');
        expect(action).toHaveProperty('reason');
        expect(['hook', 'thumbnail', 'pacing', 'title', 'description', 'cta']).toContain(action.component);
      }
    });
  });

  describe('improveScript', () => {
    it('should return original script when no weak points', async () => {
      mockPrisma.analytics.findUnique.mockResolvedValue(null);
      const improved = await engine.improveScript('Original content', 'project-1');
      expect(improved).toBe('Original content');
    });

    it('should attempt improvement when retention is weak', async () => {
      mockGenerateWithAI.mockResolvedValue('Improved script with better retention hooks and pattern interrupts throughout the narrative.');
      mockPrisma.analytics.findUnique.mockResolvedValue({
        projectId: 'project-1',
        ctr: 6.0,
        retention: 35,
        views: 200,
        watchTime: 7000,
        avgViewDuration: 35,
        impressions: 5000,
        likes: 5,
        subscribersGained: 0,
        estimatedRevenue: 0,
        estimatedRPM: 0,
        retentionCurve: [],
        project: {
          script: { content: 'Original script content that needs improvement' },
          thumbnail: { imageUrl: 'test.jpg' },
          analyticsLearning: null,
        },
      });

      const improved = await engine.improveScript('Original script content that needs improvement', 'project-1');
      expect(improved.length).toBeGreaterThan(0);
    });
  });

  describe('getLearnedPatterns', () => {
    it('should return fallback patterns when no projects found', async () => {
      mockPrisma.videoProject.findMany.mockResolvedValue([]);
      const patterns = await engine.getLearnedPatterns('horror');
      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]).toHaveProperty('pattern');
      expect(patterns[0]).toHaveProperty('effectiveness');
    });

    it('should extract patterns from analytics learning data', async () => {
      mockPrisma.videoProject.findMany.mockResolvedValue([
        {
          analyticsLearning: {
            recommendations: {
              patterns: [
                { pattern: 'Use question hooks', component: 'hook', effectiveness: 85, timesUsed: 10, confidence: 75 },
                { pattern: 'Face close-up thumbnails', component: 'thumbnail', effectiveness: 78, timesUsed: 8, confidence: 70 },
              ],
            },
          },
        },
      ]);

      const patterns = await engine.getLearnedPatterns('horror');
      expect(patterns.length).toBe(2);
      expect(patterns[0]).toHaveProperty('pattern');
      expect(patterns[0]).toHaveProperty('effectiveness');
    });
  });
});
