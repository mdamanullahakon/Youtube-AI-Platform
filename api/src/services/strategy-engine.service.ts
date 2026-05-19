import { prisma } from '../config/db';
import { generateWithAI } from './ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export const NICHE_STRATEGIES = {
  'AI News': { pacing: 'fast-paced', hookStyle: 'curiosity-gap', thumbnailStyle: 'bold-text-contrast', tone: 'authoritative-excited', avgDuration: '8-10min', ctaStyle: 'curiosity', storytellingArc: 'revelation' },
  'Tech Facts': { pacing: 'fast-paced', hookStyle: 'shocking-statistic', thumbnailStyle: 'number-list', tone: 'enthusiastic-educational', avgDuration: '6-8min', ctaStyle: 'value', storytellingArc: 'list-format' },
  'Business Stories': { pacing: 'moderate', hookStyle: 'story-bait', thumbnailStyle: 'face-closeup-shock', tone: 'storytelling-dramatic', avgDuration: '10-15min', ctaStyle: 'emotional', storytellingArc: 'hero-journey' },
  'Motivation': { pacing: 'varied', hookStyle: 'bold-statement', thumbnailStyle: 'face-closeup-shock', tone: 'inspirational-powerful', avgDuration: '5-8min', ctaStyle: 'challenge', storytellingArc: 'transformation' },
  'Celebrity Stories': { pacing: 'moderate', hookStyle: 'provocative-question', thumbnailStyle: 'curiosity-gap-emotional', tone: 'dramatic-secretive', avgDuration: '8-12min', ctaStyle: 'curiosity', storytellingArc: 'reveal' },
  'Horror': { pacing: 'slow-burn', hookStyle: 'pattern-interrupt', thumbnailStyle: 'minimalist-mystery', tone: 'creepy-suspenseful', avgDuration: '10-15min', ctaStyle: 'fear-of-missing', storytellingArc: 'mystery-box' },
  'True Crime': { pacing: 'slow-burn', hookStyle: 'story-bait', thumbnailStyle: 'minimalist-mystery', tone: 'serious-investigative', avgDuration: '15-20min', ctaStyle: 'intrigue', storytellingArc: 'investigation' },
  'Finance': { pacing: 'moderate', hookStyle: 'shocking-statistic', thumbnailStyle: 'bold-text-contrast', tone: 'authoritative-trustworthy', avgDuration: '8-12min', ctaStyle: 'value', storytellingArc: 'problem-solution' },
  'Horror-Paranormal': { pacing: 'slow-burn', hookStyle: 'pattern-interrupt', thumbnailStyle: 'minimalist-mystery', tone: 'whisper-tense', avgDuration: '8-12min', ctaStyle: 'fear-of-missing', storytellingArc: 'discovery' },
  'Horror-Psychological': { pacing: 'varied', hookStyle: 'provocative-question', thumbnailStyle: 'face-closeup-shock', tone: 'controlled-creepy', avgDuration: '10-15min', ctaStyle: 'existential-dread', storytellingArc: 'descent' },
  'Horror-Analog': { pacing: 'slow-burn', hookStyle: 'curiosity-gap', thumbnailStyle: 'vhs-static', tone: 'archival-calm', avgDuration: '8-12min', ctaStyle: 'mystery', storytellingArc: 'unraveling' },
  'Horror-MissingPersons': { pacing: 'investigative', hookStyle: 'story-bait', thumbnailStyle: 'document-dark', tone: 'serious-ominous', avgDuration: '10-15min', ctaStyle: 'intrigue', storytellingArc: 'investigation' },
  'Horror-Forest': { pacing: 'slow-burn', hookStyle: 'pattern-interrupt', thumbnailStyle: 'dark-landscape', tone: 'isolated-tense', avgDuration: '8-12min', ctaStyle: 'survival', storytellingArc: 'descent' },
  'Horror-Ritual': { pacing: 'escalating', hookStyle: 'forbidden-knowledge', thumbnailStyle: 'symbol-dark', tone: 'ominous-ceremonial', avgDuration: '10-15min', ctaStyle: 'forbidden-curiosity', storytellingArc: 'mystery-box' },
};

export const HORROR_CHANNEL_CONFIGS = [
  {
    id: 'channel-horror-paranormal',
    name: 'Shadows Unseen',
    niche: 'Horror-Paranormal',
    description: 'Paranormal horror, ghost encounters, haunted locations, supernatural mysteries',
    uploadSchedule: { frequency: 'daily', preferredTime: '20:00', timezone: 'UTC' },
    thumbnailStyle: 'minimalist-mystery',
    colorPalette: 'deep blacks, desaturated grays, single red accent',
    introStyle: 'found-footage VHS static opening',
    musicMood: 'suspense',
    targetDuration: '8-12min',
    seoKeywords: ['paranormal', 'ghost', 'haunted', 'supernatural', 'unexplained'],
  },
  {
    id: 'channel-horror-psychological',
    name: 'Mind Gap',
    niche: 'Horror-Psychological',
    description: 'Psychological horror, mind-bending stories, reality distortion, existential dread',
    uploadSchedule: { frequency: 'daily', preferredTime: '21:00', timezone: 'UTC' },
    thumbnailStyle: 'face-closeup-shock',
    colorPalette: 'cold blues, sterile whites, deep shadows',
    introStyle: 'first-person POV, heavy breathing opening',
    musicMood: 'cinematic',
    targetDuration: '10-15min',
    seoKeywords: ['psychological', 'mind-bending', 'existential', 'disturbing', 'reality'],
  },
  {
    id: 'channel-horror-analog',
    name: 'Archive 87',
    niche: 'Horror-Analog',
    description: 'Analog horror, VHS tapes, emergency broadcasts, archived footage, government coverups',
    uploadSchedule: { frequency: 'every-other-day', preferredTime: '22:00', timezone: 'UTC' },
    thumbnailStyle: 'vhs-static',
    colorPalette: 'vhs scanlines, static white, tape degradation, sepia',
    introStyle: 'emergency broadcast system warning opening',
    musicMood: 'ambient-drone',
    targetDuration: '8-12min',
    seoKeywords: ['analog horror', 'vhs', 'found footage', 'archive', 'broadcast'],
  },
];

export class StrategyEngine {
  async getOrCreateStrategy(niche: string, channelId?: string, userId?: string) {
    const existing = await prisma.contentStrategy.findUnique({ where: { niche } });
    if (existing) return existing;

    const defaults = NICHE_STRATEGIES[niche as keyof typeof NICHE_STRATEGIES];
    if (defaults) {
      return prisma.contentStrategy.create({
        data: { niche, channelId, userId, ...defaults },
      });
    }

    const strategy = await generateWithAI(`
      Create a YouTube content strategy profile for this niche: "${niche}"

      Return JSON:
      {
        "pacingStyle": "fast-paced" | "moderate" | "slow-burn" | "varied",
        "hookStyle": "curiosity-gap" | "pattern-interrupt" | "provocative-question" | "bold-statement" | "shocking-statistic" | "story-bait",
        "thumbnailStyle": "face-closeup-shock" | "bold-text-contrast" | "curiosity-gap-emotional" | "before-after" | "number-list" | "minimalist-mystery",
        "tone": "describe the ideal tone",
        "avgDuration": "ideal video length",
        "ctaStyle": "best CTA approach",
        "storytellingArc": "best storytelling structure",
        "targetAudience": "who watches this niche",
        "colorPalette": "colors that work in this niche"
      }

      Rules:
      - Be specific to the niche
      - Consider what actually works on YouTube for this category
      - Return ONLY valid JSON
    `, 'ollama', { temperature: 0.4 });

    try {
      const parsed = extractJson(strategy) as any;

      return prisma.contentStrategy.create({
        data: {
          niche,
          channelId,
          userId,
          pacingStyle: parsed.pacingStyle || 'moderate',
          hookStyle: parsed.hookStyle || 'curiosity-gap',
          thumbnailStyle: parsed.thumbnailStyle || 'face-closeup-shock',
          tone: parsed.tone || 'neutral',
          avgDuration: parsed.avgDuration || '8-10min',
          ctaStyle: parsed.ctaStyle || 'direct',
          storytellingArc: parsed.storytellingArc || 'problem-solution',
          targetAudience: parsed.targetAudience || null,
          colorPalette: parsed.colorPalette || null,
          metadata: { tone: parsed.tone, targetAudience: parsed.targetAudience, colorPalette: parsed.colorPalette },
        },
      });
    } catch {
      return prisma.contentStrategy.create({
        data: { niche, channelId, userId },
      });
    }
  }

  async enrichPromptWithStrategy(prompt: string, niche: string): Promise<string> {
    const strategy = await this.getOrCreateStrategy(niche);

    const enrichment = `
--- NICHE-SPECIFIC STRATEGY ---
Niche: ${niche}
Pacing: ${strategy.pacingStyle}
Hook Style: ${strategy.hookStyle}
Thumbnail Style: ${strategy.thumbnailStyle}
Tone: ${strategy.tone}
Storytelling Arc: ${strategy.storytellingArc}
CTA Style: ${strategy.ctaStyle}
Target Duration: ${strategy.avgDuration}
`;

    return prompt + enrichment;
  }

  async getStrategyForNiche(niche: string) {
    return this.getOrCreateStrategy(niche);
  }

  async listStrategies(userId?: string) {
    const where: any = {};
    if (userId) where.userId = userId;

    return prisma.contentStrategy.findMany({
      where,
      orderBy: { niche: 'asc' },
    });
  }
}
