import { generateWithAI } from './ai.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { extractJson, extractJsonArray } from '../utils/parse-ai-response';

export interface RetentionScore {
  overall: number;
  hookStrength: number;
  pacingScore: number;
  curiosityScore: number;
  emotionalIntensity: number;
  engagementProbability: number;
  weaknesses: string[];
  improvements: string[];
}

export class RetentionOptimizer {
  async scoreScript(scriptContent: string, format: string): Promise<RetentionScore> {
    logger.info('Scoring script for retention optimization');

    const analysis = await generateWithAI(`
      Analyze this YouTube ${format} script for RETENTION (watch time).
      Score each dimension 0-100.

      Script:
      "${scriptContent.substring(0, 4000)}"

      Return JSON:
      {
        "hookStrength": 0-100,
        "pacingScore": 0-100,
        "curiosityScore": 0-100,
        "emotionalIntensity": 0-100,
        "engagementProbability": 0-100,
        "weaknesses": ["specific weakness 1", "specific weakness 2"],
        "improvements": ["actionable improvement 1", "actionable improvement 2"]
      }

      Rules:
      - HookStrength: First 3 seconds must create intense curiosity
      - PacingScore: Every 10-15s needs a pattern interrupt or mini-hook
      - CuriosityScore: Information gap that keeps viewers watching
      - EmotionalIntensity: Emotional variation throughout
      - EngagementProbability: Overall likelihood of high retention
      - Be BRUTALLY honest about weaknesses
      - Return ONLY valid JSON
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJson(analysis) as any;

      const overall = Math.round(
        (parsed.hookStrength * 0.3 +
         parsed.pacingScore * 0.25 +
         parsed.curiosityScore * 0.2 +
         parsed.emotionalIntensity * 0.1 +
         parsed.engagementProbability * 0.15)
      );

      return {
        overall: Math.min(100, Math.max(0, overall)),
        hookStrength: Math.min(100, Math.max(0, parsed.hookStrength || 50)),
        pacingScore: Math.min(100, Math.max(0, parsed.pacingScore || 50)),
        curiosityScore: Math.min(100, Math.max(0, parsed.curiosityScore || 50)),
        emotionalIntensity: Math.min(100, Math.max(0, parsed.emotionalIntensity || 50)),
        engagementProbability: Math.min(100, Math.max(0, parsed.engagementProbability || 50)),
        weaknesses: parsed.weaknesses || [],
        improvements: parsed.improvements || [],
      };
    } catch {
      return {
        overall: 50,
        hookStrength: 50,
        pacingScore: 50,
        curiosityScore: 50,
        emotionalIntensity: 50,
        engagementProbability: 50,
        weaknesses: ['Could not analyze script'],
        improvements: ['Try regenerating the script'],
      };
    }
  }

  async optimizeScript(scriptContent: string, retentionScore: RetentionScore): Promise<string> {
    if (retentionScore.overall >= 80) return scriptContent;

    const optimized = await generateWithAI(`
      Improve this YouTube script to MAXIMIZE RETENTION (watch time).

      Current weaknesses:
      ${retentionScore.weaknesses.map(w => `- ${w}`).join('\n')}

      Current script:
      "${scriptContent.substring(0, 4000)}"

      Rules:
      - Fix every weakness listed above
      - Add pattern interrupts every 10-15 seconds
      - Create curiosity gaps that demand continuation
      - Shorten boring sections
      - Add emotional transitions
      - Remove fluff and filler words
      - Keep the core message but make it more engaging
      - Use the same format: ---HOOK--- ---SCENES--- ---CTA---

      Return ONLY the improved script, no explanations.
    `, 'ollama', { temperature: 0.6 });

    return optimized.trim();
  }

  async detectBoringSections(scriptContent: string): Promise<{ position: number; text: string; severity: 'critical' | 'moderate' | 'minor'; suggestion: string }[]> {
    const analysis = await generateWithAI(`
      Find boring or low-retention sections in this YouTube script.

      Script:
      "${scriptContent.substring(0, 4000)}"

      Return JSON array:
      [{
        "position": line or scene number,
        "text": "the boring section text",
        "severity": "critical" | "moderate" | "minor",
        "suggestion": "how to fix it"
      }]

      Look for:
      - Slow explanations
      - Repetitive information
      - Lack of curiosity hooks
      - Missing emotional triggers
      - Overly complex sections
      - Sections without pattern interrupts

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.3 });

    try {
      const parsed = extractJsonArray(analysis) as any;
      if (!parsed) throw new Error();
      return parsed;
    } catch {
      return [];
    }
  }
}
