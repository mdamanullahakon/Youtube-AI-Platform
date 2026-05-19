import { pipelineLogger } from '../utils/logger';
import { StepStatus, StepResult, MAX_STEP_RETRIES, STEP_RETRY_BASE_DELAY_MS } from './pipeline.types';
import { checkStepIdempotency, markStepCompleted } from './idempotency';
import { PipelineStateMachine } from './state-machine';
import { SelfHealer } from './self-healer';

export abstract class PipelineStep<TInput, TOutput> {
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  abstract validate?(input: TInput): string | null;

  protected abstract execute(input: TInput): Promise<TOutput>;

  abstract fallback(input: TInput, error: Error): Promise<TOutput>;

  async run(input: TInput, projectId?: string): Promise<StepResult<TOutput>> {
    const start = Date.now();

    if (projectId) {
      const alreadyExecuted = await checkStepIdempotency(projectId, this.name);
      if (alreadyExecuted) {
        pipelineLogger.warn(`${this.name} already executed for project ${projectId} — skipping`);
        return {
          stepName: this.name,
          status: StepStatus.SKIPPED,
          output: null,
          error: null,
          retries: 0,
          durationMs: 0,
          fallbackUsed: false,
        };
      }
    }

    if (this.validate) {
      const validationError = this.validate(input);
      if (validationError) {
        return {
          stepName: this.name,
          status: StepStatus.FAILED,
          output: null,
          error: validationError,
          retries: 0,
          durationMs: Date.now() - start,
          fallbackUsed: false,
        };
      }
    }

    if (projectId) {
      const stateMachine = new PipelineStateMachine(projectId);
      const allowed = stateMachine.isAllowed(this.name);
      if (!allowed) {
        pipelineLogger.error(`${this.name} rejected by state machine for project ${projectId} — invalid transition`);
        return {
          stepName: this.name,
          status: StepStatus.FAILED,
          output: null,
          error: `State machine rejected ${this.name} for project ${projectId} — invalid transition from current state`,
          retries: 0,
          durationMs: Date.now() - start,
          fallbackUsed: false,
        };
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_STEP_RETRIES; attempt++) {
      try {
        const output = await this.execute(input);
        if (projectId) {
          await markStepCompleted(projectId, this.name);
          const stateMachine = new PipelineStateMachine(projectId);
          await stateMachine.transitionAfterStep(this.name);
        }
        return {
          stepName: this.name,
          status: StepStatus.COMPLETED,
          output,
          error: null,
          retries: attempt - 1,
          durationMs: Date.now() - start,
          fallbackUsed: false,
        };
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_STEP_RETRIES) {
          const delay = STEP_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          pipelineLogger.warn(`${this.name} attempt ${attempt}/${MAX_STEP_RETRIES} failed: ${err.message}. Retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    if (projectId) {
      const healer = new SelfHealer(projectId);
      await healer.heal(this.name, lastError!).catch(e =>
        pipelineLogger.error(`Self-heal failed for ${this.name}: ${e.message}`)
      );
    }

    try {
      const fallbackOutput = await this.fallback(input, lastError!);
      pipelineLogger.warn(`${this.name} used fallback after ${MAX_STEP_RETRIES} failed attempts`);
      if (projectId) {
        await markStepCompleted(projectId, this.name);
        const stateMachine = new PipelineStateMachine(projectId);
        await stateMachine.transitionAfterStep(this.name);
      }
      return {
        stepName: this.name,
        status: StepStatus.FALLBACK,
        output: fallbackOutput,
        error: lastError!.message,
        retries: MAX_STEP_RETRIES,
        durationMs: Date.now() - start,
        fallbackUsed: true,
      };
    } catch (fallbackErr: any) {
      pipelineLogger.error(`${this.name} failed after ${MAX_STEP_RETRIES} retries and fallback also failed: ${fallbackErr.message}`);
      if (projectId) {
        const stateMachine = new PipelineStateMachine(projectId);
        await stateMachine.markFailed();
      }
      return {
        stepName: this.name,
        status: StepStatus.FAILED,
        output: null,
        error: `All retries failed: ${lastError!.message}. Fallback failed: ${fallbackErr.message}`,
        retries: MAX_STEP_RETRIES,
        durationMs: Date.now() - start,
        fallbackUsed: true,
      };
    }
  }
}
