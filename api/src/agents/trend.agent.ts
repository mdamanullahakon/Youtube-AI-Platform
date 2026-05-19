import { getYouTubeTrends, getGoogleTrends, getRedditTrends, TrendResult } from '../services/trend.service';
import { generateWithAI } from '../services/ai.service';
import { calculateViralScore } from '../utils/helpers';
import { aiLogger } from '../utils/logger';
import { extractJson } from '../utils/parse-ai-response';
import type { TrendAnalysis } from '../types';

export async function analyzeTrend(topic?: string): Promise<TrendAnalysis> {
  aiLogger.info('Starting trend analysis...');

  let youtubeTrends: string[] = [];
  let redditTrends: TrendResult[] = [];
  let googleTrends: TrendResult[] = [];

  try {
    const results = await Promise.allSettled([
      getYouTubeTrends(),
      getRedditTrends(),
      getGoogleTrends(topic || 'trending videos'),
    ]);
    if (results[0].status === 'fulfilled') youtubeTrends = results[0].value;
    if (results[1].status === 'fulfilled') redditTrends = results[1].value;
    if (results[2].status === 'fulfilled') googleTrends = results[2].value;
  } catch {
    // all external fetches failed, continue with empty
  }

  const allTrends = [
    ...youtubeTrends,
    ...redditTrends.map((r: TrendResult) => r.title),
    ...googleTrends.map((g: TrendResult) => g.title),
  ];
  const uniqueTrends = [...new Set(allTrends)].slice(0, 15);

  let aiAnalysis = '';
  try {
    aiAnalysis = await generateWithAI(`
    Analyze these YouTube trending topics and identify the most viral potential topic.
    Return a JSON object with: topic, viralScore (0-100), competition (0-100), audience, format (Shorts/Longform).

    Trends: ${JSON.stringify(uniqueTrends)}

    Rules:
    - Pick topics with high curiosity gap
    - Prefer topics with emotional hooks
    - Consider audience size and engagement potential
    - Analyze competition level
    - Return ONLY valid JSON
  `, 'ollama', { temperature: 0.5 });
  } catch (err: any) {
    aiLogger.warn(`AI analysis failed, using fallback: ${err.message}`);
  }

  let analysis: Partial<TrendAnalysis> = {};
  try {
    if (aiAnalysis) {
      const parsed = extractJson(aiAnalysis) as any;
      analysis = {
        topic: typeof parsed.topic === 'string' ? parsed.topic : (uniqueTrends[0] || 'AI Revolution'),
        viralScore: typeof parsed.viralScore === 'number' ? parsed.viralScore : calculateViralScore(70, 40, 60),
        competition: typeof parsed.competition === 'number' ? parsed.competition : 40,
        audience: typeof parsed.audience === 'string' ? parsed.audience : 'General',
        format: typeof parsed.format === 'string' ? parsed.format : 'Shorts',
      };
    }
  } catch {
    // fallback below
  }

  if (!analysis.topic) {
    analysis = {
      topic: uniqueTrends[0] || 'Trending Topic',
      viralScore: calculateViralScore(70, 40, 60),
      competition: 40,
      audience: 'General',
      format: 'Shorts',
    };
  }

  aiLogger.info(`Trend analysis complete. Topic: ${analysis.topic}, Score: ${analysis.viralScore}`);

  return {
    ...analysis as TrendAnalysis,
    trends: uniqueTrends,
    competitors: [],
    reasoning: 'Multi-source trend analysis with AI-powered viral scoring',
  };
}
