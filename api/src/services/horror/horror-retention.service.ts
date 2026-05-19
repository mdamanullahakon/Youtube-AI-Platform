interface RetentionPattern {
  type: 'open-loop' | 'pattern-interrupt' | 'micro-cliffhanger' | 'false-resolution' | 'hidden-clue' | 'emotional-shift' | 'silence-dread';
  description: string;
  triggerPhrase: string;
  optimalSecond: number;
}

interface RetentionDropPoint {
  second: number;
  dropRate: number;
  cause: string;
  fix: string;
}

interface RetentionAnalysis {
  score: number;
  predictedRetention: number;
  weakPoints: RetentionDropPoint[];
  injections: RetentionPattern[];
}

const HORROR_PATTERNS: RetentionPattern[] = [
  { type: 'open-loop', description: 'Question left unanswered for 2+ minutes', triggerPhrase: 'But what they did not know was...', optimalSecond: 15 },
  { type: 'pattern-interrupt', description: 'Sudden tonal or visual shift', triggerPhrase: 'Then... everything changed.', optimalSecond: 45 },
  { type: 'micro-cliffhanger', description: 'Scene cut on unsettling revelation', triggerPhrase: 'And that is when they saw it.', optimalSecond: 90 },
  { type: 'false-resolution', description: 'Fake safe moment before bigger scare', triggerPhrase: 'They thought it was over. They were wrong.', optimalSecond: 180 },
  { type: 'hidden-clue', description: 'Detail in background that becomes important later', triggerPhrase: 'But there was one detail nobody noticed...', optimalSecond: 60 },
  { type: 'emotional-shift', description: 'Calm → terror → calm → terror oscillation', triggerPhrase: 'Everything was quiet. Too quiet.', optimalSecond: 120 },
  { type: 'silence-dread', description: '3+ seconds of absolute silence to build tension', triggerPhrase: '[SILENCE]', optimalSecond: 150 },
];

export class HorrorRetentionEngine {
  private readonly MIN_PATTERN_INTERVAL = 20;
  private readonly MAX_PATTERN_INTERVAL = 45;

  analyzeRetention(scenes: { text: string; duration: number }[], totalDuration: number): RetentionAnalysis {
    const weakPoints: RetentionDropPoint[] = [];
    const injections: RetentionPattern[] = [];
    let currentTime = 0;

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const textLower = scene.text.toLowerCase();

      if (scene.duration > 20 && !this.hasPatternInterrupt(textLower)) {
        weakPoints.push({
          second: currentTime,
          dropRate: 25,
          cause: `Scene ${i + 1} is ${scene.duration}s without pattern interrupt — viewers will click away`,
          fix: `Split scene at ${currentTime + 15}s with a micro-cliffhanger or open loop`,
        });
      }

      if (i > 1 && scenes[i - 1].duration > 15 && this.isMonotone(textLower)) {
        weakPoints.push({
          second: currentTime,
          dropRate: 15,
          cause: `Consecutive slow scenes create boredom — viewers feel safe, horror loses tension`,
          fix: `Insert a 2-second jump scare or sudden audio spike at ${currentTime}s`,
        });
      }

      if (i > 0 && currentTime - (injections[injections.length - 1]?.optimalSecond || 0) >= this.MAX_PATTERN_INTERVAL) {
        const pattern = this.selectPattern(injections, currentTime);
        injections.push(pattern);
      }

      currentTime += scene.duration;
    }

    const totalInjections = injections.length;
    const coverage = (totalInjections * this.MIN_PATTERN_INTERVAL) / totalDuration;
    const score = Math.round(Math.min(100, 40 + coverage * 30 + this.calculateHookScore(scenes) * 0.15));
    const predictedRetention = Math.round(score * 0.7 + Math.random() * 10);

    return { score, predictedRetention, weakPoints, injections };
  }

  injectRetentionPatterns(script: string, scenes: { text: string; duration: number }[]): string {
    let modifiedScript = script;
    let currentTime = 0;
    const insertions: { afterText: string; pattern: RetentionPattern; time: number }[] = [];

    for (let i = 0; i < scenes.length; i++) {
      if (i > 0 && currentTime - (insertions[insertions.length - 1]?.time || 0) >= this.MIN_PATTERN_INTERVAL) {
        const pattern = this.selectPattern(insertions.map(i => i.pattern), currentTime);
        insertions.push({
          afterText: scenes[i].text,
          pattern,
          time: currentTime,
        });
      }
      currentTime += scenes[i].duration;
    }

    for (const ins of insertions.reverse()) {
      modifiedScript = modifiedScript.replace(
        ins.afterText,
        `${ins.pattern.triggerPhrase}\n${ins.afterText}`
      );
    }

    return modifiedScript;
  }

  generateSceneRetentionHints(sceneIndex: number, totalScenes: number, currentDuration: number): string[] {
    const hints: string[] = [];
    const progress = sceneIndex / totalScenes;

    if (currentDuration >= this.MIN_PATTERN_INTERVAL) {
      hints.push(`INSERT PATTERN INTERRUPT here — "${this.selectPattern([], currentDuration).triggerPhrase}"`);
    }

    if (progress > 0.3 && progress < 0.5) {
      hints.push('HIDE A CLUE in background — subtle detail that matters in act 3');
    }

    if (progress > 0.5 && progress < 0.7) {
      hints.push('FALSE RESOLUTION — make viewer think the danger passed');
    }

    if (progress > 0.85) {
      hints.push('FINAL ESCALATION — this is where the biggest scare lands');
    }

    if (sceneIndex === totalScenes - 2) {
      hints.push('LINGERING DREAD — do not fully resolve, horror should continue after video ends');
    }

    return hints;
  }

  private selectPattern(used: RetentionPattern[], currentSecond: number): RetentionPattern {
    const available = HORROR_PATTERNS.filter(p => !used.some(u => u.type === p.type));
    if (available.length === 0) return HORROR_PATTERNS[Math.floor(Math.random() * HORROR_PATTERNS.length)];

    const scored = available.map(p => ({
      pattern: p,
      score: this.calculatePatternFit(p, currentSecond),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored[0].pattern;
  }

  private calculatePatternFit(pattern: RetentionPattern, currentSecond: number): number {
    return Math.max(0, 100 - Math.abs(pattern.optimalSecond - currentSecond) * 0.5);
  }

  private hasPatternInterrupt(text: string): boolean {
    const interruptors = ['but', 'then', 'suddenly', 'however', 'wait', 'what if', 'this changes', 'the truth', 'revealed'];
    return interruptors.some(i => text.includes(i));
  }

  private isMonotone(text: string): boolean {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const avgLength = sentences.reduce((s, s2) => s + s2.split(' ').length, 0) / sentences.length;
    return avgLength > 15 && text.length > 100;
  }

  private calculateHookScore(scenes: { text: string; duration: number }[]): number {
    const firstScene = scenes[0];
    if (!firstScene) return 0;
    const text = firstScene.text.toLowerCase();
    let score = 50;

    if (text.includes('?') && text.length < 100) score += 15;
    if (text.includes('...')) score += 10;
    if (text.includes('!')) score += 10;
    if (text.includes('never') || text.includes('found') || text.includes('truth')) score += 10;
    if (text.length < 60) score += 15;
    if (firstScene.duration <= 12) score += 10;

    return Math.min(100, score);
  }
}
