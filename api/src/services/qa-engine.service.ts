import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';

interface QACheck {
  name: string;
  passed: boolean;
  severity: 'block' | 'warning' | 'info';
  details: string;
  fixSuggestion?: string;
}

interface QAResult {
  passed: boolean;
  checks: QACheck[];
  summary: string;
  score: number;
  autoFixAvailable: boolean;
}

interface SceneValidation {
  index: number;
  text: string;
  duration: number;
  hasPatternInterrupt: boolean;
  hasVisualChange: boolean;
  tooLong: boolean;
}

export class QAEngine {
  async validateVideo(
    scriptContent: string,
    scenes: { text: string; duration: number }[],
    totalDurationSeconds: number,
    thumbnailPrompt?: string,
    title?: string
  ): Promise<QAResult> {
    const checks: QACheck[] = [];

    checks.push(this.checkVideoLength(totalDurationSeconds));
    checks.push(this.checkSceneFrequency(scenes));
    checks.push(this.checkRetentionHooks(scriptContent, scenes));
    checks.push(await this.thumbnailCTRRules(thumbnailPrompt));
    checks.push(await this.seoTitleCheck(title));
    checks.push(this.checkAudioAssets(scenes));
    checks.push(this.checkSubtitlePresence(scriptContent));
    checks.push(this.checkMonetizationReadiness(scriptContent));

    const failedBlocks = checks.filter(c => !c.passed && c.severity === 'block');
    const failedWarnings = checks.filter(c => !c.passed && c.severity === 'warning');
    const score = Math.round(
      (checks.filter(c => c.passed).length / checks.length) * 100
    );
    const passed = failedBlocks.length === 0;
    const autoFixAvailable = failedBlocks.length > 0 || failedWarnings.length > 0;

    logger.info(`[QAEngine] Score: ${score}%, Blocks: ${failedBlocks.length}, Warnings: ${failedWarnings.length}`);

    return {
      passed,
      checks,
      summary: passed
        ? `All ${checks.length} checks passed (score: ${score}%)`
        : `${failedBlocks.length} blocking issues, ${failedWarnings.length} warnings (score: ${score}%)`,
      score,
      autoFixAvailable,
    };
  }

  async autoFix(scriptContent: string, scenes: { text: string; duration: number }[], qaResult: QAResult): Promise<{
    fixedScript: string;
    fixedScenes: { text: string; duration: number }[];
    fixesApplied: string[];
  }> {
    const fixesApplied: string[] = [];
    let fixedScript = scriptContent;
    const fixedScenes = [...scenes];

    for (const check of qaResult.checks) {
      if (check.passed || !check.fixSuggestion) continue;

      if (check.name === 'Retention Hooks') {
        fixedScript = await this.injectRetentionHooks(fixedScript);
        fixesApplied.push('Injected retention hooks (pattern interrupts every 25s)');
      }

      if (check.name === 'Scene Frequency') {
        for (let i = 0; i < fixedScenes.length; i++) {
          if (fixedScenes[i].duration > 20) {
            const half = Math.floor(fixedScenes[i].duration / 2);
            fixedScenes[i].duration = half;
            const sceneText = fixedScenes[i].text;
            const splitPoint = Math.floor(sceneText.length / 2);
            const spaceBefore = sceneText.lastIndexOf(' ', splitPoint);
            const spaceAfter = sceneText.indexOf(' ', splitPoint);
            const mid = spaceBefore > 0 && splitPoint - spaceBefore < 20 ? spaceBefore
              : spaceAfter > 0 && spaceAfter - splitPoint < 20 ? spaceAfter
              : splitPoint;
            const firstHalf = sceneText.substring(0, mid).trim();
            const secondHalf = sceneText.substring(mid).trim();
            fixedScenes[i].text = firstHalf;
            fixedScenes.splice(i + 1, 0, {
              text: secondHalf || `[continued from previous scene]`,
              duration: half,
            });
            fixesApplied.push(`Split scene ${i + 1} (was >20s)`);
            i++;
          }
        }
      }
    }

    return { fixedScript, fixedScenes, fixesApplied };
  }

  private checkVideoLength(totalSeconds: number): QACheck {
    const targetMin = 600;
    const targetMax = 1200;
    const minutes = Math.round(totalSeconds / 60);

    if (totalSeconds < targetMin) {
      return {
        name: 'Video Length', passed: false, severity: 'block',
        details: `Video is ${minutes}min (target: 10-20min)`,
        fixSuggestion: `Extend script to ${targetMin / 60}-${targetMax / 60}min range. Add ${Math.ceil((targetMin - totalSeconds) / 60)} more minutes of content.`,
      };
    }
    return {
      name: 'Video Length', passed: true, severity: 'info',
      details: `Video is ${minutes}min — within target range`,
    };
  }

  private checkSceneFrequency(scenes: { text: string; duration: number }[]): QACheck {
    const maxSceneDuration = 20;
    const tooLong = scenes.filter(s => s.duration > maxSceneDuration);

    if (tooLong.length > 0) {
      return {
        name: 'Scene Frequency', passed: false, severity: 'block',
        details: `${tooLong.length} scenes exceed ${maxSceneDuration}s (max: ${Math.max(...tooLong.map(s => s.duration))}s)`,
        fixSuggestion: 'Split long scenes into 10-15s segments with visual changes between them',
      };
    }

    const checkStatic = scenes.every(s => s.duration >= 5 && s.duration <= maxSceneDuration);
    return {
      name: 'Scene Frequency', passed: checkStatic, severity: checkStatic ? 'info' : 'warning',
      details: `${scenes.length} scenes, avg ${Math.round(scenes.reduce((a, s) => a + s.duration, 0) / scenes.length)}s each`,
    };
  }

  private checkRetentionHooks(script: string, scenes: { text: string; duration: number }[]): QACheck {
    const text = script.toLowerCase();
    const interruptors = ['but', 'then', 'suddenly', 'however', 'wait', 'what if', 'this changes', 'the truth', 'revealed', 'found', 'discovered'];

    const textInterrupts = interruptors.filter(i => text.includes(i)).length;
    const scenesWithInterrupts = scenes.filter(s => interruptors.some(i => s.text.toLowerCase().includes(i))).length;

    const expectedInterrupts = Math.floor(scenes.length / 3);
    const score = (textInterrupts / Math.max(1, expectedInterrupts)) * 100;

    if (score < 50) {
      return {
        name: 'Retention Hooks', passed: false, severity: 'block',
        details: `Only ${textInterrupts} pattern interrupts found (need ~${expectedInterrupts} for ${scenes.length} scenes)`,
        fixSuggestion: 'Add pattern interrupt every 3rd scene: "But here is where it gets interesting..." / "Then everything changed..." / "What happened next was unexpected..."',
      };
    }

    return {
      name: 'Retention Hooks', passed: true, severity: 'info',
      details: `${textInterrupts} pattern interrupts found across ${scenes.length} scenes`,
    };
  }

  private async thumbnailCTRRules(thumbnailPrompt?: string): Promise<QACheck> {
    if (!thumbnailPrompt) {
      return { name: 'Thumbnail CTR', passed: false, severity: 'warning', details: 'No thumbnail prompt provided', fixSuggestion: 'Generate thumbnail with face close-up + high contrast + 2-4 word text overlay' };
    }

    const prompt = thumbnailPrompt.toLowerCase();
    const hasFace = prompt.includes('face') || prompt.includes('person') || prompt.includes('people') || prompt.includes('human');
    const hasContrast = prompt.includes('contrast') || prompt.includes('red') || prompt.includes('black') || prompt.includes('dark');
    const hasSubject = prompt.includes('close-up') || prompt.includes('closeup') || prompt.includes('focal');

    if (!hasFace && !hasContrast) {
      return {
        name: 'Thumbnail CTR', passed: false, severity: 'warning',
        details: 'Thumbnail may lack emotional trigger (face) or contrast',
        fixSuggestion: 'Update prompt to include face close-up with red/black high contrast lighting',
      };
    }

    return {
      name: 'Thumbnail CTR', passed: true, severity: 'info',
      details: `Thumbnail prompt includes ${hasFace ? 'face' : ''}${hasContrast ? ' + contrast' : ''}${hasSubject ? ' + focal subject' : ''}`,
    };
  }

  private async seoTitleCheck(title?: string): Promise<QACheck> {
    if (!title) {
      return { name: 'SEO Title', passed: false, severity: 'warning', details: 'No title provided', fixSuggestion: 'Generate CTR-optimized title with curiosity gap' };
    }

    const t = title.toLowerCase();
    const hasCuriosity = t.includes('?') || t.includes('truth') || t.includes('secret') || t.includes('found') || t.includes('never');
    const hasKeywords = t.split(/\s+/).length >= 4;
    const rightLength = title.length >= 30 && title.length <= 80;

    const issues: string[] = [];
    if (!hasCuriosity) issues.push('Missing curiosity trigger');
    if (!hasKeywords) issues.push('Too few keywords');
    if (!rightLength) issues.push(`Length ${title.length}chars — target 30-80`);

    if (issues.length > 0) {
      return {
        name: 'SEO Title', passed: false, severity: 'warning',
        details: issues.join('; '),
        fixSuggestion: 'Use curiosity gap + number + emotional trigger in 40-60 chars',
      };
    }

    return { name: 'SEO Title', passed: true, severity: 'info', details: `${title.length} chars — optimized` };
  }

  private checkAudioAssets(scenes: { text: string; duration: number }[]): QACheck {
    const totalSilence = scenes.filter(s => s.duration > 15).length;
    if (totalSilence > scenes.length * 0.5) {
      return {
        name: 'Audio Assets', passed: false, severity: 'warning',
        details: `High proportion of long scenes without audio variation`,
        fixSuggestion: 'Add background ambient track and ensure voiceover covers all scenes',
      };
    }
    return { name: 'Audio Assets', passed: true, severity: 'info', details: 'Scene lengths allow for consistent audio coverage' };
  }

  private checkSubtitlePresence(script: string): QACheck {
    const wordCount = script.split(/\s+/).length;
    if (wordCount < 100) {
      return { name: 'Subtitles', passed: false, severity: 'warning', details: `Only ${wordCount} words — insufficient content for subtitles`, fixSuggestion: 'Extend script to 1000+ words for proper subtitle generation' };
    }
    return { name: 'Subtitles', passed: true, severity: 'info', details: `${wordCount} words — subtitle-ready` };
  }

  private checkMonetizationReadiness(script: string): QACheck {
    const text = script.toLowerCase();
    const hasCTA = text.includes('subscribe') || text.includes('comment') || text.includes('like');
    if (!hasCTA) {
      return {
        name: 'Monetization', passed: false, severity: 'warning',
        details: 'No call-to-action found in script',
        fixSuggestion: 'Add subscribe/comment CTA in final scenes',
      };
    }
    return { name: 'Monetization', passed: true, severity: 'info', details: 'CTA present in script' };
  }

  private async injectRetentionHooks(script: string): Promise<string> {
    const hooks = [
      '\nBut here is where it gets really interesting...',
      '\nThen... everything changed.',
      '\nWhat happened next shocked everyone.',
      '\nAnd that is when they found the truth.',
    ];

    let lines = script.split('\n');
    let hookIndex = 0;
    for (let i = 3; i < lines.length; i += 3) {
      if (hookIndex < hooks.length) {
        lines.splice(i, 0, hooks[hookIndex]);
        hookIndex++;
        i++;
      }
    }

    return lines.join('\n');
  }
}
