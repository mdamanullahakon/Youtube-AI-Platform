/**
 * @deprecated Production uses sync PipelineOrchestrator via canonical-pipeline.service.
 * FlowProducer paths are disabled unless ENABLE_LEGACY_QUEUE_PIPELINE=true.
 */
import { FlowProducer } from 'bullmq';
import { redisConnection } from '../config/redis';
import { prisma } from '../config/db';
import { queueLogger } from '../utils/logger';
import { isLegacyQueuePipelineEnabled } from '../pipeline/canonical-pipeline.service';
import type { RenderJobData, UploadJobData, AnalyticsJobData, TrendJobData, ScriptJobData } from './video.queue';

function assertLegacyPipelineAllowed(): void {
  if (!isLegacyQueuePipelineEnabled()) {
    throw new Error(
      'BullMQ FlowProducer pipeline is disabled. Use canonical sync pipeline (POST /api/videos/generate/new). ' +
      'Set ENABLE_LEGACY_QUEUE_PIPELINE=true only for debugging.',
    );
  }
}

export const pipelineFlow = new FlowProducer({
  connection: redisConnection,
});

export interface PipelineFlowResult {
  pipelineJobId: string;
  tree: any;
}

export async function createFullPipelineFlow(projectId: string, topic: string, channelId?: string): Promise<PipelineFlowResult> {
  assertLegacyPipelineAllowed();
  queueLogger.warn(`[DEPRECATED] createFullPipelineFlow for project ${projectId}`);
  queueLogger.info(`Creating pipeline flow for project ${projectId}: ${topic} (channel: ${channelId || 'none'})`);

  const channel = channelId || undefined;

  const flow = await pipelineFlow.add({
    name: 'collect-analytics',
    queueName: 'analytics-collection',
    data: { projectId, channelId: channel } satisfies AnalyticsJobData,
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 86400 * 7, count: 50 },
    },
    children: [
      {
        name: 'cleanup-assets',
        queueName: 'cleanup',
        data: { projectId, filePaths: [], tempDirs: [] },
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400, count: 10 },
          removeOnFail: { age: 86400, count: 10 },
        },
        children: [
          {
            name: 'upload-video',
            queueName: 'youtube-upload',
            data: { projectId, channelId: channel, title: topic, description: '', tags: [topic], privacyStatus: 'public' } satisfies UploadJobData,
            opts: {
              attempts: 5,
              backoff: { type: 'exponential', delay: 10000 },
              removeOnComplete: { age: 86400, count: 100 },
              removeOnFail: { age: 86400 * 7, count: 50 },
            },
            children: [
              {
                name: 'render-video',
                queueName: 'video-render',
                data: { projectId, channelId: channel } satisfies RenderJobData,
                opts: {
                  attempts: 4,
                  backoff: { type: 'exponential', delay: 10000 },
                  removeOnComplete: { age: 86400, count: 100 },
                  removeOnFail: { age: 86400 * 7, count: 50 },
                },
                children: [
                  {
                    name: 'script-generation',
                    queueName: 'script-generation',
                    data: { projectId, topic, format: 'Shorts', channelId: channel } satisfies ScriptJobData,
                opts: {
                  attempts: 4,
                  backoff: { type: 'exponential', delay: 10000 },
                  removeOnComplete: { age: 86400, count: 100 },
                  removeOnFail: { age: 86400 * 7, count: 50 },
                },
                    children: [
                      {
                        name: 'trend-analysis',
                        queueName: 'trend-analysis',
                        data: { projectId, topic, channelId: channel } satisfies TrendJobData,
                        opts: {
                          attempts: 3,
                          backoff: { type: 'exponential', delay: 2000 },
                          removeOnComplete: { age: 86400, count: 100 },
                          removeOnFail: { age: 86400 * 7, count: 50 },
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  await prisma.videoProject.update({
    where: { id: projectId },
    data: { status: 'running' },
  }).catch(err => queueLogger.error(`Failed to set pipeline status to running for ${projectId}`, { error: (err as Error).message }));

  queueLogger.info(`Pipeline flow created for project ${projectId}, root job: ${flow.job.id}`);
  return { pipelineJobId: flow.job.id!, tree: flow };
}

export async function createScriptToRenderFlow(projectId: string, channelId?: string) {
  assertLegacyPipelineAllowed();
  queueLogger.warn(`[DEPRECATED] createScriptToRenderFlow for project ${projectId}`);
  const channel = channelId || undefined;
  queueLogger.info(`Creating script-to-render flow for project ${projectId}`);

  const flow = await pipelineFlow.add({
    name: 'collect-analytics',
    queueName: 'analytics-collection',
    data: { projectId, channelId: channel } satisfies AnalyticsJobData,
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 86400, count: 100 },
      removeOnFail: { age: 86400 * 7, count: 50 },
    },
    children: [
      {
        name: 'cleanup-assets',
        queueName: 'cleanup',
        data: { projectId, filePaths: [], tempDirs: [] },
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { age: 86400, count: 10 },
          removeOnFail: { age: 86400, count: 10 },
        },
        children: [
          {
            name: 'upload-video',
            queueName: 'youtube-upload',
            data: { projectId, channelId: channel, title: '(pending)', description: '', tags: [] } satisfies UploadJobData,
            opts: {
              attempts: 5,
              backoff: { type: 'exponential', delay: 10000 },
              removeOnComplete: { age: 86400, count: 100 },
              removeOnFail: { age: 86400 * 7, count: 50 },
            },
            children: [
              {
                name: 'render-video',
                queueName: 'video-render',
                data: { projectId, channelId: channel } satisfies RenderJobData,
                opts: {
                  attempts: 3,
                  backoff: { type: 'exponential', delay: 5000 },
                  removeOnComplete: { age: 86400, count: 100 },
                  removeOnFail: { age: 86400 * 7, count: 50 },
                },
              },
            ],
          },
        ],
      },
    ],
  });

  queueLogger.info(`Script-to-render flow created for project ${projectId}, root job: ${flow.job.id}`);
  return { pipelineJobId: flow.job.id!, tree: flow };
}

export async function getPipelineTreeStatus(rootJobId: string) {
  try {
    const tree = await pipelineFlow.getFlow({
      id: rootJobId,
      queueName: 'analytics-collection',
    });
    return tree;
  } catch {
    return null;
  }
}
