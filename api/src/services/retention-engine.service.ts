import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { AnalyticsValidationService } from './analytics-validation.service';

/**
 * RetentionEngineService
 * ----------------------
 * Analyzes viewer retention for a given video (via the Analytics table) and
 * injects pattern‑interrupt markers into the generated script. The markers are
 * simple HTML comments (`<!-- PATTERN_INTERRUPT -->`) that downstream renderers
 * can replace with short visual/audio cues.
 *
 * This implementation is intentionally lightweight – it looks at the overall
 * retention percentage and, if below a configurable threshold, inserts an
 * interrupt roughly every 45 seconds of script length (estimated by word count).
 */
export class RetentionEngine {
  /** Minimum retention percentage before we start inserting interrupts. */
  private static readonly RETENTION_THRESHOLD = 40; // percent

  /** Approximate seconds per 100 words (average speaking rate). */
  private static readonly SECONDS_PER_100_WORDS = 45;

  private validation = new AnalyticsValidationService();

  /**
   * Enhances a raw script with pattern‑interrupt markers based on retention.
   * @param projectId The ID of the VideoProject whose script is being processed.
   * @param script    The original script text.
   * @returns         The possibly‑modified script.
   */
  async enhanceScript(projectId: string, script: string): Promise<string> {
    try {
      // Pull the most recent analytics row for the project.
      const rawAnalytics = await prisma.analytics.findFirst({
        where: { projectId },
        orderBy: { collectedAt: 'desc' },
      });

      if (!rawAnalytics) {
        logger.info('RetentionEngine: no analytics data – returning original script', { projectId });
        return script;
      }

      // Validate / sanitize the analytics row.
      const analytics = await this.validation.validateRecord(rawAnalytics);
      if (!analytics) return script; // dropped due to corruption

      // If retention is good, we do not inject anything.
      if (analytics.retention >= RetentionEngine.RETENTION_THRESHOLD) {
        return script;
      }

      // Estimate how many interrupt markers we need based on script length.
      const wordCount = script.split(/\s+/).filter(Boolean).length;
      const estimatedSeconds = (wordCount / 100) * RetentionEngine.SECONDS_PER_100_WORDS;
      const interruptIntervalSec = 45; // fixed interval
      const interruptCount = Math.floor(estimatedSeconds / interruptIntervalSec);

      if (interruptCount <= 0) return script;

      // Insert markers evenly throughout the script.
      const lines = script.split('\n');
      const chunkSize = Math.max(1, Math.floor(lines.length / (interruptCount + 1)));
      const enhancedLines: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        enhancedLines.push(lines[i]);
        if ((i + 1) % chunkSize === 0 && interruptCount > 0) {
          enhancedLines.push('<!-- PATTERN_INTERRUPT -->');
        }
      }

      const enhancedScript = enhancedLines.join('\n');
      logger.info('RetentionEngine: inserted pattern interrupts', { projectId, interruptCount });
      return enhancedScript;
    } catch (err: any) {
      logger.error('RetentionEngine: unexpected error', { error: err.message, projectId });
      return script; // fail‑open – return original script on error
    }
  }

  /**
   * Combined analysis and optimization used by the script engine.
   * Returns the possibly modified script and a simple analysis payload.
   */
  async analyzeAndOptimizeScript(script: string, format: string): Promise<{ script: string; analysis: { predictedRetention: number; patternInterrupts: string[] } }> {
    // For now we use a placeholder projectId since the original service expects one.
    // In real usage the caller provides a projectId; here we pass an empty string.
    const enhanced = await this.enhanceScript('', script);
    // Dummy analysis – real implementation would compute retention based on analytics.
    const predictedRetention = 30; // placeholder value below threshold
    const patternInterrupts: string[] = [];
    return { script: enhanced, analysis: { predictedRetention, patternInterrupts } };
  }
}
