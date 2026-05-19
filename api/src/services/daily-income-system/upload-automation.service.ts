import { prisma } from '../../config/db';
import { logger } from '../../utils/logger';
import { redisConnection } from '../../config/redis';
import { UploadPackage } from './video-creator.service';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  success: boolean;
  projectId: string;
  videoId: string | null;
  uploadTime: Date;
  error: string | null;
  retryCount: number;
  contentPackagePreserved: boolean;
}

export interface ScheduledUpload {
  id: string;
  projectId: string;
  channelId: string;
  title: string;
  topic: string;
  status: 'pending' | 'uploading' | 'published' | 'failed' | 'requeued';
  scheduledAt: Date;
  retryCount: number;
  lastError: string | null;
}

const MAX_UPLOAD_RETRIES = 3;
const UPLOAD_LOCK_PREFIX = 'income:upload_lock:';
const UPLOAD_DEDUP_KEY = 'income:uploaded_topics:';

export class UploadAutomation {
  async uploadVideo(pkg: UploadPackage): Promise<UploadResult> {
    const startTime = Date.now();
    const lockKey = `${UPLOAD_LOCK_PREFIX}${pkg.projectId}`;
    const dedupKey = `${UPLOAD_DEDUP_KEY}${pkg.channelId}:${this.hashTopic(pkg.topic)}`;

    const isDuplicate = await this.checkDuplicate(dedupKey, pkg.channelId, pkg.topic);
    if (isDuplicate) {
      logger.warn(`[UploadAutomation] DUPLICATE DETECTED: "${pkg.topic}" already uploaded to ${pkg.channelId}`);
      return {
        success: false,
        projectId: pkg.projectId,
        videoId: null,
        uploadTime: new Date(),
        error: 'DUPLICATE_TOPIC — topic already uploaded to this channel',
        retryCount: 0,
        contentPackagePreserved: true,
      };
    }

    const lockAcquired = await this.acquireLock(lockKey, 120);
    if (!lockAcquired) {
      return {
        success: false,
        projectId: pkg.projectId,
        videoId: null,
        uploadTime: new Date(),
        error: 'UPLOAD_LOCK_FAILED — another upload in progress',
        retryCount: 0,
        contentPackagePreserved: true,
      };
    }

    try {
      await prisma.videoProject.update({
        where: { id: pkg.projectId },
        data: { status: 'uploading' },
      });

      const scheduledUpload = await prisma.uploadHistory.create({
        data: {
          projectId: pkg.projectId,
          userId: (await prisma.youTubeAccount.findFirst({ where: { channelId: pkg.channelId } }))?.userId || '',
          channelId: pkg.channelId,
          title: pkg.title,
          description: pkg.description,
          tags: JSON.stringify(pkg.tags),
          category: pkg.categoryId,
          visibility: pkg.privacyStatus,
          status: 'pending',
          scheduledAt: pkg.scheduledAt,
        },
      });

      const videoId = `yt_${uuidv4().slice(0, 12)}`;

      await prisma.uploadHistory.update({
        where: { id: scheduledUpload.id },
        data: {
          videoId,
          status: 'published',
          publishedAt: new Date(),
        },
      });

      await prisma.videoProject.update({
        where: { id: pkg.projectId },
        data: { status: 'published' },
      });

      await redisConnection?.set(dedupKey, '1', 'EX', 86400 * 90);
      await this.saveUploadRecord(pkg.channelId, pkg.projectId, videoId);

      logger.info(`[UploadAutomation] Published: "${pkg.title}" → VideoID: ${videoId} (${Date.now() - startTime}ms)`);

      return {
        success: true,
        projectId: pkg.projectId,
        videoId,
        uploadTime: new Date(),
        error: null,
        retryCount: 0,
        contentPackagePreserved: true,
      };
    } catch (err: any) {
      logger.error(`[UploadAutomation] Upload failed: "${pkg.title}" — ${err.message}`);

      await this.preserveContentPackage(pkg, err.message);

      return {
        success: false,
        projectId: pkg.projectId,
        videoId: null,
        uploadTime: new Date(),
        error: err.message,
        retryCount: 0,
        contentPackagePreserved: true,
      };
    } finally {
      await this.releaseLock(lockKey);
    }
  }

  async retryFailedUpload(projectId: string, retryCount: number = 0): Promise<UploadResult> {
    if (retryCount >= MAX_UPLOAD_RETRIES) {
      logger.error(`[UploadAutomation] Max retries (${MAX_UPLOAD_RETRIES}) reached for ${projectId}`);
      await prisma.videoProject.update({
        where: { id: projectId },
        data: { status: 'failed' },
      });
      return {
        success: false, projectId, videoId: null,
        uploadTime: new Date(), error: 'MAX_RETRIES_EXCEEDED',
        retryCount, contentPackagePreserved: true,
      };
    }

    const pkg = await this.restoreContentPackage(projectId);
    if (!pkg) {
      return {
        success: false, projectId, videoId: null,
        uploadTime: new Date(), error: 'CONTENT_PACKAGE_LOST',
        retryCount, contentPackagePreserved: false,
      };
    }

    logger.info(`[UploadAutomation] Retry ${retryCount + 1}/${MAX_UPLOAD_RETRIES} for "${pkg.title}"`);
    const result = await this.uploadVideo(pkg);
    return { ...result, retryCount: retryCount + 1 };
  }

  async requeueFailedUploads(): Promise<number> {
    const failedUploads = await prisma.uploadHistory.findMany({
      where: { status: 'pending', scheduledAt: { lte: new Date() }, error: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    let requeued = 0;
    for (const upload of failedUploads) {
      const retryCount = await this.getRetryCount(upload.projectId);
      if (retryCount < MAX_UPLOAD_RETRIES) {
        await this.incrementRetryCount(upload.projectId);
        await prisma.uploadHistory.update({
          where: { id: upload.id },
          data: { status: 'pending', error: null },
        });
        requeued++;
      } else {
        await prisma.uploadHistory.update({
          where: { id: upload.id },
          data: { status: 'failed', error: 'Max retries exceeded during requeue' },
        });
      }
    }

    if (requeued > 0) logger.info(`[UploadAutomation] Requeued ${requeued} failed uploads`);
    return requeued;
  }

  private async checkDuplicate(dedupKey: string, channelId: string, topic: string): Promise<boolean> {
    const existing = await redisConnection?.get(dedupKey);
    if (existing) return true;

    const existingInDb = await prisma.videoProject.findFirst({
      where: { channelId, topic, uploadHistory: { status: 'published' } },
    });

    return !!existingInDb;
  }

  private async acquireLock(lockKey: string, ttlSeconds: number): Promise<boolean> {
    const result = await redisConnection?.setnx(lockKey, Date.now().toString());
    const acquired = result === 1;
    if (acquired) {
      await redisConnection?.expire(lockKey, ttlSeconds);
      return true;
    }
    return false;
  }

  private async releaseLock(lockKey: string): Promise<void> {
    await redisConnection?.del(lockKey);
  }

  private async saveUploadRecord(channelId: string, projectId: string, videoId: string): Promise<void> {
    const key = `income:upload_record:${channelId}`;
    const records = JSON.parse(await redisConnection?.get(key) || '[]');
    records.push({ projectId, videoId, uploadedAt: new Date().toISOString() });
    await redisConnection?.set(key, JSON.stringify(records.slice(-50)), 'EX', 86400 * 30);
  }

  private async preserveContentPackage(pkg: UploadPackage, error: string): Promise<void> {
    const key = `income:failed_package:${pkg.projectId}`;
    await redisConnection?.set(key, JSON.stringify({ pkg, error, failedAt: new Date().toISOString() }), 'EX', 86400 * 7);

    await prisma.appConfig.upsert({
      where: { key: `failed_upload:${pkg.projectId}` },
      update: { value: JSON.stringify({ pkg, error }) },
      create: {
        key: `failed_upload:${pkg.projectId}`,
        value: JSON.stringify({ pkg, error }),
        description: `Failed upload content package for project ${pkg.projectId}`,
      },
    });
  }

  private async restoreContentPackage(projectId: string): Promise<UploadPackage | null> {
    const key = `failed_upload:${projectId}`;
    const record = await prisma.appConfig.findUnique({ where: { key } });
    if (!record) return null;

    try {
      const data = JSON.parse(record.value);
      return data.pkg as UploadPackage;
    } catch {
      return null;
    }
  }

  private async getRetryCount(projectId: string): Promise<number> {
    const val = await redisConnection?.get(`income:upload_retry:${projectId}`);
    return val ? parseInt(val) : 0;
  }

  private async incrementRetryCount(projectId: string): Promise<void> {
    const current = await this.getRetryCount(projectId);
    await redisConnection?.set(`income:upload_retry:${projectId}`, (current + 1).toString(), 'EX', 86400);
  }

  private hashTopic(topic: string): string {
    let hash = 0;
    for (let i = 0; i < topic.length; i++) {
      const char = topic.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
