import { env } from '../config/env';
import { logger } from '../utils/logger';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GRADIENT_COLORS = [
  ['1a0a2e', '0a0a23'],
  ['0a2e1a', '0a1a2e'],
  ['2e1a0a', '1a0a0a'],
  ['0a1a3e', '0a0a2e'],
  ['2e0a1a', '1a0a1a'],
  ['1a2e0a', '0a2e0a'],
  ['2e2e0a', '1a1a0a'],
  ['1a0a2e', '2e0a3e'],
];

function cacheKey(query: string): string {
  return crypto.createHash('md5').update(query.toLowerCase()).digest('hex');
}

function getGradientForQuery(query: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < query.length; i++) {
    hash = ((hash << 5) - hash) + query.charCodeAt(i);
  }
  const idx = Math.abs(hash) % GRADIENT_COLORS.length;
  const colors = GRADIENT_COLORS[idx];
  return [colors[0], colors[1]];
}

async function generateGradientImage(query: string, outputPath: string): Promise<boolean> {
  const [color1, color2] = getGradientForQuery(query);
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    const cmd = `"${ffmpegPath}" -f lavfi -i "color=c=0x${color1}:s=1920x1080:d=5:r=1,format=rgba" ` +
      `-f lavfi -i "color=c=0x${color2}:s=1920x1080:d=5:r=1,format=rgba" ` +
      `-filter_complex "[0][1]blend=all_mode=addition:all_opacity=0.3[bg]; ` +
      `[bg]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.05:t=fill, ` +
      `gblur=sigma=20:steps=3,format=yuv420p" ` +
      `-frames:v 1 "${outputPath}" -y`;
    await execAsync(cmd, { timeout: 15000 });
    return true;
  } catch (err: any) {
    logger.warn(`Gradient generation failed: ${err.message}`);
    return false;
  }
}

async function fetchFromPexels(query: string): Promise<string | null> {
  if (!env.PEXELS_API_KEY) return null;
  try {
    const { default: axios } = await import('axios');
    const response = await axios.get('https://api.pexels.com/v1/search', {
      headers: { Authorization: env.PEXELS_API_KEY },
      params: { query, per_page: 1, orientation: 'landscape', size: 'large' },
      timeout: 10000,
    });
    return response.data?.photos?.[0]?.src?.landscape || null;
  } catch (err: any) {
    logger.warn(`Pexels search failed for "${query}": ${err.message}`);
    return null;
  }
}

async function fetchFromPixabay(query: string): Promise<string | null> {
  if (!env.PIXABAY_API_KEY) return null;
  try {
    const { default: axios } = await import('axios');
    const response = await axios.get('https://pixabay.com/api/', {
      params: { key: env.PIXABAY_API_KEY, q: query, image_type: 'photo', orientation: 'horizontal', per_page: 3 },
      timeout: 10000,
    });
    return response.data?.hits?.[0]?.largeImageURL || null;
  } catch (err: any) {
    logger.warn(`Pixabay search failed for "${query}": ${err.message}`);
    return null;
  }
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  try {
    const { default: axios } = await import('axios');
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
    await writeFile(destPath, Buffer.from(response.data));
    return true;
  } catch (err: any) {
    logger.warn(`Image download failed: ${err.message}`);
    return false;
  }
}

async function generateWithDalle(prompt: string, outputPath: string): Promise<boolean> {
  if (!env.OPENAI_API_KEY) return false;
  try {
    const { default: axios } = await import('axios');
    const response = await axios.post(
      'https://api.openai.com/v1/images/generations',
      {
        model: 'dall-e-3',
        prompt: `YouTube thumbnail: ${prompt}. High contrast, vibrant colors, 16:9 aspect ratio, photorealistic style`,
        n: 1,
        size: '1792x1024',
        quality: 'hd',
      },
      {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      }
    );

    const imageUrl = response.data?.data?.[0]?.url;
    if (!imageUrl) return false;

    const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    await writeFile(outputPath, Buffer.from(imgResponse.data));
    logger.info(`DALL-E 3 image generated: ${outputPath}`);
    return true;
  } catch (err: any) {
    logger.warn(`DALL-E 3 generation failed: ${err.message}`);
    return false;
  }
}

export async function generateImage(prompt: string, outputPath: string): Promise<string | null> {
  logger.info(`Generating thumbnail image: "${prompt.slice(0, 60)}..."`);

  await mkdir(outputPath.split('\\').slice(0, -1).join('\\') || outputPath.split('/').slice(0, -1).join('/'), { recursive: true }).catch(() => {});

  // Try DALL-E 3 first
  if (await generateWithDalle(prompt, outputPath)) return outputPath;

  // Fallback: fetch from Pexels/Pixabay using prompt keywords
  const searchTerm = prompt.split(' ').slice(0, 6).join(' ');
  const fetchedUrl = await fetchFromPexels(searchTerm) || await fetchFromPixabay(searchTerm);
  if (fetchedUrl) {
    const downloaded = await downloadImage(fetchedUrl, outputPath);
    if (downloaded) return outputPath;
  }

  logger.warn(`All image generation paths failed for: "${prompt.slice(0, 60)}..."`);
  return null;
}

export async function fetchBackgroundImage(searchTerm: string): Promise<string | null> {
  const key = cacheKey(searchTerm);
  const cacheDir = join(process.cwd(), 'temp', 'bg_cache');
  const localPath = join(cacheDir, `${key}.jpg`);

  if (existsSync(localPath)) return localPath;

  await mkdir(cacheDir, { recursive: true }).catch(() => {});

  // Try real image APIs first
  let imageUrl = await fetchFromPexels(searchTerm);
  if (!imageUrl) imageUrl = await fetchFromPixabay(searchTerm);

  if (imageUrl) {
    const downloaded = await downloadImage(imageUrl, localPath);
    if (downloaded) return localPath;
  }

  // Fallback: generate gradient image
  const gradientOk = await generateGradientImage(searchTerm, localPath);
  if (gradientOk) return localPath;

  return null;
}
