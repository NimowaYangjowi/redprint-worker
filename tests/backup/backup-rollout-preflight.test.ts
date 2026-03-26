import { describe, it, expect } from 'vitest';

import {
  getMissingRequiredEnv,
  hasCommand,
  isSameDatabaseTarget,
} from '../../scripts/backup-rollout-preflight';

describe('backup rollout preflight helpers', () => {
  it('detects missing rollout env vars', () => {
    const missing = getMissingRequiredEnv({
      DATABASE_URL: 'postgresql://app:pw@host:5432/redprint',
      BACKUP_VERIFY_DATABASE_URL: '',
      R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
    });

    expect(missing).toContain('BACKUP_VERIFY_DATABASE_URL');
    expect(missing).toContain('R2_ACCESS_KEY_ID');
    expect(missing).toContain('R2_SECRET_ACCESS_KEY');
    expect(missing).toContain('R2_BUCKET_NAME');
    expect(missing).toContain('R2_PUBLIC_URL');
  });

  it('treats the same db target as unsafe even when usernames differ', () => {
    expect(
      isSameDatabaseTarget(
        'postgresql://verify-user:pw@host:5432/redprint',
        'postgresql://app-user:pw@host:5432/redprint',
      ),
    ).toBe(true);
  });

  it('treats different database names as isolated', () => {
    expect(
      isSameDatabaseTarget(
        'postgresql://verify-user:pw@host:5432/redprint_verify',
        'postgresql://app-user:pw@host:5432/redprint',
      ),
    ).toBe(false);
  });

  it('detects commands available in PATH', () => {
    expect(hasCommand('node')).toBe(true);
  });
});
