import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock r2-client before importing retention
vi.mock('../../src/lib/storage/r2-client', () => ({
  listR2Files: vi.fn(),
  deleteMultipleFromR2: vi.fn(),
}));

import { applyRetention, todayBackupExists } from '../../src/lib/backup/retention';
import { listR2Files, deleteMultipleFromR2 } from '../../src/lib/storage/r2-client';

const mockListR2Files = vi.mocked(listR2Files);
const mockDeleteMultiple = vi.mocked(deleteMultipleFromR2);

describe('retention', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BACKUP_RETENTION_DAYS = '7';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('applyRetention', () => {
    it('does nothing when no backups exist', async () => {
      mockListR2Files.mockResolvedValue([]);

      const result = await applyRetention();

      expect(result).toEqual({ totalBackups: 0, deleted: 0, kept: 0 });
      expect(mockDeleteMultiple).not.toHaveBeenCalled();
    });

    it('keeps single backup even if old (MIN_BACKUPS_TO_KEEP)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);

      mockListR2Files.mockResolvedValue([
        { key: 'backups/v2/redprint-db-old.sql.gz', size: 1000, lastModified: oldDate },
      ]);

      const result = await applyRetention();

      expect(result).toEqual({ totalBackups: 1, deleted: 0, kept: 1 });
      expect(mockDeleteMultiple).not.toHaveBeenCalled();
    });

    it('deletes backups older than retention period', async () => {
      const now = new Date();
      const recent = new Date(now.getTime() - 2 * 86_400_000); // 2 days ago
      const old = new Date(now.getTime() - 10 * 86_400_000); // 10 days ago
      const veryOld = new Date(now.getTime() - 15 * 86_400_000); // 15 days ago

      mockListR2Files.mockResolvedValue([
        { key: 'backups/v2/recent.sql.gz', size: 1000, lastModified: recent },
        { key: 'backups/v2/old.sql.gz', size: 1000, lastModified: old },
        { key: 'backups/v2/very-old.sql.gz', size: 1000, lastModified: veryOld },
      ]);
      mockDeleteMultiple.mockResolvedValue({ deleted: 2, errors: 0 });

      const result = await applyRetention();

      expect(mockDeleteMultiple).toHaveBeenCalledWith([
        'backups/v2/very-old.sql.gz',
        'backups/v2/old.sql.gz',
      ]);
      expect(result.deleted).toBe(2);
      expect(result.kept).toBe(1);
    });

    it('does not delete recent backups within retention period', async () => {
      const now = new Date();
      const day1 = new Date(now.getTime() - 1 * 86_400_000);
      const day3 = new Date(now.getTime() - 3 * 86_400_000);
      const day5 = new Date(now.getTime() - 5 * 86_400_000);

      mockListR2Files.mockResolvedValue([
        { key: 'backups/v2/day1.sql.gz', size: 1000, lastModified: day1 },
        { key: 'backups/v2/day3.sql.gz', size: 1000, lastModified: day3 },
        { key: 'backups/v2/day5.sql.gz', size: 1000, lastModified: day5 },
      ]);

      const result = await applyRetention();

      expect(result).toEqual({ totalBackups: 3, deleted: 0, kept: 3 });
      expect(mockDeleteMultiple).not.toHaveBeenCalled();
    });

    it('preserves minimum backups even when all are old', async () => {
      const now = new Date();
      const old1 = new Date(now.getTime() - 10 * 86_400_000);
      const old2 = new Date(now.getTime() - 20 * 86_400_000);

      mockListR2Files.mockResolvedValue([
        { key: 'backups/v2/old1.sql.gz', size: 1000, lastModified: old1 },
        { key: 'backups/v2/old2.sql.gz', size: 1000, lastModified: old2 },
      ]);
      mockDeleteMultiple.mockResolvedValue({ deleted: 1, errors: 0 });

      const result = await applyRetention();

      // Should only delete 1, keeping the newest as the minimum
      expect(mockDeleteMultiple).toHaveBeenCalledWith(['backups/v2/old2.sql.gz']);
      expect(result.kept).toBe(1);
    });
  });

  describe('todayBackupExists', () => {
    it('returns true when today backup exists', async () => {
      mockListR2Files.mockResolvedValue([
        { key: 'backups/v2/redprint-db-today.sql.gz', size: 1000, lastModified: new Date() },
      ]);

      const result = await todayBackupExists();

      expect(result).toBe(true);
      // Verify it searches with today's date prefix
      expect(mockListR2Files).toHaveBeenCalledWith(
        expect.stringContaining('backups/v2/redprint-db-')
      );
    });

    it('returns false when no backup exists today', async () => {
      mockListR2Files.mockResolvedValue([]);

      const result = await todayBackupExists();

      expect(result).toBe(false);
    });
  });
});
