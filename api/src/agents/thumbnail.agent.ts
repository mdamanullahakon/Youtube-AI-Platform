import { generateWithAI } from '../services/ai.service';
import { generateImage } from '../services/image.service';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';
import { CTRAnalyzer } from '../services/ctr-analyzer.service';
import { FeedbackEngine } from '../services/feedback-engine.service';

const ctrAnalyzer = new CTRAnalyzer();
const feedbackEngine = new FeedbackEngine();

export interface ThumbnailResult {
  prompt: string;
  imageUrl: string | null;
  style: string;
  ctr: number;
}

const THUMBNAIL_STYLES = [
  { name: 'face-closeup-shock', description: 'Close-up face with extreme emotional expression (shock, awe, excitement), blurred background' },
  { name: 'bold-text-contrast', description: 'Bold, large text (2-3 words) with high contrast colors, minimal design' },
  { name: 'curiosity-gap-emotional', description: 'Emotional face + curiosity gap text, split composition' },
  { name: 'before-after', description: 'Split screen showing transformation, dramatic difference' },
  { name: 'number-list', description: 'List format with prominent numbers, colorful background' },
] as const;

export async function generateThumbnail(
  topic: string,
  hook: string,
  projectId: string
): Promise<ThumbnailResult> {
  logger.info(`Generating thumbnail for: ${topic}`);

  // Get feedback from learning engine to choose best thumbnail style
  const feedback = await feedbackEngine.getScriptFeedback(topic);
  const thumbnailGuidance = feedback.thumbnailGuidance;

  // Determine best style based on historical CTR data
  let bestStyle = 'curiosity-gap-emotional';
  let bestCTR = 0;

  for (const style of THUMBNAIL_STYLES) {
    const predictedCTR = await ctrAnalyzer.predictThumbnailCTR(style.name, topic);
    if (predictedCTR > bestCTR) {
      bestCTR = predictedCTR;
      bestStyle = style.name;
    }
  }

  const styleInfo = THUMBNAIL_STYLES.find(s => s.name === bestStyle);

  logger.info(`Selected thumbnail style "${bestStyle}" (predicted CTR: ${bestCTR}%) for project ${projectId}`);

  const styleGuidanceText = thumbnailGuidance.length > 0
    ? `\nLearned insights from past performance:\n${thumbnailGuidance.map((g, i) => `  ${i + 1}. ${g}`).join('\n')}`
    : '';

  const prompt = await generateWithAI(`
    Create a YouTube thumbnail prompt that will get HIGH CTR (click-through rate).

    Video Topic: ${topic}
    Hook: ${hook}
    Selected Style: ${styleInfo?.description || 'curiosity-gap-emotional'}
    Target CTR: ${bestCTR}%${styleGuidanceText}

    Rules:
    - Use the selected style as primary guidance
    - Create curiosity gap
    - Emotional expression
    - Bold, contrasting colors
    - Bold overlay text: MAX 3-5 words only, high contrast, readable at small size
    - Close-up face with strong emotion
    - Bright, eye-catching design
    - Dark background with vibrant subject
    - Make it stand out in YouTube recommendations

    Return ONLY the prompt, no explanations.
  `, 'ollama', { temperature: 0.8 });

  const thumbnailPrompt = prompt.trim();
  const outputDir = join(process.cwd(), 'uploads', 'thumbnails');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${projectId}_${Date.now()}.png`);

  const imagePath = await generateImage(thumbnailPrompt, outputPath);

  // Save thumbnail performance data for future learning
  await ctrAnalyzer.saveThumbnailPerformance(projectId, bestStyle, thumbnailPrompt, bestCTR);

  logger.info(`Thumbnail generated: style=${bestStyle}, predictedCTR=${bestCTR}%, image=${imagePath ? 'created' : 'pending'}`);

  return {
    prompt: thumbnailPrompt,
    imageUrl: imagePath ? `/uploads/thumbnails/${projectId}_${Date.now()}.png` : null,
    style: bestStyle,
    ctr: bestCTR,
  };
}
