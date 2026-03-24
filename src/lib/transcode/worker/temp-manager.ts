/**
 * Temp File Manager & Disk Space Guard
 * Manages isolated temp directories per job and checks available disk space.
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { MIN_FREE_DISK_GB, TEMP_DIR_BASE } from '../constants';

/** Create an isolated temp directory for a job */
export function createTempDir(jobId: string): string {
  const dir = join(TEMP_DIR_BASE, jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove temp directory for a job (safe — ignores if missing) */
export function cleanupTempDir(jobId: string): void {
  const dir = join(TEMP_DIR_BASE, jobId);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Get free disk space in GB on the root partition (cross-platform) */
export function getFreeDiskGB(): number {
  // df -BG works on Linux; macOS uses df -g
  const isLinux = process.platform === 'linux';
  const output = execSync(isLinux ? 'df -BG / | tail -1' : 'df -g / | tail -1', { encoding: 'utf-8' });
  // Linux df -BG: Filesystem 1G-blocks Used Available Use% ...  (values like "10G")
  // macOS df -g:  Filesystem 1G-blocks Used Available Capacity ...  (plain integers)
  const parts = output.trim().split(/\s+/);
  return parseInt(parts[3], 10);
}

/** Check if enough disk space is available for a new job */
export function hasSufficientDisk(): boolean {
  return getFreeDiskGB() >= MIN_FREE_DISK_GB;
}
