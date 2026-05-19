import { generateWithAI } from '../services/ai.service';
import { prisma } from '../config/db';
import { ContentQualityService } from '../services/content-quality.service';
import { aiLogger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface ViralScript {
  title: string;
  hook: string;
  intro: string;
  mainContent: string;
  outro: string;
  emotionalTriggers: string[];
  retentionMoments: { timestamp: string; technique: string }[];
  cta: string;
  durationTarget: number;
  sceneBreakdown: { text: string; duration: number; visual: string }[];
  fullScript: string;
}

export class ScriptWriterAgent {
  private qualityService = new ContentQualityService();

  async generateViralScript(
    topic: string,
    format: 'Shorts' | 'Longform' = 'Shorts',
    niche?: string,
    emotionalAngle?: string,
    hookSuggestion?: string
  ): Promise<ViralScript> {
    aiLogger.info(`ScriptWriterAgent: generating ${format} script for "${topic}"`);

    const strategy = niche ? await prisma.contentStrategy.findUnique({ where: { niche } }) : null;
    const nicheContext = strategy
      ? `\nNiche strategy:\n- Pacing: ${strategy.pacingStyle}\n- Tone: ${strategy.tone}\n- Hook style: ${strategy.hookStyle}\n- Storytelling arc: ${strategy.storytellingArc}`
      : '';

    const wordLimit = format === 'Shorts' ? 350 : 2000;

    const prompt = `
      Write a VIRAL YouTube ${format} script about: ${topic}
      ${emotionalAngle ? `\nEmotional angle: ${emotionalAngle}` : ''}
      ${hookSuggestion ? `\nHook suggestion: ${hookSuggestion}` : ''}${nicheContext}

      STRUCTURE RULES (MUST FOLLOW):

      1. HOOK (0-5 seconds) — must create intense curiosity/shock/fear/mystery
         NO: "Hey guys", "What's up", "Welcome back", "In this video"
         YES: Start with the most explosive statement possible

      2. FAST PAYOFF (5-20 seconds) — immediately deliver value

      3. OPEN LOOP — leave an unanswered question that forces continued watching

      4. STORY ESCALATION — increase emotional intensity every 20-30 seconds
         Each section must be MORE interesting than the last

      5. RETENTION TRIGGERS every 10-15 seconds:
         - Pattern interrupts ("But here's the thing...")
         - Cliffhangers ("And then something unexpected happened...")
         - Countdowns ("3 reasons... here's number 1")
         - Emotional switching (curiosity → shock → awe)

      6. CTA — soft psychological close (not just "subscribe")

      MAXIMUM ${wordLimit} words.

      Format output EXACTLY:

      ---TITLE---
      [One viral-optimized title]
      ---HOOK---
      [0-5 second hook — max 2 sentences]
      ---INTRO---
      [5-20 second fast payoff]
      ---SCENES---
      [Scene 1: spoken text | duration sec | visual description]
      [Scene 2: spoken text | duration sec | visual description]
      [...continue for all scenes...]
      ---OUTRO---
      [Satisfying close with emotional payoff]
      ---CTA---
      [Call to action — soft psychological]
      ---RETENTION_MOMENTS---
      [0:15 - pattern interrupt or cliffhanger description]
      [0:30 - emotional shift or escalation]
      [...continue...]
      ---EMOTIONAL_TRIGGERS---
      [trigger 1, trigger 2, trigger 3]
    `;

    let content = await generateWithAI(prompt, 'ollama', { temperature: 0.7 });

    content = await this.qualityService.fullEnhance(content, format, niche || 'general');

    const parsed = this.parseViralScript(content, format);
    return parsed;
  }

  private parseViralScript(content: string, format: string): ViralScript {
    const extract = (section: string): string => {
      const match = content.match(new RegExp(`---${section}---\\s*([\\s\\S]*?)(?=---|$)`));
      return match ? match[1].trim() : '';
    };

    const extractList = (section: string): string[] => {
      const text = extract(section);
      return text ? text.split(',').map(s => s.trim()).filter(Boolean) : [];
    };

    const title = extract('TITLE') || 'Untitled';
    const hook = extract('HOOK') || content.split('\n')[0];
    const intro = extract('INTRO') || '';
    const mainContent = extract('SCENES') || '';
    const outro = extract('OUTRO') || '';
    const cta = extract('CTA') || '';

    const retentionRaw = extract('RETENTION_MOMENTS');
    const retentionMoments = retentionRaw
      ? retentionRaw.split('\n').filter(l => l.trim()).map(line => {
          const parts = line.split('-').map(s => s.trim());
          return { timestamp: parts[0] || '0:00', technique: parts[1] || 'pattern interrupt' };
        })
      : [];

    const emotionalTriggers = extractList('EMOTIONAL_TRIGGERS');

    const sceneLines = mainContent.split('\n').filter(l => l.trim() && l.includes('|'));
    const sceneBreakdown = sceneLines.map(line => {
      const parts = line.split('|').map(s => s.trim());
      return {
        text: parts[0] || 'Scene',
        duration: Math.min(parseInt(parts[1]?.match(/\d+/)?.[0] || '5'), format === 'Shorts' ? 15 : 60),
        visual: parts[2] || 'cinematic shot',
      };
    });

    const totalDuration = sceneBreakdown.reduce((sum, s) => sum + s.duration, 0);
    const fullScript = [hook, intro, mainContent, outro, cta].filter(Boolean).join('\n\n');

    return {
      title,
      hook,
      intro,
      mainContent,
      outro,
      emotionalTriggers,
      retentionMoments,
      cta,
      durationTarget: totalDuration || (format === 'Shorts' ? 60 : 600),
      sceneBreakdown,
      fullScript,
    };
  }

  async generateTitleVariants(topic: string, count = 5): Promise<{ title: string; ctrScore: number; type: string }[]> {
    const result = await generateWithAI(`
      Generate ${count} viral YouTube titles for topic: "${topic}"

      Rules:
      - Under 60 characters
      - Strong emotional words (shocking, secret, never, illegal, insane, free)
      - Create curiosity gap
      - Include number if possible
      - High click probability

      Return JSON array:
      [
        {"title": "...", "ctrScore": 0-100, "type": "curiosity|fear|authority|transformation|listicle|mystery"},
        ...
      ]

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.5 });

    try {
      const parsed = extractJsonArray(result) as any[];
      return parsed ? parsed.slice(0, count) : [];
    } catch {
      return [
        { title: topic, ctrScore: 50, type: 'curiosity' },
        { title: `The Truth About ${topic}`, ctrScore: 65, type: 'mystery' },
      ];
    }
  }

  async generateHookVariants(topic: string, count = 5): Promise<{ hook: string; type: string; retentionScore: number }[]> {
    const result = await generateWithAI(`
      Generate ${count} viral hooks for YouTube video about: "${topic}"

      Hook templates to use:
      1. "I tried X so you don't have to"
      2. "Stop doing X, do this instead"
      3. "Nobody tells you this about X"
      4. "The truth about X"
      5. "X changed everything"
      6. "I found X and it's insane"
      7. "Don't start X until you watch this"

      Return JSON array:
      [
        {"hook": "first 5 seconds script", "type": "curiosity|shock|fear|mystery|greed", "retentionScore": 0-100},
        ...
      ]

      Return ONLY valid JSON.
    `, 'ollama', { temperature: 0.6 });

    try {
      const parsed = extractJsonArray(result) as any[];
      return parsed ? parsed.slice(0, count) : [];
    } catch {
      return [{ hook: `${topic} changed everything`, type: 'curiosity', retentionScore: 70 }];
    }
  }
}