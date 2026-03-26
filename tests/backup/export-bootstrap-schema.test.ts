import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHeader,
  buildDockerPgDumpArgs,
  buildPgDumpArgs,
  getSourceConfig,
  maskConnectionString,
  normalizeSchemaOnlySql,
  validateSchemaOnlySql,
} from '../../scripts/export-bootstrap-schema';

describe('bootstrap schema export helper', () => {
  const originalBackupAdminUrl = process.env.BACKUP_ADMIN_DATABASE_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    if (originalBackupAdminUrl === undefined) {
      delete process.env.BACKUP_ADMIN_DATABASE_URL;
    } else {
      process.env.BACKUP_ADMIN_DATABASE_URL = originalBackupAdminUrl;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('prefers BACKUP_ADMIN_DATABASE_URL as the trusted schema source', () => {
    process.env.BACKUP_ADMIN_DATABASE_URL = 'postgres://admin:pw@host/admin_db';
    process.env.DATABASE_URL = 'postgres://app:pw@host/app_db';

    expect(getSourceConfig()).toEqual({
      url: 'postgres://admin:pw@host/admin_db',
      envName: 'BACKUP_ADMIN_DATABASE_URL',
    });
  });

  it('falls back to DATABASE_URL when the admin URL is absent', () => {
    delete process.env.BACKUP_ADMIN_DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://app:pw@host/app_db';

    expect(getSourceConfig()).toEqual({
      url: 'postgres://app:pw@host/app_db',
      envName: 'DATABASE_URL',
    });
  });

  it('fails closed when no trusted schema source URL is configured', () => {
    delete process.env.BACKUP_ADMIN_DATABASE_URL;
    delete process.env.DATABASE_URL;

    expect(() => getSourceConfig()).toThrow(
      'Set BACKUP_ADMIN_DATABASE_URL or DATABASE_URL before exporting bootstrap-redprint-schema.sql.',
    );
  });

  it('builds schema-only pg_dump arguments', () => {
    const args = buildPgDumpArgs(
      {
        url: 'postgres://admin:pw@host/admin_db',
        envName: 'BACKUP_ADMIN_DATABASE_URL',
      },
      '/tmp/bootstrap.sql',
    );

    expect(args).toEqual([
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--quote-all-identifiers',
      '--file=/tmp/bootstrap.sql',
      '--dbname=postgres://admin:pw@host/admin_db',
    ]);
  });

  it('builds docker pg_dump arguments for hosts without local postgres tools', () => {
    const args = buildDockerPgDumpArgs({
      url: 'postgres://admin:pw@host/admin_db',
      envName: 'BACKUP_ADMIN_DATABASE_URL',
    });

    expect(args).toEqual([
      'run',
      '--rm',
      'postgres:17',
      'pg_dump',
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '--quote-all-identifiers',
      '--dbname=postgres://admin:pw@host/admin_db',
    ]);
  });

  it('accepts schema-only SQL with CREATE TABLE statements', () => {
    expect(() =>
      validateSchemaOnlySql(`
        CREATE TABLE "users" (
          "id" text PRIMARY KEY
        );
        ALTER TABLE ONLY "users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
      `),
    ).not.toThrow();
  });

  it('rejects exports that do not contain CREATE TABLE', () => {
    expect(() => validateSchemaOnlySql('CREATE INDEX "idx_users_id" ON "users" ("id");')).toThrow(
      'pg_dump output did not contain CREATE TABLE statements.',
    );
  });

  it('rejects exports that accidentally include COPY data blocks', () => {
    expect(() =>
      validateSchemaOnlySql(`
        CREATE TABLE "users" ("id" text PRIMARY KEY);
        COPY "users" ("id") FROM STDIN;
      `),
    ).toThrow(
      'pg_dump output contained data statements. Refusing to replace bootstrap-redprint-schema.sql with a non-schema-only export.',
    );
  });

  it('rejects exports that accidentally include INSERT data statements', () => {
    expect(() =>
      validateSchemaOnlySql(`
        CREATE TABLE "users" ("id" text PRIMARY KEY);
        INSERT INTO "users" ("id") VALUES ('u_1');
      `),
    ).toThrow(
      'pg_dump output contained data statements. Refusing to replace bootstrap-redprint-schema.sql with a non-schema-only export.',
    );
  });

  it('removes pg_dump restrict noise to keep the checked-in schema diff stable', () => {
    const normalized = normalizeSchemaOnlySql(`
      -- header
      \\restrict abc123
      CREATE TABLE "users" ("id" text PRIMARY KEY);
      \\unrestrict abc123
    `);

    expect(normalized).toContain('CREATE TABLE "users"');
    expect(normalized).not.toContain('\\restrict');
    expect(normalized).not.toContain('\\unrestrict');
  });

  it('masks connection strings in export failures', () => {
    const source = {
      url: 'postgres://admin:secret@db.internal/redprint',
      envName: 'BACKUP_ADMIN_DATABASE_URL' as const,
    };

    expect(maskConnectionString(`pg_dump failed for ${source.url}`, source)).toBe(
      'pg_dump failed for ***BACKUP_ADMIN_DATABASE_URL***',
    );
  });

  it('builds a checked-in file header that records the source env', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T13:00:00.000Z'));

    try {
      const header = buildHeader('BACKUP_ADMIN_DATABASE_URL');
      expect(header).toContain('-- Generated by: npm run export:bootstrap-schema');
      expect(header).toContain('-- Generated at: 2026-03-26T13:00:00.000Z');
      expect(header).toContain('-- Source env: BACKUP_ADMIN_DATABASE_URL');
    } finally {
      vi.useRealTimers();
    }
  });
});
