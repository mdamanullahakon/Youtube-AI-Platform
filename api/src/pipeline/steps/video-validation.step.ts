import { join } from 'path';
import { PipelineStep } from '../pipeline-step';
import { VideoValidationInput, VideoValidationOutput } from '../pipeline.types';
import { OutputValidationGate } from '../../services/output-validation.service';
import { PreUploadValidationGate } from '../../services/pre-upload-validation.service';
import { parseScriptScenes } from '../../utils/helpers';
import { validateVoiceoverAudioFile } from '../audio-validation';

export class VideoValidationStep extends PipelineStep<VideoValidationInput, VideoValidationOutput> {
  private outputGate = new OutputValidationGate();
  private preUploadGate = new PreUploadValidationGate();

  constructor() {
    super('VideoValidation');
  }

  validate(input: VideoValidationInput): string | null {
    if (!input.video?.videoUrl) return 'Rendered video URL is required';
    if (!input.voiceover?.audioUrl) return 'Voiceover is required for validation';
    if (!input.projectId) return 'projectId is required';
    return null;
  }

  protected async execute(input: VideoValidationInput): Promise<VideoValidationOutput> {
    const videoPath = join(process.cwd(), input.video.videoUrl.replace(/^\//, ''));
    const voicePath = await validateVoiceoverAudioFile(input.voiceover.audioUrl);
    const scenes = parseScriptScenes(input.script.content);

    const qualityResult = await this.outputGate.validateVideo(
      videoPath,
      scenes,
      voicePath,
      input.topic,
    );
    if (!qualityResult.passed) {
      const blockers = qualityResult.checks.filter(c => c.severity === 'block' && !c.passed).map(c => c.name);
      throw new Error(`Video quality validation failed: ${blockers.join(', ')}`);
    }

    const preUpload = await this.preUploadGate.validate({
      videoPath,
      thumbnailPath: null,
      requireThumbnail: false,
    });
    if (!preUpload.passed) {
      throw new Error(`Pre-upload video validation failed: ${preUpload.blockers.join(', ')}`);
    }

    return {
      validated: true,
      videoUrl: input.video.videoUrl,
      durationSec: Number(preUpload.details.durationSec) || 0,
      resolution: `${preUpload.details.width}x${preUpload.details.height}`,
    };
  }

  async fallback(_input: VideoValidationInput, error: Error): Promise<VideoValidationOutput> {
    throw new Error(`Video validation failed: ${error.message}`);
  }
}
