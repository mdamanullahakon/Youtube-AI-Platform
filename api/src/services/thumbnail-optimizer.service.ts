import { generateWithAI } from './ai.service';
import { generateImage } from './image.service';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { prisma } from '../config/db';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface ThumbnailVariant {
  style: string;
  prompt: string;
  ctrProbability: number;
  emotionalImpact: number;
  clickCuriosity: number;
  colorContrast: number;
  composition: string;
  textOverlay: string;
}

export class ThumbnailOptimizer {
  async generateVariants(topic: string, hook: string, projectId: string, niche?: string): Promise<ThumbnailVariant[]> {
    logger.info(`Generating thumbnail variants for: ${topic}`);

    const strategy = niche ? await prisma.contentStrategy.findUnique({ where: { niche } }) : null;
    const preferredStyle = strategy?.thumbnailStyle || 'face-closeup-shock';

    const analysis = await generateWithAI(`
      Generate 5 YouTube thumbnail concepts for HIGH CTR.

      Topic: "${topic}"
      Hook: "${hook}"
      Preferred style: ${preferredStyle}

      Return JSON array of 5 thumbnails:
      [{
        "style": "face-closeup-shock" | "bold-text-contrast" | "curiosity-gap-emotional" | "before-after" | "number-list" | "reaction-meme" | "minimalist-mystery",
        "prompt": "detailed image generation prompt (for DALL-E/Midjourney)",
        "ctrProbability": 0-100,
        "emotionalImpact": 0-100,
        "clickCuriosity": 0-100,
        "colorContrast": 0-100,
        "composition": "describe the visual composition briefly",
        "textOverlay": "2-3 word text overlay for the thumbnail"
      }]

      Thumbnail rules for HIGH CTR:
      - Bright, contrasting colors (red/yellow/blue)
      - Close-up face with extreme emotion
      - Curiosity gap in the expression
      - Bold text (max 3 words)
      - Dark background with vibrant subject
      - Make it stand out in a stack of recommended videos
      - Emotional expression must be instantly readable
      - Text must create more curiosity than it satisfies

      Return ONLY valid JSON array.
    `, 'ollama', { temperature: 0.8 });

    try {
      const parsed = extractJsonArray(analysis);
      if (!parsed) return this.getDefaultVariants(topic, hook);

      return parsed.map((t: any) => ({
        style: t.style || preferredStyle,
        prompt: t.prompt || '',
        ctrProbability: Math.min(100, Math.max(0, t.ctrProbability || 50)),
        emotionalImpact: Math.min(100, Math.max(0, t.emotionalImpact || 50)),
        clickCuriosity: Math.min(100, Math.max(0, t.clickCuriosity || 50)),
        colorContrast: Math.min(100, Math.max(0, t.colorContrast || 50)),
        composition: t.composition || '',
        textOverlay: t.textOverlay || '',
      }));
    } catch {
      logger.warn('Failed to parse thumbnail variants, using defaults');
      return this.getDefaultVariants(topic, hook);
    }
  }

  async pickBestVariant(variants: ThumbnailVariant[]): Promise<ThumbnailVariant> {
    if (variants.length === 0) return this.getDefaultVariants('Topic', 'Hook')[0];

    const ranked = variants.sort((a, b) => {
      const aScore = a.ctrProbability * 0.4 + a.clickCuriosity * 0.3 + a.emotionalImpact * 0.2 + a.colorContrast * 0.1;
      const bScore = b.ctrProbability * 0.4 + b.clickCuriosity * 0.3 + b.emotionalImpact * 0.2 + b.colorContrast * 0.1;
      return bScore - aScore;
    });

    return ranked[0];
  }

  async generatePhysicalImage(variant: ThumbnailVariant, outputPath: string): Promise<string | null> {
    return generateImage(variant.prompt, outputPath);
  }

  private getDefaultVariants(topic: string, hook: string): ThumbnailVariant[] {
    const base = `YouTube thumbnail about ${topic}`;
    return [
      { style: 'face-closeup-shock', prompt: `${base}, close-up face with shocked expression, mouth open, eyes wide, dark background with dramatic lighting`, ctrProbability: 85, emotionalImpact: 90, clickCuriosity: 85, colorContrast: 75, composition: 'Close-up face center, blurred dark background', textOverlay: 'SHOCKING TRUTH' },
      { style: 'bold-text-contrast', prompt: `${base}, bold red and yellow text on black background, minimal design, dramatic lighting effects`, ctrProbability: 80, emotionalImpact: 65, clickCuriosity: 80, colorContrast: 95, composition: 'Text centered, gradient background', textOverlay: 'YOU WON\'T BELIEVE' },
      { style: 'curiosity-gap-emotional', prompt: `${base}, emotional face half-lit, mysterious expression, curiosity gap, cinematic lighting`, ctrProbability: 82, emotionalImpact: 85, clickCuriosity: 90, colorContrast: 70, composition: 'Split lighting on face, dark foreground', textOverlay: 'THE REAL REASON' },
      { style: 'before-after', prompt: `${base}, split screen showing dramatic transformation, left side dark/grainy, right side bright/successful`, ctrProbability: 75, emotionalImpact: 80, clickCuriosity: 75, colorContrast: 85, composition: 'Vertical split, two contrasting scenes', textOverlay: 'DAY 1 VS DAY 30' },
      { style: 'number-list', prompt: `${base}, large bold numbers on colorful background, list format, eye-catching gradient`, ctrProbability: 70, emotionalImpact: 60, clickCuriosity: 75, colorContrast: 90, composition: 'Large number center, colorful gradient background', textOverlay: '3 REASONS WHY' },
    ];
  }
}
