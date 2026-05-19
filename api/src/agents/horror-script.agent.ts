import { generateWithAI } from '../services/ai.service';
import { ContentQualityService } from '../services/content-quality.service';
import { prisma } from '../config/db';
import { aiLogger as logger } from '../utils/logger';
import { extractJsonArray, safeParseJson } from '../utils/parse-ai-response';

export interface HorrorScript {
  viralTitle: string;
  thumbnailText: string;
  altTitles: string[];
  openingHook: string;
  fullScript: string;
  scenes: HorrorScene[];
  soundDesign: string[];
  voiceTone: string;
  seoPackage: SEOPackage;
  shortsClips: ShortsClip[];
  retentionAnalysis: RetentionAnalysis;
  psychologyBreakdown: string;
  wordCount: number;
  durationTarget: number;
}

export interface HorrorScene {
  index: number;
  text: string;
  duration: number;
  visualPrompt: string;
  cameraAngle: string;
  lighting: string;
  atmosphere: string;
  soundEffects: string[];
  transition: string;
  colorMood: string;
}

export interface SEOPackage {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  hookLines: string[];
  communityPostTeaser: string;
}

export interface ShortsClip {
  timestamp: number;
  duration: number;
  reason: string;
}

export interface RetentionAnalysis {
  hookRetention: string;
  peakRetentionMoments: string[];
  potentialDropOffZones: string[];
  replayValue: string;
  commentBaitPotential: string;
}

const HORROR_NICHES = [
  'paranormal', 'psychological', 'analog-horror', 'basement-horror',
  'missing-persons', 'emergency-recordings', 'rural-isolation', 'abandoned-places',
  'childhood-trauma', 'ritual-horror', 'family-secrets', 'dead-relatives',
  'forest-horror', 'sleep-experiments', 'government-coverups', 'vhs-tape-horror',
  'emergency-broadcast', 'possession', 'unknown-entities', 'distorted-reality',
  'time-loop-horror', 'dark-water-horror', 'mimic-entities', 'false-humans',
  'hidden-rooms', 'surveillance-horror',
];

const HORROR_THEMES: Record<string, { bgColor: string; accentColor: string }> = {
  basement: { bgColor: '0a0a0a', accentColor: '1a0505' },
  forest: { bgColor: '050d05', accentColor: '0a1a0a' },
  water: { bgColor: '050510', accentColor: '05051a' },
  urban: { bgColor: '0d0d0d', accentColor: '1a1a1a' },
  ritual: { bgColor: '100505', accentColor: '2a0505' },
  psychological: { bgColor: '050508', accentColor: '0a0515' },
  analog: { bgColor: '0d0a05', accentColor: '1a0f05' },
  entity: { bgColor: '080508', accentColor: '150515' },
};

export class HorrorScriptAgent {
  private qualityService: ContentQualityService;

  constructor() {
    this.qualityService = new ContentQualityService();
  }

  async generateHorrorStory(
    topic: string,
    subNiche?: string,
    format: string = '8-12min',
    emotionalAngle?: string,
  ): Promise<HorrorScript> {
    logger.info(`Generating horror story: "${topic}" (${subNiche || 'auto'})`);

    const nicheStrategy = subNiche ? await prisma.contentStrategy.findUnique({ where: { niche: subNiche } }) : null;
    const pastStories = await prisma.script.findMany({
      where: { project: { topic: { contains: subNiche || topic } } },
      take: 3,
      orderBy: { createdAt: 'desc' },
    });
    const pastContent = pastStories.map(s => s.content.substring(0, 200)).join('\n---\n');

    const prompt = this.buildMasterPrompt(topic, subNiche, format, emotionalAngle, nicheStrategy, pastContent);

    const rawScript = await generateWithAI(prompt, 'ollama', { temperature: 0.7, maxTokens: 4096 });

    const enhancedScript = await this.qualityService.fullEnhance(rawScript, format, subNiche || 'Horror');

    return this.parseHorrorScript(enhancedScript, topic, format);
  }

  private buildMasterPrompt(
    topic: string,
    subNiche?: string,
    format?: string,
    emotionalAngle?: string,
    nicheStrategy?: any,
    pastContent?: string,
  ): string {
    const targetDuration = format === 'Shorts' ? '45-60 seconds' : format || '8-12 minutes';
    const targetWords = format === 'Shorts' ? '200-350 words' : '2500-4500 words';
    const nicheFocus = subNiche || 'psychological horror, paranormal horror';
    const angleExtra = emotionalAngle ? `\nEmotional angle: ${emotionalAngle}` : '';
    const strategyExtra = nicheStrategy ? `\nNiche tone: ${nicheStrategy.tone}\nPacing: ${nicheStrategy.pacingStyle}` : '';
    const pastExtra = pastContent ? `\n\nPreviously generated content for reference (AVOID repeating these ideas):\n${pastContent}` : '';

    return `You are an elite autonomous cinematic horror content intelligence system. Your purpose is to create a VIRAL YouTube horror story optimized for maximum retention, CTR, and emotional addiction.

TOPIC: "${topic}"
SUB-NICHE: ${nicheFocus}
TARGET DURATION: ${targetDuration}
TARGET WORD COUNT: ${targetWords}${angleExtra}${strategyExtra}${pastExtra}

====================================================
MANDATORY STORY STRUCTURE
====================================================

1. OPENING HOOK (0-30 sec):
- Immediate impossible event
- Disturbing mystery
- Emotional shock
- Viewer curiosity explosion
Start with something like: a dead person speaking, blood where impossible, a missing child returning, a strange recording, a voice from underground, an unknown person inside the house, impossible footage.
NEVER start slowly.

2. EARLY TENSION (30 sec - 2 min): 
Introduce main character with emotional weakness, hidden trauma, environment, strange event.
Viewer must sense: "Something is deeply wrong."

3. ESCALATION PHASE:
Every 20-40 seconds, add ONE: new clue, new fear, new reveal, new sound, new mystery, new contradiction, new impossible detail.
NEVER allow emotional flatness.

4. MID-STORY REVELATION:
Reveal hidden crime, family secret, buried truth, cover-up, missing victim, betrayal, or entity origin.
This section should emotionally destabilize the audience.

5. FINAL DESCENT:
Reality collapses. Fear becomes unavoidable.
Use: darkness, flooding, distorted voices, hallucinations, hidden bodies, impossible movement, broken time perception, entity manifestation.

6. FINAL TWIST:
Reveal the horror was bigger, the protagonist failed, the entity survived, the cycle continues, something still watches.
Viewer must finish with chills.

7. FINAL LINE (THE KILLER):
End with a disturbing question, psychological implication, viewer self-insertion, existential terror.
Example: "If your dead mother knocked on your bedroom door tonight... would you answer?"

====================================================
RETENTION ENGINEERING RULES
====================================================
- Pattern interrupt every 30 seconds
- Cliffhanger every 45-60 seconds
- Emotional trigger every 2 minutes
- New mystery every 90 seconds
- Escalation every scene
- NEVER explain everything too early
- NEVER remove mystery
- NEVER use comedy
- NEVER use generic horror clichés repeatedly
- NEVER use weak endings
- NEVER resolve all questions

====================================================
CINEMATIC STYLE
====================================================
- Short paragraphs
- Cinematic pacing
- Visual language
- Sensory detail
- Emotional realism
- Atmospheric narration
Use: rain, silence, static, water dripping, footsteps, heavy breathing, distant sounds, flickering lights, VHS distortion, radio interference

====================================================
CHARACTER RULES
====================================================
Main character must feel: emotionally broken, guilty, traumatized, regretful, isolated, emotionally vulnerable.
Audience must emotionally attach quickly.

====================================================
ENTITY DESIGN
====================================================
Entity must: remain partially unknown, avoid overexposure, feel ancient, feel intelligent, mimic humans imperfectly, distort sound, distort memory, break physical logic.
Most terrifying horrors are PARTIALLY UNSEEN.

====================================================
OUTPUT FORMAT - RETURN EXACTLY THIS STRUCTURE
====================================================

---TITLE---
[Viral title here]

---ALT_TITLES---
[Alternative title 1]
[Alternative title 2]
[Alternative title 3]

---THUMBNAIL_TEXT---
[Short text for thumbnail - 3-5 words max]

---OPENING_HOOK---
[The first 30 seconds - must be impossible/disturbing]

---STORY---
[Full cinematic story following the 7-part structure above]

---SCENES---
[Scene 1] | [duration in seconds] | [visual prompt] | [camera angle] | [lighting] | [atmosphere] | [sound effects] | [transition type] | [color mood]
[Scene 2] | [duration in seconds] | [visual prompt] | [camera angle] | [lighting] | [atmosphere] | [sound effects] | [transition type] | [color mood]
...one line per scene

---SOUND_DESIGN---
[sound element 1]
[sound element 2]
[sound element 3]
...

---VOICE_TONE---
[AI voice tone instructions - style, pace, emotional register]

---SEO_TITLE---
[SEO-optimized title]

---SEO_DESCRIPTION---
[Full description with keywords, 2-3 paragraphs]

---TAGS---
[tag1, tag2, tag3, ...]

---HASHTAGS---
[#hashtag1 #hashtag2 #hashtag3 ...]

---HOOK_LINES---
[Hook line 1]
[Hook line 2]
[Hook line 3]

---COMMUNITY_POST---
[Community post teaser text]

---SHORTS_CLIPS---
[timestamp] | [duration] | [reason]
[timestamp] | [duration] | [reason]

---RETENTION_ANALYSIS---
Hook Retention: [assessment]
Peak Moments: [moment 1], [moment 2], [moment 3]
Drop-off Zones: [zone 1], [zone 2]
Replay Value: [assessment]
Comment Bait: [assessment]

---PSYCHOLOGY---
[Viewer psychology breakdown - what primal fears are triggered, why this story works]

---FINAL_LINE---
[The killer closing line]

IMPORTANT: The story must feel like HBO psychological horror, Netflix dark thriller, Reddit NoSleep realism, analog horror atmosphere, cinematic audio storytelling, found-footage terror, slow-burn dread. Every scene must be visually cinematic.`;
  }

  private parseHorrorScript(rawScript: string, topic: string, format: string): HorrorScript {
    const extractSection = (marker: string, fallback: string): string => {
      const regex = new RegExp(`---${marker}---\\s*([\\s\\S]*?)(?:---[A-Z_]+---|$)`, 'i');
      const match = rawScript.match(regex);
      return match ? match[1].trim() : fallback;
    };

    const extractLines = (marker: string, fallback: string[]): string[] => {
      const content = extractSection(marker, '');
      if (!content) return fallback;
      return content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('---'));
    };

    const viralTitle = extractSection('TITLE', `The ${topic} Incident`);
    const thumbnailText = extractSection('THUMBNAIL_TEXT', 'IT FOUND ME');
    const altTitles = extractLines('ALT_TITLES', [viralTitle]);
    const openingHook = extractSection('OPENING_HOOK', 'It started with a knock at the door. At 3 AM.');
    const storyContent = extractSection('STORY', 'No story generated.');
    const soundDesign = extractLines('SOUND_DESIGN', ['Distant footsteps', 'Static interference', 'Heavy breathing']);
    const voiceTone = extractSection('VOICE_TONE', 'Slow burn, emotionally controlled, whisper intensity, calm terror');
    const seoTitle = extractSection('SEO_TITLE', viralTitle);
    const seoDescription = extractSection('SEO_DESCRIPTION', `${topic} - a terrifying true story.`);
    const tagsRaw = extractSection('TAGS', `${topic}, horror, scary stories, true horror`);
    const tags = tagsRaw.split(',').map(t => t.trim()).filter(t => t);
    const hashtagsRaw = extractSection('HASHTAGS', '#horror #scary #truestory');
    const hashtags = hashtagsRaw.split(' ').map(h => h.trim()).filter(h => h);
    const hookLines = extractLines('HOOK_LINES', [openingHook]);
    const communityPost = extractSection('COMMUNITY_POST', 'Something happened last night...');
    const finalLine = extractSection('FINAL_LINE', 'What would you do if the knocking started at your door?');

    const rawScenes = extractSection('SCENES', '');
    const scenes: HorrorScene[] = this.parseHorrorScenes(rawScenes);

    const rawShorts = extractSection('SHORTS_CLIPS', '');
    const shortsClips: ShortsClip[] = this.parseShortsClips(rawShorts);

    const retentionSection = extractSection('RETENTION_ANALYSIS', '');
    const retentionAnalysis = this.parseRetentionAnalysis(retentionSection);

    const psychologyBreakdown = extractSection('PSYCHOLOGY', 'This story triggers primal fear of the unknown and vulnerability.');

    const fullScript = `---OPENING_HOOK---\n${openingHook}\n\n---STORY---\n${storyContent}\n\n---FINAL_LINE---\n${finalLine}`;

    const wordCount = fullScript.split(/\s+/).length;
    const durationTarget = scenes.reduce((sum, s) => sum + s.duration, 0);

    const seoPackage: SEOPackage = {
      title: seoTitle,
      description: seoDescription,
      tags,
      hashtags,
      hookLines,
      communityPostTeaser: communityPost,
    };

    return {
      viralTitle,
      thumbnailText,
      altTitles,
      openingHook,
      fullScript,
      scenes,
      soundDesign,
      voiceTone,
      seoPackage,
      shortsClips,
      retentionAnalysis,
      psychologyBreakdown,
      wordCount,
      durationTarget,
    };
  }

  private parseHorrorScenes(rawScenes: string): HorrorScene[] {
    const lines = rawScenes.split('\n').filter(l => l.trim());
    const scenes: HorrorScene[] = [];

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 3) continue;

      const textMatch = parts[0].match(/\[Scene\s*\d+\]\s*(.*)/i);
      const text = textMatch ? textMatch[1] : parts[0];
      const duration = Math.min(parseInt(parts[1]?.match(/\d+/)?.[0] || '10'), 30);
      const visualPrompt = parts[2] || 'dark cinematic horror scene';
      const cameraAngle = parts[3] || 'first-person';
      const lighting = parts[4] || 'low-key';
      const atmosphere = parts[5] || 'oppressive dread';
      const soundEffects = (parts[6] || 'silence').split(',').map(s => s.trim());
      const transition = parts[7] || 'fade-to-black';
      const colorMood = parts[8] || 'desaturated shadows';

      scenes.push({
        index: scenes.length,
        text,
        duration,
        visualPrompt,
        cameraAngle,
        lighting,
        atmosphere,
        soundEffects,
        transition,
        colorMood,
      });
    }

    if (scenes.length === 0) {
      scenes.push({
        index: 0,
        text: rawScenes.substring(0, 100) || 'Darkness fills the room.',
        duration: 10,
        visualPrompt: 'cinematic horror establishing shot, darkness, subtle movement in shadows',
        cameraAngle: 'wide establishing',
        lighting: 'low-key',
        atmosphere: 'oppressive dread',
        soundEffects: ['distant hum', 'silence'],
        transition: 'fade-in',
        colorMood: 'desaturated shadows, deep blacks',
      });
    }

    return scenes;
  }

  private parseShortsClips(raw: string): ShortsClip[] {
    const lines = raw.split('\n').filter(l => l.trim());
    const clips: ShortsClip[] = [];

    for (const line of lines) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 2) continue;
      const timestamp = parseInt(parts[0]?.match(/\d+/)?.[0] || '0');
      const duration = parseInt(parts[1]?.match(/\d+/)?.[0] || '15');
      const reason = parts[2] || 'high-impact moment';
      clips.push({ timestamp, duration, reason });
    }

    if (clips.length === 0) {
      clips.push({ timestamp: 0, duration: 15, reason: 'Opening hook - highest retention moment' });
      clips.push({ timestamp: 60, duration: 15, reason: 'Mid-story revelation' });
      clips.push({ timestamp: 120, duration: 15, reason: 'Final twist reveal' });
    }

    return clips;
  }

  private parseRetentionAnalysis(raw: string): RetentionAnalysis {
    const getField = (label: string, fallback: string): string => {
      const regex = new RegExp(`${label}:\\s*(.+)`, 'i');
      const match = raw.match(regex);
      return match ? match[1].trim() : fallback;
    };

    const getList = (label: string, fallback: string[]): string[] => {
      const val = getField(label, '');
      if (!val) return fallback;
      return val.split(',').map(v => v.trim()).filter(v => v);
    };

    return {
      hookRetention: getField('Hook Retention', '95%+ due to impossible-event opener'),
      peakRetentionMoments: getList('Peak Moments', ['Opening hook', 'Mid-story reveal', 'Final twist']),
      potentialDropOffZones: getList('Drop-off Zones', ['Mid-story exposition']),
      replayValue: getField('Replay Value', 'High - viewers will rewatch to catch hidden clues'),
      commentBaitPotential: getField('Comment Bait', 'Extreme - ambiguous ending will spark debate'),
    };
  }

  async generateTitleVariants(topic: string, count: number = 10): Promise<{ title: string; ctrScore: number; type: string }[]> {
    const prompt = `Generate ${count} HIGH-CTR YouTube video titles for a horror story about: "${topic}"

Rules:
- Each title must create overwhelming curiosity
- Use proven formats: "The X That Y", "I Did X and Then Y", "The Night X Happened"
- Include emotional triggers: "terrifying", "haunting", "disturbing", "unsettling"
- Create information gaps that demand clicking
- Target 30-50 characters
- NEVER be generic

Return as JSON array of { "title": string, "ctrScore": number 0-100, "type": "curiosity-gap" | "pattern-interrupt" | "provocative-question" | "shocking-statistic" | "story-bait" }`;

    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.8 });
    const parsed = extractJsonArray<{ title: string; ctrScore: number; type: string }>(result);
    if (parsed && parsed.length > 0) return parsed;

    return Array.from({ length: count }, (_, i) => ({
      title: `The ${topic} Incident ${i + 1}`,
      ctrScore: 70 - i * 3,
      type: i === 0 ? 'pattern-interrupt' : 'curiosity-gap',
    }));
  }

  async generateHookVariants(topic: string, count: number = 5): Promise<{ hook: string; type: string; retentionScore: number }[]> {
    const prompt = `Generate ${count} OPENING HOOKS for a YouTube horror story about "${topic}"

Each hook must:
- Start with an immediate impossible event
- Create overwhelming curiosity in under 10 seconds
- Make the viewer NEED to know what happens next
- Be 1-3 sentences max

Types of hooks to use:
- Dead person speaking
- Blood where impossible
- Missing child returning
- Strange recording found
- Voice from underground
- Unknown person inside house
- Impossible footage
- Time anomaly

Return as JSON array of { "hook": string, "type": string, "retentionScore": number 0-100 }`;

    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.8 });
    const parsed = extractJsonArray<{ hook: string; type: string; retentionScore: number }>(result);
    if (parsed && parsed.length > 0) return parsed;

    return [
      { hook: `The night I found the tape, I wish I had never pressed play.`, type: 'pattern-interrupt', retentionScore: 95 },
      { hook: `My dead mother called me last night. The phone number showed as "Unknown."`, type: 'provocative-question', retentionScore: 98 },
    ];
  }

  async generateVisualSequence(scenes: HorrorScene[]): Promise<HorrorScene[]> {
    logger.info(`Enhancing ${scenes.length} horror scenes with cinematic visual prompts`);

    const prompt = `Enhance these horror video scenes with CINEMATIC visual prompts optimized for AI image generation.

Each scene needs:
- Ultra cinematic horror realism style
- Dark atmospheric lighting
- Film-grain texture
- Photorealistic detail
- Rain-soaked or decayed atmosphere
- Moody shadows
- Psychological dread in composition

Scenes:
${scenes.map((s, i) => `Scene ${i + 1}: "${s.text}"`).join('\n')}

Return ONLY a JSON array of visual prompt strings (one per scene, same order).
Each prompt must be 20-40 words, describing the shot like a film director.`;

    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.7 });
    const parsed = extractJsonArray<string>(result);

    if (parsed && parsed.length === scenes.length) {
      return scenes.map((scene, i) => ({
        ...scene,
        visualPrompt: parsed[i] || scene.visualPrompt,
      }));
    }

    return scenes;
  }
}
