import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module
vi.mock('../../src/db', () => {
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockValues = vi.fn();
  const mockSet = vi.fn();
  const mockWhere = vi.fn();
  const mockReturning = vi.fn();

  // Chain: db.insert(table).values(data).returning(cols)
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([{ id: 'test-backup-id' }]);

  // Chain: db.update(table).set(data).where(condition)
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue(undefined);

  return {
    db: {
      insert: mockInsert,
      update: mockUpdate,
    },
    backupLogs: {
      id: 'id',
      status: 'status',
    },
    __mocks: { mockInsert, mockUpdate, mockValues, mockSet, mockWhere, mockReturning },
  };
});

// Mock drizzle-orm eq function
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

import {
  logBackupStart,
  logBackupUploadComplete,
  logBackupSuccess,
  logBackupFailed,
} from '../../src/lib/backup/backup-logger';
import { db, __mocks } from '../../src/db';

const { mockInsert, mockUpdate, mockValues, mockSet, mockWhere, mockReturning } = __mocks as any;

describe('backup-logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chains
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: 'test-backup-id' }]);
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);
  });

  describe('logBackupStart', () => {
    it('inserts a running record and returns the id', async () => {
      const id = await logBackupStart();

      expect(id).toBe('test-backup-id');
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
          startedAt: expect.any(Date),
          formatVersion: 'v2',
          verificationStatus: 'pending',
        })
      );
    });

    it('throws a migration-first rollout error when phase-3 columns are missing', async () => {
      mockReturning.mockRejectedValueOnce(new Error('column "format_version" does not exist'));

      await expect(logBackupStart()).rejects.toThrow(
        'Run scripts/migrate-backup-logs.sql before deploying the backup worker or monitoring app.',
      );
    });
  });

  describe('logBackupSuccess', () => {
    it('records upload completion before verification finishes', async () => {
      await logBackupUploadComplete('test-id', 'backups/v2/redprint-db-2026-03-26.sql.gz');

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'running',
          r2Key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
          formatVersion: 'v2',
          verificationStatus: 'pending',
        })
      );
    });

    it('updates the record with success data', async () => {
      await logBackupSuccess('test-id', {
        r2Key: 'backups/redprint-db-2026-03-24.sql.gz',
        fileSize: 12345678,
        durationMs: 8200,
        retentionKept: 5,
        retentionDeleted: 2,
        verifiedFromR2Key: 'backups/v2/redprint-db-2026-03-24.sql.gz',
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          r2Key: 'backups/redprint-db-2026-03-24.sql.gz',
          fileSize: 12345678,
          durationMs: 8200,
          retentionKept: 5,
          retentionDeleted: 2,
          completedAt: expect.any(Date),
          formatVersion: 'v2',
          verificationStatus: 'passed',
          verifiedAt: expect.any(Date),
          verifiedFromR2Key: expect.any(String),
        })
      );
    });

    it('handles missing retention data', async () => {
      await logBackupSuccess('test-id', {
        r2Key: 'backups/test.sql.gz',
        fileSize: 1000,
        durationMs: 500,
      });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'success',
          retentionKept: null,
          retentionDeleted: null,
        })
      );
    });
  });

  describe('logBackupFailed', () => {
    it('updates the record with failure data', async () => {
      await logBackupFailed('test-id', 'pg_dump timed out', 10000);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'pg_dump timed out',
          durationMs: 10000,
          completedAt: expect.any(Date),
        })
      );
    });

    it('sets verificationStatus to failed when verificationFailed is true', async () => {
      await logBackupFailed('test-id', 'verification mismatch', 15000, true);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'verification mismatch',
          durationMs: 15000,
          completedAt: expect.any(Date),
          verificationStatus: 'failed',
        })
      );
    });

    it('throws a migration-first rollout error when update hits a missing verification column', async () => {
      mockWhere.mockRejectedValueOnce(new Error('column "verification_status" does not exist'));

      await expect(logBackupFailed('test-id', 'verification mismatch', 15000, true)).rejects.toThrow(
        'Run scripts/migrate-backup-logs.sql before deploying the backup worker or monitoring app.',
      );
    });
  });
});
