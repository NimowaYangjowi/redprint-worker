# Railway Verify DB Setup And Daily Flow

이 문서는 Railway verify DB를 실제로 만들고, 첫 세팅부터 매일 어떤 흐름으로 도는지 설명합니다.

쉽게 말해:
- 연습장 DB를 처음 어떻게 준비하는지
- 매일 백업 상자를 어떻게 다시 열어보는지
- 검사 끝나면 왜 바로 비우는지
를 설명하는 운영 문서입니다.

## What BACKUP_VERIFY_DATABASE_URL Means

`BACKUP_VERIFY_DATABASE_URL`은:
- 실서비스 DB와 분리된
- 백업 복원 검증 전용 PostgreSQL DB URL입니다

예시:

```env
DATABASE_URL=postgresql://app_user:password@host:5432/railway
BACKUP_VERIFY_DATABASE_URL=postgresql://verify_user:password@host:5432/redprint_verify
```

핵심 규칙:
- `DATABASE_URL`과 같은 DB를 가리키면 안 됩니다
- 실제 사용자 데이터가 들어 있는 운영 DB를 가리키면 안 됩니다

쉽게 말해:
- 진짜 가게 주소와
- 연습장 가게 주소는 달라야 합니다

## Why Railway Is Recommended

코드상으로는 Railway가 꼭 필수는 아닙니다.
하지만 실제 운영에서는 Railway verify DB를 권장합니다.

이유:
- worker가 Railway에서 도는 경우 네트워크 접근이 가장 단순함
- 매일 자동 검증을 운영 환경 안에서 계속 돌리기 쉬움
- 로컬 Docker는 로컬 연습에는 좋지만, 상시 운영 verify DB로는 부적합함

쉽게 말해:
- 집에서 연습하려면 로컬 Docker도 괜찮지만
- 매일 학교에서 시험 보려면 학교 안 교실이 더 맞습니다

## First-Time Setup

### Step 1. Create A Dedicated Railway Postgres

- Railway에서 새 Postgres를 하나 만든다
- 이 DB는 verify 전용으로만 사용한다

권장 이름:
- `redprint_verify`

중요:
- 메인 DB 서비스 재사용보다 별도 verify DB가 더 안전합니다

### Step 2. Set BACKUP_VERIFY_DATABASE_URL

worker가 읽는 환경변수에 아래를 넣습니다.

```env
BACKUP_VERIFY_DATABASE_URL=postgresql://verify_user:password@host:5432/redprint_verify
```

### Step 3. Prepare The Schema Once

verify DB는 빈 DB여도 되지만, 스키마는 미리 준비돼 있어야 합니다.

준비 방법:

```bash
psql "$BACKUP_VERIFY_DATABASE_URL" -f scripts/bootstrap-redprint-schema.sql
```

이 단계의 의미:
- 매일 데이터를 넣기 전에
- 교실의 책상, 칠판, 서랍 구조를 먼저 만들어 두는 것입니다

### Step 4. Rollout Preflight

배포 전 읽기 전용 점검:

```bash
npm run backup:rollout:preflight
```

이 명령은 대략 이런 것을 확인합니다.
- 필수 env 존재
- verify DB가 live DB와 다른지
- `backup_logs` phase-3 칼럼 존재
- verify DB에 public 테이블이 준비돼 있는지

## Daily Runtime Flow

매일 Railway verify DB에서 일어나는 흐름은 이렇습니다.

1. 실서비스 DB에서 `.sql.gz` 백업 파일 생성
2. R2에 업로드
3. `backup_logs`에 `running/pending` 기록
4. verify DB 데이터 비우기
5. R2 파일을 verify DB에 복원
6. JSON / sequence / schema fingerprint 검사
7. verify DB를 즉시 다시 비우기
8. 그때만 `status='success'`, `verification_status='passed'`

쉽게 말해:
- 상자를 만들고
- 창고에 넣고
- 연습장 DB에 다시 열어보고
- 합격하면 연습장 교실을 바로 다시 치웁니다

## Important Clarification

현재 구조는:
- verify DB를 매일 새로 만들고 지우는 구조가 아닙니다

현재 구조는:
- verify DB는 고정으로 유지
- 데이터만 매일 비우고 다시 복원
- 검사가 끝나면 다시 비움

즉:
- DB 서비스 자체를 없애는 것이 아니라
- 그 안의 데이터만 비우는 구조입니다

## Why We Empty It Immediately

검사 후 데이터를 다음날까지 그대로 두면:
- verify DB 안에 복원된 데이터가 계속 디스크를 점유합니다
- 비용 관점에서 불필요합니다

그래서 현재 구현은:
- 다음날 시작 전에만 비우지 않고
- 검사가 성공하면 즉시 다시 비웁니다

쉽게 말해:
- 시험 끝난 교실에 책상을 하루 종일 쌓아두지 않고
- 시험 끝나면 바로 치우는 구조입니다

## Rollout Smoke

운영 배포 후에는 아래 순서가 권장됩니다.

```bash
npm run backup:rollout:preflight
npm run backup:rollout:smoke
npm run backup:rollout:status
```

의미:
- preflight: 준비물 검사
- smoke: 한 번 실제로 verified-backup 실행
- status: 메뉴바 백업 상태 카드가 어떤 이야기를 해야 하는지 읽기

## Failure Interpretation

### If preflight fails

대표 원인:
- `BACKUP_VERIFY_DATABASE_URL` 없음
- verify DB schema 미준비
- `backup_logs` migration 미적용

### If smoke fails

대표 원인:
- verify DB 복원 실패
- schema fingerprint mismatch
- sentinel checksum mismatch
- cleanup failure

중요:
- cleanup이 실패하면 초록불로 넘어가지 않습니다

## Related Docs

- 큰 구조: [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
- schema 변경 운영: [verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)
- rollout 체크리스트: [phase-4-rollout-checklist.md](/Users/jiwoo/Downloads/projects/transcode-worker/tasks/db-backup/phase-4-rollout-checklist.md)
