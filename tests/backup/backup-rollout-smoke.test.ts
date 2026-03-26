import { describe, it, expect } from 'vitest';

import {
  getRolloutSmokeFailure,
} from '../../scripts/backup-rollout-smoke';
import type { BackupRolloutSnapshot } from '../../scripts/backup-rollout-status';

function buildSnapshot(overrides: Partial<BackupRolloutSnapshot>): BackupRolloutSnapshot {
  return {
    latest: {
      status: 'success',
      r2_key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
      file_size: 1024,
      duration_ms: 5000,
      error_message: null,
      format_version: 'v2',
      verification_status: 'passed',
      verified_at: new Date('2026-03-26T12:00:05.000Z'),
      verified_from_r2_key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
      started_at: new Date('2026-03-26T12:00:00.000Z'),
      completed_at: new Date('2026-03-26T12:00:05.000Z'),
    },
    latestVerified: {
      status: 'success',
      r2_key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
      file_size: 1024,
      duration_ms: 5000,
      error_message: null,
      format_version: 'v2',
      verification_status: 'passed',
      verified_at: new Date('2026-03-26T12:00:05.000Z'),
      verified_from_r2_key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
      started_at: new Date('2026-03-26T12:00:00.000Z'),
      completed_at: new Date('2026-03-26T12:00:05.000Z'),
    },
    totalVerified: 1,
    hasPhase3Columns: true,
    ...overrides,
  };
}

describe('backup rollout smoke helper', () => {
  it('passes when the latest row is restore-verified', () => {
    expect(getRolloutSmokeFailure(buildSnapshot({}))).toBeNull();
  });

  it('fails when phase-3 columns are still missing', () => {
    expect(
      getRolloutSmokeFailure(buildSnapshot({ hasPhase3Columns: false })),
    ).toContain('phase-3 verification columns');
  });

  it('fails when the latest row ends in legacy instead of verified', () => {
    expect(
      getRolloutSmokeFailure(buildSnapshot({
        latest: {
          ...buildSnapshot({}).latest!,
          verification_status: null,
        },
      })),
    ).toContain('Latest backup did not end in restore-verified green');
  });

  it('fails when latest_verified is missing despite a green-looking latest row', () => {
    expect(
      getRolloutSmokeFailure(buildSnapshot({ latestVerified: null })),
    ).toContain('latest_verified is empty');
  });
});
