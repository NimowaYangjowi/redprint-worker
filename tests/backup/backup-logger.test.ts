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

import { logBackupStart, logBackupSuccess, logBackupFailed } from '../../src/lib/backup/backup-logger';
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
        })
      );
    });
  });

  describe('logBackupSuccess', () => {
    it('updates the record with success data', async () => {
      await logBackupSuccess('test-id', {
        r2Key: 'backups/redprint-db-2026-03-24.sql.gz',
        fileSize: 12345678,
        durationMs: 8200,
        retentionKept: 5,
        retentionDeleted: 2,
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
  });
});
