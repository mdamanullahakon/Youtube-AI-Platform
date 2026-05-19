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

export class HorrorPipelineService {
  private visualEngine: HorrorVisualEngine;
  private soundEngine: HorrorSoundEngine;
  private thumbnailGen: HorrorThumbnailGenerator;
  private retentionEngine: HorrorRetentionEngine;
  private multiChannel: MultiChannelEngine;
  private uploadEnhancer: UploadEnhancer;
  private analyticsSelfImprove: AnalyticsSelfImproveEngine;

  constructor() {
    this.visualEngine = new HorrorVisualEngine();
    this.soundEngine = new HorrorSoundEngine();
    this.thumbnailGen = new HorrorThumbnailGenerator();
    this.retentionEngine = new HorrorRetentionEngine();
    this.multiChannel = new MultiChannelEngine();
    this.uploadEnhancer = new UploadEnhancer();
    this.analyticsSelfImprove = new AnalyticsSelfImproveEngine();
  }

  async runHorrorPipeline(options: HorrorPipelineOptions): Promise<HorrorPipelineResult> {
    const result: HorrorPipelineResult = {
      success: false,
      projectId: options.projectId,
      errors: [],
      warnings: [],
    };

    logger.info(`[HorrorPipeline] Starting for "${options.topic}" (type: ${options.horrorType || 'psychological'})`);

    try {
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

      logger.info(`[HorrorPipeline] Script generated: ${script.wordCount} words, ${script.scenes.length} scenes`);

      const retentionAnalysis = this.retentionEngine.analyzeRetention(
        script.scenes,
        script.scenes.reduce((s, sc) => s + sc.duration, 0)
      );

      if (retentionAnalysis.score < 50) {
        const optimizedScript = this.retentionEngine.injectRetentionPatterns(
          script.content, script.scenes
        );
        script.content = optimizedScript;
        logger.info(`[HorrorPipeline] Retention patterns injected (score: ${retentionAnalysis.score} → target 50+)`);
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

      logger.info(`[HorrorPipeline] Voiceover: ${voiceoverResult.audioUrl ? 'generated' : 'fallback used'}`);

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

      logger.info(`[HorrorPipeline] Video rendered: ${videoUrl}`);

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

      logger.info(`[HorrorPipeline] Thumbnail: ${bestConcept.style} (predicted CTR: ${bestConcept.predictedCtr}%)`);

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
      logger.info(`[HorrorPipeline] Complete for "${options.topic}"`);
      return result;

    } catch (err: any) {
      logger.error(`[HorrorPipeline] Failed: ${err.message}`);
      result.success = false;
      result.errors.push(err.message);

      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'failed' },
      }).catch(() => {});

      return result;
    }
  }

  private async handleAutoUpload(
    options: HorrorPipelineOptions,
    script: Awaited<ReturnType<typeof generateHorrorScript>>,
    videoPath: string,
    thumbnailPath?: string,
  ): Promise<string | undefined> {
    try {
      const seo = await optimizeSEO(options.topic, script.hook);
      const seoTitle = seo.title || options.topic;
      const seoDesc = seo.description || `The terrifying truth about ${options.topic} that nobody talks about. Watch if you dare.`;

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

      logger.info(`[HorrorPipeline] Uploaded to YouTube: ${videoId}`);

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

      await this.analyticsSelfImprove.analyzePastPerformance(options.topic)
        .then(async (perf) => {
          logger.info(`[HorrorPipeline] Self-improvement: ${perf.insights.length} insights, ${perf.improvements.length} improvements queued`);
          await prisma.analyticsLearning.upsert({
            where: { projectId: options.projectId },
            update: {
              recommendations: perf as any,
              learningIteration: { increment: 1 },
            },
            create: {
              projectId: options.projectId,
              recommendations: perf as any,
            },
          });
        })
        .catch(() => {});

      return channelId;
    } catch (err: any) {
      logger.warn(`[HorrorPipeline] Auto-upload failed: ${err.message}`);
      await prisma.videoProject.update({
        where: { id: options.projectId },
        data: { status: 'upload_failed' },
      }).catch(() => {});
      return undefined;
    }
  }
}
