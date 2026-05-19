import { prisma } from '../config/db';
import { pipelineLogger } from '../utils/logger';
import { RevenueGate } from './steps/revenue-gate.step';
import { ViralIntelligenceGate } from './steps/viral-intelligence-gate.step';
import { UsaMarketGate } from './steps/usa-market-gate.step';
import { TopicEngineStep } from './steps/topic-engine.step';
import { ScriptEngineStep } from './steps/script-engine.step';
import { VoiceEngineStep } from './steps/voice-engine.step';
import { VideoEngineStep } from './steps/video-engine.step';
import { ThumbnailEngineStep } from './steps/thumbnail-engine.step';
import { UploadEngineStep } from './steps/upload-engine.step';
import { AnalyticsEngineStep } from './steps/analytics-engine.step';
import {
  PipelineContext,
  PipelineStatus,
  StepStatus,
  StepResult,
  TopicEngineInput,
  TopicEngineOutput,
  ScriptEngineInput,
  ScriptEngineOutput,
  VoiceEngineInput,
  VoiceEngineOutput,
  VideoEngineInput,
  VideoEngineOutput,
  ThumbnailEngineInput,
  ThumbnailEngineOutput,
  UploadEngineInput,
  UploadEngineOutput,
  AnalyticsEngineInput,
  AnalyticsEngineOutput,
} from './pipeline.types';
import { PipelineStateMachine, PipelineState } from './state-machine';
import { acquireJobLock, releaseJobLock, verifyNoDuplicateOutputs } from './idempotency';

export class PipelineOrchestrator {
  private context: PipelineContext;
  private stateMachine: PipelineStateMachine;
  private revenueGate: RevenueGate;
  private viralGate: ViralIntelligenceGate;
  private usaGate: UsaMarketGate;
  private topicEngine: TopicEngineStep;
  private scriptEngine: ScriptEngineStep;
  private voiceEngine: VoiceEngineStep;
  private videoEngine: VideoEngineStep;
  private thumbnailEngine: ThumbnailEngineStep;
  private uploadEngine: UploadEngineStep;
  private analyticsEngine: AnalyticsEngineStep;

  constructor(projectId: string, userId: string, topic: string, channelId?: string) {
    this.context = {
      projectId,
      userId,
      channelId,
      topic,
      status: PipelineStatus.PENDING,
      steps: {},
      startedAt: Date.now(),
    };
    this.stateMachine = new PipelineStateMachine(projectId);
    this.revenueGate = new RevenueGate();
    this.viralGate = new ViralIntelligenceGate();
    this.usaGate = new UsaMarketGate();
    this.topicEngine = new TopicEngineStep();
    this.scriptEngine = new ScriptEngineStep();
    this.voiceEngine = new VoiceEngineStep();
    this.videoEngine = new VideoEngineStep();
    this.thumbnailEngine = new ThumbnailEngineStep();
    this.uploadEngine = new UploadEngineStep();
    this.analyticsEngine = new AnalyticsEngineStep();
  }

  async run(): Promise<PipelineContext> {
    const jobLockAcquired = await acquireJobLock(this.context.projectId);
    if (!jobLockAcquired) {
      pipelineLogger.warn(`Pipeline already running for project ${this.context.projectId} — skipping duplicate execution`);
      this.context.status = PipelineStatus.FAILED;
      return this.context;
    }

    try {
      pipelineLogger.info(`Pipeline started for project ${this.context.projectId}: ${this.context.topic}`);
      this.context.status = PipelineStatus.RUNNING;

      const success = await this.executeSequentialPipeline();
      if (!success) {
        this.context.status = PipelineStatus.FAILED;
        await this.stateMachine.markFailed();
        return this.context;
      }

      const duplicates = await verifyNoDuplicateOutputs(this.context.projectId);
      if (duplicates.length > 0) {
        pipelineLogger.warn(`Duplicate outputs detected for project ${this.context.projectId}: ${duplicates.join(', ')}`);
      }

      await this.stateMachine.transitionTo(PipelineState.ANALYTICS_COLLECTED);
      this.context.status = PipelineStatus.COMPLETED;
      this.context.completedAt = Date.now();
      pipelineLogger.info(`Pipeline completed for project ${this.context.projectId} in ${(this.context.completedAt - this.context.startedAt) / 1000}s`);
    } catch (err: any) {
      pipelineLogger.error(`Pipeline crashed for project ${this.context.projectId}: ${err.message}`);
      this.context.status = PipelineStatus.FAILED;
      await this.stateMachine.markFailed();
    } finally {
      await releaseJobLock(this.context.projectId);
    }

    return this.context;
  }

  private async executeSequentialPipeline(): Promise<boolean> {
    // Step -1: Revenue Gate — blocks non-profitable topics BEFORE any analysis
    const revenueOutput = await this.runStep(
      'RevenueGate', this.revenueGate,
      { projectId: this.context.projectId, topic: this.context.topic, userId: this.context.userId, channelId: this.context.channelId },
    );
    if (revenueOutput === null) return false;

    // Step 0: Viral Intelligence Gate — blocks low-potential topics BEFORE generation
    const gateOutput = await this.runStep(
      'ViralIntelligenceGate', this.viralGate,
      { projectId: this.context.projectId, topic: this.context.topic, userId: this.context.userId, channelId: this.context.channelId },
    );
    if (gateOutput === null) return false;

    // Step 0.5: USA Market Gate — ensures topic is optimized for US audience, RPM, timing
    const usaOutput = await this.runStep(
      'UsaMarketGate', this.usaGate,
      { projectId: this.context.projectId, topic: this.context.topic, userId: this.context.userId, channelId: this.context.channelId },
    );
    if (usaOutput === null) return false;

    const topicOutput = await this.runStep<TopicEngineInput, TopicEngineOutput>(
      'TopicEngine', this.topicEngine,
      { projectId: this.context.projectId, topic: this.context.topic, userId: this.context.userId, channelId: this.context.channelId },
    );
    if (topicOutput === null) return false;

    const scriptInput: ScriptEngineInput = {
      projectId: this.context.projectId, topic: topicOutput.topic,
      channelId: this.context.channelId, userId: this.context.userId,
      trendAnalysis: topicOutput,
    };
    const scriptOutput = await this.runStep<ScriptEngineInput, ScriptEngineOutput>(
      'ScriptEngine', this.scriptEngine, scriptInput,
    );
    if (scriptOutput === null) return false;

    const [voiceOutput, thumbnailOutput] = await Promise.all([
      this.runStep<VoiceEngineInput, VoiceEngineOutput>(
        'VoiceEngine', this.voiceEngine,
        { projectId: this.context.projectId, topic: topicOutput.topic, channelId: this.context.channelId, userId: this.context.userId, script: scriptOutput },
      ),
      this.runStep<ThumbnailEngineInput, ThumbnailEngineOutput>(
        'ThumbnailEngine', this.thumbnailEngine,
        { projectId: this.context.projectId, topic: topicOutput.topic, channelId: this.context.channelId, userId: this.context.userId, script: scriptOutput },
      ),
    ]);

    const videoInput: VideoEngineInput = {
      projectId: this.context.projectId, topic: topicOutput.topic,
      channelId: this.context.channelId, userId: this.context.userId,
      script: scriptOutput,
      voiceover: voiceOutput || { audioUrl: null, duration: 0, voiceoverId: null },
    };
    const videoOutput = await this.runStep<VideoEngineInput, VideoEngineOutput>(
      'VideoEngine', this.videoEngine, videoInput,
    );
    if (videoOutput === null) return false;

    await this.stateMachine.transitionTo(PipelineState.READY_FOR_UPLOAD);

    const uploadInput: UploadEngineInput = {
      projectId: this.context.projectId, topic: topicOutput.topic,
      channelId: this.context.channelId, userId: this.context.userId,
      video: videoOutput,
      thumbnail: thumbnailOutput || { thumbnailId: '', imageUrl: null, style: 'default', predictedCtr: 0 },
      script: scriptOutput,
    };
    const uploadOutput = await this.runStep<UploadEngineInput, UploadEngineOutput>(
      'UploadEngine', this.uploadEngine, uploadInput,
    );
    if (uploadOutput === null) return false;

    const analyticsInput: AnalyticsEngineInput = {
      projectId: this.context.projectId, topic: topicOutput.topic,
      channelId: this.context.channelId, userId: this.context.userId,
      upload: uploadOutput,
    };
    await this.runStep<AnalyticsEngineInput, AnalyticsEngineOutput>(
      'AnalyticsEngine', this.analyticsEngine, analyticsInput,
    );

    return true;
  }

  private async runStep<TInput, TOutput>(
    stepName: string,
    step: { run: (input: TInput, projectId?: string) => Promise<StepResult<TOutput>> },
    input: TInput,
  ): Promise<TOutput | null> {
    const result = await step.run(input, this.context.projectId);
    this.context.steps[stepName] = result;

    if (result.status === StepStatus.SKIPPED) {
      pipelineLogger.info(`${stepName} skipped (already completed for this project)`);
      return result.output;
    }

    if (result.status === StepStatus.FAILED) {
      pipelineLogger.error(`${stepName} failed: ${result.error}`);
      return null;
    }

    if (result.status === StepStatus.FALLBACK) {
      pipelineLogger.warn(`${stepName} used fallback: ${result.error}`);
    }

    return result.output;
  }

  getProgress(): number {
    const stepWeights: Record<string, number> = {
      RevenueGate: 0, ViralIntelligenceGate: 1, UsaMarketGate: 2, TopicEngine: 10, ScriptEngine: 25, VoiceEngine: 35,
      ThumbnailEngine: 40, VideoEngine: 65, UploadEngine: 85, AnalyticsEngine: 100,
    };
    let maxWeight = 0;
    for (const [stepName, weight] of Object.entries(stepWeights)) {
      const result = this.context.steps[stepName];
      const ok = result?.status === StepStatus.COMPLETED || result?.status === StepStatus.FALLBACK || result?.status === StepStatus.SKIPPED;
      if (ok) maxWeight = weight;
    }
    return maxWeight;
  }

  getContext(): PipelineContext {
    return { ...this.context };
  }
}
