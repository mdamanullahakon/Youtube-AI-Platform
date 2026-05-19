import path from 'path';
import { PipelineStep } from '../pipeline-step';
import { VideoEngineInput, VideoEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { renderVideo } from '../../services/render.service';
import { parseScriptScenes } from '../../utils/helpers';
import { ViralQualityEngine } from '../../services/viral-quality.service';
import { logger } from '../../utils/logger';

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
    return null;
  }

  protected async execute(input: VideoEngineInput): Promise<VideoEngineOutput> {
    const scenes = parseScriptScenes(input.script.content);
    if (scenes.length === 0) {
      throw new Error('No scenes could be parsed from the script');
    }

    // Enforce emotional story arc
    const arcScenes = this.viralQuality.enforceEmotionalArc(scenes);

    // Optimize scene pacing for retention
    const optimizedScenes = this.viralQuality.optimizeScenePacing(arcScenes);

    // Validate hook in first scene
    const hookCheck = this.viralQuality.validateHook(optimizedScenes[0].text);
    if (!hookCheck.valid) {
      logger.warn(`[VideoEngine] Hook validation score ${hookCheck.score} — issues: ${hookCheck.issues.join(', ')}`);
      // Prepend a forced hook scene
      const hookText = this.viralQuality.generateHook(input.topic, []).text;
      optimizedScenes.unshift({ text: hookText, duration: 8, visualPrompt: 'dramatic hook establishing shot' });
    }

    // Validate visual variety
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
    const videoUrl = await renderVideo({
      scenes: optimizedScenes,
      topic: input.topic,
      title: input.topic,
      voiceoverPath: input.voiceover.audioUrl || undefined,
      outputPath,
      mood: moodFromTopic,
    });

    await prisma.videoRender.upsert({
      where: { projectId: input.projectId },
      update: {
        videoUrl,
        status: 'completed',
      },
      create: {
        projectId: input.projectId,
        videoUrl,
        status: 'completed',
      },
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

  async fallback(input: VideoEngineInput, error: Error): Promise<VideoEngineOutput> {
    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'rendered' },
    }).catch(() => {});

    return {
      renderId: input.projectId,
      videoUrl: '',
      duration: 0,
    };
  }
}
