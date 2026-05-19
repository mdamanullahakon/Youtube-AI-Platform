import { PipelineStep } from '../pipeline-step';
import { ThumbnailEngineInput, ThumbnailEngineOutput } from '../pipeline.types';
import { generateThumbnail } from '../../agents/thumbnail.agent';
import { ThumbnailIntelligence } from '../../services/thumbnail-intelligence.service';
import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';

export class ThumbnailEngineStep extends PipelineStep<ThumbnailEngineInput, ThumbnailEngineOutput> {
  private thumbnailIntel: ThumbnailIntelligence;

  constructor() {
    super('ThumbnailEngine');
    this.thumbnailIntel = new ThumbnailIntelligence();
  }

  validate(input: ThumbnailEngineInput): string | null {
    if (!input.script) return 'Script is required';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: ThumbnailEngineInput): Promise<ThumbnailEngineOutput> {
    const concepts = await this.thumbnailIntel.generateMultipleConcepts(
      input.topic,
      input.script.hook
    );

    const bestConcept = await this.thumbnailIntel.pickBestConcept(concepts);

    logger.info(`[ThumbnailEngine] Selected concept: ${bestConcept.style} (score: ${bestConcept.overallScore}) from ${concepts.length} variants`);

    const thumbnail = await generateThumbnail(
      `${input.topic}: ${bestConcept.prompt.substring(0, 200)}`,
      bestConcept.textOverlay || input.script.hook,
      input.projectId
    );

    await prisma.thumbnail.upsert({
      where: { projectId: input.projectId },
      update: {
        style: bestConcept.style,
        imageUrl: thumbnail.imageUrl || null,
        ctr: bestConcept.overallScore,
        status: 'generated',
      },
      create: {
        projectId: input.projectId,
        style: bestConcept.style,
        imageUrl: thumbnail.imageUrl || null,
        ctr: bestConcept.overallScore,
        status: 'generated',
      },
    });

    await this.thumbnailIntel.recordThumbnailPerformance(
      input.projectId,
      bestConcept.style,
      bestConcept.overallScore,
      0,
      0
    );

    return {
      thumbnailId: input.projectId,
      imageUrl: thumbnail.imageUrl || null,
      style: bestConcept.style,
      predictedCtr: bestConcept.overallScore,
    };
  }

  async fallback(input: ThumbnailEngineInput, _error: Error): Promise<ThumbnailEngineOutput> {
    return {
      thumbnailId: input.projectId,
      imageUrl: null,
      style: 'high-contrast-shock',
      predictedCtr: 5.0,
    };
  }
}
