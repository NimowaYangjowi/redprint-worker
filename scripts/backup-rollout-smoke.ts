import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

import { runBackupRolloutPreflight } from './backup-rollout-preflight';
import {
  describeBackupUiState,
  getBackupUiState,
  readBackupRolloutSnapshot,
  type BackupRolloutSnapshot,
} from './backup-rollout-status';
import { runBackupOnce } from './run-backup-once';

config({ path: '.env.worker' });
config({ path: '.env.local' });

const MAIN_MODULE_PATH = process.argv[1];

function formatChecklistLine(ok: boolean, label: string, detail: string): string {
  return `${ok ? '[ok]' : '[x]'} ${label}: ${detail}`;
}

export function getRolloutSmokeFailure(snapshot: BackupRolloutSnapshot): string | null {
  if (!snapshot.hasPhase3Columns) {
    return 'backup_logs is still missing the phase-3 verification columns.';
  }

  if (!snapshot.latest) {
    return 'No backup row was written by the rollout smoke run.';
  }

  const latestState = getBackupUiState(snapshot.latest);
  if (latestState !== 'verified') {
    const statusSummary = [
      `ui_state=${latestState}`,
      `status=${snapshot.latest.status}`,
      `verification_status=${snapshot.latest.verification_status ?? 'null'}`,
      `error=${snapshot.latest.error_message ?? 'none'}`,
    ].join(', ');

    return `Latest backup did not end in restore-verified green (${statusSummary}).`;
  }

  if (!snapshot.latestVerified) {
    return 'latest_verified is empty even though the latest row looks verified.';
  }

  return null;
}

async function main(): Promise<void> {
  const items = await runBackupRolloutPreflight();
  for (const item of items) {
    process.stdout.write(`${formatChecklistLine(item.ok, item.label, item.detail)}\n`);
  }

  const preflightFailed = items.some((item) => !item.ok);
  if (preflightFailed) {
    process.stdout.write(
      '\nRollout smoke did not run because preflight failed. Fix the environment first.\n',
    );
    process.exitCode = 1;
    return;
  }

  await runBackupOnce();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set before reading rollout smoke status.');
  }

  const snapshot = await readBackupRolloutSnapshot(databaseUrl);
  const latestState = getBackupUiState(snapshot.latest);
  process.stdout.write(
    `\nLatest backup state after smoke: ${describeBackupUiState(latestState)}\n`,
  );

  const failure = getRolloutSmokeFailure(snapshot);
  if (failure) {
    process.stdout.write(`${failure}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    'Rollout smoke passed. The latest backup row ended in restore-verified green.\n',
  );
}

if (MAIN_MODULE_PATH === fileURLToPath(import.meta.url)) {
  await main();
}
