import { Request, Response } from 'express';
import { StorageManager } from '../services/storage.service';
import { cleanupQueue } from '../queues/video.queue';
import { logger } from '../utils/logger';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
}

export async function getStorageUsage(req: Request, res: Response) {
  try {
    const usage = await StorageManager.getUsage();
    res.json({ success: true, usage });
  } catch (error: any) {
    logger.error('Failed to get storage usage', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get storage usage' });
  }
}

export async function getStorageFiles(req: Request, res: Response) {
  try {
    const type = String(req.query.type || 'temp');
    if (!['temp', 'videos', 'voiceovers', 'thumbnails', 'logs'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid file type. Use: temp, videos, voiceovers, thumbnails, logs' });
    }
    const files = await StorageManager.scanFiles(type as any);
    const totalSize = files.reduce((s, f) => s + f.size, 0);
    res.json({ success: true, type, files, totalSize, totalFormatted: formatBytes(totalSize), count: files.length });
  } catch (error: any) {
    logger.error('Failed to get storage files', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get storage files' });
  }
}

export async function queueStorageCleanup(req: Request, res: Response) {
  try {
    const types = (req.body?.types as string[]) || ['temp', 'voiceovers', 'logs', 'videos'];

    const job = await cleanupQueue.add('manual-cleanup', { types });

    res.status(202).json({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: `Cleanup queued for: ${types.join(', ')}`,
    });
  } catch (error: any) {
    logger.error('Failed to queue cleanup', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to queue cleanup' });
  }
}

export async function runEmergencyCleanup(req: Request, res: Response) {
  try {
    const result = await StorageManager.emergencyCleanup(500 * 1024 * 1024);
    res.json({
      success: true,
      message: `Emergency cleanup completed. Freed ${result.freedFormatted}`,
      freedBytes: result.freedBytes,
      freedFormatted: result.freedFormatted,
      filesRemoved: result.filesRemoved,
    });
  } catch (error: any) {
    logger.error('Failed to run emergency cleanup', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to run emergency cleanup' });
  }
}

export async function getStorageStatus(req: Request, res: Response) {
  try {
    const usage = await StorageManager.getUsage();
    const tempOverLimit = await StorageManager.isTempOverLimit();

    res.json({
      success: true,
      status: usage.status,
      freeSpace: usage.freeFormatted,
      freeBytes: usage.freeBytes,
      tempOverLimit,
      breakdown: {
        temp: { size: usage.temp.size, formatted: formatBytes(usage.temp.size), files: usage.temp.files },
        videos: { size: usage.videos.size, formatted: formatBytes(usage.videos.size), files: usage.videos.files },
        voiceovers: { size: usage.voiceovers.size, formatted: formatBytes(usage.voiceovers.size), files: usage.voiceovers.files },
        thumbnails: { size: usage.thumbnails.size, formatted: formatBytes(usage.thumbnails.size), files: usage.thumbnails.files },
        logs: { size: usage.logs.size, formatted: formatBytes(usage.logs.size), files: usage.logs.files },
      },
    });
  } catch (error: any) {
    logger.error('Failed to get storage status', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get storage status' });
  }
}
