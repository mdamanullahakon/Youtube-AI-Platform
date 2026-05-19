import { generateWithAI } from './ai.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';

export class ContentQualityService {
  async humanizeScript(scriptContent: string, format: string, niche?: string): Promise<string> {
    logger.info('Humanizing script for natural tone');

    const strategy = niche ? await prisma.contentStrategy.findUnique({ where: { niche } }) : null;

    const humanized = await generateWithAI(`
      Rewrite this YouTube ${format} script to sound NATURALLY HUMAN.
      Remove ALL robotic, AI-generated tone.

      Current script:
      "${scriptContent.substring(0, 4000)}"

      ${strategy ? `\nNiche: ${niche}\nTone: ${strategy.tone}\nPacing: ${strategy.pacingStyle}` : ''}

      RULES (MUST FOLLOW):
      - Write like a real person speaking naturally
      - Add conversational fillers ("you know", "here's the thing", "honestly")
      - Vary sentence length (short punchy + longer flowing)
      - Use contractions (don't, can't, won't, it's)
      - Add emotional emphasis with words like "incredibly", "absolutely", "genuinely"
      - Include rhetorical questions
      - Use analogies and metaphors
      - Add suspense builders ("but here's where it gets interesting")
      - Remove: "furthermore", "moreover", "in addition", "consequently"
      - Replace: formal transitions with natural ones ("but", "so", "anyway", "actually")
      - Add personality and attitude appropriate to the topic
      - Keep the same structure: ---HOOK--- ---SCENES--- ---CTA---

      Return ONLY the rewritten script.
    `, 'ollama', { temperature: 0.8 });

    return humanized.trim();
  }

  async addEmotionalDepth(scriptContent: string): Promise<string> {
    const enhanced = await generateWithAI(`
      Add emotional depth and storytelling to this YouTube script.

      Script:
      "${scriptContent.substring(0, 4000)}"

      RULES:
      - Add emotional transitions between scenes
      - Create suspense before reveals
      - Add curiosity layering (tease what's coming next)
      - Include relatable human moments
      - Use sensory language (visual, auditory, emotional)
      - Add micro-stories within the main story
      - Create emotional peaks and valleys
      - End sections with hooks that demand continuation
      - Keep the same structure: ---HOOK--- ---SCENES--- ---CTA---

      Return ONLY the enhanced script.
    `, 'ollama', { temperature: 0.7 });

    return enhanced.trim();
  }

  async improvePacing(scriptContent: string, format: string): Promise<string> {
    const improved = await generateWithAI(`
      Optimize PACING for this YouTube ${format} script.

      Script:
      "${scriptContent.substring(0, 4000)}"

      RULES:
      - Every 10-15 seconds: add a pattern interrupt or mini-hook
      - ${format === 'Shorts' ? 'Keep every second valuable, no filler' : 'Vary pacing: fast sections followed by slower breathers'}
      - Shorten sections that drag
      - Add quick cuts between ideas
      - Use the "promise-pause-payoff" rhythm
      - Insert curiosity gaps at natural drop-off points
      - Remove repetitive information
      - Speed up transitions between scenes
      - Keep the same structure: ---HOOK--- ---SCENES--- ---CTA---

      Return ONLY the improved script.
    `, 'ollama', { temperature: 0.6 });

    return improved.trim();
  }

  async fullEnhance(scriptContent: string, format: string, niche?: string): Promise<string> {
    let enhanced = await this.humanizeScript(scriptContent, format, niche);
    enhanced = await this.addEmotionalDepth(enhanced);
    enhanced = await this.improvePacing(enhanced, format);
    return enhanced;
  }
}
