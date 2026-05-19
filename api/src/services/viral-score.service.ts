import { prisma } from '../config/db';
import { logger } from '../utils/logger';

export interface ViralScoreResult {
  projectId: string;
  ctrScore: number;
  retentionScore: number;
  engagementPrediction: number;
  nicheDemand: number;
  viralScore: number;
  threshold: number;
  meetsThreshold: boolean;
  breakdown: {
    ctrScoreExplanation: string;
    retentionScoreExplanation: string;
    engagementPredictionExplanation: string;
    nicheDemandExplanation: string;
  };
  recommendedAction: 'upload' | 'optimize-before-upload' | 'reject-regenerate';
}

export class ViralScoreService {
  private readonly VIRAL_THRESHOLD = 60;

  async computeViralScore(projectId: string): Promise<ViralScoreResult> {
    logger.info(`[ViralScore] Computing viral score for project: ${projectId}`);

    const project = await prisma.videoProject.findUnique({
      where: { id: projectId },
      include: {
        analytics: true,
        trendResearch: true,
        thumbnail: true,
        thumbnailPerformance: true,
        script: true,
        contentPerformance: true,
        analyticsLearning: true,
      },
    });

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const ctrScore = await this.computeCTRScore(project);
    const retentionScore = await this.computeRetentionScore(project);
    const engagementPrediction = await this.computeEngagementPrediction(project);
    const nicheDemand = await this.computeNicheDemand(project);

    const viralScore = Math.round(
      ctrScore * 0.25 +
      retentionScore * 0.30 +
      engagementPrediction * 0.25 +
      nicheDemand * 0.20
    );

    const meetsThreshold = viralScore >= this.VIRAL_THRESHOLD;

    let recommendedAction: 'upload' | 'optimize-before-upload' | 'reject-regenerate';
    if (viralScore >= this.VIRAL_THRESHOLD) {
      recommendedAction = 'upload';
    } else if (viralScore >= this.VIRAL_THRESHOLD * 0.7) {
      recommendedAction = 'optimize-before-upload';
    } else {
      recommendedAction = 'reject-regenerate';
    }

    await prisma.videoProject.update({
      where: { id: projectId },
      data: { viralScore },
    });

    const result: ViralScoreResult = {
      projectId,
      ctrScore,
      retentionScore,
      engagementPrediction,
      nicheDemand,
      viralScore,
      threshold: this.VIRAL_THRESHOLD,
      meetsThreshold,
      breakdown: {
        ctrScoreExplanation: this.explainCTRScore(ctrScore),
        retentionScoreExplanation: this.explainRetentionScore(retentionScore),
        engagementPredictionExplanation: this.explainEngagementPrediction(engagementPrediction),
        nicheDemandExplanation: this.explainNicheDemand(nicheDemand),
      },
      recommendedAction,
    };

    logger.info(`[ViralScore] Project ${projectId}: viralScore=${viralScore}/${this.VIRAL_THRESHOLD} → ${recommendedAction}`);

    return result;
  }

  async computeBatchViralScore(projectIds: string[]): Promise<ViralScoreResult[]> {
    return Promise.all(projectIds.map(id => this.computeViralScore(id)));
  }

  async getUploadGateResult(projectId: string): Promise<{ allowed: boolean; score: ViralScoreResult }> {
    const score = await this.computeViralScore(projectId);

    const allowed = score.recommendedAction === 'upload' || score.recommendedAction === 'optimize-before-upload';

    if (!allowed) {
      logger.warn(`[ViralScore Gate] BLOCKED upload for ${projectId}: viralScore=${score.viralScore}, required=${this.VIRAL_THRESHOLD}`);
    }

    return { allowed, score };
  }

  private async computeCTRScore(project: any): Promise<number> {
    const thumbnailCTR = project.thumbnailPerformance?.actualCTR || project.thumbnail?.ctr || 0;
    const thumbnailQuality = project.thumbnail?.style ? 70 : 50;

    const competitorAvgCTR = await this.getNicheAverageCTR(project.topic);

    let score = 0;
    if (thumbnailCTR > 0) {
      score = Math.min(100, (thumbnailCTR / Math.max(competitorAvgCTR, 1)) * 50);
    }
    score += thumbnailQuality * 0.3;

    const contentPerformance = project.contentPerformance;
    if (contentPerformance?.actualCTR) {
      score += Math.min(100, contentPerformance.actualCTR * 8) * 0.3;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private async computeRetentionScore(project: any): Promise<number> {
    const analytics = project.analytics;
    const analyticsLearning = project.analyticsLearning;

    let score = 50;

    if (analytics?.retention) {
      score = analytics.retention * 0.7;
    }

    if (analyticsLearning?.hookRetentionScore) {
      score += analyticsLearning.hookRetentionScore * 0.3;
    } else if (project.script?.hook) {
      score += 15;
    }

    const hasPatternInterrupts = project.script?.content?.toLowerCase().includes('but') ||
      project.script?.content?.toLowerCase().includes('wait') ||
      project.script?.content?.toLowerCase().includes('however') ||
      project.script?.content?.toLowerCase().includes('this changes');
    if (hasPatternInterrupts) {
      score += 10;
    }

    const hasCTA = project.script?.content?.toLowerCase().includes('subscribe') ||
      project.script?.content?.toLowerCase().includes('like') ||
      project.script?.content?.toLowerCase().includes('comment');
    if (hasCTA) {
      score += 5;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private async computeEngagementPrediction(project: any): Promise<number> {
    const analytics = project.analytics;
    let score = 50;

    if (analytics) {
      const commentRate = analytics.views > 0 ? (analytics.comments / analytics.views) * 100 : 0;
      const likeRate = analytics.views > 0 ? (analytics.likes / analytics.views) * 100 : 0;
      const shareRate = analytics.views > 0 ? (analytics.shares / analytics.views) * 100 : 0;

      score = Math.min(100,
        (likeRate * 5) +
        (commentRate * 10) +
        (shareRate * 15) +
        Math.min(30, analytics.subscribersGained)
      );
    }

    const viralKeywords = ['secret', 'shocking', 'revealed', 'truth', 'never', 'changes everything', 'mind-blowing', 'controversial', 'banned', 'illegal'];
    const titleLower = (project.title || project.topic || '').toLowerCase();
    const keywordMatches = viralKeywords.filter(k => titleLower.includes(k)).length;
    score += keywordMatches * 5;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private async computeNicheDemand(project: any): Promise<number> {
    const topic = project.topic || '';
    const trendResearch = project.trendResearch;

    let score = 50;

    if (trendResearch) {
      if (trendResearch.viralScore) {
        score = trendResearch.viralScore * 0.7;
      }

      if (trendResearch.competition !== undefined) {
        const competitionFactor = Math.max(0, 100 - trendResearch.competition);
        score += competitionFactor * 0.3;
      }
    }

    const viralNiches = ['AI', 'finance', 'true crime', 'horror', 'business', 'health', 'money', 'conspiracy', 'technology', 'psychology'];
    for (const niche of viralNiches) {
      if (topic.toLowerCase().includes(niche)) {
        score += 10;
      }
    }

    const recentTrending = await prisma.viralOpportunity.findFirst({
      where: { topic: { contains: topic.substring(0, 30) } },
      orderBy: { viralScore: 'desc' },
    });

    if (recentTrending?.viralScore) {
      score += recentTrending.viralScore * 0.3;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  private async getNicheAverageCTR(niche: string): Promise<number> {
    const projects = await prisma.videoProject.findMany({
      where: { topic: { contains: niche.substring(0, 20) } },
      include: { analytics: true },
      take: 20,
    });

    const withCTR = projects.filter(p => p.analytics && p.analytics!.ctr > 0);
    if (withCTR.length === 0) return 5;

    return withCTR.reduce((s, p) => s + p.analytics!.ctr, 0) / withCTR.length;
  }

  private explainCTRScore(score: number): string {
    if (score >= 80) return 'Excellent CTR potential - thumbnail and title are strongly optimized';
    if (score >= 60) return 'Good CTR potential - minor thumbnail/title improvements possible';
    if (score >= 40) return 'Moderate CTR - needs better thumbnail contrast or title curiosity gap';
    return 'Low CTR - regenerate thumbnail and title with stronger emotional triggers';
  }

  private explainRetentionScore(score: number): string {
    if (score >= 80) return 'Strong retention - pattern interrupts and pacing are well-optimized';
    if (score >= 60) return 'Decent retention - add more curiosity hooks every 20-30 seconds';
    if (score >= 40) return 'Below average retention - script needs restructuring for watch time';
    return 'Poor retention - script likely loses viewers in first 30 seconds';
  }

  private explainEngagementPrediction(score: number): string {
    if (score >= 80) return 'High engagement predicted - strong like/comment/share triggers';
    if (score >= 60) return 'Good engagement - add stronger CTA and discussion prompts';
    if (score >= 40) return 'Moderate engagement - needs better community interaction hooks';
    return 'Low engagement - lacks share triggers and community building elements';
  }

  private explainNicheDemand(score: number): string {
    if (score >= 80) return 'High viral niche demand - topic has strong search volume and low competition';
    if (score >= 60) return 'Good niche demand - trending topic with reasonable competition';
    if (score >= 40) return 'Moderate demand - niche has potential but needs better targeting';
    return 'Low demand - consider pivoting to a higher-demand niche';
  }
}
