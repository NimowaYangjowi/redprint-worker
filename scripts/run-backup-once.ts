import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

config({ path: '.env.worker' });
config({ path: '.env.local' });

const MAIN_MODULE_PATH = process.argv[1];

export async function runBackupOnce(): Promise<void> {
  const { _executeBackup } = await import('../src/lib/backup/backup-scheduler');

  process.stdout.write(
    '[BACKUP] Running one manual verified-backup cycle for rollout smoke.\n',
  );
  process.stdout.write(
    '[BACKUP] 쉽게 말해, 오늘 스케줄을 기다리지 않고 지금 백업 상자를 한 번 만들고 다시 열어보는 버튼입니다.\n',
  );
  process.stdout.write(
    '[BACKUP] 이 one-shot smoke는 기존 백업 정리(retention)는 건너뛰고, 복원 검증 흐름만 확인합니다.\n',
  );

  await _executeBackup({ skipRetention: true });
}

if (MAIN_MODULE_PATH === fileURLToPath(import.meta.url)) {
  await runBackupOnce();
}
