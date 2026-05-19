import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { generateHorrorScript } from '../agents/horror/horror-script.agent';
import { HorrorVisualEngine } from '../services/horror/horror-visual.service';
import { HorrorSoundEngine } from '../services/horror/horror-sound.service';
import { HorrorThumbnailGenerator } from '../services/horror/horror-thumbnail.service';
import { HorrorRetentionEngine } from '../services/horror/horror-retention.service';
import { MultiChannelEngine } from '../services/horror/multi-channel.service';
import { UploadEnhancer } from '../services/horror/upload-enhancer.service';
import { AnalyticsSelfImproveEngine } from '../services/horror/analytics-self-improve.service';
import { ViralPredictionEngine } from '../services/viral-prediction-engine.service';
import { QAEngine } from '../services/qa-engine.service';
import { TestingEngine } from '../services/testing-engine.service';
import { SelfImprovingContentEngine } from '../services/self-improving-content.service';
import { ReportingEngine } from '../services/reporting-engine.service';
import { RevenueOptimizationEngine } from '../services/revenue-optimization-engine.service';
import { createVoiceover } from '../agents/voiceover.agent';
import { renderVideo } from '../services/render.service';
import { generateImage } from '../services/image.service';
import { uploadToYouTube } from '../services/youtube.service';
import { getVideoAnalytics } from '../services/youtube.service';
import { optimizeSEO } from '../agents/seo.agent';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';

interface HorrorPipelineOptions {
  projectId: string;
  userId: string;
  topic: string;
  channelId?: string;
  autoUpload?: boolean;
  horrorType?: 'psychological' | 'paranormal' | 'true-crime' | 'analog' | 'supernatural';
}

interface HorrorPipelineResult {
  success: boolean;
  projectId: string;
  script?: string;
  sceneCount?: number;
  voiceoverUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  uploadVideoId?: string;
  channelAssignment?: string;
  analyticsEnabled?: boolean;
  errors: string[];
  warnings: string[];
}

const PIPELINE_TIMEOUT_MS = 30 * 60 * 1000;

interface PipelineContext {
  traceId: string;
  startTime: number;
}

function generateTraceId(): string {
  return `pipe_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class HorrorPipelineService {
  private visualEngine: HorrorVisualEngine;
  private soundEngine: HorrorSoundEngine;
  private thumbnailGen: HorrorThumbnailGenerator;
  private retentionEngine: HorrorRetentionEngine;
  private multiChannel: MultiChannelEngine;
  private uploadEnhancer: UploadEnhancer;
  private analyticsSelfImprove: AnalyticsSelfImproveEngine;
  private viralPrediction: ViralPredictionEngine;
  private qa: QAEngine;
  private testing: TestingEngine;
  private selfImprove: SelfImprovingContentEngine;
  private reporting: ReportingEngine;
  private revenueOpt: RevenueOptimizationEngine;
  private ctx: PipelineContext;

  constructor() {
    this.ctx = { traceId: generateTraceId(), startTime: Date.now() };
    this.visualEngine = new HorrorVisualEngine();
    this.soundEngine = new HorrorSoundEngine();
    this.thumbnailGen = new HorrorThumbnailGenerator();
    this.retentionEngine = new HorrorRetentionEngine();
    this.multiChannel = new MultiChannelEngine();
    this.uploadEnhancer = new UploadEnhancer();
    this.analyticsSelfImprove = new AnalyticsSelfImproveEngine();
    this.viralPrediction = new ViralPredictionEngine();
    this.qa = new QAEngine();
    this.testing = new TestingEngine();
    this.selfImprove = new SelfImprovingContentEngine();
    this.reporting = new ReportingEngine();
    this.revenueOpt = new RevenueOptimizationEngine();
  }

  async runHorrorPipeline(options: HorrorPipelineOptions): Promise<HorrorPipelineResult> {
    this.ctx = { traceId: generateTraceId(), startTime: Date.now() };

    const result: HorrorPipelineResult = {
      success: false,
      projectId: options.projectId,
      errors: [],
      warnings: [],
    };

    logger.info(`[HorrorPipeline][${this.ctx.traceId}] Starting for "${options.topic}" (type: ${options.horrorType || 'psychological'})`);

    const timeout = new Promise<HorrorPipelineResult>((_, reject) => {
      setTimeout(() => reject(new Error(`Pipeline timeout after ${PIPELINE_TIMEOUT_MS / 60000} min`)), PIPELINE_TIMEOUT_MS);
    });

    const pipeline = (async () => {
      await prisma.videoProject.upsert({
        where: { id: options.projectId },
        update: { topic: options.topic, status: 'script_generating' },
        create: {
          id: options.projectId,
          userId: options.userId,
          channelId: options.channelId,
          topic: options.topic,
          status: 'script_generating',
        },
      });

      const guidance = await this.analyticsSelfImprove.generateNextScriptGuidance(
        options.projectId, options.topic
      );

      const enrichedTopic = guidance.length > 0
        ? `${options.topic}\n\nLearning from past performance:\n${guidance.map(g => `- ${g}`).join('\n')}`
        : options.topic;

      const script = await generateHorrorScript(enrichedTopic);
      result.script = script.content;
      result.sceneCount = script.scenes.length;

      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Script generated: ${script.wordCount} words, ${script.scenes.length} scenes`);

      const retentionAnalysis = this.retentionEngine.analyzeRetention(
        script.scenes,
        script.scenes.reduce((s, sc) => s + sc.duration, 0)
      );

      if (retentionAnalysis.score < 50) {
        const optimizedScript = this.retentionEngine.injectRetentionPatterns(
          script.content, script.scenes
        );
        script.content = optimizedScript;
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] Retention patterns injected (score: ${retentionAnalysis.score} → target 50+)`);
      }

      const viralPrediction = await this.viralPrediction.predict(
        options.topic, script.hook, script.content, script.scenes
      );
      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Viral prediction: ${viralPrediction.viralScore}/100 (CTR: ${viralPrediction.ctrPrediction}%, Retention: ${viralPrediction.retentionPrediction}%)`);

      if (!viralPrediction.thresholdMet) {
        logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Viral score ${viralPrediction.viralScore} below threshold ${60} — regenerating script`);
        const enrichedRegenTopic = `${options.topic}\n\nPre-viral optimization needed:\n${viralPrediction.recommendation}`;
        const regenScript = await generateHorrorScript(enrichedRegenTopic);
        script.content = regenScript.content;
        script.hook = regenScript.hook;
        script.scenes = regenScript.scenes;
        script.wordCount = regenScript.wordCount;
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] Script regenerated via viral prediction: ${regenScript.wordCount} words`);

        const regenPrediction = await this.viralPrediction.predict(
          options.topic, script.hook, script.content, script.scenes
        );
        if (!regenPrediction.thresholdMet) {
          result.warnings.push(`Viral score ${regenPrediction.viralScore} still below threshold after regeneration — proceeding with optimizations`);
          logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Regenerated script still below threshold (${regenPrediction.viralScore}) — continuing with caveats`);
        } else {
          logger.info(`[HorrorPipeline][${this.ctx.traceId}] Regenerated script passes viral threshold (${regenPrediction.viralScore})`);
        }
      }

      await prisma.script.upsert({
        where: { projectId: options.projectId },
        update: {
          content: script.content,
          hook: script.hook,
          wordCount: script.wordCount,
          tone: 'horror',
          targetLength: 'long-form',
        },
        create: {
          projectId: options.projectId,
          content: script.content,
          hook: script.hook,
          wordCount: script.wordCount,
          tone: 'horror',
          targetLength: 'long-form',
        },
      });

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'voiceover_generating' },
      });

      const voiceoverResult = await createVoiceover(
        script.content, options.projectId, 'en', 'horror-narrative'
      );
      result.voiceoverUrl = voiceoverResult.audioUrl || undefined;

      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Voiceover: ${voiceoverResult.audioUrl ? 'generated' : 'fallback used'}`);

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'rendering' },
      });

      const visualPlans = script.scenes.map((scene, i) =>
        this.visualEngine.planScene(scene, i, script.scenes.length)
      );

      const enrichedScenes = script.scenes.map((scene, i) => ({
        ...scene,
        visualPrompt: this.visualEngine.generateVisualPrompt(scene, visualPlans[i]),
      }));

      const mood = options.horrorType === 'psychological' ? 'suspense'
        : options.horrorType === 'paranormal' ? 'mystery'
        : options.horrorType === 'true-crime' ? 'dark'
        : 'suspense';

      const outputPath = path.join(process.cwd(), 'uploads', 'videos', `${options.projectId}.mp4`);
      const outputDir = path.dirname(outputPath);
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

      const videoUrl = await renderVideo({
        scenes: enrichedScenes,
        topic: options.topic,
        title: options.topic,
        voiceoverPath: voiceoverResult.audioUrl || undefined,
        outputPath,
        mood,
      });
      result.videoUrl = videoUrl;

      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Video rendered: ${videoUrl}`);

      await this.soundEngine.generateHorrorSoundtrack(
        script.scenes.length,
        script.scenes.reduce((s, sc) => s + sc.duration, 0),
        options.projectId
      );

      await prisma.videoRender.upsert({
        where: { projectId: options.projectId },
        update: { videoUrl, status: 'completed' },
        create: { projectId: options.projectId, videoUrl, status: 'completed' },
      });

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'thumbnail_generating' },
      });

      const concepts = this.thumbnailGen.generateConcepts(options.topic, script.hook);
      const bestConcept = this.thumbnailGen.pickBestConcept(concepts);

      const thumbnailDir = path.join(process.cwd(), 'uploads', 'thumbnails');
      if (!existsSync(thumbnailDir)) mkdirSync(thumbnailDir, { recursive: true });

      const thumbnailPath = path.join(thumbnailDir, `${options.projectId}.png`);
      const generatedThumbnail = await generateImage(bestConcept.prompt, thumbnailPath);
      if (generatedThumbnail) {
        result.thumbnailUrl = `/uploads/thumbnails/${options.projectId}.png`;

        await prisma.thumbnail.upsert({
          where: { projectId: options.projectId },
          update: {
            style: bestConcept.style,
            imageUrl: result.thumbnailUrl,
            ctr: bestConcept.predictedCtr,
            status: 'generated',
          },
          create: {
            projectId: options.projectId,
            style: bestConcept.style,
            imageUrl: result.thumbnailUrl,
            ctr: bestConcept.predictedCtr,
            status: 'generated',
          },
        });
      }

      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Thumbnail: ${bestConcept.style} (predicted CTR: ${bestConcept.predictedCtr}%)`);

      const totalSeconds = enrichedScenes.reduce((s, sc) => s + sc.duration, 0);
      const qaResult = await this.qa.validateVideo(
        script.content,
        enrichedScenes,
        totalSeconds,
        bestConcept.prompt,
        options.topic
      );
      logger.info(`[HorrorPipeline][${this.ctx.traceId}] QA check: ${qaResult.score}% (${qaResult.passed ? 'PASS' : 'FAIL'})`);

      if (!qaResult.passed && qaResult.autoFixAvailable) {
        const fixed = await this.qa.autoFix(script.content, enrichedScenes, qaResult);
        script.content = fixed.fixedScript;
        const enrichedMap = new Map(enrichedScenes.map((s, i) => [i, s.visualPrompt]));
        enrichedScenes.length = 0;
        enrichedScenes.push(...fixed.fixedScenes.map((s, i) => ({
          ...s,
          visualPrompt: enrichedMap.get(i) || '',
        })));
        result.warnings.push(`QA applied ${fixed.fixesApplied.length} fixes`);
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] QA auto-fix: ${fixed.fixesApplied.join(', ')}`);

        const recheckResult = await this.qa.validateVideo(
          script.content, enrichedScenes, totalSeconds, bestConcept.prompt, options.topic
        );
        if (!recheckResult.passed) {
          result.warnings.push(`QA score ${recheckResult.score}% still below threshold after auto-fix — blocking upload`);
          logger.warn(`[HorrorPipeline][${this.ctx.traceId}] QA still failing after auto-fix (${recheckResult.score}%) — blocking upload`);
          options.autoUpload = false;
        }
      } else if (!qaResult.passed) {
        result.warnings.push(`QA score ${qaResult.score}% below threshold with no auto-fix available — blocking upload`);
        logger.warn(`[HorrorPipeline][${this.ctx.traceId}] QA failed with no auto-fix available (${qaResult.score}%) — blocking upload`);
        options.autoUpload = false;
      }

      if (options.autoUpload && voiceoverResult.audioUrl) {
        result.channelAssignment = await this.handleAutoUpload(
          options, script, videoUrl, generatedThumbnail || undefined
        );
      }

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'completed' },
      });

      result.success = true;
      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Complete for "${options.topic}"`);

      if (options.autoUpload) {
        try {
          const report = await this.reporting.generateVideoReport(options.projectId);
          logger.info(`[HorrorPipeline][${this.ctx.traceId}] Video report: score ${report.score}/100, ${report.mistakes.length} issues, revenue est. $${report.estimatedRevenue}`);
        } catch (e: any) {
          logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Report generation skipped: ${e.message}`);
        }
      }

      return result;
    })();

    const raceResult = await Promise.race([pipeline, timeout]).catch(async (err: any) => {
      logger.error(`[HorrorPipeline][${this.ctx.traceId}] Failed: ${err.message}`);
      result.success = false;
      result.errors.push(err.message);

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'failed' },
      }).catch(() => {});

      return result;
    });

    const elapsed = Math.round((Date.now() - this.ctx.startTime) / 1000);
    logger.info(`[HorrorPipeline][${this.ctx.traceId}] Elapsed: ${elapsed}s, success: ${raceResult.success}`);
    return raceResult;
  }

  private async handleAutoUpload(
    options: HorrorPipelineOptions,
    script: Awaited<ReturnType<typeof generateHorrorScript>>,
    videoPath: string,
    thumbnailPath?: string,
  ): Promise<string | undefined> {
    try {
      const seo = await optimizeSEO(options.topic, script.hook);
      let seoTitle = seo.title || options.topic;
      let seoDesc = seo.description || `The terrifying truth about ${options.topic} that nobody talks about. Watch if you dare.`;

      const revenueStrategy = await this.revenueOpt.optimizeForRevenue(
        options.topic, options.horrorType || 'paranormal', script.content, seoDesc
      );
      seoDesc = await this.revenueOpt.optimizeDescription(seoDesc, revenueStrategy);
      if (revenueStrategy.improvements.length > 0) {
        revenueStrategy.improvements.forEach(i => logger.info(`[HorrorPipeline][${this.ctx.traceId}] Revenue: ${i}`));
      }
      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Revenue optimization: RPM $${revenueStrategy.estimatedRPM}, ${revenueStrategy.affiliateProducts.length} affiliates, ${revenueStrategy.optimalAdBreaks.length} ad breaks`);

      const channelAssignment = await this.multiChannel.assignContentToChannel(
        options.projectId,
        options.userId,
        options.topic,
        seoTitle,
        seoDesc,
        seo.tags || [options.topic]
      );

      const channelId = channelAssignment?.channelId || options.channelId;
      const title = channelAssignment?.variation.title || seoTitle;
      const description = channelAssignment?.variation.description || seoDesc;
      const tags = channelAssignment?.variation.tags || seo.tags || [options.topic];

      const videoId = await uploadToYouTube({
        title: title.substring(0, 100),
        description: `${description}\n\n#horror #scary #paranormal #truecrime #creepy`,
        tags: [...new Set([...tags, 'horror', 'scary', 'paranormal', 'true crime'])].slice(0, 15),
        categoryId: '22',
        privacyStatus: 'public',
        videoPath,
        thumbnailPath: thumbnailPath || undefined,
        userId: options.userId,
        channelId,
      });

      logger.info(`[HorrorPipeline][${this.ctx.traceId}] Uploaded to YouTube: ${videoId}`);

      await this.uploadEnhancer.enhanceUpload(
        options.projectId, options.userId, videoId, options.topic
      );

      await prisma.uploadHistory.upsert({
        where: { projectId: options.projectId },
        update: {
          videoId,
          title,
          description,
          tags: tags.join(','),
          status: 'uploaded',
          publishedAt: new Date(),
          channelId,
        },
        create: {
          projectId: options.projectId,
          userId: options.userId,
          channelId,
          videoId,
          title,
          description,
          tags: tags.join(','),
          status: 'uploaded',
          publishedAt: new Date(),
        },
      });

      const existingTests = await prisma.aBTestResult.count({
        where: { projectId: options.projectId },
      });
      if (existingTests === 0) {
        const testVariants = await this.testing.generateVariants(options.topic, script.hook, options.horrorType || 'horror');
        for (const test of testVariants) {
          await prisma.aBTestResult.create({
            data: {
              projectId: options.projectId,
              testType: test.testType,
              variantA: test.variantA as any,
              variantB: test.variantB as any,
              hypothesis: test.hypothesis,
              predictedWinner: test.predictedWinner,
              minSampleSize: test.minSampleSize,
              winner: null,
              confidence: 0,
              status: 'pending',
              ctrA: test.variantA.predictedCTR,
              ctrB: test.variantB.predictedCTR,
              retentionA: test.variantA.predictedRetention,
              retentionB: test.variantB.predictedRetention,
            },
          }).catch(e => logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Failed to create A/B test: ${e.message}`));
        }
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] ${testVariants.length} A/B tests created for project ${options.projectId}`);
      } else {
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] A/B tests already exist for project ${options.projectId} — skipping creation`);
      }

      const analytics = await getVideoAnalytics(videoId, options.userId);
      if (analytics) {
        await prisma.analytics.upsert({
          where: { projectId: options.projectId },
          update: {
            views: analytics.views || 0,
            likes: analytics.likes || 0,
            comments: analytics.comments || 0,
            ctr: analytics.ctr || 0,
            retention: analytics.retention || 0,
            watchTime: analytics.watchTime || 0,
            subscribersGained: analytics.subscribersGained || 0,
          },
          create: {
            projectId: options.projectId,
            views: analytics.views || 0,
            likes: analytics.likes || 0,
            comments: analytics.comments || 0,
            ctr: analytics.ctr || 0,
            retention: analytics.retention || 0,
            watchTime: analytics.watchTime || 0,
            subscribersGained: analytics.subscribersGained || 0,
          },
        });
      }

      try {
        const perf = await this.selfImprove.analyzeVideoPerformance(options.projectId);
        logger.info(`[HorrorPipeline][${this.ctx.traceId}] Self-improvement: ${perf.weakPoints.length} weak points, ${perf.improvementPlan.length} improvements`);
        if (perf.weakPoints.length > 0 || perf.improvementPlan.length > 0) {
          await prisma.analyticsLearning.upsert({
            where: { projectId: options.projectId },
            update: {
              recommendations: { weakPoints: perf.weakPoints, strengths: perf.strengths, improvementPlan: perf.improvementPlan } as any,
              learningIteration: { increment: 1 },
            },
            create: {
              projectId: options.projectId,
              recommendations: { weakPoints: perf.weakPoints, strengths: perf.strengths, improvementPlan: perf.improvementPlan } as any,
            },
          });
        }
      } catch (e: any) {
        logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Self-improve failed: ${e.message}`);
      }

      return channelId;
    } catch (err: any) {
      logger.warn(`[HorrorPipeline][${this.ctx.traceId}] Auto-upload failed: ${err.message}`);
      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'upload_failed' },
      }).catch(() => {});
      return undefined;
    }
  }
}
