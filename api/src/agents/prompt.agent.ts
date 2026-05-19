import { generateWithAI } from '../services/ai.service';
import { aiLogger as logger } from '../utils/logger';

export interface VisualPrompt {
  sceneIndex: number;
  text: string;
  prompt: string;
  platform: string;
}

export async function generateVisualPrompts(
  scenes: { text: string; visualPrompt: string }[]
): Promise<VisualPrompt[]> {
  logger.info(`Generating visual prompts for ${scenes.length} scenes`);

  const platforms = ['runway', 'midjourney', 'stable-diffusion', 'flux'];

  const results: VisualPrompt[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const platform = platforms[i % platforms.length];

    const prompt = await generateWithAI(`
      Create a cinematic AI video generation prompt for ${platform}.
      Scene text: "${scene.text}"
      Visual style: "${scene.visualPrompt}"

      Requirements:
      - Cinematic lighting
      - Emotional atmosphere
      - Dynamic composition
      - ${platform === 'runway' ? 'Smooth motion, camera movement' : ''}
      ${platform === 'midjourney' ? '--ar 16:9 --style raw --v 6' : ''}
      ${platform === 'flux' ? 'Photorealistic, highly detailed' : ''}

      Return ONLY the prompt, no explanations.
    `, 'ollama', { temperature: 0.7 });

    results.push({
      sceneIndex: i,
      text: scene.text,
      prompt: prompt.trim(),
      platform,
    });
  }

  logger.info(`Generated ${results.length} visual prompts`);
  return results;
}
