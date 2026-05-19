import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReaddir = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockUnlink = vi.hoisted(() => vi.fn());
const mockRmdir = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => {
  function MockIORedis() { return { on: vi.fn().mockReturnThis(), status: 'ready', quit: vi.fn().mockResolvedValue('OK') }; }
  return { default: MockIORedis };
});

vi.mock('fs/promises', () => ({ readdir: mockReaddir, stat: mockStat, unlink: mockUnlink, rm: mockRmdir, mkdir: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs', () => ({ existsSync: mockExistsSync }));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { STORAGE_CONFIG } from '../../../services/storage.service';

describe('Storage Service', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('STORAGE_CONFIG', () => {
    it('should export config with retention values', () => {
      expect(STORAGE_CONFIG.RETENTION.TEMP_RENDER_MS).toBe(60 * 60 * 1000);
      expect(STORAGE_CONFIG.RETENTION.VOICEOVER_MS).toBe(30 * 24 * 60 * 60 * 1000);
      expect(STORAGE_CONFIG.RETENTION.VIDEO_AFTER_UPLOAD_MS).toBe(14 * 24 * 60 * 60 * 1000);
      expect(STORAGE_CONFIG.THRESHOLDS.CRITICAL_BYTES).toBe(500 * 1024 * 1024);
      expect(STORAGE_CONFIG.THRESHOLDS.WARNING_BYTES).toBe(1024 * 1024 * 1024);
      expect(STORAGE_CONFIG.PATHS.TEMP).toBeTruthy();
      expect(STORAGE_CONFIG.PATHS.UPLOADS).toBeTruthy();
    });
  });

  describe('getDiskFree exports', () => {
    it('should be an exported function', async () => {
      const mod = await import('../../../services/storage.service');
      expect(typeof mod.getDiskFree).toBe('function');
    });
  });
});
