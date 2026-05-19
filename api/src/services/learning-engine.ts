import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import type { ContentInsightType, InsightCategory } from '../types';

interface ScriptImprovement {
  hookSuggestion: string;
  structureSuggestion: string;
  pacingSuggestion: string;
  ctaSuggestion: string;
  actionableTips: string[];
}

export class LearningEngine {
  async getTopInsights(category?: InsightCategory, limit: number = 10): Promise<ContentInsightType[]> {
    try {
      const where: Record<string, unknown> = {};
      if (category) where.category = category;

      const records = await prisma.contentInsight.findMany({
        where,
        orderBy: [{ confidence: 'desc' }, { applicationCount: 'asc' }],
        take: limit,
      });

      return records.map(r => ({
        id: r.id,
        category: r.category as InsightCategory,
        content: r.content,
        source: r.source as ContentInsightType['source'],
        confidence: r.confidence,
        applicationCount: r.applicationCount,
        lastAppliedAt: r.lastAppliedAt?.toISOString(),
        createdAt: r.createdAt.toISOString(),
      }));
    } catch (err) {
      aiLogger.error('Failed to fetch top insights', { error: (err as Error).message });
      return [];
    }
  }

  async saveInsights(insights: ContentInsightType[]): Promise<void> {
    try {
      for (const insight of insights) {
        const existing = await prisma.contentInsight.findFirst({
          where: {
            category: insight.category,
            content: insight.content.substring(0, 200),
          },
        });

        if (existing) {
          await prisma.contentInsight.update({
            where: { id: existing.id },
            data: {
              confidence: Math.max(existing.confidence, insight.confidence),
              source: insight.source,
            },
          });
        } else {
          await prisma.contentInsight.create({
            data: {
              category: insight.category,
              content: insight.content,
              source: insight.source,
              confidence: insight.confidence,
              applicationCount: 0,
            },
          });
        }
      }
    } catch (err) {
      aiLogger.error('Failed to save insights', { error: (err as Error).message });
    }
  }

  async recordApplication(insightId: string): Promise<void> {
    try {
      await prisma.contentInsight.update({
        where: { id: insightId },
        data: {
          applicationCount: { increment: 1 },
          lastAppliedAt: new Date(),
        },
      });
    } catch (err) {
      aiLogger.error('Failed to record insight application', { error: (err as Error).message });
    }
  }

  async correlatePerformanceWithScripts(): Promise<ContentInsightType[]> {
    try {
      const projects = await prisma.videoProject.findMany({
        where: {
          analytics: { isNot: null },
          script: { isNot: null },
        },
        include: {
          analytics: true,
          script: true,
          transcriptIntelligence: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      if (projects.length < 3) return [];

      const performanceInsights: ContentInsightType[] = [];

      const highPerformers = projects.filter(p =>
        p.analytics && p.analytics.ctr > 8 && p.analytics.retention > 50
      );
      const lowPerformers = projects.filter(p =>
        p.analytics && (p.analytics.ctr < 3 || p.analytics.retention < 20)
      );

      if (highPerformers.length >= 2 && lowPerformers.length >= 2) {
        const highHookScores = highPerformers
          .filter(p => p.transcriptIntelligence)
          .map(p => Number(p.transcriptIntelligence!.hookScore) || 0);
        const lowHookScores = lowPerformers
          .filter(p => p.transcriptIntelligence)
          .map(p => Number(p.transcriptIntelligence!.hookScore) || 0);

        if (highHookScores.length > 0 && lowHookScores.length > 0) {
          const highAvg = highHookScores.reduce((a, b) => a + b, 0) / highHookScores.length;
          const lowAvg = lowHookScores.reduce((a, b) => a + b, 0) / lowHookScores.length;

          if (highAvg > lowAvg + 10) {
            performanceInsights.push({
              category: 'hook',
              content: `Correlation found: High-performing videos average hook score ${Math.round(highAvg)}/100 vs low-performing ${Math.round(lowAvg)}/100. Hook quality directly impacts CTR and retention.`,
              source: 'performance-correlation',
              confidence: 0.8,
              applicationCount: 0,
            });
          }
        }

        const highEngagement = highPerformers
          .filter(p => p.transcriptIntelligence)
          .map(p => Number(p.transcriptIntelligence!.engagementScore) || 0);
        const lowEngagement = lowPerformers
          .filter(p => p.transcriptIntelligence)
          .map(p => Number(p.transcriptIntelligence!.engagementScore) || 0);

        if (highEngagement.length > 0 && lowEngagement.length > 0) {
          const highEngAvg = highEngagement.reduce((a, b) => a + b, 0) / highEngagement.length;
          const lowEngAvg = lowEngagement.reduce((a, b) => a + b, 0) / lowEngagement.length;

          if (highEngAvg > lowEngAvg + 10) {
            performanceInsights.push({
              category: 'general',
              content: `Correlation found: High-performing videos average engagement score ${Math.round(highEngAvg)}/100 vs low-performing ${Math.round(lowEngAvg)}/100. Overall engagement structure correlates with viewership.`,
              source: 'performance-correlation',
              confidence: 0.75,
              applicationCount: 0,
            });
          }
        }
      }

      return performanceInsights;
    } catch (err) {
      aiLogger.error('Failed to correlate performance with scripts', { error: (err as Error).message });
      return [];
    }
  }

  async generateScriptImprovements(topic: string, format: string): Promise<ScriptImprovement> {
    const insights = await this.getTopInsights(undefined, 15);
    const hookInsights = insights.filter(i => i.category === 'hook');
    const structureInsights = insights.filter(i => i.category === 'structure' || i.category === 'storytelling');
    const pacingInsights = insights.filter(i => i.category === 'pacing');
    const ctaInsights = insights.filter(i => i.category === 'cta');
    const generalInsights = insights.filter(i => i.category === 'general' || i.category === 'retention' || i.category === 'emotional');

    const hookSuggestion = hookInsights.length > 0
      ? hookInsights.sort((a, b) => b.confidence - a.confidence)[0].content
      : 'Open with a curiosity gap or provocative question in the first 3 seconds';

    const structureSuggestion = structureInsights.length > 0
      ? structureInsights.sort((a, b) => b.confidence - a.confidence)[0].content
      : 'Use a clear narrative arc: hook → rising tension → payoff → CTA';

    const pacingSuggestion = pacingInsights.length > 0
      ? pacingInsights.sort((a, b) => b.confidence - a.confidence)[0].content
      : 'Vary sentence length: short punchy sentences for hooks, longer ones for explanation';

    const ctaSuggestion = ctaInsights.length > 0
      ? ctaInsights.sort((a, b) => b.confidence - a.confidence)[0].content
      : 'Place a specific CTA in the final 15% of the video';

    const actionableTips = generalInsights
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3)
      .map(i => i.content);

    return {
      hookSuggestion,
      structureSuggestion,
      pacingSuggestion,
      ctaSuggestion,
      actionableTips,
    };
  }
}
