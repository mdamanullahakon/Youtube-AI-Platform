import { prisma } from '../config/db';
import { aiLogger } from '../utils/logger';
import { CTRAnalyzer } from './ctr-analyzer.service';
import { RetentionAnalyzer } from './retention-analyzer.service';
import { RecommendationGenerator } from './recommendation.service';
import { FeedbackEngine } from './feedback-engine.service';
import type {
  AnalyticsLearningResult,
  OptimizationRecommendation,
  HookEffectivenessEntry,
  DropOffPoint,
  RetentionCurvePoint,
} from '../types';

export interface LearningOptions {
  projectId: string;
  enhanceWithAI?: boolean;
}

export class AnalyticsLearningService {
  private ctrAnalyzer: CTRAnalyzer;
  private retentionAnalyzer: RetentionAnalyzer;
  private recommendationGenerator: RecommendationGenerator;
  private feedbackEngine: FeedbackEngine;

  constructor() {
    this.ctrAnalyzer = new CTRAnalyzer();
    this.retentionAnalyzer = new RetentionAnalyzer();
    this.recommendationGenerator = new RecommendationGenerator();
    this.feedbackEngine = new FeedbackEngine();
  }

  async analyzeProject(options: LearningOptions): Promise<AnalyticsLearningResult> {
    const { projectId, enhanceWithAI = true } = options;

    aiLogger.info(`Starting analytics learning analysis for project ${projectId}`);

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

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const analytics = project.analytics;
    const currentLearning = project.analyticsLearning;

    const learningIteration = (currentLearning?.learningIteration || 0) + 1;

    // Phase 1: CTR Analysis
    const thumbnailAnalysis = await this.ctrAnalyzer.analyzeProjectThumbnail(projectId);

    if (analytics && analytics.ctr > 0) {
      await this.ctrAnalyzer.updateWithActualCTR(projectId, analytics.ctr, analytics.impressions);
    }

    // Phase 2: Hook-Retention Correlation
    const hookRetention = await this.retentionAnalyzer.correlateHooksWithRetention(projectId);

    // Phase 3: Drop-off Analysis
    const dropOffPoints = await this.retentionAnalyzer.analyzeDropOffPoints(projectId);

    // Phase 4: Retention Curve
    const retentionCurve = await this.retentionAnalyzer.generateRetentionCurve(projectId);

    // Phase 5: Generate Recommendations
    const recommendationInput = {
      projectId,
      topic: project.topic,
      retention: analytics?.retention || 0,
      ctr: analytics?.ctr || 0,
      views: analytics?.views || 0,
      hookEntries: hookRetention.entries,
      dropOffPoints,
      topHookType: hookRetention.topHookType,
      thumbnailStyle: thumbnailAnalysis.style,
      thumbnailCTR: thumbnailAnalysis.actualCTR,
    };

    let recommendations: OptimizationRecommendation[] = this.recommendationGenerator.generateDataDriven(recommendationInput);

    if (enhanceWithAI) {
      recommendations = await this.recommendationGenerator.enhanceWithAI(recommendationInput, recommendations);
    }

    // Phase 6: Calculate scores
    const hookRetentionScore = hookRetention.entries.length > 0
      ? Math.round(hookRetention.entries.reduce((s, e) => s + e.score, 0) / hookRetention.entries.length)
      : 0;

    const thumbnailScore = thumbnailAnalysis.actualCTR > 0
      ? Math.round(Math.min(100, thumbnailAnalysis.actualCTR * 10))
      : thumbnailAnalysis.predictedCTR > 0 ? Math.round(Math.min(100, thumbnailAnalysis.predictedCTR * 10)) : 0;

    const confidence = Math.min(1, Math.max(0.3,
      0.3 +
      (analytics ? Math.min(0.2, analytics.views / 10000 * 0.2) : 0) +
      (hookRetention.entries.length > 0 ? 0.2 : 0) +
      (learningIteration > 1 ? 0.15 : 0) +
      (dropOffPoints.length > 0 ? 0.15 : 0)
    ));

    // Phase 7: Persist learning
    await prisma.analyticsLearning.upsert({
      where: { projectId },
      update: {
        hookRetentionScore,
        hookEffectiveness: hookRetention.entries as any,
        thumbnailScore,
        thumbnailStyle: thumbnailAnalysis.style,
        dropOffPoints: dropOffPoints as any,
        retentionCurve: retentionCurve as any,
        recommendations: recommendations as any,
        learningIteration,
        confidence,
        lastAnalyzedAt: new Date(),
      },
      create: {
        projectId,
        hookRetentionScore,
        hookEffectiveness: hookRetention.entries as any,
        thumbnailScore,
        thumbnailStyle: thumbnailAnalysis.style,
        dropOffPoints: dropOffPoints as any,
        retentionCurve: retentionCurve as any,
        recommendations: recommendations as any,
        learningIteration,
        confidence,
      },
    });

    // Phase 8: Feed into feedback engine
    await this.feedbackEngine.processAnalyticsForLearning(projectId);

    aiLogger.info(
      `Analytics learning complete for ${projectId}: ` +
      `hookRetention=${hookRetentionScore}, thumbnail=${thumbnailScore}, ` +
      `recommendations=${recommendations.length}, iteration=${learningIteration}`
    );

    return {
      projectId,
      hookRetentionScore,
      hookEffectiveness: hookRetention.entries,
      thumbnailScore,
      thumbnailStyle: thumbnailAnalysis.style,
      dropOffPoints,
      retentionCurve,
      recommendations,
      learningIteration,
      confidence,
    };
  }

  async getScriptFeedback(topic?: string, format?: string) {
    return this.feedbackEngine.getScriptFeedback(topic, format);
  }

  async getGlobalReport() {
    return this.feedbackEngine.getGlobalOptimizationReport();
  }

  async correlateAcrossProjects(skip = 0, take = 200): Promise<{
    totalProjects: number;
    averageCTR: number;
    averageRetention: number;
    averageViews: number;
    topPerformingHookTypes: { type: string; avgRetention: number; count: number }[];
    thumbnailStylePerformance: { style: string; avgCTR: number; count: number }[];
    globalRecommendations: string[];
  }> {
    const analytics = await prisma.analytics.findMany({
      orderBy: { views: 'desc' },
      skip,
      take,
    });

    const totalProjects = analytics.length;
    const averageCTR = analytics.length > 0
      ? Math.round(analytics.reduce((s, a) => s + a.ctr, 0) / analytics.length * 10) / 10
      : 0;
    const averageRetention = analytics.length > 0
      ? Math.round(analytics.reduce((s, a) => s + a.retention, 0) / analytics.length * 10) / 10
      : 0;
    const averageViews = analytics.length > 0
      ? Math.round(analytics.reduce((s, a) => s + a.views, 0) / analytics.length)
      : 0;

    const globalReport = await this.feedbackEngine.getGlobalOptimizationReport();

    return {
      totalProjects,
      averageCTR,
      averageRetention,
      averageViews,
      topPerformingHookTypes: globalReport.topHookTypes,
      thumbnailStylePerformance: globalReport.thumbnailStyleRankings,
      globalRecommendations: globalReport.globalRecommendations,
    };
  }
}
