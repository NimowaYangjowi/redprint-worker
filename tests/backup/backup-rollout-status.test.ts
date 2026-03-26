import { describe, it, expect } from 'vitest';

import {
  describeBackupUiState,
  getBackupUiState,
  type BackupStatusEntry,
} from '../../scripts/backup-rollout-status';

function buildEntry(overrides: Partial<BackupStatusEntry>): BackupStatusEntry {
  return {
    status: 'running',
    r2_key: null,
    file_size: null,
    duration_ms: null,
    error_message: null,
    format_version: 'v2',
    verification_status: null,
    verified_at: null,
    verified_from_r2_key: null,
    started_at: new Date('2026-03-26T00:00:00.000Z'),
    completed_at: null,
    ...overrides,
  };
}

describe('backup rollout status helpers', () => {
  it('maps uploaded running rows to verifying', () => {
    expect(
      getBackupUiState(buildEntry({
        status: 'running',
        r2_key: 'backups/v2/redprint-db-2026-03-26.sql.gz',
        verification_status: 'pending',
      })),
    ).toBe('verifying');
  });

  it('maps success plus passed verification to verified', () => {
    expect(
      getBackupUiState(buildEntry({
        status: 'success',
        verification_status: 'passed',
      })),
    ).toBe('verified');
  });

  it('maps success without verification proof to legacy', () => {
    expect(
      getBackupUiState(buildEntry({
        status: 'success',
        verification_status: null,
      })),
    ).toBe('legacy');
  });

  it('maps verification failures separately from plain failures', () => {
    expect(
      getBackupUiState(buildEntry({
        status: 'failed',
        verification_status: 'failed',
      })),
    ).toBe('failed-verification');
  });

  it('describes the same labels the operator sees in the menu bar backup card', () => {
    expect(describeBackupUiState('running')).toBe('실행 중');
    expect(describeBackupUiState('verifying')).toBe('검증 중');
    expect(describeBackupUiState('verified')).toBe('정상');
  });
});
