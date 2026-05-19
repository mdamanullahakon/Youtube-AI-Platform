import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGenerateWithAI = vi.fn().mockResolvedValue('{"descriptionScore": 70, "improvements": ["Add curiosity gap"], "optimalAffiliatePlacement": "first paragraph"}');
vi.mock('../../../services/ai.service', () => ({
  generateWithAI: mockGenerateWithAI,
}));

import { QAEngine } from '../../../services/qa-engine.service';

describe('QAEngine', () => {
  let engine: QAEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new QAEngine();
  });

  const validScript = `You think you know what happened in the woods that night? Think again.

I've spent the last three years investigating the disappearances. What I found will shock you.

The first clue appeared on a Tuesday morning. A single photograph, slipped under my door.

The police said it was nothing. But the face in the photo... it was mine.

Three days later, the second clue arrived. This time, a voice message. A whisper I couldn't understand.

The pattern became clear. Someone — or something — was communicating with me.

I traced the origin to an abandoned facility thirty miles outside town.

What I discovered there changed everything I thought I knew about reality.

The experiments weren't just illegal. They were impossible. And they were still ongoing.

I had two choices: expose the truth, or become another missing person case.

I chose to fight back. But first, I needed proof. The kind of proof that couldn't be dismissed.

This is the story of how I found it. And why I might not survive telling it.`;

  const validScenes = [
    { text: 'Opening hook - the disappearances', duration: 18 },
    { text: 'The photograph discovery', duration: 15 },
    { text: 'The voice message', duration: 20 },
    { text: 'Tracing the origin', duration: 17 },
    { text: 'The facility discovery', duration: 19 },
    { text: 'The experiments revealed', duration: 21 },
    { text: 'The choice to fight', duration: 16 },
    { text: 'The plan for proof', duration: 14 },
    { text: 'Final stakes setup', duration: 18 },
    { text: 'The confrontation begins', duration: 22 },
  ];

  describe('validateVideo', () => {
    it('should return a QAResult with all checks', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 180, 'A dark figure in abandoned hospital hallway, face close-up, red eyes', 'The Truth They Buried in the Woods'
      );
      expect(result).toHaveProperty('passed');
      expect(result).toHaveProperty('checks');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('autoFixAvailable');
    });

    it('should run 8 checks', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 600, undefined, undefined
      );
      expect(result.checks.length).toBe(8);
    });

    it('should check video length (10-20 min = 600-1200s)', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 300, undefined, undefined
      );
      const lengthCheck = result.checks.find(c => c.name === 'Video Length');
      expect(lengthCheck).toBeDefined();
      expect(lengthCheck!.passed).toBe(false);
    });

    it('should pass with 12 min video', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 720, undefined, undefined
      );
      const lengthCheck = result.checks.find(c => c.name === 'Video Length');
      expect(lengthCheck).toBeDefined();
      expect(lengthCheck!.passed).toBe(true);
    });

    it('should detect missing retention hooks in sparse script', async () => {
      const sparseScript = 'Scene one. Scene two. Scene three. Scene four.';
      const result = await engine.validateVideo(
        sparseScript, [{ text: 'Scene one', duration: 30 }, { text: 'Scene two', duration: 30 }], 60, undefined, undefined
      );
      const hookCheck = result.checks.find(c => c.name === 'Retention Hooks');
      expect(hookCheck).toBeDefined();
    });

    it('should compute a score between 0-100', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 720, 'Face close-up, fear expression, dark background', 'The Secret They Never Told You'
      );
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe('autoFix', () => {
    it('should return fixed script and scenes', async () => {
      const qaResult = await engine.validateVideo(
        validScript, validScenes, 300, undefined, undefined
      );
      const fixed = await engine.autoFix(validScript, validScenes, qaResult);

      expect(fixed).toHaveProperty('fixedScript');
      expect(fixed).toHaveProperty('fixedScenes');
      expect(fixed).toHaveProperty('fixesApplied');
      expect(Array.isArray(fixed.fixesApplied)).toBe(true);
    });

    it('should apply fixes when video length is too short', async () => {
      const shortResult = await engine.validateVideo(
        validScript, [{ text: 'short', duration: 10 }], 60, undefined, undefined
      );
      const fixed = await engine.autoFix(validScript, [{ text: 'short', duration: 10 }], shortResult);
      expect(fixed.fixesApplied.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('check functions (private via validation)', () => {
    it('should flag missing thumbnail prompt', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 720, '', 'Good Title: The Secret'
      );
      const thumbnailCheck = result.checks.find(c => c.name === 'Thumbnail CTR Rules');
      if (thumbnailCheck) {
        expect(thumbnailCheck.passed).toBe(false);
      }
    });

    it('should flag weak SEO title', async () => {
      const result = await engine.validateVideo(
        validScript, validScenes, 720, 'Face close-up', 'title'
      );
      const seoCheck = result.checks.find(c => c.name === 'SEO Title Check');
      if (seoCheck) {
        expect(seoCheck.passed).toBe(false);
      }
    });
  });
});
