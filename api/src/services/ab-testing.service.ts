import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';

export type ABTestType = 'title' | 'thumbnail' | 'hook' | 'upload-timing';

export interface ABTestResult {
  id: string;
  testType: ABTestType;
  variantA: string;
  variantB: string;
  winner: string | null;
  ctrA: number;
  ctrB: number;
  retentionA: number;
  retentionB: number;
  confidence: number;
  statisticallySignificant: boolean;
}

export class ABTestingService {
  async createTest(projectId: string, testType: ABTestType, variantA: string, variantB: string) {
    return prisma.aBTestResult.create({
      data: { projectId, testType, variantA, variantB, status: 'running' },
    });
  }

  async recordResult(testId: string, variant: 'A' | 'B', impressions: number, clicks: number, retention: number): Promise<void> {
    const test = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (!test) return;

    const updateData: any = {};
    if (variant === 'A') {
      updateData.impressionsA = test.impressionsA + impressions;
      updateData.clicksA = test.clicksA + clicks;
      updateData.ctrA = (test.clicksA + clicks) / (test.impressionsA + impressions) * 100;
      updateData.retentionA = (test.retentionA * test.impressionsA + retention) / (test.impressionsA + impressions);
    } else {
      updateData.impressionsB = test.impressionsB + impressions;
      updateData.clicksB = test.clicksB + clicks;
      updateData.ctrB = (test.clicksB + clicks) / (test.impressionsB + impressions) * 100;
      updateData.retentionB = (test.retentionB * test.impressionsB + retention) / (test.impressionsB + impressions);
    }

    const updated = await prisma.aBTestResult.update({
      where: { id: testId },
      data: updateData,
    });

    const totalImpressions = updated.impressionsA + updated.impressionsB;
    if (totalImpressions >= 1000) {
      await this.calculateWinner(testId);
    }
  }

  async calculateWinner(testId: string): Promise<ABTestResult | null> {
    const test = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (!test || test.impressionsA + test.impressionsB < 100) return null;

    const ctrA = test.impressionsA > 0 ? (test.clicksA / test.impressionsA) * 100 : 0;
    const ctrB = test.impressionsB > 0 ? (test.clicksB / test.impressionsB) * 100 : 0;

    const ctrDiff = Math.abs(ctrA - ctrB);
    const totalImpressions = test.impressionsA + test.impressionsB;
    const seA = ctrA > 0 ? Math.sqrt(ctrA * (100 - ctrA) / test.impressionsA) : 0;
    const seB = ctrB > 0 ? Math.sqrt(ctrB * (100 - ctrB) / test.impressionsB) : 0;
    const zScore = Math.sqrt(seA * seA + seB * seB) > 0 ? ctrDiff / Math.sqrt(seA * seA + seB * seB) : 0;
    const confidence = Math.min(99, Math.round((1 - 0.5 * Math.exp(-0.5 * zScore * zScore)) * 100));

    let winner: string | null = null;
    if (confidence > 90 && ctrDiff > 0.5) {
      winner = ctrA > ctrB ? 'A' : 'B';
    }

    const statisticallySignificant = confidence > 90;

    await prisma.aBTestResult.update({
      where: { id: testId },
      data: { winner, confidence, statisticallySignificant, status: statisticallySignificant ? 'completed' : 'running' },
    });

    if (winner && statisticallySignificant) {
      logger.info(`A/B test ${testId} complete: Variant ${winner} wins (CTR: ${ctrA.toFixed(1)}% vs ${ctrB.toFixed(1)}%)`);
    }

    return {
      id: test.id, testType: test.testType as ABTestType,
      variantA: test.variantA, variantB: test.variantB,
      winner, ctrA, ctrB,
      retentionA: test.retentionA, retentionB: test.retentionB,
      confidence, statisticallySignificant,
    };
  }

  async getTestsByProject(projectId: string): Promise<ABTestResult[]> {
    const tests = await prisma.aBTestResult.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    return tests.map(t => ({
      id: t.id, testType: t.testType as ABTestType,
      variantA: t.variantA, variantB: t.variantB,
      winner: t.winner,
      ctrA: t.ctrA, ctrB: t.ctrB,
      retentionA: t.retentionA, retentionB: t.retentionB,
      confidence: t.confidence,
      statisticallySignificant: t.statisticallySignificant,
    }));
  }

  async getBestPerformingVariant(testType: ABTestType, channelId?: string): Promise<string | null> {
    const where: any = { testType, status: 'completed', statisticallySignificant: true };
    const tests = await prisma.aBTestResult.findMany({
      where,
      orderBy: { confidence: 'desc' },
      take: 10,
    });

    if (tests.length === 0) return null;

    const winnerCounts: Record<string, number> = {};
    for (const t of tests) {
      if (t.winner === 'A') {
        winnerCounts[t.variantA] = (winnerCounts[t.variantA] || 0) + 1;
      } else if (t.winner === 'B') {
        winnerCounts[t.variantB] = (winnerCounts[t.variantB] || 0) + 1;
      }
    }

    const best = Object.entries(winnerCounts).sort((a, b) => b[1] - a[1]);
    return best.length > 0 ? best[0][0] : null;
  }
}
