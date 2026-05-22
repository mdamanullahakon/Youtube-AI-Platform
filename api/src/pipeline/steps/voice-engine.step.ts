import { PipelineStep } from '../pipeline-step';
import { VoiceEngineInput, VoiceEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { createVoiceover } from '../../agents/voiceover.agent';
import { validateVoiceoverAudioFile } from '../audio-validation';

export class VoiceEngineStep extends PipelineStep<VoiceEngineInput, VoiceEngineOutput> {
  constructor() {
    super('VoiceEngine');
  }

  validate(input: VoiceEngineInput): string | null {
    if (!input.script) return 'Script is required for voiceover generation';
    if (!input.script.content) return 'Script content is empty';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: VoiceEngineInput): Promise<VoiceEngineOutput> {
    const result = await createVoiceover(input.script.content, input.projectId, 'en', 'narrative');

    if (!result.audioUrl) {
      throw new Error('Voice generation failed: no audio file produced');
    }

    await validateVoiceoverAudioFile(result.audioUrl);

    await prisma.voiceover.upsert({
      where: { projectId: input.projectId },
      update: {
        text: input.script.content,
        audioUrl: result.audioUrl,
        duration: result.duration,
        language: result.language,
        tone: result.tone,
        status: 'completed',
      },
      create: {
        projectId: input.projectId,
        text: input.script.content,
        audioUrl: result.audioUrl,
        duration: result.duration,
        language: result.language,
        tone: result.tone,
        status: 'completed',
      },
    });

    return {
      audioUrl: result.audioUrl,
      duration: result.duration || 0,
      voiceoverId: input.projectId,
    };
  }

  async fallback(_input: VoiceEngineInput, error: Error): Promise<VoiceEngineOutput> {
    throw new Error(`Voice generation failed after retries — no silent video allowed: ${error.message}`);
  }
}
