import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { logger } from '../utils/logger';
import { env } from '../config/env';

const PEXELS_API_URL = 'https://api.pexels.com/videos/search';
const PIXABAY_API_URL = 'https://pixabay.com/api/videos/';

interface StockVideoResult {
  url: string;
  width: number;
  height: number;
  duration: number;
}

export async function searchStockFootage(query: string, outputPath: string): Promise<string | null> {
  try {
    await mkdir(join(outputPath, '..'), { recursive: true });

    const result = env.PEXELS_API_KEY
      ? await searchPexels(query)
      : await searchPixabay(query);

    if (!result) {
      logger.warn(`No stock footage found for: ${query}`);
      return null;
    }

    const ext = extname(result.url) || '.mp4';
    const videoPath = outputPath.endsWith(ext) ? outputPath : outputPath + ext;
    const response = await axios.get(result.url, { responseType: 'arraybuffer', timeout: 30000 });
    await writeFile(videoPath, Buffer.from(response.data));
    logger.info(`Downloaded stock footage: ${query} (${(response.data.length / 1024 / 1024).toFixed(1)}MB)`);
    return videoPath;
  } catch (error: any) {
    logger.warn(`Stock footage fetch failed for "${query}"`, { error: error.message });
    return null;
  }
}

async function searchPexels(query: string): Promise<StockVideoResult | null> {
  const key = env.PEXELS_API_KEY;
  if (!key) return null;

  const response = await axios.get(PEXELS_API_URL, {
    headers: { Authorization: key },
    params: { query, per_page: 5, orientation: 'landscape', size: 'medium' },
    timeout: 10000,
  });

  const videos = response.data?.videos;
  if (!videos?.length) return null;

  for (const video of videos) {
    const hd = video.video_files?.find((f: any) => f.quality === 'hd' && f.width >= 1280);
    if (hd) return { url: hd.link, width: hd.width, height: hd.height, duration: video.duration };
  }

  const fallback = videos[0]?.video_files?.[0];
  if (fallback) return { url: fallback.link, width: fallback.width, height: fallback.height, duration: videos[0].duration };
  return null;
}

async function searchPixabay(query: string): Promise<StockVideoResult | null> {
  const key = env.PIXABAY_API_KEY;
  if (!key) return null;

  const response = await axios.get(PIXABAY_API_URL, {
    params: { key, q: query, safesearch: true, per_page: 5 },
    timeout: 10000,
  });

  const hits = response.data?.hits;
  if (!hits?.length) return null;

  for (const hit of hits) {
    const hdVideos = hit.videos?.large_hd || hit.videos?.medium?.url || hit.videos?.small?.url;
    if (typeof hdVideos === 'string') {
      return { url: hdVideos, width: hit.videos?.large?.width || 1920, height: hit.videos?.large?.height || 1080, duration: hit.duration };
    }
    if (hit.videos?.large) {
      return { url: hit.videos.large.url, width: hit.videos.large.width, height: hit.videos.large.height, duration: hit.duration };
    }
  }

  const firstHit = hits[0];
  const videoObj = firstHit.videos?.medium || firstHit.videos?.small;
  if (videoObj) return { url: videoObj.url, width: videoObj.width, height: videoObj.height, duration: firstHit.duration };
  return null;
}
