// src/services/ctr-optimization.service.ts
import { prisma } from '../config/db';
import { logger } from '../utils/logger';

/**
 * CTR Optimization Engine
 *
 * - Creates AB test entries for title or thumbnail.
 * - Periodically aggregates impressions/clicks and computes CTR.
 * - Determines a winner when statistical confidence is reached.
 * - Controlled via ENABLE_CTR_OPTIMIZATION env flag.
 */
export class CTROptimizationService {
  private static readonly CONFIDENCE_THRESHOLD = 0.8; // 80% confidence needed

  /** Create an AB test for a project */
  async createTest(
    projectId: string,
    testType: 'title' | 'thumbnail',
    variantA: string,
    variantB: string,
  ) {
    const existing = await prisma.aBTestResult.findFirst({ where: { projectId, testType } });
    if (existing) {
      logger.warn('AB test already exists for project', { projectId, testType });
      return existing;
    }
    const result = await prisma.aBTestResult.create({
      data: {
        projectId,
        testType,
        variantA,
        variantB,
        status: 'running',
      },
    });
    logger.info('Created AB test', { id: result.id, projectId, testType });
    return result;
  }

  /** Evaluate all running tests – called by scheduler */
  async evaluateTests() {
    const tests = await prisma.aBTestResult.findMany({ where: { status: 'running' } });
    for (const test of tests) {
      const ctrA = test.impressionsA > 0 ? test.clicksA / test.impressionsA : 0;
      const ctrB = test.impressionsB > 0 ? test.clicksB / test.impressionsB : 0;

      const total = test.impressionsA + test.impressionsB;
      const confidence = total > 200 ? 0.9 : total / 200; // crude estimate

      let winner: string | null = null;
      if (confidence >= CTROptimizationService.CONFIDENCE_THRESHOLD) {
        winner = ctrA > ctrB ? test.variantA : test.variantB;
      }

      await prisma.aBTestResult.update({
        where: { id: test.id },
        data: {
          winner,
          ctrA,
          ctrB,
          confidence,
          status: winner ? 'completed' : test.status,
        },
      });

      logger.info('AB test evaluated', {
        testId: test.id,
        ctrA,
        ctrB,
        confidence,
        winner,
      });
    }
  }
}

// Export a singleton for easy consumption elsewhere
export const ctrOptimizationService = new CTROptimizationService();
