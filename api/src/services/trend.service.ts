import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';

export interface TrendResult {
  title: string;
  url: string;
  source: string;
  score: number;
}

export async function getYouTubeTrends(): Promise<string[]> {
  try {
    const response = await axios.get('https://www.youtube.com/feed/trending', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const html = response.data;
    const $ = cheerio.load(html);
    const titles: string[] = [];
    $('a').each((_, element) => {
      const title = $(element).attr('title');
      if (title && title.length > 20) {
        titles.push(title);
      }
    });
    return titles.slice(0, 10);
  } catch (error) {
    logger.error('Failed to fetch YouTube trends', error);
    return [];
  }
}

export async function getGoogleTrends(keyword: string): Promise<TrendResult[]> {
  try {
    const response = await axios.get(
      `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`,
      { timeout: 10000 }
    );
    const $ = cheerio.load(response.data);
    const results: TrendResult[] = [];
    $('md-chip').each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        results.push({ title: text, url: '', source: 'google-trends', score: 50 });
      }
    });
    return results.slice(0, 5);
  } catch (error) {
    logger.error('Failed to fetch Google Trends', error);
    return [];
  }
}

export async function getRedditTrends(subreddit = 'videos'): Promise<TrendResult[]> {
  try {
    const response = await axios.get(
      `https://www.reddit.com/r/${subreddit}/hot.json?limit=10`,
      {
        timeout: 10000,
        headers: { 'User-Agent': 'YouTubeAI/1.0' },
      }
    );
    return response.data.data.children.map((child: any) => ({
      title: child.data.title,
      url: `https://reddit.com${child.data.permalink}`,
      source: 'reddit',
      score: child.data.score || 0,
    }));
  } catch (error) {
    logger.error('Failed to fetch Reddit trends', error);
    return [];
  }
}
