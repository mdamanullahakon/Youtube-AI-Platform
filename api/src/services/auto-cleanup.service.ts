import { readdir, stat, unlink, rm } from 'fs/promises';
import { join } from 'path';
import { logger } from '../utils/logger';

export class AutoCleanupService {
  async cleanupAfterUpload(projectId: string): Promise<void> {
    logger.info(`Auto-cleanup after upload for project: ${projectId}`);
    const baseDir = join(process.cwd(), 'uploads');
    const dirs = ['voiceovers', 'thumbnails', join('videos', 'temp')];

    for (const dir of dirs) {
      const dirPath = join(baseDir, dir);
      try {
        const files = await readdir(dirPath);
        const projectFiles = files.filter(f => f.includes(projectId));

        for (const file of projectFiles) {
          await unlink(join(dirPath, file)).catch(() => {});
        }

        if (projectFiles.length > 0) {
          logger.info(`Cleaned ${projectFiles.length} files from ${dir} for project ${projectId}`);
        }
      } catch {}
    }

    const tempDir = join(baseDir, 'temp');
    try {
      const tempItems = await readdir(tempDir);
      const projectTemp = tempItems.filter(f => f.includes(projectId));

      for (const item of projectTemp) {
        const fullPath = join(tempDir, item);
        const itemStat = await stat(fullPath).catch(() => null);
        if (itemStat?.isDirectory()) {
          await rm(fullPath, { recursive: true, force: true }).catch(() => {});
        } else {
          await unlink(fullPath).catch(() => {});
        }
      }
    } catch {}

    const freedBytes = await this.getStorageSavings(projectId);
    logger.info(`Cleanup complete for project ${projectId}: freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);
  }

  async getStorageSavings(projectId: string): Promise<number> {
    let totalBytes = 0;
    const baseDir = join(process.cwd(), 'uploads');

    const searchDirs = ['voiceovers', 'thumbnails', 'temp', join('videos', 'temp')];
    for (const dir of searchDirs) {
      const dirPath = join(baseDir, dir);
      try {
        const files = await readdir(dirPath);
        for (const file of files.filter(f => f.includes(projectId))) {
          const fileStat = await stat(join(dirPath, file)).catch(() => null);
          if (fileStat) totalBytes += fileStat.size;
        }
      } catch {}
    }

    return totalBytes;
  }
}
