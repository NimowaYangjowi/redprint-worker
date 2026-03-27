import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/transcode/queue-queries', () => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  heartbeat: vi.fn(),
}));

vi.mock('../../src/lib/backup/backup-scheduler', () => ({
  startBackupScheduler: vi.fn(),
  stopBackupScheduler: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/transcode/worker/processor', () => ({
  processJob: vi.fn(),
  toCompleteParams: vi.fn(),
}));

vi.mock('../../src/lib/transcode/worker/recovery', () => ({
  recoverStaleJobs: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../src/lib/transcode/worker/sweeper', () => ({
  startSweeper: vi.fn(),
  stopSweeper: vi.fn(),
}));

vi.mock('../../src/lib/transcode/worker/temp-manager', () => ({
  createTempDir: vi.fn(),
  cleanupTempDir: vi.fn(),
  hasSufficientDisk: vi.fn().mockReturnValue(true),
  getFreeDiskGB: vi.fn().mockReturnValue(100),
}));

import { start, stop } from '../../src/lib/transcode/worker/runner';
import { startBackupScheduler } from '../../src/lib/backup/backup-scheduler';
import { claim } from '../../src/lib/transcode/queue-queries';

const mockStartBackupScheduler = vi.mocked(startBackupScheduler);
const mockClaim = vi.mocked(claim);

describe('transcode runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await stop();
    vi.restoreAllMocks();
  });

  it('starts claiming jobs even if backup scheduler startup is still pending', async () => {
    mockStartBackupScheduler.mockImplementation(
      () => new Promise<void>(() => undefined)
    );
    mockClaim.mockRejectedValue(new Error('claim reached'));

    await expect(start()).rejects.toThrow('claim reached');

    expect(mockStartBackupScheduler).toHaveBeenCalled();
    expect(mockClaim).toHaveBeenCalled();
  });
});
