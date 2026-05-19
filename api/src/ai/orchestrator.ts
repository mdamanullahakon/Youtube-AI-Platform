import { aiLogger } from '../utils/logger';
import { prisma } from '../config/db';
import { PipelineOrchestrator } from '../pipeline/pipeline-orchestrator.service';

export class AIOrchestrator {
  private projectId: string;
  private channelId?: string;
  private userId: string;

  constructor(projectId: string, channelId?: string, userId?: string) {
    this.projectId = projectId;
    this.channelId = channelId;
    this.userId = userId || 'system';
  }

  async getProgress(): Promise<number> {
    try {
      const project = await prisma.videoProject.findUnique({
        where: { id: this.projectId },
        include: {
          trendResearch: true,
          script: true,
          thumbnail: true,
          voiceover: true,
          videoRender: true,
          uploadHistory: true,
          analytics: true,
        },
      });
      if (!project) return 0;

      switch (project.status) {
        case 'published': return 100;
        case 'uploaded': return 90;
        case 'uploading': return 85;
        case 'rendered': return 75;
        case 'rendering': return 65;
        case 'script_generated': return 40;
        case 'running': return 20;
        case 'draft': return 5;
        case 'failed': return -1;
      }

      if (project.analytics) return 100;
      if (project.uploadHistory?.status === 'uploaded') return 95;
      if (project.videoRender?.status === 'completed') return 75;
      if (project.videoRender?.status === 'rendering') return 60;
      if (project.script && project.thumbnail && project.voiceover) return 50;
      if (project.script) return 35;
      if (project.trendResearch) return 15;
      return 5;
    } catch {
      return 0;
    }
  }

  async runFullPipeline(topic: string): Promise<Record<string, unknown>> {
    aiLogger.info(`Running deterministic pipeline for project ${this.projectId}: ${topic}`);

    const orchestrator = new PipelineOrchestrator(
      this.projectId,
      this.userId,
      topic,
      this.channelId,
    );

    const context = await orchestrator.run();

    return {
      projectId: this.projectId,
      status: context.status,
      progress: orchestrator.getProgress(),
      steps: Object.entries(context.steps).map(([name, result]) => ({
        step: name,
        status: result.status,
        retries: result.retries,
        fallbackUsed: result.fallbackUsed,
        durationMs: result.durationMs,
        error: result.error,
      })),
      durationMs: context.completedAt ? context.completedAt - context.startedAt : null,
    };
  }
}

export async function createCrew(projectId: string, channelId?: string, userId?: string): Promise<AIOrchestrator> {
  return new AIOrchestrator(projectId, channelId, userId);
}
