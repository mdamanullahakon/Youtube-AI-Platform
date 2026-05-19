import { generateWithAI } from '../services/ai.service';
import { logger } from '../utils/logger';
import { safeParseJson, extractJsonArray } from '../utils/parse-ai-response';

export interface HorrorSEOResult {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  hookLines: string[];
  communityPostTeaser: string;
  thumbnailText: string;
  altTitles: string[];
  shortsIdeas: string[];
}

const HORROR_TAG_POOL = [
  'scary stories', 'true horror', 'creepy pasta', 'horror stories',
  'paranormal activity', 'unexplained', 'creepy', 'disturbing',
  'psychological horror', 'analog horror', 'found footage',
  'nightmare fuel', 'haunting', 'dark web', 'missing 411',
  'unsolved mystery', 'creepy facts', 'horror narration',
  'scary voiceover', 'real horror', 'creepy encounters',
  'supernatural', 'ghost stories', 'horror shorts',
];

export async function generateHorrorSEO(
  storyTitle: string,
  topic: string,
  niche: string = 'psychological-horror',
  hook?: string,
): Promise<HorrorSEOResult> {
  logger.info(`Generating horror SEO for: "${storyTitle}"`);

  const prompt = `Create a COMPLETE YouTube SEO package for this horror story.

STORY TITLE: "${storyTitle}"
TOPIC: "${topic}"
NICHE: ${niche}
${hook ? `OPENING HOOK: "${hook}"` : ''}

Return EXACTLY this JSON structure - nothing else:
{
  "title": "SEO-optimized video title (create curiosity gap, 30-50 chars)",
  "description": "2-3 paragraph description. First paragraph: hook + story summary (2 sentences). Second paragraph: what viewer will experience. Third paragraph: call to action + channel subscription. Include relevant keywords naturally.",
  "tags": ["array", "of", "15-20", "relevant", "horror", "tags"],
  "hashtags": ["#array", "of", "5-8", "hashtags"],
  "hookLines": ["3-5 short lines that could be used as community post teasers or comment bait"],
  "communityPostTeaser": "A single 1-2 sentence teaser for YouTube community tab",
  "thumbnailText": "3-5 WORDS MAX for thumbnail overlay - must create instant curiosity",
  "altTitles": ["3 alternative titles", "for a/b testing", "different hook angles"],
  "shortsIdeas": ["3-4 specific 15-60 second clips", "that can be extracted", "as YouTube Shorts", "from this story"]
}

RULES:
- Title must create overwhelming curiosity without clickbait
- Description must include keywords: horror, scary, creepy, paranormal, true story, disturbing
- Tags must include both broad (horror stories) and specific (${topic})
- Thumbnail text must be ULTRA short and punchy
- Alt titles should test different psychological hooks
- First 2 lines of description are SEO-critical`;

  const result = await generateWithAI(prompt, 'ollama', { temperature: 0.6, maxTokens: 2048 });
  const parsed = safeParseJson<HorrorSEOResult | null>(result, null);

  if (parsed && parsed.title) {
    return parsed;
  }

  return {
    title: storyTitle,
    description: `${topic} - a terrifying true story that will keep you awake tonight. The events described are based on actual accounts. Watch until the end for a twist you won't see coming.\n\nIf you enjoy horror stories, subscribe for more terrifying content every week.`,
    tags: [topic, ...HORROR_TAG_POOL.slice(0, 15)],
    hashtags: ['#horror', '#scary', '#truestory', '#creepy', '#paranormal', '#horrorstories'],
    hookLines: [hook || `The ${topic} story will haunt you.`],
    communityPostTeaser: `Something happened last night that I can't explain. ${topic}... 🖤`,
    thumbnailText: 'IT FOUND ME',
    altTitles: [storyTitle, `The ${topic} Incident`, `I Survived ${topic}`],
    shortsIdeas: ['Opening hook extraction 0-15s', 'Mid-story reveal 60-75s', 'Final twist 120-135s'],
  };
}

export async function generateHorrorHashtags(topic: string): Promise<string[]> {
  const prompt = `Generate 8 highly effective YouTube hashtags for a horror story about "${topic}".

  Return a JSON array of strings like: ["#horror", "#scary", ...]
  Mix broad horror tags with niche-specific ones.

  Return ONLY valid JSON array.`;

  const result = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
  const parsed = extractJsonArray<string>(result);

  if (parsed && parsed.length >= 3) {
    return parsed.slice(0, 8);
  }

  return ['#horror', '#scary', '#horrorstories', '#creepy', '#paranormal', '#truestory', '#disturbing', '#nightmare'];
}
