import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

interface TestVariant {
  id: string;
  title: string;
  thumbnailPrompt: string;
  hook: string;
  predictedCTR: number;
  predictedRetention: number;
}

interface ABTestDefinition {
  testType: 'title' | 'thumbnail' | 'hook' | 'full-package';
  variantA: TestVariant;
  variantB: TestVariant;
  hypothesis: string;
  predictedWinner: 'A' | 'B';
  minSampleSize: number;
}

interface TestResult {
  projectId: string;
  testType: string;
  winner: 'A' | 'B' | null;
  ctrA: number;
  ctrB: number;
  retentionA: number;
  retentionB: number;
  confidence: number;
  significant: boolean;
  winningPattern: string;
}

export class TestingEngine {
  async generateVariants(topic: string, hook: string, niche: string = 'horror'): Promise<ABTestDefinition[]> {
    logger.info(`[TestingEngine] Generating A/B variants for: "${topic}"`);

    const pastWinners = await prisma.aBTestResult.findMany({
      where: { status: 'completed', statisticallySignificant: true },
      orderBy: { completedAt: 'desc' },
      take: 15,
    });

    const winningPatterns = pastWinners
      .filter(t => t.winner !== null)
      .map(t => t.winner === 'A' ? t.variantA : t.variantB)
      .slice(0, 8);

    const response = await generateWithAI(`
      You are a YouTube A/B testing strategist. Create 3 test variations for a "${niche}" video.

      Topic: "${topic}"
      Hook: "${hook}"

      Past winning patterns:
      ${winningPatterns.map((p, i) => `${i + 1}. "${p}"`).join('\n')}

      Generate 3 distinct A/B test definitions covering:
      1. TITLE test — two CTR-optimized title variants
      2. THUMBNAIL test — two thumbnail prompt variants with different emotional triggers
      3. HOOK test — two opening hook variants (first 15 seconds)

      For each variant, provide:
      - title: video title (max 80 chars, curiosity gap)
      - thumbnailPrompt: detailed DALL-E/SDXL prompt for thumbnail generation
      - hook: opening statement (max 100 chars)
      - predictedCTR: 0-100 score
      - predictedRetention: 0-100 score

      Return as JSON array:
      [{
        "testType": "title"|"thumbnail"|"hook",
        "hypothesis": "why this test matters",
        "predictedWinner": "A"|"B",
        "variantA": { "title": "", "thumbnailPrompt": "", "hook": "", "predictedCTR": 0, "predictedRetention": 0 },
        "variantB": { ... }
      }]
    `, 'ollama', { temperature: 0.7 });

    try {
      const parsed = extractJsonArray<any>(response);
      if (parsed && parsed.length > 0) {
        return parsed.map(p => ({
          ...p,
          minSampleSize: 1000,
        }));
      }
    } catch {}

    return this.generateDefaultVariants(topic, niche);
  }

  async recordTestResult(
    projectId: string,
    testType: string,
    variantA: string,
    variantB: string,
    result: { ctrA: number; ctrB: number; retentionA: number; retentionB: number }
  ): Promise<TestResult> {
    const winner = result.ctrA > result.ctrB ? 'A' : result.ctrB > result.ctrA ? 'B' : null;
    const ctrDiff = Math.abs(result.ctrA - result.ctrB);
    const confidence = Math.min(99, ctrDiff * 10 + 50);

    await prisma.aBTestResult.upsert({
      where: { id: `${projectId}_${testType}` },
      update: {
        ctrA: result.ctrA,
        ctrB: result.ctrB,
        retentionA: result.retentionA,
        retentionB: result.retentionB,
        winner,
        confidence,
        statisticallySignificant: confidence >= 95,
        status: confidence >= 95 ? 'completed' : 'running',
        completedAt: confidence >= 95 ? new Date() : undefined,
      },
      create: {
        id: `${projectId}_${testType}`,
        projectId,
        testType,
        variantA,
        variantB,
        ctrA: result.ctrA,
        ctrB: result.ctrB,
        retentionA: result.retentionA,
        retentionB: result.retentionB,
        winner,
        confidence,
        statisticallySignificant: confidence >= 95,
        status: confidence >= 95 ? 'completed' : 'running',
      },
    });

    return {
      projectId,
      testType,
      winner,
      ctrA: result.ctrA,
      ctrB: result.ctrB,
      retentionA: result.retentionA,
      retentionB: result.retentionB,
      confidence,
      significant: confidence >= 95,
      winningPattern: winner === 'A' ? variantA : winner === 'B' ? variantB : 'none',
    };
  }

  async getWinnerForProject(projectId: string): Promise<{
    bestTitle: string;
    bestThumbnailPrompt: string;
    bestHook: string;
  }> {
    const tests = await prisma.aBTestResult.findMany({
      where: { projectId, winner: { not: null } },
    });

    let bestTitle = '';
    let bestThumbnailPrompt = '';
    let bestHook = '';

    for (const test of tests) {
      const winnerValue = test.winner === 'A' ? test.variantA : test.variantB;
      if (test.testType === 'title') bestTitle = winnerValue;
      if (test.testType === 'thumbnail') bestThumbnailPrompt = winnerValue;
      if (test.testType === 'hook') bestHook = winnerValue;
    }

    return { bestTitle, bestThumbnailPrompt, bestHook };
  }

  async getGlobalLearnings(niche?: string): Promise<{
    bestTitlePatterns: string[];
    bestThumbnailPatterns: string[];
    bestHookPatterns: string[];
    avgLiftFromTesting: number;
  }> {
    const completed = await prisma.aBTestResult.findMany({
      where: {
        status: 'completed',
        statisticallySignificant: true,
        winner: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      take: 50,
    });

    const winners = completed.map(t => t.winner === 'A' ? t.variantA : t.variantB);
    const titleWinners = completed.filter(t => t.testType === 'title').map(t => t.winner === 'A' ? t.variantA : t.variantB);
    const thumbnailWinners = completed.filter(t => t.testType === 'thumbnail').map(t => t.winner === 'A' ? t.variantA : t.variantB);
    const hookWinners = completed.filter(t => t.testType === 'hook').map(t => t.winner === 'A' ? t.variantA : t.variantB);

    const avgLift = completed.length > 0
      ? completed.reduce((s, t) => {
          const ctrA = t.ctrA || 0;
          const ctrB = t.ctrB || 0;
          return s + Math.abs(ctrA - ctrB);
        }, 0) / completed.length
      : 0;

    return {
      bestTitlePatterns: titleWinners.slice(0, 5),
      bestThumbnailPatterns: thumbnailWinners.slice(0, 5),
      bestHookPatterns: hookWinners.slice(0, 5),
      avgLiftFromTesting: Math.round(avgLift * 100) / 100,
    };
  }

  private generateDefaultVariants(topic: string, niche: string): ABTestDefinition[] {
    return [
      {
        testType: 'title',
        variantA: { id: 'a', title: `The ${niche} Truth About ${topic} Nobody Talks About`, thumbnailPrompt: `Dark cinematic ${niche} scene`, hook: `What if everything you knew was wrong?`, predictedCTR: 75, predictedRetention: 60 },
        variantB: { id: 'b', title: `I Investigated ${topic} For 30 Days`, thumbnailPrompt: `Face close-up shocked expression ${niche}`, hook: `They said it was nothing. Here is what I found.`, predictedCTR: 80, predictedRetention: 65 },
        hypothesis: 'Curiosity gap vs personal narrative hook drives higher CTR',
        predictedWinner: 'B',
        minSampleSize: 1000,
      },
      {
        testType: 'thumbnail',
        variantA: { id: 'a', title: topic, thumbnailPrompt: `Close-up terrified face, single tear, red/black lighting, horror atmosphere, 4K`, hook: '', predictedCTR: 78, predictedRetention: 55 },
        variantB: { id: 'b', title: topic, thumbnailPrompt: `Shadow entity in doorway, glowing eyes, fog, green tint, found footage style`, hook: '', predictedCTR: 72, predictedRetention: 58 },
        hypothesis: 'Human face emotion vs entity mystery for thumbnail CTR',
        predictedWinner: 'A',
        minSampleSize: 1000,
      },
      {
        testType: 'hook',
        variantA: { id: 'a', title: topic, thumbnailPrompt: '', hook: `The last thing ${topic} ever saw... was nothing at all.`, predictedCTR: 70, predictedRetention: 75 },
        variantB: { id: 'b', title: topic, thumbnailPrompt: '', hook: `There is a place where ${topic} hides. And I found it.`, predictedCTR: 68, predictedRetention: 72 },
        hypothesis: 'Open loop mystery vs location-based hook for retention',
        predictedWinner: 'A',
        minSampleSize: 1000,
      },
    ];
  }
}
