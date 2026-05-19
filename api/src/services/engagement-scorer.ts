import type {
  DetectedHook,
  RetentionLoop,
  PatternInterrupt,
  StorytellingStructure,
  PacingPattern,
  EmotionalArc,
  EngagementScore,
} from '../types';

export class EngagementStructureScorer {
  score(
    hooks: DetectedHook[],
    retentionLoops: RetentionLoop[],
    patternInterrupts: PatternInterrupt[],
    structure: StorytellingStructure | null,
    pacing: PacingPattern | null,
    emotionalArc: EmotionalArc | null,
  ): EngagementScore {
    const hookRetention = this.scoreHookRetention(hooks);
    const pacingOptimality = this.scorePacingOptimality(pacing);
    const narrativeCohesion = this.scoreNarrativeCohesion(structure, hooks.length);
    const emotionalVariety = this.scoreEmotionalVariety(emotionalArc);
    const ctaEffectiveness = this.scoreCTAEffectiveness(hooks);
    const patternInterruptScore = this.scorePatternInterruptFrequency(patternInterrupts, retentionLoops);
    const payoffSatisfaction = this.scorePayoffSatisfaction(structure, emotionalArc);

    const dimensions = {
      hookRetention,
      pacingOptimality,
      narrativeCohesion,
      emotionalVariety,
      ctaEffectiveness,
      patternInterrupt: patternInterruptScore,
      payoffSatisfaction,
    };

    const overall = Math.round(Object.values(dimensions).reduce((a, b) => a + b, 0) / 7);

    return { overall, dimensions };
  }

  private scoreHookRetention(hooks: DetectedHook[]): number {
    if (hooks.length === 0) return 0;

    const topScores = hooks.slice(0, 3).map(h => h.score);
    const avgTopScore = topScores.reduce((a, b) => a + b, 0) / topScores.length;

    const nonUnknown = hooks.filter(h => h.type !== 'unknown').length;
    const typeRatio = nonUnknown / Math.max(1, hooks.length);

    return Math.round(Math.min(100, avgTopScore * 0.6 + typeRatio * 40));
  }

  private scorePacingOptimality(pacing: PacingPattern | null): number {
    if (!pacing) return 50;

    let score = 50;

    if (pacing.overall === 'varied') score += 30;
    else if (pacing.overall === 'moderate') score += 15;
    else if (pacing.overall === 'fast') score += 5;
    else score -= 10;

    const paceDiff = Math.abs(pacing.wordsPerSecond - 2.5);
    if (paceDiff < 0.3) score += 15;
    else if (paceDiff < 0.7) score += 10;
    else if (paceDiff < 1.2) score += 5;
    else score -= 10;

    if (pacing.sentenceLengthVariation > 5) score += 10;

    if (pacing.segments.length >= 3) score += 5;

    return Math.min(100, Math.max(0, score));
  }

  private scoreNarrativeCohesion(structure: StorytellingStructure | null, hookCount: number): number {
    if (!structure) return hookCount > 0 ? 30 : 10;

    let score = 30;

    if (structure.confidence > 70) score += 30;
    else if (structure.confidence > 40) score += 15;

    if (structure.phases.length >= 3) score += 20;
    else if (structure.phases.length >= 2) score += 10;

    const knownStructures = ['problem-solution', 'hook-story-payoff', 'list-format', 'curiosity-gap', 'rags-to-riches', 'open-loop'];
    if (knownStructures.includes(structure.name)) score += 20;

    return Math.min(100, score);
  }

  private scoreEmotionalVariety(emotionalArc: EmotionalArc | null): number {
    if (!emotionalArc) return 30;

    let score = 30;

    score += Math.min(30, emotionalArc.variety);

    if (emotionalArc.primaryEmotion !== emotionalArc.secondaryEmotion) score += 20;

    const trajectoryLen = emotionalArc.trajectory.length;
    if (trajectoryLen > 10) score += 20;
    else if (trajectoryLen > 5) score += 10;

    return Math.min(100, score);
  }

  private scoreCTAEffectiveness(hooks: DetectedHook[]): number {
    const ctaHooks = hooks.filter(h => {
      const lower = h.text.toLowerCase();
      return /subscribe|like|comment|follow|share|check out|hit that|link/i.test(lower);
    });

    if (ctaHooks.length === 0) return 20;

    const lastHooks = hooks.slice(-3);
    const hasEndCTA = lastHooks.some(h => {
      const lower = h.text.toLowerCase();
      return /subscribe|like|comment|follow|share|check out|hit that|link/i.test(lower);
    });

    let score = 50;
    if (hasEndCTA) score += 30;
    if (ctaHooks.length <= 2) score += 10;
    else score -= 10;

    return Math.min(100, Math.max(0, score));
  }

  private scorePatternInterruptFrequency(interrupts: PatternInterrupt[], loops: RetentionLoop[]): number {
    const totalEvents = interrupts.length + loops.length;

    if (totalEvents === 0) return 10;

    if (totalEvents >= 3 && totalEvents <= 8) return 85;
    if (totalEvents >= 2 && totalEvents <= 10) return 70;
    if (totalEvents >= 1) return 50;

    return 20;
  }

  private scorePayoffSatisfaction(structure: StorytellingStructure | null, emotionalArc: EmotionalArc | null): number {
    let score = 30;

    if (structure && structure.phases.length >= 3) {
      const lastPhase = structure.phases[structure.phases.length - 1];
      const hasPayoffRelated = /result|outcome|solution|lesson|summary|cta|conclusion/i.test(lastPhase.purpose);
      if (hasPayoffRelated) score += 25;
    }

    if (emotionalArc && emotionalArc.trajectory.length > 3) {
      const lastPoints = emotionalArc.trajectory.slice(-3);
      const intenseEndings = lastPoints.filter(p => p.intensity > 50);
      if (intenseEndings.length >= 2) score += 25;
    }

    if (structure && structure.confidence > 50) score += 20;

    return Math.min(100, score);
  }
}
