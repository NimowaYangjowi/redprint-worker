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
  logBackupSuccess: vi.fn().mockResolvedValue(undefined),
  logBackupFailed: vi.fn().mockResolvedValue(undefined),
}));

import {
  startBackupScheduler,
  stopBackupScheduler,
} from '../../src/lib/backup/backup-scheduler';
import { todayBackupExists } from '../../src/lib/backup/retention';

const mockTodayBackupExists = vi.mocked(todayBackupExists);

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
});
