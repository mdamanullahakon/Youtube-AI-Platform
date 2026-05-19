import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJsonArray, extractJson } from '../utils/parse-ai-response';

export interface ExperimentDefinition {
  testType: 'title' | 'thumbnail' | 'hook' | 'upload-timing' | 'cta-style';
  variantA: string;
  variantB: string;
  hypothesis: string;
  predictedWinner: string;
  minSampleSize: number;
}

export interface ExperimentResult {
  id: string;
  testType: string;
  variantA: string;
  variantB: string;
  winner: string | null;
  ctrA: number;
  ctrB: number;
  retentionA: number;
  retentionB: number;
  confidence: number;
  statisticallySignificant: boolean;
  aLearnedPattern: string;
  bLearnedPattern: string;
}

export class SmartExperimentation {
  async designExperiment(projectId: string, topic: string, niche?: string): Promise<ExperimentDefinition[]> {
    logger.info(`[SmartExperimentation] Designing experiments for: ${topic}`);

    const pastWinners = await prisma.aBTestResult.findMany({
      where: { status: 'completed', statisticallySignificant: true },
      orderBy: { completedAt: 'desc' },
      take: 20,
    });

    const winningTemplates = pastWinners
      .filter(t => t.winner !== null)
      .map(t => t.winner === 'A' ? t.variantA : t.variantB);

    const response = await generateWithAI(`
      Design 3 A/B test experiments for a YouTube video about "${topic}" in niche "${niche || 'general'}".

      Past winning patterns:
      ${winningTemplates.slice(0, 10).map((t, i) => `${i + 1}. "${t}"`).join('\n')}

      Create experiments for:
      1. TITLE: Two competing title formats
      2. THUMBNAIL: Two competing thumbnail styles
      3. HOOK: Two competing opening hook styles

      For each experiment provide:
      - testType: "title" | "thumbnail" | "hook"
      - variantA: exact variant content
      - variantB: exact variant content
      - hypothesis: what you expect to learn
      - predictedWinner: "A" or "B"
      - minSampleSize: minimum impressions for significance

      Rules:
      - Variants must be distinctly different approaches
      - No minor wording changes - test different STRATEGIES
      - Hypothesis must be testable and specific

      Return JSON array of 3 experiments:
      [{
        "testType": "title",
        "variantA": "curiosity-gap title example",
        "variantB": "direct-value title example",
        "hypothesis": "Curiosity gap will drive 20% higher CTR",
        "predictedWinner": "A",
        "minSampleSize": 1000
      }]

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJsonArray(response) as any[];
      if (!parsed) return [];

      return parsed.slice(0, 3).map((e: any) => ({
        testType: e.testType || 'title',
        variantA: e.variantA || '',
        variantB: e.variantB || '',
        hypothesis: e.hypothesis || '',
        predictedWinner: e.predictedWinner || 'A',
        minSampleSize: e.minSampleSize || 1000,
      }));
    } catch {
      return [];
    }
  }

  async recordExperimentData(testId: string, variant: 'A' | 'B', impressions: number, clicks: number, retention: number): Promise<void> {
    const test = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (!test) return;

    const updateData: any = {};
    if (variant === 'A') {
      updateData.impressionsA = test.impressionsA + impressions;
      updateData.clicksA = test.clicksA + clicks;
      updateData.ctrA = test.impressionsA + impressions > 0
        ? ((test.clicksA + clicks) / (test.impressionsA + impressions)) * 100
        : 0;
      updateData.retentionA = test.impressionsA + impressions > 0
        ? ((test.retentionA * test.impressionsA) + (retention * impressions)) / (test.impressionsA + impressions)
        : 0;
    } else {
      updateData.impressionsB = test.impressionsB + impressions;
      updateData.clicksB = test.clicksB + clicks;
      updateData.ctrB = test.impressionsB + impressions > 0
        ? ((test.clicksB + clicks) / (test.impressionsB + impressions)) * 100
        : 0;
      updateData.retentionB = test.impressionsB + impressions > 0
        ? ((test.retentionB * test.impressionsB) + (retention * impressions)) / (test.impressionsB + impressions)
        : 0;
    }

    await prisma.aBTestResult.update({ where: { id: testId }, data: updateData });

    const updated = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (updated && (updated.impressionsA + updated.impressionsB) >= 1000) {
      await this.calculateWinner(testId);
    }
  }

  async calculateWinner(testId: string): Promise<ExperimentResult | null> {
    const test = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (!test || (test.impressionsA + test.impressionsB) < 100) return null;

    const ctrA = test.impressionsA > 0 ? (test.clicksA / test.impressionsA) * 100 : 0;
    const ctrB = test.impressionsB > 0 ? (test.clicksB / test.impressionsB) * 100 : 0;

    const ctrDiff = Math.abs(ctrA - ctrB);
    const totalImpressions = test.impressionsA + test.impressionsB;
    const seA = ctrA > 0 ? Math.sqrt(ctrA * (100 - ctrA) / test.impressionsA) : 0;
    const seB = ctrB > 0 ? Math.sqrt(ctrB * (100 - ctrB) / test.impressionsB) : 0;
    const pooledSE = Math.sqrt(seA * seA + seB * seB);
    const zScore = pooledSE > 0 ? ctrDiff / pooledSE : 0;
    const confidence = Math.min(99, Math.round((1 - 0.5 * Math.exp(-0.5 * zScore * zScore)) * 100));

    let winner: string | null = null;
    if (confidence > 90 && ctrDiff > 0.5) {
      winner = ctrA > ctrB ? 'A' : 'B';
    }

    const statisticallySignificant = confidence > 90;

    const learningResponse = winner ? await generateWithAI(`
      An A/B test completed on YouTube:
      Test Type: ${test.testType}
      Variant A: "${test.variantA}" (CTR: ${ctrA.toFixed(1)}%)
      Variant B: "${test.variantB}" (CTR: ${ctrB.toFixed(1)}%)
      Winner: ${winner} (${winner === 'A' ? ctrA.toFixed(1) : ctrB.toFixed(1)}% CTR)

      Extract 2 actionable learning patterns (one from each variant):
      - What made the winner effective?
      - What did the loser teach us?

      Return JSON: { "winnerPattern": "what made it work", "loserPattern": "what to avoid" }
      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.3 }) : null;

    let learnedPatternA = '';
    let learnedPatternB = '';
    if (learningResponse) {
      try {
        const parsed = extractJson(learningResponse) as any;
        learnedPatternA = parsed?.winnerPattern || '';
        learnedPatternB = parsed?.loserPattern || '';
      } catch {}
    }

    await prisma.aBTestResult.update({
      where: { id: testId },
      data: {
        winner, confidence, statisticallySignificant,
        status: statisticallySignificant ? 'completed' : 'running',
        completedAt: statisticallySignificant ? new Date() : undefined,
        metadata: { learnedPatternA, learnedPatternB },
      },
    });

    if (statisticallySignificant && winner) {
      await prisma.contentInsight.create({
        data: {
          category: test.testType === 'title' ? 'general' : test.testType,
          content: `A/B Test (${test.testType}): "${winner === 'A' ? test.variantA : test.variantB}" outperformed alternative by ${ctrDiff.toFixed(1)}% CTR. Pattern: ${learnedPatternA}`,
          source: 'ab-test-result',
          confidence: Math.min(0.95, confidence / 100),
          applicationCount: 1,
        },
      });
    }

    return {
      id: test.id,
      testType: test.testType,
      variantA: test.variantA,
      variantB: test.variantB,
      winner, ctrA, ctrB,
      retentionA: test.retentionA,
      retentionB: test.retentionB,
      confidence, statisticallySignificant,
      aLearnedPattern: learnedPatternA,
      bLearnedPattern: learnedPatternB,
    };
  }

  async getLearnedPatterns(testType?: string, limit = 10): Promise<{ pattern: string; source: string; confidence: number }[]> {
    const where: any = { source: 'ab-test-result', confidence: { gte: 0.7 } };
    if (testType) where.category = testType;

    const insights = await prisma.contentInsight.findMany({
      where,
      orderBy: { confidence: 'desc' },
      take: limit,
    });

    return insights.map(i => ({
      pattern: i.content,
      source: i.source,
      confidence: i.confidence,
    }));
  }

  async getExperimentsByProject(projectId: string) {
    const tests = await prisma.aBTestResult.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return tests.map(t => ({
      id: t.id,
      testType: t.testType,
      variantA: t.variantA,
      variantB: t.variantB,
      winner: t.winner,
      ctrA: t.ctrA,
      ctrB: t.ctrB,
      retentionA: t.retentionA,
      retentionB: t.retentionB,
      confidence: t.confidence,
      statisticallySignificant: t.statisticallySignificant,
      status: t.status,
    }));
  }
}
