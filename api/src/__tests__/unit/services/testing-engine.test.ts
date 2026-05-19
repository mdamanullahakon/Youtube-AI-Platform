import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateWithAI = vi.hoisted(() => vi.fn().mockResolvedValue(`[
  {
    "testType": "title",
    "hypothesis": "Question-based titles drive higher CTR",
    "predictedWinner": "A",
    "variantA": { "title": "Did They Really Find This in the Woods?", "thumbnailPrompt": "Dark forest, flashlight beam revealing something", "hook": "What I found in these woods will haunt you", "predictedCTR": 8.5, "predictedRetention": 65 },
    "variantB": { "title": "The Forest Discovery That Changes Everything", "thumbnailPrompt": "Close-up of terrified face in forest", "hook": "Three hikers went in. Only one came out.", "predictedCTR": 7.2, "predictedRetention": 60 }
  },
  {
    "testType": "thumbnail",
    "hypothesis": "Face close-up with fear expression outperforms landscape shots",
    "predictedWinner": "A",
    "variantA": { "title": "What They Found in the Forest", "thumbnailPrompt": "Extreme close-up of wide eye reflecting forest scene", "hook": "The forest was hiding something terrible", "predictedCTR": 9.1, "predictedRetention": 62 },
    "variantB": { "title": "The Forest Discovery", "thumbnailPrompt": "Wide shot of dark forest with single light source", "hook": "Nobody knew what was buried beneath the trees", "predictedCTR": 5.8, "predictedRetention": 55 }
  },
  {
    "testType": "hook",
    "hypothesis": "Micro-cliffhanger hooks outperform question hooks",
    "predictedWinner": "A",
    "variantA": { "title": "Forest Discovery That Changes History", "thumbnailPrompt": "Mysterious object in forest clearing", "hook": "The moment I saw it, I knew nothing would ever be the same.", "predictedCTR": 7.8, "predictedRetention": 70 },
    "variantB": { "title": "Incredible Forest Find", "thumbnailPrompt": "Person standing at forest edge looking back", "hook": "Have you ever wondered what's really out there in the dark?", "predictedCTR": 6.5, "predictedRetention": 58 }
  }
]`));

const mockExtractJsonArray = vi.hoisted(() => vi.fn().mockImplementation((s: string) => JSON.parse(s)));
vi.mock('../../../services/ai.service', () => ({
  generateWithAI: mockGenerateWithAI,
}));
vi.mock('../../../utils/parse-ai-response', () => ({
  extractJsonArray: mockExtractJsonArray,
}));

const mockPrisma = vi.hoisted(() => ({
  aBTestResult: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../config/db', () => ({ prisma: mockPrisma }));

import { TestingEngine } from '../../../services/testing-engine.service';

describe('TestingEngine', () => {
  let engine: TestingEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new TestingEngine();
  });

  describe('generateVariants', () => {
    it('should generate 3 A/B test definitions', async () => {
      const variants = await engine.generateVariants('Forest discovery horror story', 'The forest was hiding something no one expected');
      expect(variants).toHaveLength(3);
    });

    it('should include title, thumbnail, and hook test types', async () => {
      const variants = await engine.generateVariants('Forest discovery horror story', 'The forest was hiding something no one expected');
      const testTypes = variants.map(v => v.testType);
      expect(testTypes).toContain('title');
      expect(testTypes).toContain('thumbnail');
      expect(testTypes).toContain('hook');
    });

    it('should have two variants per test', async () => {
      const variants = await engine.generateVariants('Forest discovery horror story', 'The forest was hiding something no one expected');
      for (const v of variants) {
        expect(v.variantA).toBeDefined();
        expect(v.variantB).toBeDefined();
        expect(v.variantA.title).toBeTruthy();
        expect(v.variantB.title).toBeTruthy();
      }
    });

    it('should have predicted CTR and retention for each variant', async () => {
      const variants = await engine.generateVariants('Forest discovery horror story', 'The forest was hiding something no one expected');
      for (const v of variants) {
        expect(v.variantA.predictedCTR).toBeGreaterThan(0);
        expect(v.variantA.predictedRetention).toBeGreaterThan(0);
        expect(v.variantB.predictedCTR).toBeGreaterThan(0);
        expect(v.variantB.predictedRetention).toBeGreaterThan(0);
      }
    });

    it('should include hypothesis for each test', async () => {
      const variants = await engine.generateVariants('Forest discovery horror story', 'The forest was hiding something no one expected');
      for (const v of variants) {
        expect(v.hypothesis).toBeTruthy();
      }
    });
  });

  describe('recordTestResult', () => {
    it('should return a test result with confidence', async () => {
      mockPrisma.aBTestResult.findFirst.mockResolvedValue({
        variantA: { predictedCTR: 8 },
        variantB: { predictedCTR: 6 },
        ctrA: 0,
        ctrB: 0,
        retentionA: 0,
        retentionB: 0,
        status: 'pending',
      });

      const result = await engine.recordTestResult(
        'project-1', 'title',
        { title: 'Variant A', predictedCTR: 8, predictedRetention: 60 },
        { title: 'Variant B', predictedCTR: 6, predictedRetention: 55 },
        { ctrA: 7.2, ctrB: 4.5, retentionA: 62, retentionB: 58 }
      );

      expect(result).toHaveProperty('winner');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('significant');
    });
  });

  describe('getWinnerForProject', () => {
    it('should return default winners when no tests exist', async () => {
      mockPrisma.aBTestResult.findMany.mockResolvedValue([]);
      const winner = await engine.getWinnerForProject('project-nonexistent');
      expect(winner).toBeDefined();
      expect(winner.bestTitle).toBeDefined();
    });

    it('should return best variants when tests exist', async () => {
      mockPrisma.aBTestResult.findMany.mockResolvedValue([
        {
          testType: 'title', winner: 'A', status: 'completed', completedAt: new Date(),
          variantA: '{ "title": "Best Title Ever", "thumbnailPrompt": "prompt A", "hook": "hook A" }',
          variantB: '{ "title": "Okay Title", "thumbnailPrompt": "prompt B", "hook": "hook B" }',
          statisticallySignificant: true, confidence: 96,
          ctrA: 8.5, ctrB: 4.2, retentionA: 65, retentionB: 50,
          project: { projectId: 'project-1' },
        },
        {
          testType: 'thumbnail', winner: 'B', status: 'completed', completedAt: new Date(),
          variantA: '{ "title": "Title A", "thumbnailPrompt": "prompt A", "hook": "hook A" }',
          variantB: '{ "title": "Title B", "thumbnailPrompt": "prompt B", "hook": "hook B" }',
          statisticallySignificant: true, confidence: 95,
          ctrA: 5.0, ctrB: 7.8, retentionA: 55, retentionB: 68,
          project: { projectId: 'project-1' },
        },
      ]);

      const winner = await engine.getWinnerForProject('project-1');
      expect(winner).toBeDefined();
      expect(winner.bestTitle).toBeTruthy();
    });
  });

  describe('generateDefaultVariants', () => {
    it('should return 3 default variants without calling AI', () => {
      const variants = engine.generateDefaultVariants('horror story', 'horror');
      expect(variants).toHaveLength(3);
      expect(variants[0].testType).toBe('title');
      expect(variants[1].testType).toBe('thumbnail');
      expect(variants[2].testType).toBe('hook');
    });
  });
});
