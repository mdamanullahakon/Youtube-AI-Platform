import { generateWithAI } from '../services/ai.service';
import { logger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';

export interface SEOResult {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  keywords: string[];
}

export async function optimizeSEO(topic: string, hook: string): Promise<SEOResult> {
  logger.info(`Optimizing SEO for: ${topic}`);

  const seoContent = await generateWithAI(`
    Generate YouTube SEO optimized content for a video about: "${topic}"
    Hook: "${hook}"

    Return JSON with:
    {
      "title": "Click-worthy title (use power words, numbers, curiosity, max 70 chars)",
      "description": "SEO-optimized description with keywords, timestamps, links (max 200 words)",
      "tags": ["tag1", "tag2", ...] (10-15 relevant tags),
      "hashtags": ["#hashtag1", "#hashtag2", ...] (3-5 hashtags),
      "keywords": ["keyword1", "keyword2", ...] (5-10 keywords)
    }

    Rules:
    - Title must create curiosity gap
    - Include high-volume keywords
    - Description must hook readers in first 2 lines
    - Tags must include broad + specific terms
    - Return ONLY valid JSON
  `, 'ollama', { temperature: 0.5 });

  try {
    const parsed = extractJson<SEOResult>(seoContent);
    if (!parsed) throw new Error();
    return parsed;
  } catch {
    logger.warn('Failed to parse SEO JSON, using defaults');
    return {
      title: `${topic}: The Shocking Truth Revealed`,
      description: `In this video, we explore ${topic}. The insights will change how you think.\n\nTimestamps:\n0:00 - Introduction\n0:30 - Main Content\n\n#${topic.replace(/\s+/g, '')} #Viral`,
      tags: [topic, 'viral', 'trending', 'youtube', 'must watch'],
      hashtags: [`#${topic.replace(/\s+/g, '')}`, '#Viral', '#Trending'],
      keywords: [topic, 'viral video', 'trending topic'],
    };
  }
}
