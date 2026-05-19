import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import type { HookEffectivenessEntry, HookRetentionCorrelation, DropOffPoint, RetentionCurvePoint } from '../types';

const HOOK_TYPES = [
  'curiosity-gap', 'pattern-interrupt', 'provocative-question', 'bold-statement',
  'shocking-statistic', 'story-bait', 'benefit-forward', 'urgency', 'controversy', 'relatable-problem',
] as const;

export class RetentionAnalyzer {
  async correlateHooksWithRetention(projectId: string): Promise<{
    entries: HookEffectivenessEntry[];
    topHookType: string;
    recommendations: string[];
  }> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        script: true,
        transcriptIntelligence: true,
      },
    });

    if (!project || !project.analytics) {
      return { entries: [], topHookType: 'unknown', recommendations: ['No analytics data available'] };
    }

    const ti = project.transcriptIntelligence;
    const hooks = ti?.detectedHooks as any[] | undefined;
    const retention = project.analytics.retention;

    const entries: HookEffectivenessEntry[] = [];

    if (hooks && hooks.length > 0) {
      const hookTypeCounts = new Map<string, { totalScore: number; count: number }>();

      for (const hook of hooks) {
        const type = hook.type || 'unknown';
        const existing = hookTypeCounts.get(type) || { totalScore: 0, count: 0 };
        existing.totalScore += hook.score || 50;
        existing.count++;
        hookTypeCounts.set(type, existing);
      }

      for (const [hookType, data] of hookTypeCounts) {
        const avgScore = data.totalScore / data.count;
        entries.push({
          hookType,
          avgRetention: Math.round(retention * (avgScore / 100)),
          sampleSize: data.count,
          confidence: Math.min(1, data.count / 5),
          score: Math.round(avgScore),
        });
      }
    }

    entries.sort((a, b) => b.score - a.score);
    const topHookType = entries[0]?.hookType || 'unknown';

    const recommendations: string[] = [];

    if (retention < 30) {
      recommendations.push('Retention below 30%. Add a pattern interrupt or curiosity gap every 10-15 seconds.');
    } else if (retention < 50) {
      recommendations.push(`Top hook type "${topHookType}" drives best retention. Lead with this hook type in future videos.`);
    } else if (retention >= 60) {
      recommendations.push(`Retention at ${retention}% is strong. Maintain current hook strategy with "${topHookType}" openings.`);
    }

    if (entries.length > 1) {
      const best = entries[0];
      const worst = entries[entries.length - 1];
      if (best.score - worst.score > 20) {
        recommendations.push(
          `${best.hookType} hooks (score: ${best.score}) significantly outperform ${worst.hookType} hooks (score: ${worst.score}). Avoid ${worst.hookType} in openings.`
        );
      }
    }

    return { entries, topHookType, recommendations };
  }

  async analyzeAllCorrelations(): Promise<{
    correlations: HookRetentionCorrelation[];
    significantFindings: string[];
  }> {
    const projects = await prisma.videoProject.findMany({
      where: {
        analytics: { isNot: null },
        transcriptIntelligence: { isNot: null },
      },
      include: {
        analytics: true,
        transcriptIntelligence: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (projects.length < 3) {
      return {
        correlations: [],
        significantFindings: ['Need at least 3 projects with analytics + transcript data to find patterns.'],
      };
    }

    const hookTypeRetentionMap = new Map<string, { totalRetention: number; count: number; totalHookScore: number }>();

    for (const project of projects) {
      const hooks = project.transcriptIntelligence?.detectedHooks as any[] | undefined;
      const retention = project.analytics?.retention || 0;

      if (!hooks) continue;

      const topHook = hooks[0];
      if (!topHook) continue;

      const type = topHook.type || 'unknown';
      const existing = hookTypeRetentionMap.get(type) || { totalRetention: 0, count: 0, totalHookScore: 0 };
      existing.totalRetention += retention;
      existing.count++;
      existing.totalHookScore += topHook.score || 50;
      hookTypeRetentionMap.set(type, existing);
    }

    const correlations: HookRetentionCorrelation[] = [];
    for (const [hookType, data] of hookTypeRetentionMap) {
      const avgRetention = Math.round((data.totalRetention / data.count) * 10) / 10;
      const avgHookScore = data.totalHookScore / data.count;
      const correlationStrength = Math.min(1, (avgRetention / 100) * (avgHookScore / 100) * 2);
      const isSignificant = data.count >= 3 && correlationStrength > 0.3;

      correlations.push({
        hookType,
        averageRetention: avgRetention,
        sampleSize: data.count,
        correlationStrength: Math.round(correlationStrength * 100),
        isStatisticallySignificant: isSignificant,
      });
    }

    correlations.sort((a, b) => b.averageRetention - a.averageRetention);

    const significantFindings: string[] = [];
    const significant = correlations.filter(c => c.isStatisticallySignificant);

    if (significant.length > 0) {
      const best = significant[0];
      significantFindings.push(
        `${best.hookType} hooks correlate with ${best.averageRetention}% average retention (${best.sampleSize} samples, strength: ${best.correlationStrength}%). Use this hook type as primary opener.`
      );
    }

    const worst = correlations[correlations.length - 1];
    if (worst && worst.averageRetention < 25) {
      significantFindings.push(
        `${worst.hookType} hooks average only ${worst.averageRetention}% retention. Avoid using this hook type for openings.`
      );
    }

    const totalAvgRetention = correlations.reduce((s, c) => s + c.averageRetention * c.sampleSize, 0) /
      correlations.reduce((s, c) => s + c.sampleSize, 0);

    if (totalAvgRetention < 40) {
      significantFindings.push(
        'Overall retention across all content is below 40%. Focus on improving hook quality and adding more pattern interrupts.'
      );
    }

    return { correlations, significantFindings };
  }

  async analyzeDropOffPoints(projectId: string): Promise<DropOffPoint[]> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        script: true,
        transcriptIntelligence: true,
      },
    });

    if (!project) return [];

    const retention = project.analytics?.retention || 0;
    const ti = project.transcriptIntelligence;
    const pacingPattern = ti?.pacingPattern as any;
    const detectedHooks = ti?.detectedHooks as any[] | undefined;

    const dropOffs: DropOffPoint[] = [];

    // 1. Analyze pacing for potential dropout points
    if (pacingPattern?.hotspots) {
      for (const hotspot of pacingPattern.hotspots) {
        if (hotspot.type === 'deceleration' && hotspot.intensity > 60) {
          dropOffs.push({
            position: hotspot.position,
            severity: 'moderate',
            estimatedDropPercent: Math.round(hotspot.intensity * 0.3),
            context: `Pace slows significantly at position ${hotspot.position}`,
            likelyCause: 'Sudden pacing deceleration may cause viewer disengagement',
          });
        }
      }
    }

    // 2. Analyze hook density for retention risk
    if (detectedHooks) {
      const hookPositions = detectedHooks.map((h: any) => h.position).sort((a: number, b: number) => a - b);
      if (hookPositions.length >= 2) {
        for (let i = 1; i < hookPositions.length; i++) {
          const gap = hookPositions[i] - hookPositions[i - 1];
          if (gap > 15) {
            dropOffs.push({
              position: hookPositions[i - 1] + Math.floor(gap / 2),
              severity: gap > 25 ? 'critical' : 'moderate',
              estimatedDropPercent: Math.min(50, gap * 2),
              context: `Gap of ${gap} sentences between retention hooks`,
              likelyCause: 'Too much time without a retention hook or pattern interrupt',
            });
          }
        }
      }
    }

    // 3. Overall retention-based assessment
    if (retention < 30) {
      dropOffs.push({
        position: 1,
        severity: 'critical',
        estimatedDropPercent: 70 - retention,
        context: 'Overall retention critically low',
        likelyCause: 'Hook fails to retain viewers beyond first few seconds',
      });
    } else if (retention < 50) {
      dropOffs.push({
        position: 3,
        severity: 'moderate',
        estimatedDropPercent: 50 - retention,
        context: 'Mid-video retention below average',
        likelyCause: 'Insufficient retention hooks or pacing issues in middle section',
      });
    }

    // 4. Script length-based estimate
    const scriptContent = project.script?.content;
    if (scriptContent) {
      const wordCount = scriptContent.split(/\s+/).length;
      if (wordCount > 800 && retention < 40) {
        dropOffs.push({
          position: Math.round(wordCount / 300),
          severity: 'moderate',
          estimatedDropPercent: 25,
          context: `Long script (${wordCount} words) with low retention`,
          likelyCause: 'Video may be too long for the retention quality. Consider shortening by 30-40%.',
        });
      }
    }

    dropOffs.sort((a, b) => {
      const severityOrder = { critical: 0, moderate: 1, minor: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });

    return dropOffs;
  }

  async generateRetentionCurve(projectId: string): Promise<RetentionCurvePoint[]> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: { analytics: true, transcriptIntelligence: true },
    });

    if (!project) return [];

    const retention = project.analytics?.retention || 0;
    const ti = project.transcriptIntelligence;
    const hooks = ti?.detectedHooks as any[] | undefined;

    const curve: RetentionCurvePoint[] = [];

    curve.push({ position: 0, retention: 100, label: 'Start' });
    curve.push({ position: 1, retention: Math.max(30, retention + 20), label: 'After hook' });

    if (hooks && hooks.length > 0) {
      for (let i = 0; i < hooks.length; i++) {
        const hook = hooks[i];
        const estimatedRetention = Math.max(10, retention - (i * 8));
        curve.push({
          position: hook.position || (i + 2) * 3,
          retention: Math.round(estimatedRetention),
          label: `Hook ${i + 1}: ${(hook.type || 'hook').substring(0, 20)}`,
        });
      }
    }

    const midPoint = hooks ? hooks.length + 2 : 4;
    curve.push({
      position: midPoint,
      retention: Math.round(retention * 0.8),
      label: 'Mid-point',
    });

    curve.push({
      position: midPoint + 2,
      retention: Math.round(retention),
      label: 'End',
    });

    return curve;
  }
}
