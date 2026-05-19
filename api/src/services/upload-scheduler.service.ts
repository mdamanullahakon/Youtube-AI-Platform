import { prisma } from '../config/db';
import { uploadQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';

export class UploadSchedulerService {
  async createSchedule(data: {
    channelId: string;
    userId: string;
    niche?: string;
    frequency: string;
    uploadDays?: string;
    uploadTime?: string;
    timezone?: string;
  }) {
    const nextScheduledAt = this.calculateNextUpload(data.frequency, data.uploadDays, data.uploadTime, data.timezone);

    return prisma.uploadSchedule.create({
      data: {
        channelId: data.channelId,
        userId: data.userId,
        niche: data.niche,
        frequency: data.frequency,
        uploadDays: data.uploadDays,
        uploadTime: data.uploadTime,
        timezone: data.timezone || 'UTC',
        nextScheduledAt,
        status: 'active',
      },
    });
  }

  async processPendingUploads(): Promise<number> {
    const now = new Date();
    const schedules = await prisma.uploadSchedule.findMany({
      where: {
        status: 'active',
        nextScheduledAt: { lte: now },
        projectId: { not: null },
      },
    });

    let processed = 0;
    for (const schedule of schedules) {
      try {
        await this.executeScheduledUpload(schedule.id);
        processed++;
      } catch (err: any) {
        logger.error(`Scheduled upload failed for schedule ${schedule.id}`, { error: err.message });
      }
    }
    return processed;
  }

  async executeScheduledUpload(scheduleId: string): Promise<void> {
    const schedule = await prisma.uploadSchedule.findUnique({
      where: { id: scheduleId },
    });
    if (!schedule || !schedule.projectId) return;

    await prisma.uploadSchedule.update({
      where: { id: scheduleId },
      data: { status: 'queued' },
    });

    const nextDate = this.calculateNextUpload(
      schedule.frequency,
      schedule.uploadDays ?? undefined,
      schedule.uploadTime ?? undefined,
      schedule.timezone,
    );

    const job = await uploadQueue.add('upload-video', {
      projectId: schedule.projectId,
      channelId: schedule.channelId,
      title: '',
      description: '',
      tags: [],
    });

    await prisma.uploadSchedule.update({
      where: { id: scheduleId },
      data: {
        lastUploadedAt: new Date(),
        nextScheduledAt: nextDate,
        status: 'active',
        projectId: null,
      },
    });

    logger.info(`Scheduled upload executed: ${scheduleId}, job: ${job.id}`);
  }

  async assignProjectToSchedule(scheduleId: string, projectId: string): Promise<void> {
    await prisma.uploadSchedule.update({
      where: { id: scheduleId },
      data: { projectId },
    });
  }

  calculateNextUpload(frequency: string, uploadDays?: string, uploadTime?: string, timezone?: string): Date {
    const now = new Date();
    const next = new Date(now);
    const [hours = 10, minutes = 0] = (uploadTime || '10:00').split(':').map(Number);

    const dayMap: Record<string, number> = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };

    switch (frequency) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'every-other-day':
        next.setDate(next.getDate() + 2);
        break;
      case 'weekly': {
        if (uploadDays && dayMap[uploadDays.toLowerCase()] !== undefined) {
          const targetDay = dayMap[uploadDays.toLowerCase()];
          const currentDay = next.getDay();
          let daysUntil = targetDay - currentDay;
          if (daysUntil <= 0) daysUntil += 7;
          next.setDate(next.getDate() + daysUntil);
        } else {
          next.setDate(next.getDate() + 7);
        }
        break;
      }
      case 'twice-weekly':
        next.setDate(next.getDate() + 3);
        break;
      default:
        next.setDate(next.getDate() + 1);
    }

    next.setHours(hours, minutes, 0, 0);
    return next;
  }
}
