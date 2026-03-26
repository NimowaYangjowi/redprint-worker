import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies
vi.mock('../../src/lib/backup/pg-dump', () => ({
  runPgDump: vi.fn(),
}));

vi.mock('../../src/lib/backup/backup-uploader', () => ({
  uploadBackup: vi.fn(),
}));

vi.mock('../../src/lib/backup/retention', () => ({
  applyRetention: vi.fn(),
  todayBackupExists: vi.fn(),
}));

vi.mock('../../src/lib/backup/backup-logger', () => ({
  logBackupStart: vi.fn().mockResolvedValue('mock-log-id'),
  logBackupUploadComplete: vi.fn().mockResolvedValue(undefined),
  logBackupSuccess: vi.fn().mockResolvedValue(undefined),
  logBackupFailed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/backup/backup-verify', () => ({
  verifyBackupFromR2: vi.fn(),
}));

import {
  startBackupScheduler,
  stopBackupScheduler,
  _executeBackup,
} from '../../src/lib/backup/backup-scheduler';
import { runPgDump } from '../../src/lib/backup/pg-dump';
import { uploadBackup } from '../../src/lib/backup/backup-uploader';
import { applyRetention, todayBackupExists } from '../../src/lib/backup/retention';
import { verifyBackupFromR2 } from '../../src/lib/backup/backup-verify';
import {
  logBackupStart,
  logBackupUploadComplete,
  logBackupSuccess,
  logBackupFailed,
} from '../../src/lib/backup/backup-logger';

const mockRunPgDump = vi.mocked(runPgDump);
const mockUploadBackup = vi.mocked(uploadBackup);
const mockApplyRetention = vi.mocked(applyRetention);
const mockTodayBackupExists = vi.mocked(todayBackupExists);
const mockVerifyBackupFromR2 = vi.mocked(verifyBackupFromR2);
const mockLogBackupStart = vi.mocked(logBackupStart);
const mockLogBackupUploadComplete = vi.mocked(logBackupUploadComplete);
const mockLogBackupSuccess = vi.mocked(logBackupSuccess);
const mockLogBackupFailed = vi.mocked(logBackupFailed);

describe('backup-scheduler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    process.env.BACKUP_ENABLED = 'true';
    process.env.BACKUP_HOUR_UTC = '4';
  });

  afterEach(async () => {
    await stopBackupScheduler();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  it('does not start when BACKUP_ENABLED is not true', async () => {
    process.env.BACKUP_ENABLED = 'false';

    await startBackupScheduler();

    // Should log disabled message and not set any timer
    expect(mockTodayBackupExists).not.toHaveBeenCalled();
  });

  it('checks for existing backup on start', async () => {
    mockTodayBackupExists.mockResolvedValue(false);

    await startBackupScheduler();

    expect(mockTodayBackupExists).toHaveBeenCalled();
  });

  it('skips to tomorrow when today backup already exists', async () => {
    mockTodayBackupExists.mockResolvedValue(true);

    await startBackupScheduler();

    expect(mockTodayBackupExists).toHaveBeenCalled();
    // Scheduler should be running (timer set for tomorrow)
  });

  it('stops cleanly when no backup is in progress', async () => {
    mockTodayBackupExists.mockResolvedValue(false);

    await startBackupScheduler();
    await stopBackupScheduler();

    // Should complete without hanging
  });

  it('handles todayBackupExists error gracefully', async () => {
    mockTodayBackupExists.mockRejectedValue(new Error('R2 unavailable'));

    // Should not throw — continues with scheduling
    await expect(startBackupScheduler()).resolves.toBeUndefined();
  });

  it('records remote upload before verification starts', async () => {
    mockTodayBackupExists.mockResolvedValue(false);
    mockRunPgDump.mockResolvedValue('/tmp/redprint-db.sql.gz');
    mockUploadBackup.mockResolvedValue({
      key: 'backups/v2/redprint-db-2026-03-26-040000.sql.gz',
      size: 1024,
    });
    mockVerifyBackupFromR2.mockResolvedValue({
      passed: true,
      durationMs: 1200,
      verifyDbName: 'verify_redprint',
    } as any);
    mockApplyRetention.mockResolvedValue({ kept: 1, deleted: 0 });
    mockLogBackupStart.mockResolvedValue('mock-log-id');

    await startBackupScheduler();
    await _executeBackup();

    expect(mockLogBackupUploadComplete).toHaveBeenCalledWith(
      'mock-log-id',
      'backups/v2/redprint-db-2026-03-26-040000.sql.gz'
    );
    expect(mockVerifyBackupFromR2).toHaveBeenCalledWith(
      'backups/v2/redprint-db-2026-03-26-040000.sql.gz'
    );
    expect(mockLogBackupSuccess).toHaveBeenCalled();
    expect(mockLogBackupFailed).not.toHaveBeenCalled();
  });

  it('skips retention during a manual rollout smoke run', async () => {
    mockTodayBackupExists.mockResolvedValue(false);
    mockRunPgDump.mockResolvedValue('/tmp/redprint-db.sql.gz');
    mockUploadBackup.mockResolvedValue({
      key: 'backups/v2/redprint-db-2026-03-26-040000.sql.gz',
      size: 1024,
    });
    mockVerifyBackupFromR2.mockResolvedValue({
      passed: true,
      durationMs: 1200,
      verifyDbName: 'verify_redprint',
    } as any);
    mockLogBackupStart.mockResolvedValue('mock-log-id');

    await startBackupScheduler();
    await _executeBackup({ skipRetention: true });

    expect(mockApplyRetention).not.toHaveBeenCalled();
    expect(mockLogBackupSuccess).toHaveBeenCalledWith(
      'mock-log-id',
      expect.objectContaining({
        retentionKept: undefined,
        retentionDeleted: undefined,
      }),
    );
  });
});
