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

  it('parses the embedded backup manifest header', async () => {
    const { parseBackupManifestFromSqlText } = await import('../../src/lib/backup/pg-dump');

    const sqlText = [
      '-- Redprint Database Dump',
      '-- backup_manifest: {"format_version":"v2","schema_fingerprint":"abc123","public_table_count":3,"sentinel_tables":["assets"],"sentinel_row_checksums":{"assets":"deadbeef"}}',
      "SET statement_timeout = 0;",
    ].join('\n');

    expect(parseBackupManifestFromSqlText(sqlText)).toEqual({
      format_version: 'v2',
      schema_fingerprint: 'abc123',
      public_table_count: 3,
      sentinel_tables: ['assets'],
      sentinel_row_checksums: { assets: 'deadbeef' },
    });
  });

  it('builds a stable schema fingerprint for the same table shape', async () => {
    const { buildSchemaFingerprint } = await import('../../src/lib/backup/pg-dump');

    const schemaShape = [
      {
        tableName: 'assets',
        columns: [
          { columnName: 'id', dataType: 'text', udtName: 'text', isNullable: 'NO' },
          { columnName: 'metadata', dataType: 'jsonb', udtName: 'jsonb', isNullable: 'YES' },
        ],
        primaryKeyColumns: ['id'],
      },
      {
        tableName: 'users',
        columns: [
          { columnName: 'user_id', dataType: 'text', udtName: 'text', isNullable: 'NO' },
        ],
        primaryKeyColumns: ['user_id'],
      },
    ];

    expect(buildSchemaFingerprint(schemaShape)).toBe(buildSchemaFingerprint(schemaShape));
  });

  it('computes the same checksum for the same sentinel row JSON', async () => {
    const { computeRowChecksum } = await import('../../src/lib/backup/pg-dump');

    const rowJson = '{"id":"asset_123","metadata":{"workflowNodeMapping":{"main":"node-a"}}}';

    expect(computeRowChecksum(rowJson)).toBe(computeRowChecksum(rowJson));
    expect(computeRowChecksum(rowJson)).not.toBe(
      computeRowChecksum('{"id":"asset_123","metadata":{"workflowNodeMapping":{"main":"node-b"}}}')
    );
  });

  it('formats COPY statements with an explicit public schema qualification', async () => {
    const { formatCopyTableStatement } = await import('../../src/lib/backup/pg-dump');

    expect(formatCopyTableStatement('accounting_pending_events', ['id', 'status'])).toBe(
      'COPY "public"."accounting_pending_events" ("id", "status") FROM STDIN;\n',
    );
  });

  it('formats sequence restore statements with an explicit public regclass', async () => {
    const { formatSequenceSetvalStatement } = await import('../../src/lib/backup/pg-dump');

    expect(formatSequenceSetvalStatement('submission_attestations_id_seq', 41, true)).toBe(
      `SELECT pg_catalog.setval('"public"."submission_attestations_id_seq"'::regclass, 41, true);\n\n`,
    );
  });

  it('formats Postgres array literals for COPY text mode', async () => {
    const { formatPostgresArrayLiteral } = await import('../../src/lib/backup/pg-dump');

    expect(formatPostgresArrayLiteral([])).toBe('{}');
    expect(formatPostgresArrayLiteral(['tag-a', 'tag-b'])).toBe('{"tag-a","tag-b"}');
    expect(formatPostgresArrayLiteral(['comma,value', 'quote"value'])).toBe(
      '{"comma,value","quote\\"value"}',
    );
  });

  it('keeps timestamp values as raw strings in the dump client to preserve microseconds', async () => {
    const { PG_DUMP_TYPES } = await import('../../src/lib/backup/pg-dump');

    expect(PG_DUMP_TYPES.date.parse('2026-03-22T14:28:17.043443+00:00')).toBe(
      '2026-03-22T14:28:17.043443+00:00',
    );
    expect(PG_DUMP_TYPES.date.serialize('2026-03-22T14:28:17.043443+00:00')).toBe(
      '2026-03-22T14:28:17.043443+00:00',
    );
  });
});
