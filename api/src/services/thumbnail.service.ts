// Thumbnail generation service — supports local rendering + cloud APIs
import axios from 'axios';
import { promises as fs } from 'fs';
import { join } from 'path';
import { generateText } from './llm.service';

export type ThumbnailOptions = {
  title: string;
  topic?: string;
  style?: 'minimal' | 'bold' | 'cinematic'; // defaults to 'bold'
};

async function generateThumbnailPrompt(opts: ThumbnailOptions): Promise<string> {
  const prompt = `Create a YouTube thumbnail prompt for:
Title: "${opts.title}"
Topic: "${opts.topic || opts.title}"
Style: ${opts.style || 'bold'}

Generate a detailed Midjourney or DALL-E prompt that will produce a HIGH-CTR thumbnail:
- Bold colors that stand out in recommendations
- Clear, readable text if needed
- Emotional hook (curiosity, surprise, urgency)
- 16:9 aspect ratio optimized
- Professional quality

Return ONLY the image generation prompt, no explanation.`;

  try {
    return await generateText(prompt, { maxTokens: 512, temperature: 0.8 });
  } catch (err) {
    return `YouTube thumbnail for "${opts.title}": bold, high-CTR design, professional quality, 1280x720, eye-catching colors`;
  }
}

export async function generateThumbnailWithMidjourney(opts: ThumbnailOptions): Promise<string> {
  // This is a placeholder. In production, integrate with Midjourney API or Discord bot.
  const prompt = await generateThumbnailPrompt(opts);
  const tmp = join(process.cwd(), 'tmp');
  await fs.mkdir(tmp, { recursive: true });

  const outPath = join(tmp, `thumbnail-${Date.now()}.url`);
  const content = `[THUMBNAIL_PLACEHOLDER]\nPrompt: ${prompt}\nService: Midjourney (manual run required)\nExpected: High-CTR YouTube thumbnail (1280x720)`;
  await fs.writeFile(outPath, content, 'utf8');

  console.info('[ThumbnailService] Midjourney placeholder saved (manual generation required):', outPath);
  return outPath;
}

export async function generateThumbnailWithStableDiffusion(opts: ThumbnailOptions): Promise<string> {
  const stableDiffUrl = process.env.STABLE_DIFFUSION_API_URL || 'http://localhost:7860';
  const prompt = await generateThumbnailPrompt(opts);

  try {
    const resp = await axios.post(`${stableDiffUrl}/api/txt2img`, {
      prompt,
      negative_prompt: 'low quality, blurry, distorted',
      steps: 30,
      cfg_scale: 7,
      width: 1280,
      height: 720,
      sampler_name: 'DPM++ 2M Karras',
    }, { timeout: 120000 });

    if (resp.data.images && resp.data.images.length > 0) {
      const tmp = join(process.cwd(), 'tmp');
      await fs.mkdir(tmp, { recursive: true });
      const base64Img = resp.data.images[0];
      const outPath = join(tmp, `thumbnail-${Date.now()}.png`);
      await fs.writeFile(outPath, Buffer.from(base64Img, 'base64'));
      console.info('[ThumbnailService] Generated thumbnail via Stable Diffusion:', outPath);
      return outPath;
    }
  } catch (err: any) {
    console.warn('[ThumbnailService] Stable Diffusion generation failed:', err.message || err);
  }

  // Fallback to placeholder
  const tmp = join(process.cwd(), 'tmp');
  await fs.mkdir(tmp, { recursive: true });
  const outPath = join(tmp, `thumbnail-${Date.now()}.placeholder`);
  const content = `[THUMBNAIL_PLACEHOLDER]\nPrompt: ${prompt}\nService: Stable Diffusion\nStatus: Generation failed or not available`;
  await fs.writeFile(outPath, content, 'utf8');
  return outPath;
}

export async function generateThumbnail(opts: ThumbnailOptions): Promise<string> {
  // Try Stable Diffusion first, fall back to Midjourney placeholder
  const stableDiffUrl = process.env.STABLE_DIFFUSION_API_URL;
  if (stableDiffUrl) {
    try {
      return await generateThumbnailWithStableDiffusion(opts);
    } catch (err) {
      console.warn('[ThumbnailService] Stable Diffusion unavailable, trying Midjourney placeholder');
    }
  }

  return generateThumbnailWithMidjourney(opts);
}

export async function enhanceThumbnailPrompt(basePrompt: string): Promise<string> {
  const prompt = `Enhance this YouTube thumbnail prompt for maximum CTR:
Base: "${basePrompt}"

Return an improved prompt that includes:
- Color psychology (proven CTR boosters)
- Composition (rule of thirds, focal points)
- Emotional triggers (curiosity, FOMO, surprise)
- Text overlay positioning
- Professional polish

Return ONLY the enhanced prompt.`;

  try {
    return await generateText(prompt, { maxTokens: 256, temperature: 0.7 });
  } catch (err) {
    return basePrompt;
  }
}

export default { generateThumbnail, generateThumbnailWithStableDiffusion, generateThumbnailWithMidjourney, enhanceThumbnailPrompt };
