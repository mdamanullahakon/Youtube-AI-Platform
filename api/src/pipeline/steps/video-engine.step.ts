import path from 'path';
import { existsSync } from 'fs';
import { stat } from 'fs/promises';
import { PipelineStep } from '../pipeline-step';
import { VideoEngineInput, VideoEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { renderVideo } from '../../services/render.service';
import { parseScriptScenes } from '../../utils/helpers';
import { ViralQualityEngine } from '../../services/viral-quality.service';
import { logger } from '../../utils/logger';
import { validateVoiceoverAudioFile } from '../audio-validation';
import { detectMoodFromTopic } from '../../services/cinematic-effects';

export class VideoEngineStep extends PipelineStep<VideoEngineInput, VideoEngineOutput> {
  private viralQuality: ViralQualityEngine;

  constructor() {
    super('VideoEngine');
    this.viralQuality = new ViralQualityEngine();
  }

  validate(input: VideoEngineInput): string | null {
    if (!input.script) return 'Script is required for video rendering';
    if (!input.script.content) return 'Script content is empty';
    if (!input.projectId) return 'projectId is required';
    if (!input.voiceover?.audioUrl) return 'Voiceover audio is required before video rendering';
    return null;
  }

  protected async execute(input: VideoEngineInput): Promise<VideoEngineOutput> {
    const scenes = parseScriptScenes(input.script.content);
    if (scenes.length === 0) {
      throw new Error('No scenes could be parsed from the script');
    }

    const arcScenes = this.viralQuality.enforceEmotionalArc(scenes);
    const optimizedScenes = this.viralQuality.optimizeScenePacing(arcScenes);

    const hookCheck = this.viralQuality.validateHook(optimizedScenes[0].text);
    if (!hookCheck.valid) {
      logger.warn(`[VideoEngine] Hook validation score ${hookCheck.score} - issues: ${hookCheck.issues.join(', ')}`);
      const hookText = this.viralQuality.generateHook(input.topic, []).text;
      optimizedScenes.unshift({
        text: hookText,
        duration: 8,
        visualPrompt: 'dramatic hook establishing shot',
      });
    }

    const visualsCheck = this.viralQuality.checkVisualVariety(optimizedScenes);
    if (!visualsCheck.valid) {
      logger.warn(`[VideoEngine] Visual variety issue: ${visualsCheck.issues.join('; ')}`);
    }

    const moodFromTopic = input.topic?.toLowerCase().includes('true crime') || input.topic?.toLowerCase().includes('horror')
      ? 'suspense'
      : input.topic?.toLowerCase().includes('success') || input.topic?.toLowerCase().includes('motivation')
        ? 'energetic'
        : input.topic?.toLowerCase().includes('tutorial') || input.topic?.toLowerCase().includes('guide')
          ? 'calm'
          : 'story';

    const outputPath = path.join(process.cwd(), 'uploads', 'videos', `${input.projectId}.mp4`);

    const voiceoverPath = await validateVoiceoverAudioFile(input.voiceover!.audioUrl);

    await renderVideo({
      scenes: optimizedScenes,
      topic: input.topic,
      title: input.topic,
      voiceoverPath,
      outputPath,
      mood: detectMoodFromTopic(input.topic || '') || moodFromTopic,
    });

    if (!existsSync(outputPath)) {
      throw new Error(`Rendered video file missing: ${outputPath}`);
    }
    const fileStat = await stat(outputPath);
    if (fileStat.size < 2048) {
      throw new Error(`Rendered video file too small (${fileStat.size} bytes)`);
    }

    const videoUrl = `/uploads/videos/${input.projectId}.mp4`;

    await prisma.videoRender.upsert({
      where: { projectId: input.projectId },
      update: { videoUrl, status: 'completed' },
      create: { projectId: input.projectId, videoUrl, status: 'completed' },
    });

    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'rendered' },
    });

    return {
      renderId: input.projectId,
      videoUrl,
      duration: 0,
    };
  }

  async fallback(_input: VideoEngineInput, error: Error): Promise<VideoEngineOutput> {
    throw new Error(`Video rendering failed after retries: ${error.message}`);
  }
}
