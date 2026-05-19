import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  videoProject: { findMany: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../config/db', () => ({ prisma: mockPrisma }));

import { ViralPredictionEngine } from '../../../services/viral-prediction-engine.service';

describe('ViralPredictionEngine', () => {
  let engine: ViralPredictionEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ViralPredictionEngine();
  });

  describe('predict', () => {
    const topic = 'The abandoned hospital in the woods';
    const hook = 'What if I told you this hospital was still operating... at night?';
    const title = 'The Truth About Abandoned Hospital Night Operations';
    const scenes = [
      { text: 'Setting the scene in the dark woods', duration: 18 },
      { text: 'First discovery of the hospital', duration: 15 },
      { text: 'Unexpected sound from inside', duration: 20 },
      { text: 'The truth is revealed', duration: 22 },
    ];

    it('should return a viral score between 0-100', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
      expect(result.viralScore).toBeLessThanOrEqual(100);
    });

    it('should predict CTR between 2-15%', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.ctrPrediction).toBeGreaterThanOrEqual(2);
      expect(result.ctrPrediction).toBeLessThanOrEqual(15);
    });

    it('should predict retention between 30-90%', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.retentionPrediction).toBeGreaterThanOrEqual(30);
      expect(result.retentionPrediction).toBeLessThanOrEqual(90);
    });

    it('should return revenue potential > 0', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.revenuePotential).toBeGreaterThan(0);
    });

    it('should have thresholdMet property', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(typeof result.thresholdMet).toBe('boolean');
    });

    it('should return factor breakdown', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.factors.length).toBeGreaterThanOrEqual(3);
      expect(result.factors[0]).toHaveProperty('name');
      expect(result.factors[0]).toHaveProperty('score');
      expect(result.factors[0]).toHaveProperty('weight');
      expect(result.factors[0]).toHaveProperty('impact');
    });

    it('should return a recommendation string', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.recommendation).toBeTruthy();
      expect(typeof result.recommendation).toBe('string');
    });

    it('should give higher scores with strong hooks', async () => {
      const weakHook = 'In this video we will explore things';
      const strongHook = 'You won\'t believe what they found... hidden for 50 years. NEVER shared before.';

      const weakResult = await engine.predict(topic, weakHook, title, scenes);
      const strongResult = await engine.predict(topic, strongHook, title, scenes);

      expect(strongResult.viralScore).toBeGreaterThanOrEqual(weakResult.viralScore);
    });

    it('should give higher scores with strong titles', async () => {
      const weakTitle = 'Video about a hospital';
      const strongTitle = 'They Hid This Abandoned Hospital\'s Dark Secret for 50 Years — Until Today';

      const weakResult = await engine.predict(topic, hook, weakTitle, scenes);
      const strongResult = await engine.predict(topic, hook, strongTitle, scenes);

      expect(strongResult.viralScore).toBeGreaterThanOrEqual(weakResult.viralScore);
    });

    it('should include confidence in prediction', async () => {
      const result = await engine.predict(topic, hook, title, scenes);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(100);
    });
  });

  describe('edge cases', () => {
    it('should handle empty hook', async () => {
      const result = await engine.predict('topic', '', 'title', [{ text: 'scene', duration: 10 }]);
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle very long hook', async () => {
      const result = await engine.predict('topic', 'a'.repeat(200), 'title', [{ text: 'scene', duration: 10 }]);
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle single scene', async () => {
      const result = await engine.predict('topic', 'hook', 'title', [{ text: 'only scene', duration: 600 }]);
      expect(result.viralScore).toBeGreaterThanOrEqual(0);
    });
  });
});
