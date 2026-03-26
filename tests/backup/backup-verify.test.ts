import { gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('postgres', () => {
  const mockUnsafe = vi.fn().mockResolvedValue([]);
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  const mockTaggedTemplate = vi.fn().mockResolvedValue([]);

  const sqlFn = Object.assign(mockTaggedTemplate, {
    unsafe: mockUnsafe,
    end: mockEnd,
  });

  const ctor = vi.fn(() => sqlFn);
  (ctor as any).__sqlFn = sqlFn;
  (ctor as any).__mockUnsafe = mockUnsafe;
  (ctor as any).__mockEnd = mockEnd;
  (ctor as any).__mockTaggedTemplate = mockTaggedTemplate;

  return { default: ctor };
});

vi.mock('../../src/lib/storage/r2-client', () => ({
  getR2ObjectStream: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn(async (source: AsyncIterable<unknown> | Iterable<unknown>) => {
    for await (const _chunk of source as AsyncIterable<unknown>) {
      // Consume the restore stream so mocked R2 reads happen during tests.
    }
  }),
}));

vi.mock('node:zlib', async () => {
  const actual = await vi.importActual<typeof import('node:zlib')>('node:zlib');
  return {
    ...actual,
    createGunzip: actual.createGunzip,
  };
});

import { spawn } from 'node:child_process';
import postgres from 'postgres';

import { buildSchemaFingerprint, computeRowChecksum } from '../../src/lib/backup/pg-dump';
import { getR2ObjectStream } from '../../src/lib/storage/r2-client';
import { verifyBackupFromR2 } from '../../src/lib/backup/backup-verify';

const mockSpawn = vi.mocked(spawn);
const mockGetR2ObjectStream = vi.mocked(getR2ObjectStream);
const mockPostgresCtor = vi.mocked(postgres) as any;
const mockUnsafe: ReturnType<typeof vi.fn> = mockPostgresCtor.__mockUnsafe;
const mockEnd: ReturnType<typeof vi.fn> = mockPostgresCtor.__mockEnd;
const mockTaggedTemplate: ReturnType<typeof vi.fn> = mockPostgresCtor.__mockTaggedTemplate;
const sqlFn = mockPostgresCtor.__sqlFn;

const VERIFY_TABLE_SHAPE = [
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
  {
    tableName: 'submission_attestations',
    columns: [
      { columnName: 'id', dataType: 'integer', udtName: 'int4', isNullable: 'NO' },
      { columnName: 'terms_version', dataType: 'text', udtName: 'text', isNullable: 'NO' },
    ],
    primaryKeyColumns: ['id'],
  },
] as const;

const DEFAULT_MANIFEST = {
  format_version: 'v2',
  schema_fingerprint: buildSchemaFingerprint(VERIFY_TABLE_SHAPE.map((table) => ({
    tableName: table.tableName,
    columns: [...table.columns],
    primaryKeyColumns: [...table.primaryKeyColumns],
  }))),
  public_table_count: 3,
  sentinel_tables: ['assets'],
  sentinel_row_checksums: {
    assets: computeRowChecksum('{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}'),
  },
};

function resetMockDefaults() {
  mockUnsafe.mockReset().mockResolvedValue([]);
  mockEnd.mockReset().mockResolvedValue(undefined);
  mockTaggedTemplate.mockReset().mockResolvedValue([]);

  sqlFn.unsafe = mockUnsafe;
  sqlFn.end = mockEnd;

  mockPostgresCtor.mockReset().mockReturnValue(sqlFn);
  mockPostgresCtor.__sqlFn = sqlFn;
  mockPostgresCtor.__mockUnsafe = mockUnsafe;
  mockPostgresCtor.__mockEnd = mockEnd;
  mockPostgresCtor.__mockTaggedTemplate = mockTaggedTemplate;

  mockSpawn.mockReset();
  mockGetR2ObjectStream.mockReset();
}

function createFakeProcess(exitCode: number) {
  return createFakeProcessWithStderr(exitCode);
}

function createFakeProcessWithStderr(exitCode: number, stderrMessage = '') {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  let emissionScheduled = false;

  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) {
      listener(...args);
    }
  };

  const scheduleEmission = () => {
    if (emissionScheduled) {
      return;
    }

    emissionScheduled = true;
    process.nextTick(() => {
      if (stderrMessage) {
        emit('stderr:data', Buffer.from(stderrMessage));
      }

      emit('close', exitCode);
    });
  };

  const register = (event: string, cb: (...args: unknown[]) => void) => {
    const current = listeners.get(event) ?? [];
    current.push(cb);
    listeners.set(event, current);
    scheduleEmission();
  };

  return {
    stdin: {
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    },
    stdout: { on: vi.fn() },
    stderr: {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'data') {
          register('stderr:data', cb);
        }
      }),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      register(event, cb);
    }),
    pid: 12345,
  } as unknown as ReturnType<typeof spawn>;
}

function createManifestStream(manifest = DEFAULT_MANIFEST): Readable {
  const sqlText = [
    '-- Redprint Database Dump',
    `-- backup_manifest: ${JSON.stringify(manifest)}`,
    '',
    "SET statement_timeout = 0;",
  ].join('\n');

  return Readable.from(gzipSync(sqlText));
}

function createRestoreStream(): Readable {
  return Readable.from(gzipSync("SET statement_timeout = 0;\nSELECT 1;\n"));
}

function setupSuccessfulVerifyDbState(manifest = DEFAULT_MANIFEST) {
  mockTaggedTemplate.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join(' ');

    if (query.includes('FROM information_schema.tables')) {
      return [
        { table_name: 'assets' },
        { table_name: 'users' },
        { table_name: 'submission_attestations' },
      ];
    }

    if (query.includes('FROM information_schema.columns')) {
      return [
        { table_name: 'assets', column_name: 'id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', ordinal_position: 1 },
        { table_name: 'assets', column_name: 'metadata', data_type: 'jsonb', udt_name: 'jsonb', is_nullable: 'YES', ordinal_position: 2 },
        { table_name: 'users', column_name: 'user_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', ordinal_position: 1 },
        {
          table_name: 'submission_attestations',
          column_name: 'id',
          data_type: 'integer',
          udt_name: 'int4',
          is_nullable: 'NO',
          ordinal_position: 1,
        },
        {
          table_name: 'submission_attestations',
          column_name: 'terms_version',
          data_type: 'text',
          udt_name: 'text',
          is_nullable: 'NO',
          ordinal_position: 2,
        },
      ];
    }

    if (query.includes('FROM information_schema.table_constraints')) {
      return [
        { table_name: 'assets', column_name: 'id', ordinal_position: 1 },
        { table_name: 'users', column_name: 'user_id', ordinal_position: 1 },
        { table_name: 'submission_attestations', column_name: 'id', ordinal_position: 1 },
      ];
    }

    if (query.includes('FROM pg_class seq')) {
      return [
        {
          sequence_name: 'submission_attestations_id_seq',
          table_name: 'submission_attestations',
          column_name: 'id',
        },
      ];
    }

    return [];
  });

  let existsChecksSinceReset = 0;
  mockUnsafe.mockImplementation(async (query: string) => {
    if (query.startsWith('TRUNCATE TABLE')) {
      existsChecksSinceReset = 0;
      return [];
    }

    if (query.includes('SELECT EXISTS')) {
      existsChecksSinceReset += 1;

      // zero-row checks before restore
      if (existsChecksSinceReset <= VERIFY_TABLE_SHAPE.length) {
        return [{ has_rows: false }];
      }

      // at least one table has restored data
      if (existsChecksSinceReset === VERIFY_TABLE_SHAPE.length + 1) {
        return [{ has_rows: true }];
      }

      return [{ has_rows: false }];
    }

    if (query.includes('row_to_json') && query.includes('"assets"')) {
      return [
        {
          row_json: '{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}',
        },
      ];
    }

    if (query === 'SELECT last_value, is_called FROM "submission_attestations_id_seq"') {
      return [{ last_value: 41, is_called: true }];
    }

    if (query === `SELECT nextval('"public"."submission_attestations_id_seq"'::regclass) AS next_value`) {
      return [{ next_value: 42 }];
    }

    if (query === `SELECT setval('"public"."submission_attestations_id_seq"'::regclass, 41, true)`) {
      return [{ setval: 41 }];
    }

    return [];
  });

  let r2ReadCount = 0;
  mockGetR2ObjectStream.mockImplementation(async () => {
    r2ReadCount += 1;
    return r2ReadCount === 1 ? createManifestStream(manifest) : createRestoreStream();
  });
  mockSpawn.mockReturnValue(createFakeProcess(0));
}

describe('backup-verify', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetMockDefaults();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('environment validation', () => {
    it('throws when BACKUP_VERIFY_DATABASE_URL is not set', async () => {
      delete process.env.BACKUP_VERIFY_DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://app:pw@host:5432/redprint';

      await expect(verifyBackupFromR2('backups/v2/test.sql.gz')).rejects.toThrow(
        'BACKUP_VERIFY_DATABASE_URL is not set',
      );
    });

    it('throws when DATABASE_URL is not set', async () => {
      process.env.BACKUP_VERIFY_DATABASE_URL = 'postgresql://verify:pw@host:5432/redprint_verify';
      delete process.env.DATABASE_URL;

      await expect(verifyBackupFromR2('backups/v2/test.sql.gz')).rejects.toThrow(
        'DATABASE_URL is not set',
      );
    });

    it('throws when verify DB points to the live app database', async () => {
      process.env.BACKUP_VERIFY_DATABASE_URL = 'postgresql://app:pw@host:5432/redprint';
      process.env.DATABASE_URL = 'postgresql://app:pw@host:5432/redprint';

      await expect(verifyBackupFromR2('backups/v2/test.sql.gz')).rejects.toThrow(
        'must point to a dedicated verify DB',
      );
    });

    it('also rejects the live app database when only the DB user differs', async () => {
      process.env.BACKUP_VERIFY_DATABASE_URL = 'postgresql://verify-user:pw@host:5432/redprint';
      process.env.DATABASE_URL = 'postgresql://app-user:pw@host:5432/redprint';

      await expect(verifyBackupFromR2('backups/v2/test.sql.gz')).rejects.toThrow(
        'must point to a dedicated verify DB',
      );
    });
  });

  describe('artifact-manifest verification', () => {
    const VERIFY_URL = 'postgresql://verify:pw@host:5432/redprint_verify';
    const LIVE_URL = 'postgresql://app:pw@host:5432/redprint';

    beforeEach(() => {
      process.env.BACKUP_VERIFY_DATABASE_URL = VERIFY_URL;
      process.env.DATABASE_URL = LIVE_URL;
    });

    it('passes when the verify DB schema and sentinel checksum match the uploaded artifact', async () => {
      setupSuccessfulVerifyDbState();

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(true);
      expect(result.verifyDbName).toBe('redprint_verify');
      expect(mockGetR2ObjectStream).toHaveBeenCalledTimes(2);
      expect(mockSpawn).toHaveBeenCalledWith(
        'psql',
        expect.arrayContaining(['-d', VERIFY_URL, '-v', 'ON_ERROR_STOP=1']),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );
      expect(mockUnsafe).toHaveBeenCalledWith(
        `SELECT nextval('"public"."submission_attestations_id_seq"'::regclass) AS next_value`,
      );
      expect(mockUnsafe).toHaveBeenCalledWith(
        `SELECT setval('"public"."submission_attestations_id_seq"'::regclass, 41, true)`,
      );
      expect(
        mockUnsafe.mock.calls.filter(([query]) => typeof query === 'string' && query.startsWith('TRUNCATE TABLE')).length,
      ).toBe(2);
    });

    it('retries with the isolated replica fallback when normal restore fails on FK order', async () => {
      setupSuccessfulVerifyDbState();
      mockSpawn
        .mockReturnValueOnce(
          createFakeProcessWithStderr(3, 'ERROR: insert or update on table "asset_media" violates foreign key constraint'),
        )
        .mockReturnValueOnce(createFakeProcess(0));

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(true);
      expect(result.usedReplicaFallback).toBe(true);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      expect(mockGetR2ObjectStream).toHaveBeenCalledTimes(3);
      expect(
        mockUnsafe.mock.calls.filter(([query]) => typeof query === 'string' && query.startsWith('TRUNCATE TABLE')).length,
      ).toBe(3);
    });

    it('fails closed when the backup schema fingerprint does not match the prepared verify DB', async () => {
      setupSuccessfulVerifyDbState({
        ...DEFAULT_MANIFEST,
        schema_fingerprint: 'different-fingerprint',
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('schema fingerprint');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails closed when a sentinel checksum mismatches after restore', async () => {
      setupSuccessfulVerifyDbState({
        ...DEFAULT_MANIFEST,
        sentinel_row_checksums: {
          assets: computeRowChecksum('{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-z"}}}'),
        },
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('Sentinel checksum mismatch');
    });

    it('fails when the backup artifact has no manifest header', async () => {
      mockTaggedTemplate.mockResolvedValue([]);
      mockGetR2ObjectStream.mockResolvedValueOnce(
        Readable.from(gzipSync('-- Redprint Database Dump\nSET statement_timeout = 0;\n')),
      );

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('Backup manifest');
    });

    it('fails when old rows remain before restore', async () => {
      setupSuccessfulVerifyDbState();
      mockUnsafe.mockImplementation(async (query: string) => {
        if (query.startsWith('TRUNCATE TABLE')) return [];
        if (query.includes('SELECT EXISTS')) return [{ has_rows: true }];
        if (query.includes('row_to_json') && query.includes('"assets"')) {
          return [{ row_json: '{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}' }];
        }
        return [];
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('still has rows before restore');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('fails when restore finishes but the verify DB stays empty', async () => {
      setupSuccessfulVerifyDbState();

      let existsChecks = 0;
      mockUnsafe.mockImplementation(async (query: string) => {
        if (query.startsWith('TRUNCATE TABLE')) return [];
        if (query.includes('SELECT EXISTS')) {
          existsChecks += 1;
          return [{ has_rows: false }];
        }
        if (query.includes('row_to_json') && query.includes('"assets"')) {
          return [{ row_json: '{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}' }];
        }
        return [];
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('restored verify DB is empty');
    });

    it('returns passed=false when psql restore fails', async () => {
      setupSuccessfulVerifyDbState();
      mockSpawn.mockReturnValue(createFakeProcess(1));

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/psql exited with code 1/);
    });

    it('fails closed when post-verification cleanup cannot empty the verify DB again', async () => {
      setupSuccessfulVerifyDbState();

      let truncateCount = 0;
      let existsChecksSinceReset = 0;
      mockUnsafe.mockImplementation(async (query: string) => {
        if (query.startsWith('TRUNCATE TABLE')) {
          truncateCount += 1;
          existsChecksSinceReset = 0;
          return [];
        }

        if (query.includes('SELECT EXISTS')) {
          existsChecksSinceReset += 1;

          if (truncateCount < 2) {
            if (existsChecksSinceReset <= VERIFY_TABLE_SHAPE.length) {
              return [{ has_rows: false }];
            }

            if (existsChecksSinceReset === VERIFY_TABLE_SHAPE.length + 1) {
              return [{ has_rows: true }];
            }

            return [{ has_rows: false }];
          }

          return [{ has_rows: true }];
        }

        if (query.includes('row_to_json') && query.includes('"assets"')) {
          return [{ row_json: '{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}' }];
        }

        if (query === 'SELECT last_value, is_called FROM "submission_attestations_id_seq"') {
          return [{ last_value: 41, is_called: true }];
        }

        if (query === `SELECT nextval('"public"."submission_attestations_id_seq"'::regclass) AS next_value`) {
          return [{ next_value: 42 }];
        }

        if (query === `SELECT setval('"public"."submission_attestations_id_seq"'::regclass, 41, true)`) {
          return [{ setval: 41 }];
        }

        return [];
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('verify DB cleanup');
      expect(result.error).toContain('still has rows before restore');
    });

    it('fails closed when the restored sequence cannot produce the next value', async () => {
      setupSuccessfulVerifyDbState();
      mockUnsafe.mockImplementation(async (query: string) => {
        if (query.startsWith('TRUNCATE TABLE')) return [];
        if (query.includes('SELECT EXISTS')) {
          const restorePhaseStartsAt = VERIFY_TABLE_SHAPE.length + 1;
          const hasRows = query.includes('LIMIT 1');
          if (hasRows) {
            const callIndex = mockUnsafe.mock.calls.filter(
              ([recordedQuery]) => typeof recordedQuery === 'string' && recordedQuery.includes('SELECT EXISTS'),
            ).length;
            return [{ has_rows: callIndex >= restorePhaseStartsAt }];
          }
        }
        if (query.includes('row_to_json') && query.includes('"assets"')) {
          return [{ row_json: '{"id":"asset_001","metadata":{"workflowNodeMapping":{"main":"node-a"}}}' }];
        }
        if (query === 'SELECT last_value, is_called FROM "submission_attestations_id_seq"') {
          return [{ last_value: 41, is_called: true }];
        }
        if (query === `SELECT nextval('"public"."submission_attestations_id_seq"'::regclass) AS next_value`) {
          throw new Error('duplicate key would be generated');
        }
        if (query === `SELECT setval('"public"."submission_attestations_id_seq"'::regclass, 41, true)`) {
          return [{ setval: 41 }];
        }
        return [];
      });

      const result = await verifyBackupFromR2('backups/v2/test.sql.gz');

      expect(result.passed).toBe(false);
      expect(result.error).toContain('Sequence smoke test failed');
      expect(result.error).toContain('submission_attestations_id_seq');
      expect(mockUnsafe).toHaveBeenCalledWith(
        `SELECT setval('"public"."submission_attestations_id_seq"'::regclass, 41, true)`,
      );
    });
  });
});
