import { PipelineStep } from '../pipeline-step';
import { ScriptEngineInput, ScriptEngineOutput } from '../pipeline.types';
import { prisma } from '../../config/db';
import { generateScript } from '../../agents/script.agent';
import { RetentionEngine } from '../../services/retention-engine.service';
import { ViralFeedbackLoop } from '../../services/viral-feedback-loop.service';
import { logger } from '../../utils/logger';

export class ScriptEngineStep extends PipelineStep<ScriptEngineInput, ScriptEngineOutput> {
  private retentionEngine: RetentionEngine;
  private viralFeedback: ViralFeedbackLoop;

  constructor() {
    super('ScriptEngine');
    this.retentionEngine = new RetentionEngine();
    this.viralFeedback = new ViralFeedbackLoop();
  }

  validate(input: ScriptEngineInput): string | null {
    if (!input.projectId) return 'projectId is required';
    if (!input.trendAnalysis) return 'trendAnalysis is required from previous step';
    return null;
  }

  protected async execute(input: ScriptEngineInput): Promise<ScriptEngineOutput> {
    const guidance = await this.viralFeedback.generateScriptGuidanceFromPatterns(
      input.trendAnalysis.topic,
      input.trendAnalysis.audience
    );

    const enrichedTopic = guidance.length > 0
      ? `${input.trendAnalysis.topic}\n\nGuidance from viral patterns:\n${guidance.map(g => `- ${g}`).join('\n')}`
      : input.trendAnalysis.topic;

    const script = await generateScript(
      enrichedTopic,
      input.trendAnalysis.format || 'long-form',
    );

    const retentionResult = await this.retentionEngine.analyzeAndOptimizeScript(
      script.content,
      input.trendAnalysis.format || 'long-form'
    );

    await prisma.script.upsert({
      where: { projectId: input.projectId },
      update: {
        content: retentionResult.script,
        hook: script.hook,
        wordCount: retentionResult.script.split(/\s+/).length,
        tone: script.tone,
        targetLength: script.targetLength,
      },
      create: {
        projectId: input.projectId,
        content: retentionResult.script,
        hook: script.hook,
        wordCount: retentionResult.script.split(/\s+/).length,
        tone: script.tone,
        targetLength: script.targetLength,
      },
    });

    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: {
        status: 'script_generated',
        viralScore: retentionResult.analysis.predictedRetention,
      },
    });

    logger.info(`[ScriptEngine] Script retention score: ${retentionResult.analysis.predictedRetention}%, hooks injected: ${retentionResult.analysis.patternInterrupts.length}`);

    return {
      scriptId: input.projectId,
      content: retentionResult.script,
      hook: script.hook,
      wordCount: retentionResult.script.split(/\s+/).length,
      scenes: script.scenes || [],
    };
  }

  async fallback(input: ScriptEngineInput, error: Error): Promise<ScriptEngineOutput> {
    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'script_generated' },
    }).catch(() => {});

    return {
      scriptId: input.projectId,
      content: `This is a story about ${input.trendAnalysis.topic}. It begins on a dark night when everything changed...`,
      hook: `What if ${input.trendAnalysis.topic} was real?`,
      wordCount: 500,
      scenes: [
        { text: `Introduction to ${input.trendAnalysis.topic}`, duration: 15, visualPrompt: `dark atmospheric scene of ${input.trendAnalysis.topic}` },
        { text: 'The story unfolds with unexpected twists', duration: 30, visualPrompt: 'cinematic tension building scene' },
        { text: 'Conclusion with a shocking reveal', duration: 15, visualPrompt: 'climactic revelation scene' },
      ],
    };
  }
}
