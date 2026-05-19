import { generateWithAI } from './ai.service';
import { aiLogger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';
import type { OptimizationRecommendation, DropOffPoint, HookEffectivenessEntry } from '../types';

interface AnalysisInput {
  projectId: string;
  topic: string;
  retention: number;
  ctr: number;
  views: number;
  hookEntries: HookEffectivenessEntry[];
  dropOffPoints: DropOffPoint[];
  topHookType: string;
  thumbnailStyle: string;
  thumbnailCTR: number;
}

export class RecommendationGenerator {
  generateDataDriven(input: AnalysisInput): OptimizationRecommendation[] {
    const recommendations: OptimizationRecommendation[] = [];

    // Hook recommendations
    if (input.topHookType !== 'unknown' && input.hookEntries.length > 0) {
      const bestHook = input.hookEntries[0];
      recommendations.push({
        category: 'hook',
        priority: input.retention < 40 ? 'critical' : 'high',
        content: `Lead with "${bestHook.hookType}" hooks. They score ${bestHook.score}/100 with ${bestHook.avgRetention}% estimated retention.`,
        expectedImpact: `+${Math.round((bestHook.avgRetention - input.retention) * 0.3)}% retention`,
        confidence: bestHook.confidence,
        relatedMetric: 'retention',
      });
    }

    if (input.hookEntries.length > 1) {
      const worstHook = input.hookEntries[input.hookEntries.length - 1];
      if (worstHook.score < 40) {
        recommendations.push({
          category: 'hook',
          priority: 'high',
          content: `Avoid "${worstHook.hookType}" hooks. They score only ${worstHook.score}/100. Replace with curiosity-gap or bold-statement.`,
          expectedImpact: `+${Math.round((100 - worstHook.score) * 0.2)}% hook quality`,
          confidence: Math.max(0.5, worstHook.confidence),
          relatedMetric: 'hook-score',
        });
      }
    }

    // Thumbnail recommendations
    if (input.thumbnailCTR < 4) {
      recommendations.push({
        category: 'thumbnail',
        priority: 'critical',
        content: `Thumbnail CTR is ${input.thumbnailCTR}%. Redesign with bold contrasting colors, close-up face with extreme emotion, and max 3 words of text creating curiosity.`,
        expectedImpact: `+${Math.round((6 - input.thumbnailCTR) * 2)}% CTR`,
        confidence: 0.8,
        relatedMetric: 'ctr',
      });
    } else if (input.thumbnailCTR < 7) {
      recommendations.push({
        category: 'thumbnail',
        priority: 'medium',
        content: `Thumbnail CTR is ${input.thumbnailCTR}%. ${input.thumbnailStyle !== 'unknown' ? `Current style "${input.thumbnailStyle}" is performing adequately.` : ''} Test A/B variations with different emotional expressions or text angles.`,
        expectedImpact: `+${Math.round((10 - input.thumbnailCTR) * 0.5)}% CTR`,
        confidence: 0.6,
        relatedMetric: 'ctr',
      });
    }

    // Retention recommendations
    if (input.retention < 30) {
      recommendations.push({
        category: 'retention',
        priority: 'critical',
        content: `Retention at ${input.retention}%. Restructure video: add pattern interrupt every 8-10 seconds, use curiosity gaps at content transitions, and deliver on hook promise within first 60 seconds.`,
        expectedImpact: `+${Math.round((50 - input.retention) * 0.4)}% retention`,
        confidence: 0.85,
        relatedMetric: 'retention',
      });
    } else if (input.retention < 50) {
      recommendations.push({
        category: 'retention',
        priority: 'high',
        content: `Retention at ${input.retention}%. Increase mid-video pattern interrupts. Use mini-cliffhangers before transitions and raise stakes at the 40% mark.`,
        expectedImpact: `+${Math.round((60 - input.retention) * 0.3)}% retention`,
        confidence: 0.7,
        relatedMetric: 'retention',
      });
    }

    // Pacing recommendations from drop-off points
    const criticalDropOffs = input.dropOffPoints.filter(d => d.severity === 'critical');
    if (criticalDropOffs.length > 0) {
      for (const dropOff of criticalDropOffs.slice(0, 2)) {
        recommendations.push({
          category: 'pacing',
          priority: 'critical',
          content: `Drop-off detected at position ${dropOff.position}: "${dropOff.context}". ${dropOff.likelyCause}`,
          expectedImpact: `Recover ~${dropOff.estimatedDropPercent}% of lost viewers`,
          confidence: 0.7,
          relatedMetric: 'retention',
        });
      }
    }

    // General recommendations
    if (input.views < 100 && input.ctr < 5) {
      recommendations.push({
        category: 'general',
        priority: 'high',
        content: `Low views (${input.views}) and CTR (${input.ctr}%). Focus on title optimization: use numbers, power words, and curiosity gaps in titles. Post at optimal times for your audience.`,
        expectedImpact: '+200-500% more impressions',
        confidence: 0.75,
        relatedMetric: 'views',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        category: 'general',
        priority: 'low',
        content: 'Current performance is stable. Continue testing A/B variations on hooks and thumbnails to further optimize.',
        expectedImpact: 'Incremental improvements across all metrics',
        confidence: 0.5,
        relatedMetric: 'general',
      });
    }

    return recommendations;
  }

  async enhanceWithAI(input: AnalysisInput, dataDriven: OptimizationRecommendation[]): Promise<OptimizationRecommendation[]> {
    try {
      const currentRecs = dataDriven.slice(0, 5).map(r => `[${r.priority}] ${r.category}: ${r.content}`).join('\n');

      const prompt = `Generate optimization recommendations for a YouTube video based on these analytics:

Topic: ${input.topic}
Retention: ${input.retention}%
CTR: ${input.ctr}%
Views: ${input.views}
Top hook type: ${input.topHookType}
Thumbnail style: ${input.thumbnailStyle}

Current recommendations:
${currentRecs}

Return JSON array of 2-3 ADDITIONAL unique, specific recommendations not covered above:
[
  {
    "category": "hook|thumbnail|pacing|structure|cta|retention|general",
    "priority": "critical|high|medium|low",
    "content": "Specific actionable recommendation based on the data",
    "expectedImpact": "Expected improvement in metrics",
    "confidence": 0.75,
    "relatedMetric": "retention|ctr|views|hook-score|general"
  }
]

Each recommendation must:
- Be specific and actionable (not generic advice)
- Reference actual metrics from the data
- Have a realistic expected impact
- Not duplicate existing recommendations`;

      const result = await generateWithAI(prompt, 'ollama', { temperature: 0.4 });
      const parsed = extractJsonArray(result);

      if (parsed) {
        const validCategories = ['hook', 'thumbnail', 'pacing', 'structure', 'cta', 'retention', 'general'];
        const validPriorities = ['critical', 'high', 'medium', 'low'];

        const aiRecs: OptimizationRecommendation[] = parsed
          .filter((r: any) => r.content && r.content.length > 20)
          .map((r: any) => ({
            category: validCategories.includes(r.category) ? r.category : 'general',
            priority: validPriorities.includes(r.priority) ? r.priority : 'medium',
            content: r.content,
            expectedImpact: r.expectedImpact || 'Improved performance',
            confidence: Math.min(1, Math.max(0, r.confidence ?? 0.5)),
            relatedMetric: r.relatedMetric || 'general',
          }));

        return [...dataDriven, ...aiRecs];
      }
    } catch (err) {
      aiLogger.warn('AI recommendation enhancement failed', { error: (err as Error).message });
    }

    return dataDriven;
  }
}
