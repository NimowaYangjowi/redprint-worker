/**
 * pg_dump Executor
 * Runs pg_dump as a child process, pipes through gzip, and verifies integrity.
 *
 * Flow:
 *   pg_dump --dbname=DATABASE_URL → stdout → gzip → temp file
 *   gzip -t temp file (integrity check)
 *   Return temp file path
 */

import { execFile } from 'node:child_process';
import { createWriteStream, statSync, unlinkSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PG_DUMP_TIMEOUT_MS, GZIP_VERIFY_TIMEOUT_MS } from './constants';

/** Mask DATABASE_URL in error messages to prevent credential leaks */
function maskConnectionString(message: string): string {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return message;
  return message.replaceAll(dbUrl, '***DATABASE_URL***');
}

/**
 * Execute pg_dump and produce a gzipped SQL file.
 * @returns Path to the temporary .sql.gz file
 * @throws On pg_dump failure, empty output, or gzip corruption
 */
export async function runPgDump(): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set');
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const tempPath = join(tmpdir(), `redprint-db-${timestamp}.sql.gz`);

  try {
    // Step 1: Run pg_dump → gzip → temp file
    await dumpAndCompress(databaseUrl, tempPath);

    // Step 2: Verify file size > 0
    const stat = statSync(tempPath);
    if (stat.size === 0) {
      throw new Error('pg_dump produced an empty file');
    }

    // Step 3: Verify gzip integrity
    await verifyGzipIntegrity(tempPath);

    return tempPath;
  } catch (err) {
    // Cleanup partial file on any error
    cleanupFile(tempPath);
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`pg_dump failed: ${maskConnectionString(message)}`);
  }
}

/** Run pg_dump and pipe stdout through gzip to a file */
function dumpAndCompress(databaseUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'pg_dump',
      ['--dbname', databaseUrl, '--no-owner', '--no-acl'],
      {
        timeout: PG_DUMP_TIMEOUT_MS,
        maxBuffer: 10 * 1024, // We only capture stderr, not stdout
        encoding: 'buffer',
      }
    );

    if (!child.stdout || !child.stderr) {
      reject(new Error('Failed to spawn pg_dump process'));
      return;
    }

    let stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const gzip = createGzip({ level: 6 });
    const outStream = createWriteStream(outputPath);

    // pg_dump stdout → gzip → file
    pipeline(
      Readable.fromWeb(
        new ReadableStream({
          start(controller) {
            child.stdout!.on('data', (chunk: Buffer) => controller.enqueue(chunk));
            child.stdout!.on('end', () => controller.close());
            child.stdout!.on('error', (err) => controller.error(err));
          },
        }) as import('stream/web').ReadableStream
      ),
      gzip,
      outStream
    ).then(() => {
      // Wait for child process to exit
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
          reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
        }
      });
    }).catch(reject);

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/** Verify gzip file integrity using gzip -t */
function verifyGzipIntegrity(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'gzip',
      ['-t', filePath],
      { timeout: GZIP_VERIFY_TIMEOUT_MS },
      (error) => {
        if (error) {
          reject(new Error(`gzip integrity check failed: ${error.message}`));
        } else {
          resolve();
        }
      }
    );
  });
}

/** Safely remove a file if it exists */
function cleanupFile(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best-effort cleanup
  }
}
