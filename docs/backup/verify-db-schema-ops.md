# Verify DB Schema Operations When Main DB Changes

이 문서는 메인 DB schema 변경이 생겼을 때 verify DB를 어떻게 같이 운영해야 하는지 설명합니다.

쉽게 말해:
- 진짜 가게 구조를 바꾸면
- 연습장 가게 구조도 어떻게 같이 맞출지
- 어떤 순서로 배포해야 메뉴바 백업 상태 카드가 거짓말하지 않는지
를 설명하는 순서표입니다.

## Core Rule

원칙은 간단합니다.

- 메인 DB schema가 바뀌면 verify DB schema도 같이 맞춰야 합니다

왜냐하면 현재 verify 엔진은:
- table count
- schema fingerprint
- sentinel data
를 같이 보기 때문입니다

즉 verify DB 구조가 stale하면:
- 백업은 초록불이 아니라 실패로 떨어집니다

## Recommended 6-Step Flow

### Step 1. Land The Main DB Migration

먼저 메인 DB에 schema 변경을 적용합니다.

예:
- 컬럼 추가
- 테이블 추가
- FK/인덱스 변경

쉽게 말해:
- 진짜 가게 구조부터 먼저 바꿉니다

### Step 2. Apply The Same Schema Change To Verify DB

verify DB도 같은 구조가 되게 맞춥니다.

가능한 방식:
- 같은 SQL migration 적용
- verify DB를 새 bootstrap 기준으로 refresh

권장 원칙:
- "진짜 가게 구조"와 "연습장 가게 구조"가 같은 날 같이 바뀌어야 합니다

### Step 3. Regenerate The Bootstrap Snapshot

schema 변경 후에는:

```bash
npm run export:bootstrap-schema
```

로 [bootstrap-redprint-schema.sql](/Users/jiwoo/Downloads/projects/transcode-worker/scripts/bootstrap-redprint-schema.sql)을 최신 기준으로 다시 만듭니다.

이 파일의 의미:
- verify DB를 다시 세울 때 쓰는 설계도

즉:
- 건물 구조를 바꿨으면
- 설계도 봉투도 새 버전으로 갈아둬야 합니다

### Step 4. Run Migration-First Rollout Order

배포 순서는 항상 이 순서를 지킵니다.

1. `scripts/migrate-backup-logs.sql`
2. 메인 DB schema 변경
3. verify DB schema 맞추기
4. worker 배포
5. monitor app 배포

중요:
- 새 worker와 메뉴바 상태 카드는
- 새 구조를 읽고 쓴다고 가정합니다

### Step 5. Run Rollout Smoke

변경 후에는 아래를 권장합니다.

```bash
npm run backup:rollout:preflight
npm run backup:rollout:smoke
```

이 단계의 의미:
- verify DB가 구조상 맞는지
- 복원 검증이 실제로 통과하는지
- 성공 후 verify DB가 다시 비워지는지
를 한 번 확인하는 것입니다

### Step 6. Confirm Status From The Operator View

마지막으로 운영자 관점에서 확인합니다.

```bash
npm run backup:rollout:status
```

확인할 것:
- 최신 백업이 `verified`로 보이는지
- `latest_verified`가 최신 성공 행과 맞는지
- 메뉴바 백업 상태 카드의 의미와 터미널 상태가 같은지

쉽게 말해:
- 기계 쪽 로그만 보지 말고
- 점원이 붙이는 스티커가 진짜 맞는지도 보라는 뜻입니다

## What Not To Do

- 메인 DB만 바꾸고 verify DB는 나중에 맞추기
- bootstrap snapshot을 오래된 상태로 방치
- 새 worker를 migration보다 먼저 배포
- verify DB를 실서비스 DB와 같은 DB로 두기

이런 경우 어떤 일이 생기냐면:
- verify가 fail closed
- 메뉴바 백업 상태 카드가 초록불을 못 띄움
- 운영자가 "왜 갑자기 다 실패하지?"를 보게 됩니다

## Simple Decision Rule

schema 변경이 있으면 항상 이렇게 생각하면 됩니다.

- 메인 DB 바뀜
- verify DB도 같이 바뀜
- bootstrap snapshot도 같이 갱신
- smoke로 한 번 검증

이 네 가지가 같이 가야 합니다.

## Related Docs

- 큰 구조: [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
- Railway verify DB 운영: [railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
- rollout 체크리스트: [phase-4-rollout-checklist.md](/Users/jiwoo/Downloads/projects/transcode-worker/tasks/db-backup/phase-4-rollout-checklist.md)
