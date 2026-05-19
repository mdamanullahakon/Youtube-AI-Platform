import { generateWithAI } from './ai.service';
import { aiLogger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';
import type {
  DetectedHook,
  RetentionLoop,
  PatternInterrupt,
  StorytellingStructure,
  PacingPattern,
  HookQualityScore,
  EngagementScore,
  EmotionalArc,
  ContentInsightType,
  InsightCategory,
} from '../types';

const INSIGHT_TEMPLATES: Record<InsightCategory, string[]> = {
  hook: [
    'Opening hooks that start with a {type} pattern achieve {percent}% higher retention in the first 30 seconds',
    'The most effective hooks in this niche use {technique} to create immediate curiosity',
    'Hooks scoring below {score}/100 should be rewritten to include a specific {element}',
  ],
  structure: [
    'The {structure} narrative structure maintains {percent}% higher mid-video retention than unstructured content',
    'Successful videos in this space use a {phase_count}-phase narrative arc to guide viewer attention',
    'Videos with a clear narrative arc outperform fragmented content by {percent}% in watch time',
  ],
  pacing: [
    'Optimal pacing in this niche averages {wps} words per second with varied sentence lengths',
    'Pacing should accelerate during {segment} segments and decelerate during explanatory sections',
    'Sentence length variation of {variation}+ improves perceived video quality and retention',
  ],
  cta: [
    'End-of-video CTAs that reference specific content from the video convert at {percent}% higher rates',
    'CTAs placed in the final {percent}% of the video yield optimal conversion without hurting retention',
    'Asking a specific question before the CTA increases comment rates by {percent}%',
  ],
  emotional: [
    'Videos that transition from {primary} to {secondary} emotion maintain higher retention throughout',
    'Emotional variety of {variety}% or higher correlates with increased sharing behavior',
    'The strongest emotional arcs build tension for the first {percent}% before delivering the payoff',
  ],
  retention: [
    'Pattern interrupts every {interval} seconds prevent viewer dropout in the critical mid-section',
    'Curiosity gaps combined with mini-cliffhangers create {percent}% higher retention through content transitions',
    'The most effective retention technique in this genre is {technique} with an effectiveness score of {score}/100',
  ],
  storytelling: [
    'Stories that follow a {arc} arc achieve {percent}% higher audience engagement',
    'Including a clear {phase} phase within the first {percent}% of the narrative improves comprehension',
    'Personal stories outperform generic examples by {percent}% in audience retention metrics',
  ],
  thumbnail: [
    'Thumbnails with the {style} style achieve {percent}% higher CTR than other styles',
    'Using bold contrasting colors and emotional faces improves CTR by {percent}%',
    'Thumbnails with 2-3 words of bold text outperform text-free thumbnails by {percent}%',
  ],
  general: [
    'Videos under {word_count} words with {hook_count}+ distinct hooks perform best for the {format} format',
    'The first {seconds} seconds are critical - every word should serve curiosity or emotional connection',
    'Combining {technique_1} with {technique_2} creates a powerful one-two punch for viewer retention',
  ],
};

export class InsightGenerator {
  generateRuleInsights(
    hooks: DetectedHook[],
    loops: RetentionLoop[],
    interrupts: PatternInterrupt[],
    structure: StorytellingStructure | null,
    pacing: PacingPattern | null,
    hookQuality: HookQualityScore,
    engagement: EngagementScore,
    emotionalArc: EmotionalArc | null,
  ): ContentInsightType[] {
    const insights: ContentInsightType[] = [];

    // Hook insights
    if (hooks.length > 0) {
      const topHookType = hooks[0].type;
      insights.push({
        category: 'hook',
        content: `Opening hooks that start with a "${topHookType}" pattern achieve higher retention in the first 30 seconds. Current score: ${hooks[0].score}/100.`,
        source: 'transcript-analysis',
        confidence: Math.round(hooks[0].score) / 100,
        applicationCount: 0,
      });

      if (hookQuality.overall < 50) {
        insights.push({
          category: 'hook',
          content: `Hook quality score is ${hookQuality.overall}/100. Consider rewriting the hook to include a specific statistic, provocative question, or curiosity gap.`,
          source: 'transcript-analysis',
          confidence: 0.7,
          applicationCount: 0,
        });
      }
    }

    // Retention insights
    if (loops.length >= 2) {
      const bestLoop = loops.reduce((a, b) => a.effectiveness > b.effectiveness ? a : b);
      insights.push({
        category: 'retention',
        content: `The most effective retention technique detected is "${bestLoop.type}" with effectiveness score ${bestLoop.effectiveness}/100. Use this technique during content transitions.`,
        source: 'transcript-analysis',
        confidence: 0.75,
        applicationCount: 0,
      });
    }

    if (interrupts.length < 2) {
      insights.push({
        category: 'retention',
        content: 'Only ' + interrupts.length + ' pattern interrupt(s) detected. Add 3-5 pattern interrupts (direct address, rhetorical questions, counter-intuitive statements) to maintain mid-video retention.',
        source: 'transcript-analysis',
        confidence: 0.65,
        applicationCount: 0,
      });
    }

    // Structure insights
    if (structure) {
      insights.push({
        category: 'storytelling',
        content: `Detected "${structure.name}" narrative structure (${structure.arc}) with ${structure.confidence}% confidence. Structure uses ${structure.phases.length} narrative phases.`,
        source: 'transcript-analysis',
        confidence: structure.confidence / 100,
        applicationCount: 0,
      });
    }

    // Pacing insights
    if (pacing) {
      insights.push({
        category: 'pacing',
        content: `Pacing is "${pacing.overall}" at ${pacing.wordsPerSecond} words/sec with sentence length avg ${pacing.sentenceLengthAvg}. ${pacing.sentenceLengthVariation > 5 ? 'Good variation in sentence lengths.' : 'Consider varying sentence lengths more for better engagement.'}`,
        source: 'transcript-analysis',
        confidence: 0.7,
        applicationCount: 0,
      });

      if (pacing.segments.length > 1) {
        const variedSegments = pacing.segments.filter(s => s.pace === 'fast' || s.pace === 'slow');
        if (variedSegments.length < 2) {
          insights.push({
            category: 'pacing',
            content: 'Pacing lacks variation across segments. Alternate between fast-paced hooks and slower explanatory sections to maintain viewer interest.',
            source: 'transcript-analysis',
            confidence: 0.6,
            applicationCount: 0,
          });
        }
      }
    }

    // Emotional insights
    if (emotionalArc && emotionalArc.primaryEmotion !== emotionalArc.secondaryEmotion) {
      insights.push({
        category: 'emotional',
        content: `Emotional arc transitions from "${emotionalArc.primaryEmotion}" to "${emotionalArc.secondaryEmotion}" with ${emotionalArc.variety}% variety. This emotional journey supports viewer engagement.`,
        source: 'transcript-analysis',
        confidence: 0.65,
        applicationCount: 0,
      });
    }

    // Engagement insights
    if (engagement.overall < 50) {
      const lowestDim = Object.entries(engagement.dimensions)
        .sort(([, a], [, b]) => a - b)[0];
      insights.push({
        category: 'general',
        content: `Overall engagement score is ${engagement.overall}/100. Lowest dimension: "${lowestDim[0]}" at ${lowestDim[1]}/100. Focus improvement here.`,
        source: 'transcript-analysis',
        confidence: 0.8,
        applicationCount: 0,
      });
    }

    // CTA insights
    {
      const ctaHooks = hooks.filter(h => {
        const l = h.text.toLowerCase();
        return /subscribe|like|comment|follow|share/i.test(l);
      });
      if (ctaHooks.length === 0) {
        insights.push({
          category: 'cta',
          content: 'No call-to-action detected. Add a specific CTA (subscribe, like, comment, or share) in the final 15% of the video.',
          source: 'transcript-analysis',
          confidence: 0.9,
          applicationCount: 0,
        });
      } else {
        const lastHook = ctaHooks[ctaHooks.length - 1];
        const isEndCTA = hooks.indexOf(lastHook) > hooks.length * 0.7;
        if (!isEndCTA) {
          insights.push({
            category: 'cta',
            content: 'CTA appears too early in the video. Move primary CTA to the last 15-20% of content for higher conversion without hurting retention.',
            source: 'transcript-analysis',
            confidence: 0.6,
            applicationCount: 0,
          });
        }
      }
    }

    return insights;
  }

  async enhanceWithAI(
    transcript: string,
    insights: ContentInsightType[],
  ): Promise<ContentInsightType[]> {
    try {
      const sample = transcript.substring(0, 1500);
      const currentInsights = insights.slice(0, 5).map(i => i.content);

      const prompt = `Generate actionable content insights from this YouTube transcript analysis.

Transcript sample:
"""${sample}"""

Current insights from rule-based analysis:
${currentInsights.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return JSON array of insights (2-4 additional insights NOT already covered):
[
  {
    "category": "hook|structure|pacing|cta|emotional|retention|storytelling|general",
    "content": "Specific actionable insight based on the transcript content",
    "confidence": 0.75
  }
]

Each insight must be:
- Specific to the actual transcript content (reference real elements)
- Actionable (writer can immediately apply it)
- Scored with confidence 0-1
- Not a duplicate of the rule-based insights above`;

      const result = await generateWithAI(prompt, 'ollama', { temperature: 0.4 });
      const parsed = extractJsonArray(result);

      if (parsed) {
        const validCategories = ['hook', 'structure', 'pacing', 'cta', 'emotional', 'retention', 'storytelling', 'general'];

        const aiInsights: ContentInsightType[] = parsed
          .filter((i: any) => i.content && i.content.length > 20)
          .map((i: any) => ({
            category: validCategories.includes(i.category) ? i.category : 'general',
            content: i.content,
            source: 'transcript-analysis' as const,
            confidence: Math.min(1, Math.max(0, i.confidence ?? 0.5)),
            applicationCount: 0,
          }));

        return [...insights, ...aiInsights];
      }
    } catch (err) {
      aiLogger.warn('AI insight generation failed, using rule-based results', { error: (err as Error).message });
    }

    return insights;
  }
}
