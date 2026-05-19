import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { generateWithAI } from '../ai.service';
import { extractJson, extractJsonArray } from '../../utils/parse-ai-response';
import { ScoredTopic } from './daily-content-planner.service';

export interface UploadPackage {
  projectId: string;
  channelId: string;
  topic: string;
  title: string;
  script: string;
  thumbnailConcept: string;
  thumbnailPrompt: string;
  description: string;
  tags: string[];
  pinnedComment: string;
  cta: string;
  categoryId: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
  scheduledAt: Date | null;
  estimatedCost: number;
  metadata: {
    niche: string;
    hookStyle: string;
    pacingStyle: string;
    storytellingArc: string;
    tone: string;
    targetLength: string;
  };
}

const NICHE_CATEGORY: Record<string, string> = {
  'technology': '28', 'finance': '25', 'horror': '23', 'entertainment': '24',
  'education': '27', 'gaming': '20', 'music': '10', 'science': '28',
  'health': '26', 'comedy': '23', 'news': '25', 'sports': '17',
};

export class VideoCreator {
  async createUploadPackage(channelId: string, topic: ScoredTopic): Promise<UploadPackage> {
    logger.info(`[VideoCreator] Creating upload package for "${topic.title}"`);

    const script = await this.generateScript(topic);
    const title = await this.generateTitle(topic);
    const thumbnail = await this.generateThumbnail(topic);
    const description = await this.generateDescription(topic, script);
    const tags = await this.generateTags(topic);
    const pinnedComment = await this.generatePinnedComment(topic, title);
    const cta = await this.generateCTA(topic);

    const project = await prisma.videoProject.create({
      data: {
        channelId,
        userId: (await prisma.youTubeAccount.findFirst({ where: { channelId } }))?.userId || '',
        topic: topic.title,
        title,
        status: 'draft',
        format: topic.format,
      },
    });

    await prisma.script.create({
      data: {
        projectId: project.id,
        content: script,
        hook: topic.hookIdea,
        wordCount: script.split(' ').length,
        generatedBy: 'daily-income-system',
      },
    });

    await prisma.appConfig.upsert({
      where: { key: `upload_package:${project.id}` },
      update: { value: JSON.stringify({ thumbnailConcept: thumbnail.concept, thumbnailPrompt: thumbnail.prompt, description, tags, pinnedComment, cta, title, topic: topic.title }) },
      create: {
        key: `upload_package:${project.id}`,
        value: JSON.stringify({ thumbnailConcept: thumbnail.concept, thumbnailPrompt: thumbnail.prompt, description, tags, pinnedComment, cta, title, topic: topic.title }),
        description: `Upload package for project ${project.id}`,
      },
    });

    logger.info(`[VideoCreator] Package created for "${topic.title}" — Project: ${project.id}`);

    return {
      projectId: project.id,
      channelId,
      topic: topic.title,
      title,
      script,
      thumbnailConcept: thumbnail.concept,
      thumbnailPrompt: thumbnail.prompt,
      description,
      tags,
      pinnedComment,
      cta,
      categoryId: NICHE_CATEGORY[topic.niche] || '27',
      privacyStatus: 'public',
      scheduledAt: this.calculateOptimalUploadTime(),
      estimatedCost: topic.productionCost,
      metadata: {
        niche: topic.niche,
        hookStyle: 'curiosity-gap',
        pacingStyle: 'fast-paced',
        storytellingArc: 'problem-solution',
        tone: 'conversational-educational',
        targetLength: topic.format === 'shorts' ? '30-60s' : '8-12min',
      },
    };
  }

  private async generateScript(topic: ScoredTopic): Promise<string> {
    const prompt = `Write a professional YouTube script for a "${topic.format}" video.

Title: "${topic.title}"
Hook style: ${topic.hookIdea}
Niche: ${topic.niche}

Script structure:
1. HOOK (first 7 seconds) — grab attention using: ${topic.hookIdea}
2. INTRO (8-30 seconds) — preview value, create curiosity
3. BODY — main content with retention loop every 20 seconds (pattern interrupt or curiosity gap)
4. CTA (natural placement) — guide viewers to the offer in description
5. OUTRO — summarize, ask to subscribe, tease next video

Writing rules:
- Conversational tone, natural contractions
- Short sentences (max 20 words)
- Pattern interrupts every 20-30 seconds
- Curiosity gaps every 60 seconds
- Keep it ${topic.format === 'shorts' ? 'under 60 seconds, fast-paced' : '8-12 minutes, well-paced'}
- Include one mid-roll monetization cue

Return ONLY the script content. No explanations. Minimum ${topic.format === 'shorts' ? '200' : '800'} words.`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.6, maxTokens: 3072 });
    return response.trim();
  }

  private async generateTitle(topic: ScoredTopic): Promise<string> {
    const prompt = `Generate a CTR-optimized YouTube title.

Topic: "${topic.title}"
Niche: ${topic.niche}
Target CTR: ${topic.estimatedCTR}%

Rules:
- Max 60 characters
- Create strong curiosity gap
- Use 1-2 power words
- Add number if possible
- Must be intriguing enough to click
- No clickbait lies (must deliver on promise)

Return ONLY the title string. No quotes.`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.7 });
    return response.trim().substring(0, 100).replace(/["']/g, '');
  }

  private async generateThumbnail(topic: ScoredTopic): Promise<{ concept: string; prompt: string }> {
    const prompt = `Create a high-CTR YouTube thumbnail concept.

Title: "${topic.title}"
Niche: ${topic.niche}
Hook: ${topic.hookIdea}

Return JSON:
{
  "concept": "detailed visual description of thumbnail (30 words)",
  "prompt": "AI image generation prompt for creating this thumbnail"
}

Guidelines:
- High contrast colors (red, yellow, black, white)
- Bold text overlay (3-5 words max)
- Emotional trigger (shock, curiosity, awe, fear)
- Mobile readable (large elements, minimal clutter)
- Face closeup or strong visual metaphor`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.7 });
    const result = extractJson<{ concept: string; prompt: string }>(response);
    return result || {
      concept: `Bold thumbnail with text "${topic.title.substring(0, 40)}" on high-contrast background`,
      prompt: `High contrast YouTube thumbnail for ${topic.niche} topic: ${topic.title}`,
    };
  }

  private async generateDescription(topic: ScoredTopic, script: string): Promise<string> {
    const prompt = `Write an SEO-optimized YouTube description.

Video Title: "${topic.title}"
Niche: ${topic.niche}
Script Preview: "${script.substring(0, 300)}..."

Requirements:
- 2-3 paragraphs (150-300 words total)
- First 2 lines must hook (above the fold)
- Include 3-5 relevant hashtags
- Natural tone, informative
- Include: "Subscribe for more ${topic.niche} content"
- Add a CTA to watch related content
- At the end add: "📌 Resources & Links:" section

Return ONLY the description text.`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
    return response.trim();
  }

  private async generateTags(topic: ScoredTopic): Promise<string[]> {
    const prompt = `Generate 15 SEO YouTube tags for a video.

Title: "${topic.title}"
Niche: ${topic.niche}

Return a JSON array of 15 tags:
- Mix of broad (high volume) and specific (low competition)
- Include the niche
- Include related terms
- Max 3 words per tag
- Order by relevance`

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.4 });
    const tags = extractJsonArray<string>(response);
    return tags?.slice(0, 15) || [topic.niche, topic.title, 'youtube', 'viral', 'trending'];
  }

  private async generatePinnedComment(topic: ScoredTopic, title: string): Promise<string> {
    const prompt = `Write a YouTube pinned comment.

Topic: "${topic.title}"
Goal: Start a conversation + drive engagement

Rules:
- Friendly, conversational tone
- Ask a question to trigger replies
- Mention a resource link naturally
- 2-3 sentences max
- Add 2-3 relevant hashtags

Return ONLY the comment text.`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.6 });
    return response.trim().substring(0, 500);
  }

  private async generateCTA(topic: ScoredTopic): Promise<string> {
    const prompt = `Generate a strong call-to-action for a YouTube video.

Topic: "${topic.title}"
Niche: ${topic.niche}

The CTA should:
- Be specific (what exactly to do)
- Create urgency or FOMO
- Mention a clear benefit
- Lead to the offer/link

Return ONLY the CTA text (1 sentence).`;

    const response = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
    return response.trim().substring(0, 200);
  }

  private calculateOptimalUploadTime(): Date | null {
    const now = new Date();
    const targetHour = 14;
    const targetMinute = 0;

    const scheduled = new Date(now);
    scheduled.setHours(targetHour, targetMinute, 0, 0);

    if (scheduled <= now) {
      scheduled.setDate(scheduled.getDate() + 1);
    }

    return scheduled;
  }
}
