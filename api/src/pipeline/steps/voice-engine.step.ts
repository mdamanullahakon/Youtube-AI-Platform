import { PipelineStep } from '../pipeline-step';
import { VoiceEngineInput, VoiceEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { createVoiceover } from '../../agents/voiceover.agent';

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

    await prisma.voiceover.upsert({
      where: { projectId: input.projectId },
      update: {
        text: input.script.content,
        audioUrl: result.audioUrl,
        duration: result.duration,
        language: result.language,
        tone: result.tone,
        status: result.audioUrl ? 'completed' : 'failed',
      },
      create: {
        projectId: input.projectId,
        text: input.script.content,
        audioUrl: result.audioUrl,
        duration: result.duration,
        language: result.language,
        tone: result.tone,
        status: result.audioUrl ? 'completed' : 'failed',
      },
    });

    return {
      audioUrl: result.audioUrl || null,
      duration: result.duration || 0,
      voiceoverId: result.audioUrl ? input.projectId : null,
    };
  }

  async fallback(_input: VoiceEngineInput, _error: Error): Promise<VoiceEngineOutput> {
    return {
      audioUrl: null,
      duration: 0,
      voiceoverId: null,
    };
  }
}
