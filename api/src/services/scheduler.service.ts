import cron from 'node-cron';
import { SmartSchedulerService } from './smart-scheduler.service';
import { SeriesIntelligenceService } from './series-intelligence.service';
import { logger } from '../config/logger';
import { StorageManager } from './storage.service';
import { UploadSchedulerService } from './upload-scheduler.service';
import { videoQueue } from '../queues/video.queue';
import { prisma } from '../config/db';
import { scheduleFallbackRetry } from './youtube-fallback.service';
import { horrorContentScheduler } from './horror-content-scheduler.service';
import { MultiChannelOrchestrator } from './multi-channel-orchestrator.service';
import { NotificationService } from './notification.service';
import { incomeCycleQueue } from './income-system-v2/income.queue';
import { syncAllUsersChannelStats } from './youtube-oauth.service';
import { enqueueCanonicalPipeline } from '../pipeline/canonical-pipeline.service';

const uploadScheduler = new UploadSchedulerService();

export function initializeSchedulers() {
  logger.info('Initializing schedulers...');

  horrorContentScheduler.initialize();

  cron.schedule('*/15 * * * *', async () => {
    try {
      const usage = await StorageManager.getUsage();
      if (usage.status === 'critical') {
        logger.warn(`Cron: Disk critical (${usage.freeFormatted} free), triggering emergency cleanup`);
        await StorageManager.emergencyCleanup(500 * 1024 * 1024);
      } else if (usage.status === 'warning') {
        logger.info(`Cron: Disk warning (${usage.freeFormatted} free)`);
      }
    } catch (err: any) {
      logger.error('Cron: Disk check failed', { error: err.message });
    }
  });
  logger.info('Disk health checker initialized (15-min interval)');

    if (process.env.ENABLE_SERIES_INTELLIGENCE === 'true') {
      const seriesService = new SeriesIntelligenceService();
      cron.schedule('*/15 * * * *', async () => {
        try {
          // TODO: replace placeholders with actual series, channel, and project IDs
          const seriesId = 'placeholder-series-id';
          const channelId = 'placeholder-channel-id';
          const projectId = 'placeholder-project-id';
          await seriesService.scheduleSeriesUpload(seriesId, channelId, projectId);
          logger.info('SeriesIntelligence evaluated and scheduled');
        } catch (err: any) {
          logger.error('SeriesIntelligence cron failed', { error: err.message });
        }
      });
      logger.info('SeriesIntelligence scheduler initialized (15‑min interval)');
    }

  cron.schedule('* * * * *', async () => {
    try {
      const processed = await uploadScheduler.processPendingUploads();
      if (processed > 0) {
        logger.info(`Upload scheduler: ${processed} pending upload(s) dispatched`);
      }
    } catch (err: any) {
      logger.error('Upload scheduler cron failed', { error: err.message });
    }
  });
  logger.info('Upload scheduler initialized (1-min interval)');

  const legacyAutoGenEnabled = process.env.AUTO_GENERATE_ENABLED === 'true' && process.env.HORROR_AUTO_GENERATE_ENABLED !== 'true';
  if (legacyAutoGenEnabled) {
    const schedule = process.env.AUTO_GENERATE_CRON || '0 8 * * *';
    logger.info(`Legacy auto-content generation scheduled (${schedule})`);
    cron.schedule(schedule, async () => {
      try {
        const project = await prisma.videoProject.create({
          data: { userId: 'system', topic: 'auto-scheduled', channelId: null, status: 'draft' },
        });
        await videoQueue.add('full-pipeline', { projectId: project.id, topic: 'auto-scheduled' });
        logger.info(`Legacy auto-generated project ${project.id} enqueued`);
      } catch (err: any) {
        logger.error('Legacy auto-generation failed', { error: err.message });
      }
    });
  }

  cron.schedule('*/30 * * * *', async () => {
    try {
      await scheduleFallbackRetry();
    } catch (err: any) {
      logger.error('Fallback retry scheduler failed', { error: err.message });
    }
  });
  logger.info('YouTube fallback retry scheduler initialized (30-min interval)');

  const dailySchedule = process.env.DAILY_CONTENT_CRON || '0 6 * * *';
  cron.schedule(dailySchedule, async () => {
    logger.info('[DailyCron] Starting daily content orchestration');
    const orchestrator = new MultiChannelOrchestrator();
    const notifications = new NotificationService();
    try {
      const report = await orchestrator.runDailyOrchestration();
      logger.info(`[DailyCron] Complete: ${report.dailyScheduleResults.length} channels processed`);
    } catch (err: any) {
      logger.error(`[DailyCron] Failed: ${err.message}`);
      await notifications.send({
        event: 'system.error',
        title: 'Daily Content Cron Failed',
        message: err.message,
      }).catch(() => {});
    }
  });
  logger.info(`Daily content scheduler initialized (${dailySchedule})`);

  const incomeSchedule = process.env.INCOME_SYSTEM_CRON || '0 5 * * *';
  cron.schedule(incomeSchedule, async () => {
    logger.info('[IncomeCron] Starting income system daily cycle');
    const notifications = new NotificationService();
    try {
      const enabledConfigs = await prisma.incomeConfig.findMany({
        where: { enabled: true },
      });

      for (const config of enabledConfigs) {
        const uploadTimes = JSON.parse(config.uploadTimes || '[]') as string[];
        const monetizationTypes = JSON.parse(config.monetizationTypes || '[]') as string[];

        await incomeCycleQueue.add('daily-cycle', {
          channelId: config.channelId,
          userId: config.userId,
          niche: config.niche,
          configJson: JSON.stringify({
            channelId: config.channelId,
            userId: config.userId,
            niche: config.niche,
            videosPerDay: config.videosPerDay,
            uploadTimes,
            targetAudience: config.targetAudience || '',
            contentStyle: config.contentStyle || '',
            monetizationTypes,
            riskThresholds: {
              minCtr: config.minCtrThreshold,
              minRetention: config.minRetentionThreshold,
              maxFailRate: config.maxFailRate,
            },
            enabled: config.enabled,
          }),
        });
      }
      logger.info(`[IncomeCron] Enqueued ${enabledConfigs.length} channel cycles`);
    } catch (err: any) {
      logger.error(`[IncomeCron] Failed: ${err.message}`);
      await notifications.send({
        event: 'system.error',
        title: 'Income System Cron Failed',
        message: err.message,
      }).catch(() => {});
    }
  });
  logger.info(`Income system scheduler initialized (${incomeSchedule})`);

  cron.schedule('0 */6 * * *', async () => {
    logger.info('[ChannelStatsCron] Starting scheduled YouTube channel stats sync');
    try {
      await syncAllUsersChannelStats();
    } catch (err: any) {
      logger.error(`[ChannelStatsCron] Failed: ${err.message}`);
    }
  });
  logger.info('YouTube channel stats sync scheduler initialized (6-hour interval)');

  const autoPipelineSchedule = process.env.AUTO_PIPELINE_CRON || '0 4 * * *';
  cron.schedule(autoPipelineSchedule, async () => {
    logger.info('[AutoPipelineCron] Starting daily canonical pipeline enqueue');
    try {
      const users = await prisma.user.findMany({
        where: { youTubeAccounts: { some: { isConnected: true } } },
        select: { id: true },
      });
      for (const user of users) {
        const account = await prisma.youTubeAccount.findFirst({
          where: { userId: user.id, isConnected: true },
          orderBy: { createdAt: 'asc' },
        });
        const project = await prisma.videoProject.create({
          data: {
            userId: user.id,
            channelId: account?.channelId,
            topic: 'Scheduled automated content',
            status: 'draft',
          },
        });
        const jobId = await enqueueCanonicalPipeline(project.id, project.topic, {
          userId: user.id,
          channelId: account?.channelId,
        });
        logger.info(`[AutoPipelineCron] Canonical pipeline job ${jobId} for user ${user.id}, project ${project.id}`);
      }
    } catch (err: any) {
      logger.error(`[AutoPipelineCron] Failed: ${err.message}`);
    }
  });
  logger.info(`Canonical auto pipeline scheduler initialized (${autoPipelineSchedule})`);
}
