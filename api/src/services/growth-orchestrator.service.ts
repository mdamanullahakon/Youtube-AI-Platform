import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { CTROptimizationEngine } from './ctr-optimization-engine.service';
import { ThumbnailIntelligence } from './thumbnail-intelligence.service';
import { RetentionEngine } from './retention-engine.service';
import { ViralFeedbackLoop } from './viral-feedback-loop.service';
import { PerformanceScaler } from './performance-scaler.service';
import { RevenueMultiplier } from './revenue-multiplier.service';
import { ChannelExpansionService } from './channel-expansion.service';
import { SmartExperimentation } from './smart-experimentation.service';
import { ViralScoreService } from './viral-score.service';
import { generateWithAI } from './ai.service';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';

export interface GrowthReport {
  projectId: string;
  title: string;
  viralScore: number;
  meetsThreshold: boolean;
  ctrOptimization: {
    bestTitle: string;
    titleVariants: number;
    topScore: number;
  };
  thumbnailIntelligence: {
    bestConcept: string;
    conceptScore: number;
    style: string;
  };
  retentionAnalysis: {
    predictedRetention: number;
    passesThreshold: boolean;
    patternInterrupts: number;
  };
  viralFeedback: {
    matchingHookPatterns: number;
    guidanceItems: number;
  };
  revenueOptimization: {
    affiliateLinks: number;
    cpmPriority: number;
    isLongForm: boolean;
  };
  experiments: {
    designed: number;
  };
  recommendedAction: string;
  performanceInsights: string[];
}

export class GrowthOrchestrator {
  private ctrEngine: CTROptimizationEngine;
  private thumbnailIntel: ThumbnailIntelligence;
  private retentionEngine: RetentionEngine;
  private viralFeedback: ViralFeedbackLoop;
  private performanceScaler: PerformanceScaler;
  private revenueMultiplier: RevenueMultiplier;
  private channelExpansion: ChannelExpansionService;
  private experimentation: SmartExperimentation;
  private viralScoreService: ViralScoreService;

  constructor() {
    this.ctrEngine = new CTROptimizationEngine();
    this.thumbnailIntel = new ThumbnailIntelligence();
    this.retentionEngine = new RetentionEngine();
    this.viralFeedback = new ViralFeedbackLoop();
    this.performanceScaler = new PerformanceScaler();
    this.revenueMultiplier = new RevenueMultiplier();
    this.channelExpansion = new ChannelExpansionService();
    this.experimentation = new SmartExperimentation();
    this.viralScoreService = new ViralScoreService();
  }

  async runFullGrowthAudit(projectId: string): Promise<GrowthReport> {
    logger.info(`[GrowthOrchestrator] Running full growth audit for: ${projectId}`);

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        script: true,
        thumbnail: true,
        trendResearch: true,
        analytics: true,
        contentPerformance: true,
        uploadHistory: true,
      },
    });

    if (!project) throw new Error(`Project ${projectId} not found`);

    const niche = project.topic.split(' ').slice(0, 3).join(' ');
    const hook = project.script?.hook || '';
    const scriptContent = project.script?.content || '';

    const ctrResult = await this.ctrEngine.generateAndScoreTitles(project.topic, hook, niche);
    const bestTitle = await this.ctrEngine.selectBestTitle(ctrResult);

    const thumbnailConcepts = await this.thumbnailIntel.generateMultipleConcepts(project.topic, hook, niche);
    const bestThumbnail = await this.thumbnailIntel.pickBestConcept(thumbnailConcepts);

    let retentionResult: { script: string; analysis: any } | null = null;
    if (scriptContent) {
      try {
        retentionResult = await this.retentionEngine.analyzeAndOptimizeScript(scriptContent, project.format || 'long-form');
      } catch (err: any) {
        logger.warn(`[GrowthOrchestrator] Retention check failed: ${err.message}`);
      }
    }

    const guidance = await this.viralFeedback.generateScriptGuidanceFromPatterns(project.topic, niche);

    const viralScore = await this.viralScoreService.computeViralScore(projectId);

    const experiments = await this.experimentation.designExperiment(projectId, project.topic, niche);

    return {
      projectId,
      title: bestTitle.title,
      viralScore: viralScore.viralScore,
      meetsThreshold: viralScore.meetsThreshold,
      ctrOptimization: {
        bestTitle: bestTitle.title,
        titleVariants: ctrResult.length,
        topScore: bestTitle.overallScore,
      },
      thumbnailIntelligence: {
        bestConcept: bestThumbnail.style,
        conceptScore: bestThumbnail.overallScore,
        style: bestThumbnail.composition,
      },
      retentionAnalysis: {
        predictedRetention: retentionResult?.analysis.predictedRetention || 0,
        passesThreshold: retentionResult?.analysis.passesThreshold || false,
        patternInterrupts: retentionResult?.analysis.patternInterrupts?.length || 0,
      },
      viralFeedback: {
        matchingHookPatterns: guidance.length,
        guidanceItems: guidance.length,
      },
      revenueOptimization: {
        affiliateLinks: 0,
        cpmPriority: 0,
        isLongForm: (project.format || 'long-form') !== 'shorts',
      },
      experiments: {
        designed: experiments.length,
      },
      recommendedAction: viralScore.recommendedAction,
      performanceInsights: guidance,
    };
  }

  async preUploadGate(projectId: string): Promise<{ allowed: boolean; optimizedScript?: string; report: GrowthReport }> {
    const report = await this.runFullGrowthAudit(projectId);
    const gateResult = await this.viralScoreService.getUploadGateResult(projectId);

    logger.info(`[GrowthOrchestrator] Upload gate for ${projectId}: ${gateResult.allowed ? 'ALLOWED' : 'BLOCKED'} (viralScore: ${gateResult.score.viralScore})`);

    return {
      allowed: gateResult.allowed,
      report,
    };
  }

  async runChannelScalingCheck(): Promise<{
    scaled: { channelTitle: string; oldFrequency: string; newFrequency: string }[];
    killed: string[];
    pivoted: { channelTitle: string; newNiche: string | null }[];
  }> {
    const evaluations = await this.performanceScaler.evaluateAllChannels();
    const scaled: any[] = [];
    const pivoted: any[] = [];

    for (const e of evaluations) {
      if (e.shouldScaleUp) {
        scaled.push({ channelTitle: e.channelTitle, oldFrequency: 'previous', newFrequency: e.recommendedFrequency });
      } else if (e.shouldScaleDown) {
        scaled.push({ channelTitle: e.channelTitle, oldFrequency: 'previous', newFrequency: e.recommendedFrequency });
      }
      if (e.shouldPivotNiche && e.recommendedNiche) {
        pivoted.push({ channelTitle: e.channelTitle, newNiche: e.recommendedNiche });
      }
    }

    const { killed } = await this.channelExpansion.killUnderperformingChannels(false);

    return { scaled, killed, pivoted };
  }

  async runDailyGrowthCycle(userId: string): Promise<{
    orchestrated: number;
    blocked: number;
    scaled: any[];
    killed: string[];
    revenueOptimized: number;
    experimentsDesigned: number;
  }> {
    logger.info('[GrowthOrchestrator] Running daily growth cycle');

    const pendingProjects = await prisma.videoProject.findMany({
      where: { userId, status: 'ready_for_upload' },
      take: 10,
    });

    let orchestrated = 0;
    let blocked = 0;

    for (const project of pendingProjects) {
      try {
        const gate = await this.preUploadGate(project.id);
        if (gate.allowed) {
          orchestrated++;
        } else {
          blocked++;
          await prisma.videoProject.update({
            where: { id: project.id },
            data: { status: 'needs_optimization' },
          });
        }
      } catch (err: any) {
        logger.error(`[GrowthOrchestrator] Failed to process ${project.id}: ${err.message}`);
      }
    }

    const scalingResult = await this.runChannelScalingCheck();

    return {
      orchestrated,
      blocked,
      scaled: scalingResult.scaled,
      killed: scalingResult.killed,
      revenueOptimized: orchestrated,
      experimentsDesigned: pendingProjects.length * 3,
    };
  }

  async getViralHealthDashboard(): Promise<{
    overallViralHealth: number;
    channelCount: number;
    avgViralScore: number;
    avgCTR: number;
    avgRetention: number;
    totalRevenue: number;
    growthVelocity: string;
    recommendations: string[];
  }> {
    const projects = await prisma.videoProject.findMany({
      where: { status: 'published' },
      include: { analytics: true, uploadHistory: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const withAnalytics = projects.filter(p => p.analytics);
    const avgCTR = withAnalytics.length > 0
      ? Math.round((withAnalytics.reduce((s, p) => s + (p.analytics?.ctr || 0), 0) / withAnalytics.length) * 10) / 10
      : 0;
    const avgRetention = withAnalytics.length > 0
      ? Math.round((withAnalytics.reduce((s, p) => s + (p.analytics?.retention || 0), 0) / withAnalytics.length) * 10) / 10
      : 0;
    const avgViews = withAnalytics.length > 0
      ? Math.round(withAnalytics.reduce((s, p) => s + (p.analytics?.views || 0), 0) / withAnalytics.length)
      : 0;

    const channels = await prisma.youTubeAccount.findMany({ where: { isConnected: true } });

    const rpm = 5;
    const totalRevenue = Math.round((avgViews * projects.length / 1000) * rpm * 100) / 100;

    const recentViews = withAnalytics.filter(p => p.analytics && p.analytics!.views > 0);
    const growthVelocity = recentViews.length > 5
      ? 'growing'
      : recentViews.length > 0 ? 'building' : 'starting';

    const overallViralHealth = Math.round(
      (avgCTR * 3) + (avgRetention * 0.5) + Math.min(30, avgViews / 100)
    );

    const recommendations: string[] = [];
    if (avgCTR < 5) recommendations.push('CRITICAL: Improve thumbnail contrast and title curiosity gap. Current CTR is below YouTube average.');
    if (avgRetention < 40) recommendations.push('CRITICAL: Scripts need more pattern interrupts every 20-30 seconds. Current retention is low.');
    if (avgCTR >= 8 && avgRetention >= 60) recommendations.push('Excellent performance! Scale up upload frequency and experiment with new niches.');
    if (channels.length < 2) recommendations.push('Expand to 2-3 channels to test different niches and multiply revenue.');

    return {
      overallViralHealth: Math.min(100, overallViralHealth),
      channelCount: channels.length,
      avgViralScore: Math.round(overallViralHealth),
      avgCTR,
      avgRetention,
      totalRevenue,
      growthVelocity,
      recommendations,
    };
  }
}
