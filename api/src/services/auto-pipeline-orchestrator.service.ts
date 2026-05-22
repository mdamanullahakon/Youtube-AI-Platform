/**
 * @deprecated Use canonical-pipeline.service (sync PipelineOrchestrator) for all production automation.
 */
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { uploadToYouTube } from './youtube.service';
import { MultiChannelRotator } from './multi-channel-rotator.service';
import { ViralLearningLoop } from './viral-learning-loop.service';
import { RevenueTracker } from './revenue-tracker.service';
import { checkpointService } from './checkpoint.service';
import { resolveFontPath, escapeFontPath } from '../config/font-resolver';
import { detectGpuEncoder, isGpuAvailable } from '../utils/helpers';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'temp/auto-pipeline';

interface AutoPipelineResult {
  success: boolean;
  videoId?: string;
  channelId?: string;
  topic?: string;
  renderPath?: string;
  error?: string;
  estimatedRevenue?: number;
  viralScore?: number;
  duration?: number;
}

export class AutoPipelineOrchestrator {
  private channelRotator: MultiChannelRotator;
  private learningLoop: ViralLearningLoop;
  private revenueTracker: RevenueTracker;

  constructor() {
    this.channelRotator = new MultiChannelRotator();
    this.learningLoop = new ViralLearningLoop();
    this.revenueTracker = new RevenueTracker();
  }

  async runDaily(userId: string): Promise<AutoPipelineResult> {
    logger.info('[PIPELINE_TRACE] ═══════════════════════════════════════');
    logger.info('[PIPELINE_TRACE]  AUTO PIPELINE DAILY RUN STARTED');
    logger.info('[PIPELINE_TRACE] ═══════════════════════════════════════');

    const projectId = `auto_${userId}_${Date.now()}`;

    try {
      // ─── Checkpoint: Initialize pipeline ────────────────────────────────
      await checkpointService.initialize(projectId);

      // ─── Step 1: Select best channel ──────────────────────────────────────
      await checkpointService.start(projectId, 'TREND_ANALYSIS');
      logger.info('[PIPELINE_TRACE] Step 1: Selecting best channel...');
      const channel = await this.channelRotator.selectBestChannel(userId);
      if (!channel) {
        logger.warn('[PIPELINE_TRACE] No connected YouTube channels found');
        await checkpointService.fail(projectId, 'TREND_ANALYSIS', 'No connected YouTube channels');
        return { success: false, error: 'No connected YouTube channels' };
      }
      logger.info(`[PIPELINE_TRACE] Channel selected: ${channel.channelId}`);
      await checkpointService.complete(projectId, 'TREND_ANALYSIS');

      // ─── Step 2: Pick best topic ─────────────────────────────────────────
      await checkpointService.start(projectId, 'SCRIPT_GENERATION');
      logger.info('[PIPELINE_TRACE] Step 2: Selecting best topic...');
      let topic = await this.learningLoop.getBestTopicForToday();
      if (!topic) {
        const topics = [
          'How AI is changing content creation in 2026',
          'The future of autonomous YouTube channels',
          'Why AI-generated videos are the next big thing',
          'How to automate your entire YouTube channel',
          'The rise of AI content creators',
        ];
        topic = topics[Math.floor(Math.random() * topics.length)];
      }
      logger.info(`[PIPELINE_TRACE] Topic selected: "${topic}"`);

      // ─── Step 3: Create project ───────────────────────────────────────────
      const project = await prisma.videoProject.create({
        data: { userId, topic, status: 'processing' },
      });
      logger.info(`[PIPELINE_TRACE] Project created: ${project.id}`);

      // ─── Step 4: Generate script ──────────────────────────────────────────
      const scriptContent = `[${topic} | 10 | cinematic establishing shot of AI technology]
[AI systems are transforming how content is created and distributed across the internet. | 12 | footage of neural networks and data streams]
[Content creators who embrace AI tools are seeing unprecedented growth in their channels. | 10 | time-lapse of creator workspace with AI tools]
[The key is understanding how to combine human creativity with machine efficiency. | 10 | split screen human and AI collaboration]
[By automating repetitive tasks, creators can focus on what matters most: great content. | 8 | creator working passionately on content]
[The future belongs to those who adapt and leverage these powerful new tools. | 10 | futuristic cityscape with digital overlays]
[Start your AI-powered content journey today and stay ahead of the curve. | 8 | inspiring sunset with text overlay]`;

      const script = await prisma.script.create({
        data: {
          projectId: project.id,
          content: scriptContent,
          wordCount: scriptContent.split(' ').length,
          hook: scriptContent.split('\n')[0]?.replace(/\[.*?\]/g, '').trim() || topic,
        },
      });
      logger.info(`[PIPELINE_TRACE] Script generated: ${script.id}`);
      await checkpointService.complete(projectId, 'SCRIPT_GENERATION', { projectId: project.id });

      // ─── Step 5: Render video ─────────────────────────────────────────────
      await checkpointService.start(projectId, 'VIDEO_RENDER');
      logger.info('[PIPELINE_TRACE] Step 5: Rendering video...');
      const { randomUUID } = await import('crypto');
      const fs = await import('fs');
      const path = await import('path');
      const { promisify } = await import('util');
      const execAsync = promisify(require('child_process').exec);

      const outputDir = path.join(process.cwd(), OUTPUT_DIR);
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const renderId = randomUUID().slice(0, 8);
      const outputPath = path.join(outputDir, `auto_${renderId}.mp4`);
      const duration = 68;
      const safeTitle = topic.substring(0, 50).replace(/:/g, '\uFF1A').replace(/'/g, "'\\''");

      const fontPath = resolveFontPath();
      const fontFile = escapeFontPath(fontPath);

      const encoder = await detectGpuEncoder(FFMPEG);
      const codec = isGpuAvailable(encoder) ? `-c:v ${encoder} -preset p7 -cq 23` : '-c:v libx264 -preset ultrafast -crf 24';

      const renderCmd = [
        `"${FFMPEG}"`,
        `-f lavfi -i "color=c=0x1a1a3e:s=1920x1080:d=${duration}:r=30,format=rgba"`,
        `-vf "`,
        `drawtext=text='${safeTitle}':x=(w-text_w)/2:y='(h-text_h)/2-40':fontsize=48:fontcolor=white:`,
        `shadowx=2:shadowy=2:shadowcolor=black@0.5:fontfile='${fontFile}',`,
        `drawtext=text='AI Generated Content':x=(w-text_w)/2:y='(h-text_h)/2+20':fontsize=36:fontcolor=white:`,
        `shadowx=2:shadowy=2:shadowcolor=black@0.5:fontfile='${fontFile}',`,
        `drawtext=text='%{eif\\\\:n+1\\\\:d}':x=w-tw-20:y=h-th-20:fontsize=24:fontcolor=white@0.3:fontfile='${fontFile}'"`,
        `${codec} -pix_fmt yuv420p "${outputPath}" -y`,
      ].join(' ');

      logger.info(`[PIPELINE_TRACE] Render started: ${outputPath}`);
      await execAsync(renderCmd, { timeout: 300000 });
      logger.info('[PIPELINE_TRACE] Render success');

      // ─── Step 6: Validate output ──────────────────────────────────────────
      logger.info('[PIPELINE_TRACE] Step 6: Validating output...');
      if (!fs.existsSync(outputPath)) {
        throw new Error('Render produced no output file');
      }
      const fileSize = fs.statSync(outputPath).size;
      logger.info(`[PIPELINE_TRACE] File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      if (fileSize < 1024 * 1024) {
        logger.warn(`[PIPELINE_TRACE] File size ${(fileSize / 1024).toFixed(0)} KB < 1MB — quality may be poor`);
      }

      let probeStdout = '';
      try {
        const { stdout } = await execAsync(
          `"${FFPROBE}" -v error -show_entries format=duration:stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${outputPath}"`,
          { timeout: 10000 },
        );
        probeStdout = stdout;
      } catch (e: any) {
        throw new Error(`ffprobe validation failed: ${e.message}`);
      }

      const lines = probeStdout.trim().split('\n').filter(Boolean);
      const hasVideo = lines.includes('video');
      const durationLine = lines.find((l: string) => l.includes('.'));
      const outputDuration = durationLine ? parseFloat(durationLine) : 0;

      if (!hasVideo || outputDuration < 3) {
        throw new Error('Output file is not a valid mp4');
      }
      logger.info(`[PIPELINE_TRACE] Validation passed: ${outputDuration.toFixed(1)}s, video stream: ${hasVideo}`);

      await prisma.videoRender.create({
        data: {
          projectId: project.id,
          videoUrl: outputPath,
          status: 'completed',
          progress: 100,
          duration: Math.round(outputDuration),
        },
      }).catch(() => {});
      await checkpointService.complete(projectId, 'VIDEO_RENDER', { outputPath, duration: outputDuration });

      // ─── Step 7: Upload to YouTube with retry chain ───────────────────────
      await checkpointService.start(projectId, 'YOUTUBE_UPLOAD');
      logger.info('[PIPELINE_TRACE] Step 7: Uploading to YouTube...');
      const description = `${topic}\n\nThis video was generated and uploaded automatically by YouTube AI Platform.\n\n#AI #Automation #ContentCreation`;

      let youtubeVideoId = '';
      const uploadAttempts = [
        { delay: 0, label: 'immediate' },
        { delay: 5000, label: 'retry-5s' },
        { delay: 15000, label: 'retry-15s' },
      ];

      for (const attempt of uploadAttempts) {
        if (attempt.delay > 0) await new Promise(r => setTimeout(r, attempt.delay));
        try {
          youtubeVideoId = await uploadToYouTube({
            title: topic,
            description,
            tags: ['AI', 'Automation', 'Content Creation', 'Technology'],
            privacyStatus: 'public',
            videoPath: outputPath,
            userId,
            channelId: channel.channelId,
          });
          logger.info(`[PIPELINE_TRACE] Upload success (${attempt.label}): ${youtubeVideoId}`);
          break;
        } catch (err: any) {
          logger.warn(`[PIPELINE_TRACE] Upload attempt ${attempt.label} failed: ${err.message}`);
          if (attempt.label === uploadAttempts[uploadAttempts.length - 1].label) {
            throw err;
          }
        }
      }

      await prisma.uploadHistory.create({
        data: {
          projectId: project.id,
          videoId: youtubeVideoId,
          title: topic,
          status: 'completed',
          userId,
        },
      }).catch(() => {});

      await prisma.videoProject.update({
        where: { id: project.id },
        data: { status: 'published' },
      }).catch(() => {});
      await checkpointService.complete(projectId, 'YOUTUBE_UPLOAD', { videoId: youtubeVideoId });

      // ─── Step 8: Track revenue ──────────────────────────────────────────
      await checkpointService.start(projectId, 'ANALYTICS_SYNC');
      logger.info('[REVENUE_ESTIMATE] Step 8: Estimating revenue...');
      const revenue = await this.revenueTracker.estimateRevenue(project.id);

      logger.info('[VIRAL_SCORE] Step 9: Recording viral performance...');
      await this.learningLoop.recordPerformance(project.id, youtubeVideoId);
      await checkpointService.complete(projectId, 'ANALYTICS_SYNC', { revenue: revenue?.estimatedRevenue || 0 });

      // ─── Cleanup ─────────────────────────────────────────────────────────
      try { fs.unlinkSync(outputPath); } catch {}

      const result: AutoPipelineResult = {
        success: true,
        videoId: youtubeVideoId,
        channelId: channel.channelId,
        topic,
        estimatedRevenue: revenue?.estimatedRevenue || 0,
        viralScore: 0,
        duration: Math.round(outputDuration),
      };

      logger.info('[PIPELINE_TRACE] ═══════════════════════════════════════');
      logger.info('[PIPELINE_TRACE]  AUTO PIPELINE COMPLETED');
      logger.info('[PIPELINE_TRACE] ═══════════════════════════════════════');
      logger.info(`[PIPELINE_TRACE]  ✔ Video Generated: ${topic}`);
      logger.info(`[PIPELINE_TRACE]  ✔ Render Success: ${outputPath}`);
      logger.info(`[PIPELINE_TRACE]  ✔ Upload Success: ${youtubeVideoId}`);
      logger.info(`[PIPELINE_TRACE]  ✔ Channel Used: ${channel.channelId}`);
      logger.info(`[PIPELINE_TRACE]  ✔ Video URL: https://youtube.com/watch?v=${youtubeVideoId}`);
      logger.info(`[PIPELINE_TRACE]  ✔ Estimated Revenue: $${(revenue?.estimatedRevenue || 0).toFixed(2)}`);
      logger.info('[PIPELINE_TRACE] ═══════════════════════════════════════');

      return result;
    } catch (err: any) {
      logger.error(`[PIPELINE_TRACE] ✘ Pipeline failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
}
