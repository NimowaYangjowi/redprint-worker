import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We can't run actual pg_dump in tests, so we test the error paths
// and the helper functions.

describe('pg-dump', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('throws when DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;

    // Dynamic import to pick up env change
    const { runPgDump } = await import('../../src/lib/backup/pg-dump');

    await expect(runPgDump()).rejects.toThrow('DATABASE_URL is not set');
  });

  it('masks DATABASE_URL in error messages', async () => {
    process.env.DATABASE_URL = 'postgresql://secret:password@host:5432/db';

    // pg_dump won't be found in test env, so it will throw ENOENT
    const { runPgDump } = await import('../../src/lib/backup/pg-dump');

    try {
      await runPgDump();
      expect.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('secret');
      expect(message).not.toContain('password');
    }
  });
});
