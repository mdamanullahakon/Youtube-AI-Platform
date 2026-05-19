import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson, extractJsonArray } from '../../utils/parse-ai-response';

export type ExperimentType = 'title' | 'thumbnail' | 'hook' | 'cta' | 'upload-time' | 'video-length' | 'offer';

export interface ExperimentDefinition {
  id: string;
  type: ExperimentType;
  variableA: string;
  variableB: string;
  hypothesis: string;
  predictedWinner: string;
  expectedImprovement: number;
  channelId: string;
  niche: string;
  createdAt: Date;
}

export interface ExperimentResult {
  id: string;
  type: ExperimentType;
  variableA: string;
  variableB: string;
  winner: string | null;
  metricA: number;
  metricB: number;
  sampleSize: number;
  confidence: number;
  statisticallySignificant: boolean;
  learnedPattern: string;
  appliedToChannels: number;
}

export interface WinningPattern {
  type: ExperimentType;
  pattern: string;
  winRate: number;
  totalTests: number;
  averageImprovement: number;
  niches: string[];
  confidence: number;
}

export class IntelligentExperimentEngine {
  async designExperiments(channelId: string, niche: string): Promise<ExperimentDefinition[]> {
    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });

    const pastExperiments = await prisma.aBTestResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const prompt = `Design 3 A/B experiments for a YouTube channel in the "${niche}" niche.

Current strategy:
- Hook Style: ${strategy?.hookStyle || 'curiosity-gap'}
- Thumbnail Style: ${strategy?.thumbnailStyle || 'face-closeup-shock'}
- Tone: ${strategy?.tone || 'emotional-curiosity'}
- CTA Style: ${strategy?.ctaStyle || 'direct'}

Past experiments (avoid repeating failed ones):
${pastExperiments.map(e => `- ${e.testType}: A="${e.variantA}" vs B="${e.variantB}" → Winner: ${e.winner || 'inconclusive'}`).join('\n')}

Design 3 experiments testing different variables to maximize CTR and retention.

Return JSON array:
[
  {
    "type": "title" or "thumbnail" or "hook" or "cta",
    "variableA": "control version",
    "variableB": "test version",
    "hypothesis": "why B will outperform A",
    "predictedWinner": "A or B",
    "expectedImprovement": 15
  }
]`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.7 });
    const experiments = extractJsonArray<{
      type: ExperimentType; variableA: string; variableB: string;
      hypothesis: string; predictedWinner: string; expectedImprovement: number;
    }>(response);

    if (!experiments || experiments.length === 0) {
      return this.getDefaultExperiments(channelId, niche);
    }

    const definitions: ExperimentDefinition[] = experiments.slice(0, 3).map((exp, i) => ({
      id: `exp_${channelId}_${Date.now()}_${i}`,
      type: exp.type,
      variableA: exp.variableA,
      variableB: exp.variableB,
      hypothesis: exp.hypothesis,
      predictedWinner: exp.predictedWinner,
      expectedImprovement: exp.expectedImprovement,
      channelId,
      niche,
      createdAt: new Date(),
    }));

    return definitions;
  }

  async runExperiment(experiment: ExperimentDefinition, projectId: string): Promise<void> {
    const variantUsed = Math.random() > 0.5 ? 'A' : 'B';

    await prisma.aBTestResult.create({
      data: {
        projectId,
        testType: experiment.type,
        variantA: experiment.variableA,
        variantB: experiment.variableB,
        status: 'running',
      },
    });

    logger.info(`[ExperimentEngine] Running ${experiment.type} test on ${projectId} — variant ${variantUsed}`);
  }

  async determineWinner(testId: string): Promise<ExperimentResult | null> {
    const test = await prisma.aBTestResult.findUnique({ where: { id: testId } });
    if (!test) return null;

    const impressionsA = test.impressionsA || 0;
    const impressionsB = test.impressionsB || 0;
    const totalImpressions = impressionsA + impressionsB;

    if (totalImpressions < 1000) {
      return null;
    }

    const ctrA = test.clicksA > 0 ? (test.clicksA / test.impressionsA) * 100 : 0;
    const ctrB = test.clicksB > 0 ? (test.clicksB / test.impressionsB) * 100 : 0;
    const zScore = this.calculateZScore(ctrA, ctrB, impressionsA, impressionsB);
    const confidence = this.zScoreToConfidence(zScore);
    const statisticallySignificant = confidence >= 0.95;
    const winner = statisticallySignificant ? (ctrA > ctrB ? 'A' : (ctrB > ctrA ? 'B' : null)) : null;

    let learnedPattern = '';
    if (winner) {
      const winningVariant = winner === 'A' ? test.variantA : test.variantB;
      learnedPattern = `${test.testType}: "${winningVariant}" wins over "${winner === 'A' ? test.variantB : test.variantA}" (${(ctrA > ctrB ? ctrA : ctrB).toFixed(2)}% CTR vs ${(ctrA > ctrB ? ctrB : ctrA).toFixed(2)}% CTR)`;

      await prisma.contentInsight.create({
        data: {
          category: `${test.testType}-pattern`,
          content: learnedPattern,
          source: 'ab-test-result',
          confidence,
        },
      });
    }

    await prisma.aBTestResult.update({
      where: { id: testId },
      data: {
        winner,
        confidence,
        ctrA, ctrB,
        statisticallySignificant,
        status: statisticallySignificant ? 'completed' : 'running',
        completedAt: statisticallySignificant ? new Date() : null,
      },
    });

    return {
      id: testId,
      type: test.testType as ExperimentType,
      variableA: test.variantA,
      variableB: test.variantB,
      winner,
      metricA: ctrA,
      metricB: ctrB,
      sampleSize: totalImpressions,
      confidence,
      statisticallySignificant,
      learnedPattern,
      appliedToChannels: 0,
    };
  }

  async getWinningPatterns(limit = 10): Promise<WinningPattern[]> {
    const completedTests = await prisma.aBTestResult.findMany({
      where: { status: 'completed', statisticallySignificant: true },
      orderBy: { confidence: 'desc' },
    });

    const patternMap = new Map<string, { wins: number; total: number; improvements: number[]; niches: Set<string> }>();

    for (const test of completedTests) {
      const key = `${test.testType}:${test.winner === 'A' ? test.variantA : test.variantB}`;
      const existing = patternMap.get(key) || { wins: 0, total: 0, improvements: [], niches: new Set() };
      existing.total++;

      const ctrA = test.ctrA || 0;
      const ctrB = test.ctrB || 0;
      const improvement = Math.abs(ctrA - ctrB);

      if (test.winner) {
        existing.wins++;
        existing.improvements.push(improvement);
      }

      patternMap.set(key, existing);
    }

    const patterns: WinningPattern[] = [];
    for (const [pattern, data] of patternMap.entries()) {
      const [type, ...patternParts] = pattern.split(':');
      patterns.push({
        type: type as ExperimentType,
        pattern: patternParts.join(':'),
        winRate: data.total > 0 ? (data.wins / data.total) * 100 : 0,
        totalTests: data.total,
        averageImprovement: data.improvements.length > 0
          ? data.improvements.reduce((s, i) => s + i, 0) / data.improvements.length
          : 0,
        niches: Array.from(data.niches),
        confidence: data.wins / Math.max(1, data.total),
      });
    }

    return patterns.sort((a, b) => b.winRate - a.winRate).slice(0, limit);
  }

  async applyWinningPatterns(channelId: string): Promise<string[]> {
    const patterns = await this.getWinningPatterns(5);
    const applied: string[] = [];
    const strategy = await prisma.contentStrategy.findFirst({
      where: { channelId },
      orderBy: { createdAt: 'desc' },
    });

    if (!strategy) return applied;

    for (const pattern of patterns) {
      if (pattern.confidence < 0.8) continue;

      switch (pattern.type) {
        case 'title':
          applied.push(`Title pattern: ${pattern.pattern}`);
          break;
        case 'thumbnail':
          await prisma.contentStrategy.update({
            where: { id: strategy.id },
            data: { thumbnailStyle: pattern.pattern },
          });
          applied.push(`Thumbnail pattern: ${pattern.pattern}`);
          break;
        case 'hook':
          await prisma.contentStrategy.update({
            where: { id: strategy.id },
            data: { hookStyle: pattern.pattern },
          });
          applied.push(`Hook pattern: ${pattern.pattern}`);
          break;
        case 'cta':
          await prisma.contentStrategy.update({
            where: { id: strategy.id },
            data: { ctaStyle: pattern.pattern },
          });
          applied.push(`CTA pattern: ${pattern.pattern}`);
          break;
      }

      logger.info(`[ExperimentEngine] Applied winning pattern to ${channelId}: ${pattern.type} → ${pattern.pattern}`);
    }

    return applied;
  }

  async simulateExperiments(channelId: string, niche: string): Promise<{
    experiments: ExperimentDefinition[];
    predictedWinnerPatterns: string[];
    expectedCTRImprovement: number;
  }> {
    const experiments = await this.designExperiments(channelId, niche);
    const predictedWinners = experiments.filter(e => e.predictedWinner === 'B').map(e => `${e.type}: ${e.variableB}`);

    const totalImprovement = experiments
      .filter(e => e.predictedWinner === 'B')
      .reduce((s, e) => s + e.expectedImprovement, 0);

    const avgImprovement = experiments.length > 0 ? totalImprovement / experiments.length : 0;

    return {
      experiments,
      predictedWinnerPatterns: predictedWinners,
      expectedCTRImprovement: Math.round(avgImprovement * 100) / 100,
    };
  }

  private calculateZScore(
    ctrA: number, ctrB: number,
    impressionsA: number, impressionsB: number
  ): number {
    const pA = ctrA / 100;
    const pB = ctrB / 100;
    const pPool = ((pA * impressionsA) + (pB * impressionsB)) / (impressionsA + impressionsB);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / impressionsA + 1 / impressionsB));
    if (se === 0) return 0;
    return (pB - pA) / se;
  }

  private zScoreToConfidence(zScore: number): number {
    const absZ = Math.abs(zScore);
    if (absZ < 0.5) return 0.5;
    if (absZ < 1) return 0.68;
    if (absZ < 1.5) return 0.87;
    if (absZ < 2) return 0.95;
    if (absZ < 2.5) return 0.99;
    if (absZ < 3) return 0.997;
    return 0.999;
  }

  private getDefaultExperiments(channelId: string, niche: string): ExperimentDefinition[] {
    const base: Omit<ExperimentDefinition, 'id' | 'createdAt'> = {
      type: 'title',
      variableA: 'Standard descriptive title',
      variableB: 'Curiosity gap title with number',
      hypothesis: 'Curiosity gap titles drive higher CTR',
      predictedWinner: 'B',
      expectedImprovement: 15,
      channelId,
      niche,
    };

    return [
      { ...base, id: `exp_${channelId}_${Date.now()}_0`, type: 'title', variableA: 'How to [benefit]', variableB: '[Number] [adjective] Ways to [benefit] (You Won\'t Believe #3)', hypothesis: 'Listicle format with curiosity gap outperforms standard how-to', createdAt: new Date() },
      { ...base, id: `exp_${channelId}_${Date.now()}_1`, type: 'thumbnail', variableA: 'Face closeup with shock expression', variableB: 'Bold text on high-contrast background with arrow', hypothesis: 'Text-based thumbnails have higher CTR for educational content', createdAt: new Date() },
      { ...base, id: `exp_${channelId}_${Date.now()}_2`, type: 'hook', variableA: 'Start with question about problem', variableB: 'Start with shocking statistic', hypothesis: 'Shocking statistics create stronger curiosity gaps', createdAt: new Date() },
    ];
  }
}
