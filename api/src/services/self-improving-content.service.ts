import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';

interface PerformanceAnalysis {
  projectId: string;
  weakPoints: WeakPoint[];
  strengths: string[];
  improvementPlan: ImprovementAction[];
}

interface WeakPoint {
  metric: string;
  actualValue: number;
  benchmarkValue: number;
  gap: number;
  severity: 'critical' | 'moderate' | 'minor';
  suggestedFix: string;
}

interface ImprovementAction {
  component: 'hook' | 'thumbnail' | 'pacing' | 'title' | 'description' | 'cta';
  change: string;
  expectedLift: number;
  reason: string;
}

interface LearnedPattern {
  pattern: string;
  component: string;
  effectiveness: number;
  timesUsed: number;
  confidence: number;
}

export class SelfImprovingContentEngine {
  async analyzeVideoPerformance(projectId: string): Promise<PerformanceAnalysis> {
    logger.info(`[SelfImprove] Analyzing performance for project ${projectId}`);

    const analytics = await prisma.analytics.findUnique({
      where: { projectId },
      include: {
        project: {
          include: { script: true, thumbnail: true, analyticsLearning: true },
        },
      },
    });

    if (!analytics) {
      return {
        projectId,
        weakPoints: [],
        strengths: [],
        improvementPlan: [{
          component: 'hook',
          change: 'Strengthen opening hook with curiosity gap',
          expectedLift: 15,
          reason: 'First 15 seconds critical for retention',
        }],
      };
    }

    const weakPoints: WeakPoint[] = [];
    const strengths: string[] = [];

    const benchmarks = { ctr: 5.0, retention: 50.0, avgViewDuration: 180 };
    const ctrGap = benchmarks.ctr - (analytics.ctr || 0);
    const retentionGap = benchmarks.retention - (analytics.retention || 0);

    if (ctrGap > 1) {
      weakPoints.push({
        metric: 'CTR', actualValue: analytics.ctr || 0, benchmarkValue: benchmarks.ctr,
        gap: Math.round(ctrGap * 100) / 100, severity: ctrGap > 2 ? 'critical' : 'moderate',
        suggestedFix: 'Improve thumbnail with face close-up and red/black contrast. Shorten title to <50 chars with question format.',
      });
    } else {
      strengths.push(`Good CTR (${analytics.ctr}% vs benchmark ${benchmarks.ctr}%)`);
    }

    if (retentionGap > 10) {
      weakPoints.push({
        metric: 'Retention', actualValue: analytics.retention || 0, benchmarkValue: benchmarks.retention,
        gap: Math.round(retentionGap), severity: retentionGap > 20 ? 'critical' : 'moderate',
        suggestedFix: 'Increase pattern interrupt frequency. Insert open loops every 30s. Shorten slow sections.',
      });
    } else {
      strengths.push(`Good retention (${analytics.retention}% vs benchmark ${benchmarks.retention}%)`);
    }

    const improvementPlan = await this.generateImprovementPlan(analytics, weakPoints);

    await this.saveLearnedPatterns(projectId, improvementPlan, analytics);

    return { projectId, weakPoints, strengths, improvementPlan };
  }

  async improveScript(scriptContent: string, projectId: string): Promise<string> {
    const analysis = await this.analyzeVideoPerformance(projectId);
    let improvedScript = scriptContent;

    if (analysis.weakPoints.some(w => w.metric === 'Retention')) {
      const response = await generateWithAI(`
        IMPROVE this script to increase RETENTION.

        Weak points:
        ${analysis.weakPoints.filter(w => w.metric === 'Retention').map(w => `- ${w.suggestedFix}`).join('\n')}

        Original script:
        "${scriptContent.substring(0, 4000)}"

        Rules:
        - Insert pattern interrupts every 20-30 seconds
        - Add open loops (questions unanswered for 2+ min)
        - Shorten any scene over 20 seconds
        - Add micro-cliffhangers before scene transitions
        - Keep the core narrative intact

        Return ONLY the improved script.
      `, 'ollama', { temperature: 0.5 });

      if (response && response.length > 100) improvedScript = response;
    }

    if (analysis.weakPoints.some(w => w.metric === 'CTR')) {
      const hookResponse = await generateWithAI(`
        Generate a stronger opening hook (3-5 sentences) for this script.
        Focus on: curiosity gap, emotional trigger, micro-cliffhanger.

        Script start: "${scriptContent.substring(0, 500)}"

        Return ONLY the hook text.
      `, 'ollama', { temperature: 0.6 });

      if (hookResponse && hookResponse.length > 20) {
        improvedScript = improvedScript.replace(/---HOOK---.*?---/, `---HOOK---${hookResponse}---`);
      }
    }

    return improvedScript;
  }

  async getLearnedPatterns(niche: string): Promise<LearnedPattern[]> {
    const projects = await prisma.videoProject.findMany({
      where: {
        topic: { contains: niche },
        analyticsLearning: { isNot: null },
      },
      include: { analyticsLearning: true },
      take: 20,
    });

    const patterns: LearnedPattern[] = [];
    for (const p of projects) {
      if (p.analyticsLearning?.recommendations) {
        try {
          const recs = p.analyticsLearning.recommendations as any;
          if (recs.patterns) patterns.push(...recs.patterns);
        } catch {}
      }
    }

    if (patterns.length === 0) {
      return [
        { pattern: 'Pattern interrupt every 25-30s', component: 'pacing', effectiveness: 72, timesUsed: 10, confidence: 0.8 },
        { pattern: 'Face close-up thumbnail with red/black contrast', component: 'thumbnail', effectiveness: 85, timesUsed: 8, confidence: 0.75 },
        { pattern: 'Open with rhetorical question + silence', component: 'hook', effectiveness: 78, timesUsed: 12, confidence: 0.85 },
      ];
    }

    return patterns;
  }

  private async generateImprovementPlan(
    analytics: any,
    weakPoints: WeakPoint[]
  ): Promise<ImprovementAction[]> {
    const improvements: ImprovementAction[] = [];

    if (weakPoints.length === 0) {
      improvements.push({
        component: 'hook', change: 'Current approach working — test new hook variation for incremental lift',
        expectedLift: 5, reason: 'Continuous testing maintains growth',
      });
      return improvements;
    }

    for (const wp of weakPoints) {
      if (wp.metric === 'CTR') {
        improvements.push({
          component: 'thumbnail', change: 'Generate new thumbnail with face close-up + red contrast + 3-word text',
          expectedLift: 20, reason: `CTR ${wp.actualValue}% below benchmark — thumbnail is primary lever`,
        });
        improvements.push({
          component: 'title', change: 'Use question format with curiosity gap + numbers',
          expectedLift: 15, reason: 'Question titles improve CTR by 25% on average',
        });
      }
      if (wp.metric === 'Retention') {
        improvements.push({
          component: 'pacing', change: 'Insert pattern interrupts every 20s instead of 40s',
          expectedLift: 18, reason: `Retention ${wp.actualValue}% — faster pacing reduces drop-off`,
        });
        improvements.push({
          component: 'hook', change: 'Open with 3-second silence + shocking statement',
          expectedLift: 12, reason: 'Emotional hooks increase early retention by 30%',
        });
      }
    }

    return improvements;
  }

  private async saveLearnedPatterns(
    projectId: string,
    improvements: ImprovementAction[],
    analytics: any
  ): Promise<void> {
    try {
      const patterns: LearnedPattern[] = improvements.map(imp => ({
        pattern: imp.change,
        component: imp.component,
        effectiveness: imp.expectedLift,
        timesUsed: 1,
        confidence: 0.5,
      }));

      await prisma.analyticsLearning.upsert({
        where: { projectId },
        update: {
          recommendations: { patterns, improvements } as any,
          learningIteration: { increment: 1 },
        },
        create: {
          projectId,
          recommendations: { patterns, improvements } as any,
        },
      });
    } catch (err: any) {
      logger.warn(`[SelfImprove] Save patterns failed: ${err.message}`);
    }
  }
}
