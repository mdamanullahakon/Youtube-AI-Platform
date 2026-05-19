import { generateWithAI } from '../services/ai.service';
import { getVideoAnalytics } from '../services/youtube.service';
import { prisma } from '../config/db';
import { logger } from '../utils/logger';
import { extractJsonArray } from '../utils/parse-ai-response';

export interface AnalyticsInsight {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  ctr: number;
  retention: number;
  watchTime: number;
  subscribersGained: number;
  performance: 'excellent' | 'good' | 'average' | 'poor';
  recommendations: string[];
}

export async function analyzeVideoPerformance(projectId: string): Promise<AnalyticsInsight> {
  logger.info(`Analyzing performance for project ${projectId}`);

  const project = await prisma.videoProject.findUnique({
    where: { id: projectId },
    include: { uploadHistory: true, analytics: true },
  });

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  let analytics = project.analytics;

  if (project.uploadHistory?.videoId) {
    const youtubeStats = await getVideoAnalytics(project.uploadHistory.videoId);
    if (youtubeStats) {
      analytics = await prisma.analytics.upsert({
        where: { projectId },
        update: {
          views: youtubeStats.views || analytics?.views || 0,
          likes: youtubeStats.likes || analytics?.likes || 0,
          comments: youtubeStats.comments || analytics?.comments || 0,
          ctr: youtubeStats.ctr || analytics?.ctr || 0,
          retention: youtubeStats.retention || analytics?.retention || 0,
          watchTime: youtubeStats.watchTime || analytics?.watchTime || 0,
          subscribersGained: youtubeStats.subscribersGained || analytics?.subscribersGained || 0,
        },
        create: {
          projectId,
          views: youtubeStats.views || 0,
          likes: youtubeStats.likes || 0,
          comments: youtubeStats.comments || 0,
          ctr: youtubeStats.ctr || 0,
          retention: youtubeStats.retention || 0,
          watchTime: youtubeStats.watchTime || 0,
          subscribersGained: youtubeStats.subscribersGained || 0,
        },
      });
    }
  }

  const views = analytics?.views || 0;
  const ctr = analytics?.ctr || 0;
  const retention = analytics?.retention || 0;

  let performance: AnalyticsInsight['performance'] = 'average';
  if (views > 10000 && ctr > 10 && retention > 60) performance = 'excellent';
  else if (views > 5000 && ctr > 5 && retention > 40) performance = 'good';
  else if (views < 1000 || ctr < 2 || retention < 20) performance = 'poor';

  const recommendations = await generateRecommendations(project, performance);

  return {
    views,
    likes: analytics?.likes || 0,
    comments: analytics?.comments || 0,
    shares: analytics?.shares || 0,
    ctr,
    retention,
    watchTime: analytics?.watchTime || 0,
    subscribersGained: analytics?.subscribersGained || 0,
    performance,
    recommendations,
  };
}

async function generateRecommendations(project: any, performance: string): Promise<string[]> {
  const prompt = `
    A YouTube video titled "${project.topic}" has ${performance} performance.
    Topic: ${project.topic}
    Score: ${project.viralScore}

    Generate 3 specific recommendations to improve future videos.
    Focus on: hooks, thumbnails, retention, and posting strategy.

    Return as a JSON array of strings.
  `;

  try {
    const result = await generateWithAI(prompt, 'ollama', { temperature: 0.5 });
    const parsed = extractJsonArray<string>(result);
    if (!parsed) throw new Error();
    return parsed;
  } catch {
    return [
      'Increase hook urgency in first 3 seconds',
      'Use more pattern interrupts every 15 seconds',
      'Optimize thumbnail with brighter colors and curiosity gap',
    ];
  }
}
