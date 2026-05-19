import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import {
  IncomeTopicScore,
  IncomeVideoPlan,
  IncomeChannelConfig,
  IncomeWinningPattern,
} from './types';

interface ContentGenerationInput {
  topicScore: IncomeTopicScore;
  config: IncomeChannelConfig;
  winnerPatterns: IncomeWinningPattern[];
}

const VIRAL_TITLE_WORDS = ['Secret', 'Nobody tells you', 'Hidden', 'Game-Changing', 'Insane', 'Unbelievable', 'You Won\'t Believe', 'Stop Ignoring', 'This Will Change', 'The Truth About'];

export class ContentGenerator {
  async generate(input: ContentGenerationInput): Promise<IncomeVideoPlan> {
    const { topicScore, config, winnerPatterns } = input;
    const niche = config.niche;

    const title = await this.generateTitle(topicScore.topic, niche, winnerPatterns);
    const script = await this.generateScript(topicScore.topic, niche, title);
    const hook = this.extractHook(script, winnerPatterns);
    const thumbnailData = await this.generateThumbnailPrompt(topicScore.topic, niche, title, winnerPatterns);
    const seo = await this.generateSEO(topicScore.topic, niche, title, hook);

    return {
      topicScore,
      title,
      script,
      hook,
      thumbnailPrompt: thumbnailData.prompt,
      thumbnailStyle: thumbnailData.style,
      seoTags: seo.tags,
      seoDescription: seo.description,
      categoryId: this.getCategoryForNiche(niche),
      monetization: { affiliateLinks: [], ctaText: '', ctaPlacement: '', funnelType: '' },
      estimatedCpm: 0,
      estimatedRevenue: 0,
      channelId: config.channelId,
      userId: config.userId,
    };
  }

  private async generateTitle(
    topic: string,
    niche: string,
    winnerPatterns: IncomeWinningPattern[],
  ): Promise<string> {
    const titlePatterns = winnerPatterns
      .filter(p => p.patternType === 'title-style')
      .map(p => p.patternValue);

    const winnerBoostTip = titlePatterns.length
      ? `\nUse these proven winning patterns: ${titlePatterns.join(', ')}`
      : '';

    const prompt = `You are a viral YouTube title expert for "${niche}".
Create ONE ultra-high-CTR title for: "${topic}"

Rules:
- MAX 50 characters
- MUST contain a number (e.g. 3, 5, 7, 10)
- MUST create extreme curiosity gap (viewer MUST click)
- Use emotional power words like: Secret, Insane, Nobody tells you, Game-Changing, Hidden
- MUST be clickable WITHOUT being clickbait (deliver on promise)
- Include "2026" naturally
- Use "This" or "These" for specificity${winnerBoostTip}

WINNING FORMULAS (use one):
1. "[Number] [Viral word] [Topic] in 2026"
2. "Nobody Tells You This About [Topic]"
3. "The Secret [Topic] Hack That [Benefit]"
4. "Stop [Common mistake], Do THIS Instead in 2026"
5. "I Tried [Topic] for [Time] — Here's What Happened"

Return ONLY the title. No quotes. No labels. Max 50 chars.`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.8, maxTokens: 100 });
    const cleaned = raw.replace(/["""]/g, '').trim().substring(0, 55);
    if (cleaned.length < 10) return this.getFallbackTitle(topic);
    return cleaned;
  }

  private async generateScript(topic: string, niche: string, title: string): Promise<string> {
    const prompt = `You are a YouTube scriptwriter for "${niche}".
Write a 7-9 minute high-retention script.
Title: "${title}"
Topic: "${topic}"

CRITICAL HOOK RULE (first 5 seconds MUST):
1. Start with a shocking question OR a bold controversial statement
2. Immediately promise massive value
3. Create a curiosity loop that forces them to keep watching

Example first 5 seconds:
"Most people are doing [topic] completely wrong in 2026. And it's costing them thousands. Here's the truth nobody talks about."

Structure:
0:00-0:05 — SHOCK HOOK (question + value promise)
0:05-0:45 — INTRO (preview + stakes: "by the end of this video you'll know...")
0:45-2:00 — POINT 1 with real example
2:00-3:30 — POINT 2 with pattern interrupt
3:30-5:00 — POINT 3 with story
5:00-6:30 — POINT 4 with counter-intuitive insight
6:30-7:30 — SUMMARY + CTA (like, subscribe, comment your opinion)
7:30-8:00 — OUTRO + next video tease

Rules:
- Every 60-90 seconds: pattern interrupt (change tone, ask question, reveal surprise)
- Conversational, energetic tone
- Use "you" to address viewer directly
- Write timestamps [MM:SS] for each section
- Add "(pause for effect)" at key moments

Full script:`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.7, maxTokens: 3000 });
    return raw || this.getFallbackScript(topic, title);
  }

  private extractHook(script: string, winnerPatterns: IncomeWinningPattern[]): string {
    const lines = script.split('\n');
    const hookLine = lines.find(l => {
      const t = l.trim().toLowerCase();
      return (t.includes('hook') || t.startsWith('"') || t.includes('?')) && l.length > 20;
    });
    if (hookLine) {
      return hookLine.replace(/\[\d+:\d+\]/, '').replace(/^HOOK:?\s*/i, '').trim().substring(0, 200);
    }
    const firstRealLine = lines.find(l => l.trim().length > 30 && !l.startsWith('['));
    if (firstRealLine) return firstRealLine.trim().substring(0, 200);

    return `Most people don't know this about ${script.substring(0, 30)}... but what I'm about to share will change everything.`;
  }

  private async generateThumbnailPrompt(
    topic: string,
    niche: string,
    title: string,
    winnerPatterns: IncomeWinningPattern[],
  ): Promise<{ prompt: string; style: string }> {
    const thumbPatterns = winnerPatterns
      .filter(p => p.patternType === 'thumbnail-style')
      .map(p => p.patternValue);

    const bestStyle = thumbPatterns[0] || this.getDefaultThumbnailStyle(niche);

    const prompt = `YouTube thumbnail prompt for: "${title}" | Niche: ${niche} | Style: ${bestStyle}

CRITICAL RULES:
- Text overlay: MAX 3 words — BIG, BOLD, readable at 50px wide
- Use an emotional trigger word: SHOCK | FREE | SECRET | INSANE | EXPOSED
- High contrast colors: RED + YELLOW or BLACK + WHITE or BLUE + ORANGE
- Face expression: surprised / shocked / pointing / open mouth (if relevant)
- Bright, saturated, pops in dark mode
- Clean background, no clutter

Generate ONE detailed image prompt for AI thumbnail generation that follows all rules above.
Include: subject, colors, text overlay (exact words), expression, background.`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.7, maxTokens: 300 });
    return {
      prompt: raw.substring(0, 500) || `YouTube thumbnail: ${title}, 3-word text "${this.extractThumbnailText(title)}", SHOCK style, high contrast red+yellow`,
      style: bestStyle,
    };
  }

  private extractThumbnailText(title: string): string {
    const words = title.split(' ');
    const short = words.filter(w => w.length > 2).slice(0, 3);
    if (short.length >= 2) return short.join(' ').toUpperCase();
    return 'SHOCKING';
  }

  private async generateSEO(
    topic: string,
    niche: string,
    title: string,
    hook: string,
  ): Promise<{ tags: string[]; description: string }> {
    const prompt = `Generate viral SEO for YouTube.
Title: "${title}"
Topic: "${topic}"
Niche: "${niche}"

TAGS STRATEGY (15 total):
- 5 broad: general niche terms
- 5 mid: specific to topic
- 5 long-tail: specific phrases people search

DESCRIPTION FORMAT:
Line 1: HOOK — ${hook?.substring(0, 100) || topic}
Line 2: CTA — "👇 SUBSCRIBE for more ${niche} content in 2026!"
Line 3+: SEO keywords naturally woven into 2-3 sentences including ${topic} and ${niche}

Return ONLY valid JSON:
{
  "tags": ["tag1", ..., "tag15"],
  "description": "Full optimized description starting with hook and CTA in first 2 lines"
}`;

    const raw = await generateWithAI(prompt, 'ollama', { temperature: 0.4, maxTokens: 500 });
    try {
      return JSON.parse(raw);
    } catch {
      return this.getFallbackSEO(topic, niche, title, hook);
    }
  }

  private getFallbackSEO(topic: string, niche: string, title: string, hook: string): { tags: string[]; description: string } {
    const description = `${hook?.substring(0, 120) || topic}\n\n👇 SUBSCRIBE for more ${niche} content in 2026!\n\nIn this video, we dive deep into ${topic}. If you're into ${niche}, this is the most important video you'll watch this year. We cover strategies, tips, and secrets most people don't know about ${topic}.`;
    return {
      tags: [
        niche, topic, title.substring(0, 30),
        `${niche} 2026`, `${topic} guide`,
        `${niche} tips`, `best ${niche}`, `${niche} secrets`,
        `how to ${niche}`, `${topic} explained`,
        `viral ${niche}`, `${niche} hacks`, `top ${niche} 2026`,
        `${topic} tutorial`, `${niche} for beginners`,
      ],
      description,
    };
  }

  private getCategoryForNiche(niche: string): string {
    const map: Record<string, string> = {
      'tech': '28',
      'gaming': '20',
      'finance': '25',
      'education': '27',
      'entertainment': '24',
      'music': '10',
      'sports': '17',
      'news': '25',
      'howto': '26',
    };
    return map[niche.toLowerCase()] || '22';
  }

  private getDefaultThumbnailStyle(niche: string): string {
    const map: Record<string, string> = {
      'tech': 'face-closeup-shock',
      'finance': 'face-closeup-serious',
      'health': 'before-after',
      'gaming': 'action-screenshot',
    };
    return map[niche.toLowerCase()] || 'face-closeup-curiosity';
  }

  private getFallbackTitle(topic: string): string {
    const viral = VIRAL_TITLE_WORDS[Math.floor(Math.random() * VIRAL_TITLE_WORDS.length)];
    return `7 ${viral} ${topic} Tips Nobody Talks About in 2026`;
  }

  private getFallbackScript(topic: string, title: string): string {
    return `[00:00] Are you making these ${topic} mistakes in 2026? Most people are, and it's costing them. Here's what they don't want you to know.

[00:05] By the end of this video, you'll know exactly how to master ${topic} like a pro.

[00:45] Let's start with the biggest mistake almost everyone makes with ${topic}.

[02:00] Here's a counter-intuitive insight that changed everything for me.

[03:30] Let me show you the exact system I use for ${topic}.

[05:00] Here's a real example of how this works in practice.

[06:30] Let me summarize everything you've learned today about ${title}.

[07:30] If you found this valuable, smash that like button and subscribe. Drop a comment with your biggest takeaway!

[08:00] Next video I'll show you an even more advanced ${topic} strategy.`;
  }
}
