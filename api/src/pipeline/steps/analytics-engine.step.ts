import { PipelineStep } from '../pipeline-step';
import { AnalyticsEngineInput, AnalyticsEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { getVideoAnalytics } from '../../services/youtube.service';
import { FeedbackLoopService } from '../../services/feedback-loop.service';
import { ChannelGrowthService } from '../../services/channel-growth.service';
import { CeoService } from '../../services/ceo.service';
import { pipelineLogger } from '../../utils/logger';

const feedbackLoop = new FeedbackLoopService();
const growthService = new ChannelGrowthService();
const ceoService = new CeoService();

export class AnalyticsEngineStep extends PipelineStep<AnalyticsEngineInput, AnalyticsEngineOutput> {
  constructor() {
    super('AnalyticsEngine');
  }

  validate(input: AnalyticsEngineInput): string | null {
    if (!input.upload) return 'Upload data is required before analytics collection';
    if (!input.upload.videoId) return 'videoId is required';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: AnalyticsEngineInput): Promise<AnalyticsEngineOutput> {
    const stats = await getVideoAnalytics(input.upload.videoId, input.userId);

    if (!stats) {
      throw new Error('No analytics data returned from YouTube');
    }

    await prisma.analytics.upsert({
      where: { projectId: input.projectId },
      update: {
        views: stats.views || 0,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        ctr: stats.ctr || 0,
        retention: stats.retention || 0,
        watchTime: stats.watchTime || 0,
        subscribersGained: stats.subscribersGained || 0,
        impressions: stats.impressions || 0,
        avgViewDuration: stats.avgViewDuration || 0,
        collectedAt: new Date(),
      },
      create: {
        projectId: input.projectId,
        views: stats.views || 0,
        likes: stats.likes || 0,
        comments: stats.comments || 0,
        shares: stats.shares || 0,
        ctr: stats.ctr || 0,
        retention: stats.retention || 0,
        watchTime: stats.watchTime || 0,
        subscribersGained: stats.subscribersGained || 0,
        impressions: stats.impressions || 0,
        avgViewDuration: stats.avgViewDuration || 0,
        collectedAt: new Date(),
      },
    });

    feedbackLoop.analyzeAfterUpload(input.projectId).then(analysis => {
      if (analysis) {
        feedbackLoop.updateScriptPromptsBasedOnPerformance(input.projectId).catch(err =>
          pipelineLogger.error(`Feedback loop update failed for ${input.projectId}: ${err.message}`)
        );
      }
    }).catch(err =>
      pipelineLogger.error(`Feedback loop analysis failed for ${input.projectId}: ${err.message}`)
    );

    // Growth intelligence loop — learns from every upload
    growthService.learnFromPerformance(input.projectId).catch(err =>
      pipelineLogger.error(`Growth learning loop failed for ${input.projectId}: ${err.message}`)
    );

    // Full channel growth cycle (fire-and-forget, non-blocking)
    prisma.videoProject.findUnique({
      where: { id: input.projectId },
      select: { channelId: true },
    }).then(project => {
      if (project?.channelId) {
        growthService.runFullGrowthCycle(project.channelId).catch(err =>
          pipelineLogger.error(`Full growth cycle failed for channel ${project.channelId}: ${err.message}`)
        );

        // CEO-level orchestration cycle — executes after growth cycle
        ceoService.runFullCeoCycle(project.channelId).catch(err =>
          pipelineLogger.error(`CEO cycle failed for channel ${project.channelId}: ${err.message}`)
        );
      }
    }).catch(() => {});

    return {
      analyticsId: input.projectId,
      views: stats.views || 0,
      ctr: stats.ctr || 0,
      retention: stats.retention || 0,
    };
  }

  async fallback(input: AnalyticsEngineInput, error: Error): Promise<AnalyticsEngineOutput> {
    pipelineLogger.warn(`Analytics collection failed for ${input.projectId}: ${error.message}`);
    throw new Error(`Analytics collection failed: ${error.message}`);
  }
}
