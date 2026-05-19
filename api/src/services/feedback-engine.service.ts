import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import { LearningEngine } from './learning-engine';
import type { ContentInsightType, OptimizationRecommendation, InsightCategory } from '../types';

interface ScriptAgentFeedback {
  hookGuidance: string[];
  structureGuidance: string[];
  pacingGuidance: string[];
  ctaGuidance: string[];
  thumbnailGuidance: string[];
}

export class FeedbackEngine {
  private learningEngine: LearningEngine;

  constructor() {
    this.learningEngine = new LearningEngine();
  }

  async processAnalyticsForLearning(projectId: string): Promise<{
    newInsightsCreated: number;
    confidenceUpdates: number;
  }> {
    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        analyticsLearning: true,
        thumbnail: true,
        thumbnailPerformance: true,
        script: true,
        transcriptIntelligence: true,
      },
    });

    if (!project || !project.analytics) {
      return { newInsightsCreated: 0, confidenceUpdates: 0 };
    }

    const analytics = project.analytics;
    let newInsightsCreated = 0;
    let confidenceUpdates = 0;

    // 1. Create/update ContentPerformance record
    let predictedHookScore = project.transcriptIntelligence?.hookScore;
    const predictedThumbnailCTR = project.thumbnailPerformance?.predictedCTR || project.thumbnail?.ctr || 0;
    const predictedRetention = project.transcriptIntelligence?.engagementScore || 0;

    await prisma.contentPerformance.upsert({
      where: { projectId },
      update: {
        actualViews: analytics.views,
        actualCTR: analytics.ctr,
        actualRetention: analytics.retention,
        actualWatchTime: analytics.watchTime,
        hookGap: predictedHookScore ? predictedHookScore - analytics.retention : null,
        retentionGap: predictedRetention ? predictedRetention - analytics.retention : null,
      },
      create: {
        projectId,
        predictedHookScore,
        predictedThumbnailCTR,
        predictedRetention,
        predictedEngagement: predictedRetention,
        actualViews: analytics.views,
        actualCTR: analytics.ctr,
        actualRetention: analytics.retention,
        actualWatchTime: analytics.watchTime,
      },
    });

    // 2. Create insights based on performance
    const insights: ContentInsightType[] = [];

    // Hook quality → retention insight
    if (predictedHookScore && analytics.retention > 50) {
      insights.push({
        category: 'hook',
        content: `Hooks scoring ${Math.round(predictedHookScore)}+/100 correlate with ${analytics.retention}% retention. Maintain high hook quality standards for future scripts.`,
        source: 'performance-correlation',
        confidence: Math.min(0.9, analytics.retention / 100),
        applicationCount: 0,
      });
    }

    // CTR insight
    if (analytics.ctr > 8) {
      insights.push({
        category: 'general',
        content: `CTR of ${analytics.ctr}% indicates strong thumbnail + title performance. Analyze and replicate this thumbnail style in future content.`,
        source: 'performance-correlation',
        confidence: 0.8,
        applicationCount: 0,
      });
    } else if (analytics.ctr < 3) {
      insights.push({
        category: 'thumbnail',
        content: `CTR of ${analytics.ctr}% indicates weak thumbnail appeal. Focus on creating more curiosity-driven thumbnails with bold text and emotional faces.`,
        source: 'performance-correlation',
        confidence: 0.75,
        applicationCount: 0,
      });
    }

    // Retention insight
    if (analytics.retention > 60) {
      insights.push({
        category: 'retention',
        content: `Retention of ${analytics.retention}% is excellent. The current video structure (pacing, hook density, CTA placement) is effective. Use as template.`,
        source: 'performance-correlation',
        confidence: 0.85,
        applicationCount: 0,
      });
    } else if (analytics.retention < 30) {
      insights.push({
        category: 'retention',
        content: `Retention of ${analytics.retention}% needs urgent improvement. Add more pattern interrupts, deliver value earlier, and ensure the hook promise is fulfilled.`,
        source: 'performance-correlation',
        confidence: 0.9,
        applicationCount: 0,
      });
    }

    // Hook score gap → prediction accuracy insight
    if (predictedHookScore) {
      const gap = Math.abs(predictedHookScore - analytics.retention);
      if (gap > 30) {
        insights.push({
          category: 'general',
          content: `Hook score prediction gap of ${Math.round(gap)} points indicates the intelligence engine needs calibration. High hook scores may not always translate to retention.`,
          source: 'performance-correlation',
          confidence: 0.6,
          applicationCount: 0,
        });
      }
    }

    // Save insights
    for (const insight of insights) {
      const existing = await prisma.contentInsight.findFirst({
        where: { category: insight.category, content: insight.content.substring(0, 100) },
      });

      if (existing) {
        await prisma.contentInsight.update({
          where: { id: existing.id },
          data: { confidence: Math.max(existing.confidence, insight.confidence) },
        });
        confidenceUpdates++;
      } else {
        await prisma.contentInsight.create({
          data: {
            category: insight.category,
            content: insight.content,
            source: insight.source,
            confidence: insight.confidence,
          },
        });
        newInsightsCreated++;
      }
    }

    // 3. Update ContentInsight confidence based on actual performance
    await this.updateConfidenceFromPerformance(projectId, analytics);

    aiLogger.info(`Analytics learning processed: ${newInsightsCreated} new insights, ${confidenceUpdates} confidence updates`);

    return { newInsightsCreated, confidenceUpdates };
  }

  async getScriptFeedback(topic?: string, format?: string): Promise<ScriptAgentFeedback> {
    // Get high-confidence hook insights
    const hookInsights = await prisma.contentInsight.findMany({
      where: { category: 'hook', confidence: { gte: 0.6 } },
      orderBy: { confidence: 'desc' },
      take: 5,
    });

    // Get retention insights
    const retentionInsights = await prisma.contentInsight.findMany({
      where: { category: 'retention', confidence: { gte: 0.6 } },
      orderBy: { confidence: 'desc' },
      take: 3,
    });

    // Get thumbnail insights
    const thumbnailInsights = await prisma.contentInsight.findMany({
      where: { category: 'thumbnail', confidence: { gte: 0.6 } },
      orderBy: { confidence: 'desc' },
      take: 3,
    });

    // Get general insights
    const generalInsights = await prisma.contentInsight.findMany({
      where: { category: 'general', confidence: { gte: 0.6 } },
      orderBy: { confidence: 'desc' },
      take: 3,
    });

    // Get performance-correlated insights
    const performanceInsights = await prisma.contentInsight.findMany({
      where: { source: 'performance-correlation', confidence: { gte: 0.7 } },
      orderBy: { confidence: 'desc' },
      take: 5,
    });

    return {
      hookGuidance: [...hookInsights, ...performanceInsights.filter(i => i.category === 'hook')]
        .slice(0, 5)
        .map(i => i.content),
      structureGuidance: generalInsights
        .filter(i => i.content.toLowerCase().includes('structure') || i.content.toLowerCase().includes('narrative'))
        .slice(0, 3)
        .map(i => i.content),
      pacingGuidance: retentionInsights
        .filter(i => i.content.toLowerCase().includes('pace') || i.content.toLowerCase().includes('pattern interrupt'))
        .slice(0, 3)
        .map(i => i.content),
      ctaGuidance: generalInsights
        .filter(i => i.content.toLowerCase().includes('cta') || i.content.toLowerCase().includes('call to action'))
        .slice(0, 2)
        .map(i => i.content),
      thumbnailGuidance: [
        ...thumbnailInsights,
        ...performanceInsights.filter(i => i.category === 'thumbnail' || i.content.toLowerCase().includes('ctr')),
      ]
        .slice(0, 3)
        .map(i => i.content),
    };
  }

  async getGlobalOptimizationReport(): Promise<{
    topHookTypes: { type: string; avgRetention: number; count: number }[];
    thumbnailStyleRankings: { style: string; avgCTR: number; count: number }[];
    globalRecommendations: string[];
  }> {
    // Analyze all content performance records
    const performances = await prisma.contentPerformance.findMany({
      where: { actualViews: { gt: 0 } },
      orderBy: { actualViews: 'desc' },
      include: { project: { include: { transcriptIntelligence: true, thumbnailPerformance: true } } },
    });

    const topHookTypes = performances
      .filter(p => p.project?.transcriptIntelligence)
      .map(p => ({
        type: (p.project!.transcriptIntelligence!.detectedHooks as any[])?.[0]?.type || 'unknown',
        retention: p.actualRetention,
      }))
      .reduce<Record<string, { totalRetention: number; count: number }>>((acc, curr) => {
        const existing = acc[curr.type] || { totalRetention: 0, count: 0 };
        existing.totalRetention += curr.retention;
        existing.count++;
        acc[curr.type] = existing;
        return acc;
      }, {});

    const hookRankings = Object.entries(topHookTypes)
      .map(([type, data]) => ({
        type,
        avgRetention: Math.round(data.totalRetention / data.count),
        count: data.count,
      }))
      .sort((a, b) => b.avgRetention - a.avgRetention);

    const thumbnailPerformances = await prisma.thumbnailPerformance.findMany({
      where: { actualCTR: { gt: 0 } },
      orderBy: { actualCTR: 'desc' },
    });

    const styleMap = new Map<string, { totalCTR: number; count: number }>();
    for (const tp of thumbnailPerformances) {
      const style = tp.style || 'unknown';
      const existing = styleMap.get(style) || { totalCTR: 0, count: 0 };
      existing.totalCTR += tp.actualCTR;
      existing.count++;
      styleMap.set(style, existing);
    }

    const thumbnailRankings = Array.from(styleMap.entries())
      .map(([style, data]) => ({ style, avgCTR: Math.round(data.totalCTR / data.count), count: data.count }))
      .sort((a, b) => b.avgCTR - a.avgCTR);

    // Generate global recommendations
    const globalRecommendations: string[] = [];
    const highConfidenceInsights = await prisma.contentInsight.findMany({
      where: { confidence: { gte: 0.8 } },
      orderBy: { confidence: 'desc' },
      take: 5,
    });

    for (const insight of highConfidenceInsights) {
      globalRecommendations.push(insight.content);
    }

    if (globalRecommendations.length === 0) {
      globalRecommendations.push('Continue generating content to build performance data. The learning system needs more data points to generate reliable recommendations.');
    }

    return {
      topHookTypes: hookRankings,
      thumbnailStyleRankings: thumbnailRankings,
      globalRecommendations,
    };
  }

  private async updateConfidenceFromPerformance(projectId: string, analytics: any): Promise<void> {
    // Increase confidence of insights that predicted correctly
    const performance = await prisma.contentPerformance.findUnique({ where: { projectId } });
    if (!performance) return;

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      select: { transcriptIntelligence: { select: { detectedHooks: true } }, thumbnailPerformance: { select: { id: true } } },
    });

    if (performance.hookGap !== null && Math.abs(performance.hookGap) < 15) {
      const hooks = ((project?.transcriptIntelligence?.detectedHooks as any[]) || []).map((h: any) => h.type).filter(Boolean);
      if (hooks.length > 0) {
        await prisma.contentInsight.updateMany({
          where: { category: 'hook', source: 'transcript-analysis', content: { contains: hooks[0] } },
          data: { confidence: { increment: 0.05 } },
        });
      }
    }

    if (analytics.ctr > 8) {
      await prisma.contentInsight.updateMany({
        where: { category: 'thumbnail', source: 'performance-correlation', content: { contains: `${analytics.ctr}%` } },
        data: { confidence: { increment: 0.1 } },
      });
    }

    if (analytics.retention > 60) {
      await prisma.contentInsight.updateMany({
        where: { category: 'retention', source: 'performance-correlation', content: { contains: `${Math.round(analytics.retention)}%` } },
        data: { confidence: { increment: 0.1 } },
      });
    }
  }
}
