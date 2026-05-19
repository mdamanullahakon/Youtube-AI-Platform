import { PipelineStep } from '../pipeline-step';
import { TopicEngineInput, TopicEngineOutput, TOPIC_SCORE_THRESHOLD } from '../pipeline.types';
import { prisma } from '../../config/db';
import { analyzeTrend } from '../../agents/trend.agent';
import type { TrendAnalysis } from '../../types';

export class TopicEngineStep extends PipelineStep<TopicEngineInput, TopicEngineOutput> {
  constructor() {
    super('TopicEngine');
  }

  validate(input: TopicEngineInput): string | null {
    if (!input.topic || input.topic.trim().length === 0) {
      return 'Topic is required';
    }
    if (!input.projectId) {
      return 'projectId is required';
    }
    return null;
  }

  protected async execute(input: TopicEngineInput): Promise<TopicEngineOutput> {
    const analysis = await analyzeTrend(input.topic);

    const topicWithBestScore = await this.ensureScoreThreshold(input, analysis);

    await prisma.trendResearch.upsert({
      where: { projectId: input.projectId },
      update: {
        topic: topicWithBestScore.topic,
        viralScore: topicWithBestScore.viralScore,
        competition: topicWithBestScore.competition,
        audience: topicWithBestScore.audience,
        format: topicWithBestScore.format,
      },
      create: {
        projectId: input.projectId,
        topic: topicWithBestScore.topic,
        viralScore: topicWithBestScore.viralScore,
        competition: topicWithBestScore.competition,
        audience: topicWithBestScore.audience,
        format: topicWithBestScore.format,
      },
    });

    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'trending_analyzed', topic: topicWithBestScore.topic },
    });

    return topicWithBestScore;
  }

  private async ensureScoreThreshold(
    input: TopicEngineInput,
    initialAnalysis: TopicEngineOutput
  ): Promise<TopicEngineOutput> {
    if (initialAnalysis.viralScore >= TOPIC_SCORE_THRESHOLD) {
      return initialAnalysis;
    }

    const fallbackTopics = [
      'Most terrifying true horror stories you have never heard',
      'The scariest abandoned places on earth captured on camera',
      'Real paranormal encounters caught on tape',
    ];

    for (const altTopic of fallbackTopics) {
      const altAnalysis = await analyzeTrend(altTopic);
      if (altAnalysis.viralScore >= TOPIC_SCORE_THRESHOLD) {
        return { ...altAnalysis, topic: altTopic };
      }
    }

    return initialAnalysis;
  }

  async fallback(input: TopicEngineInput, error: Error): Promise<TopicEngineOutput> {
    await prisma.videoProject.update({
      where: { id: input.projectId },
      data: { status: 'trending_analyzed' },
    }).catch(() => {});

    return {
      topic: input.topic,
      viralScore: 50,
      competition: 30,
      audience: 'General',
      format: 'long-form',
      reasoning: `Fallback after all retries failed: ${error.message}`,
    };
  }
}
