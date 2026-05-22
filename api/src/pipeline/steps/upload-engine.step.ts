import { existsSync } from 'fs';
import { join } from 'path';
import { PipelineStep } from '../pipeline-step';
import { UploadEngineInput, UploadEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { uploadToYouTube } from '../../services/youtube.service';
import { optimizeSEO } from '../../agents/seo.agent';
import { activateFallback, queueUploadForFallback } from '../../services/youtube-fallback.service';
import { ViralScoreService } from '../../services/viral-score.service';
import { CTROptimizationEngine } from '../../services/ctr-optimization-engine.service';
import { ThumbnailIntelligence } from '../../services/thumbnail-intelligence.service';
import { RevenueMultiplier } from '../../services/revenue-multiplier.service';
import { SmartExperimentation } from '../../services/smart-experimentation.service';
import { OutputValidationGate } from '../../services/output-validation.service';
import { PreUploadValidationGate } from '../../services/pre-upload-validation.service';
import { parseScriptScenes } from '../../utils/helpers';
import { logger } from '../../utils/logger';
import { MonetizationOrchestrator } from '../../services/monetization/monetization-orchestrator.service';

export class UploadEngineStep extends PipelineStep<UploadEngineInput, UploadEngineOutput> {
  private viralScoreService: ViralScoreService;
  private ctrEngine: CTROptimizationEngine;
  private thumbnailIntel: ThumbnailIntelligence;
  private revenueMultiplier: RevenueMultiplier;
  private experimentation: SmartExperimentation;
  private validationGate: OutputValidationGate;
  private preUploadGate: PreUploadValidationGate;
  private monetizationOrchestrator: MonetizationOrchestrator;

  constructor() {
    super('UploadEngine');
    this.viralScoreService = new ViralScoreService();
    this.ctrEngine = new CTROptimizationEngine();
    this.thumbnailIntel = new ThumbnailIntelligence();
    this.revenueMultiplier = new RevenueMultiplier();
    this.experimentation = new SmartExperimentation();
    this.validationGate = new OutputValidationGate();
    this.preUploadGate = new PreUploadValidationGate();
    this.monetizationOrchestrator = new MonetizationOrchestrator();
  }

  validate(input: UploadEngineInput): string | null {
    if (!input.video) return 'Video render is required before upload';
    if (!input.video.videoUrl) return 'Video URL is missing';
    if (!input.thumbnail?.imageUrl) return 'Thumbnail is required before upload';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: UploadEngineInput): Promise<UploadEngineOutput> {
    const gate = await this.viralScoreService.getUploadGateResult(input.projectId);
    if (!gate.allowed) {
      const errMsg = `VIRAL SCORE GATE: Upload blocked for ${input.projectId}. Score: ${gate.score.viralScore}/${gate.score.threshold}. Action: ${gate.score.recommendedAction}`;
      logger.warn(`[UploadGate] ${errMsg}`);
      await prisma.videoProject.update({
        where: { id: input.projectId },
        data: { status: 'viral_score_blocked', viralScore: gate.score.viralScore },
      });
      if (gate.score.recommendedAction === 'reject-regenerate') {
        throw new Error(`UPLOAD_BLOCKED: ${errMsg}. Script must be regenerated with higher viral potential.`);
      }
    }

    let seo = await optimizeSEO(input.topic, input.script.hook);

    const titleVariants = await this.ctrEngine.generateAndScoreTitles(input.topic, input.script.hook);
    const bestTitle = await this.ctrEngine.selectBestTitle(titleVariants);
    seo.title = bestTitle.title;

    let description = seo.description || `Watch this ${input.topic} video`;

    const revenueResult = await this.revenueMultiplier.optimizeDescriptionForRevenue(
      description,
      input.topic,
      seo.tags || []
    );
    description = revenueResult.description;

    if (seo.title) {
      await prisma.videoProject.update({
        where: { id: input.projectId },
        data: { title: seo.title, description },
      });
    }

    const experiments = await this.experimentation.designExperiment(input.projectId, input.topic);
    for (const exp of experiments) {
      try {
        await prisma.aBTestResult.create({
          data: {
            projectId: input.projectId,
            testType: exp.testType,
            variantA: exp.variantA,
            variantB: exp.variantB,
            status: 'running',
            metadata: { hypothesis: exp.hypothesis, predictedWinner: exp.predictedWinner },
          },
        });
      } catch {}
    }

    const scenes = parseScriptScenes(input.script.content);
    const videoPath = input.video.videoUrl.startsWith('/')
      ? join(process.cwd(), input.video.videoUrl.replace(/^\//, ''))
      : input.video.videoUrl;

    const thumbnailPath = input.thumbnail.imageUrl!.startsWith('/')
      ? join(process.cwd(), input.thumbnail.imageUrl!.replace(/^\//, ''))
      : input.thumbnail.imageUrl!;

    const preUpload = await this.preUploadGate.validate({
      videoPath,
      thumbnailPath: input.thumbnail.imageUrl,
      requireThumbnail: true,
    });
    if (!preUpload.passed) {
      const errMsg = `PRE-UPLOAD BLOCKED: ${preUpload.blockers.join(', ')}`;
      logger.error(`[UploadGate] ${errMsg}`);
      await prisma.videoProject.update({
        where: { id: input.projectId },
        data: { status: 'validation_failed' },
      });
      throw new Error(`UPLOAD_BLOCKED: ${errMsg}`);
    }

    const validation = await this.validationGate.validateVideo(videoPath, scenes, undefined, input.topic);
    if (!validation.passed) {
      const blockerNames = validation.checks.filter(c => !c.passed && c.severity === 'block').map(c => c.name);
      throw new Error(`UPLOAD_BLOCKED: ${validation.summary} (${blockerNames.join(', ')})`);
    }
    logger.info(`[UploadGate] ${validation.summary}`);

    const videoId = await uploadToYouTube({
      title: seo.title || input.topic,
      description: description,
      tags: seo.tags || [input.topic],
      categoryId: '22',
      privacyStatus: 'public',
      videoPath,
      thumbnailPath,
      userId: input.userId,
      channelId: input.channelId,
    });

    logger.info(`[UploadEngine] Video ${videoId} uploaded. Building monetization funnel...`);

    try {
      const monetizationResult = await this.monetizationOrchestrator.prepareMonetization(
        input.projectId,
        videoId,
        input.topic,
        seo.tags || [input.topic],
        undefined,
        input.script?.scenes?.length && input.script.scenes.length < 5 ? 'shorts' : 'long-form'
      );

      description = `🔗 ${monetizationResult.affiliateLinks.map((l, i) =>
        `${i + 1}. ${l.productName}: ${l.utmUrl}`
      ).join('\n')}\n\n${description}`;

      logger.info(`[UploadEngine] Monetization ready: ${monetizationResult.affiliateProducts.length} products, funnel built, CTA optimized`);
    } catch (err: any) {
      if (err.message?.includes('MONETIZATION_GATE_BLOCKED')) {
        logger.warn(`[UploadEngine] Monetization gate blocked for ${input.projectId}: ${err.message}`);
        logger.warn(`[UploadEngine] Publishing without monetization (ad-only mode)`);
      } else {
        logger.warn(`[UploadEngine] Monetization setup failed (non-critical): ${err.message}`);
      }
    }

    await prisma.uploadHistory.upsert({
      where: { projectId: input.projectId },
      update: {
        videoId,
        title: seo.title || input.topic,
        description: description,
        tags: (seo.tags || []).join(','),
        status: 'uploaded',
        publishedAt: new Date(),
      },
      create: {
        projectId: input.projectId,
        userId: input.userId,
        channelId: input.channelId,
        videoId,
        title: seo.title || input.topic,
        description: description,
        tags: (seo.tags || []).join(','),
        status: 'uploaded',
        publishedAt: new Date(),
      },
    });

    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'published', viralScore: gate.score.viralScore },
    });

    logger.info(`[UploadEngine] Published ${videoId} with viralScore=${gate.score.viralScore}, ${experiments.length} experiments`);

    return {
      uploadId: input.projectId,
      videoId,
      publishedAt: new Date(),
    };
  }

  async fallback(input: UploadEngineInput, error: Error): Promise<UploadEngineOutput> {
    await activateFallback('unknown_oauth', error).catch(() => {});
    await queueUploadForFallback(input.projectId, input.userId).catch(() => {});
    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'upload_failed' },
    }).catch(() => {});
    throw new Error(`YouTube upload failed after retries: ${error.message}`);
  }
}
