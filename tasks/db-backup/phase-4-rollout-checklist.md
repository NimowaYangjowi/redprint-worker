# Phase 4: Verified Backup Rollout Checklist

Generated on 2026-03-26
Repo: transcode-worker
Branch: main

Purpose:
- This is the ops rollout checklist for the verified-backup work.
- 쉽게 말해, 코드는 이미 준비됐고 이제 각 환경에서 무엇을 어떤 순서로 눌러야 하는지 적은 실행 순서표다.

Source of truth relationship:
- implementation contract: `phase-3-implementation-plan-verified-backup.md`
- QA checklist: `phase-2-eng-review-test-plan-verified-restore.md`
- this file: rollout-only checklist

## Rollout Helper Commands

- `npm run backup:rollout:preflight`
  배포 전에 이 환경이 정말 준비됐는지 읽기 전용으로 확인하는 버튼이다.
  쉽게 말해, 점검표 칸이 있는지, verify DB가 따로 잡혀 있는지, `psql`이 있는지 먼저 검사한다.
- `npm run backup:run-once`
  스케줄 시간을 기다리지 않고 verified-backup를 한 번 즉시 돌리는 버튼이다.
  쉽게 말해, 오늘 수업 시간이 아니어도 지금 바로 백업 상자를 한 번 만들고 다시 열어보는 연습 버튼이다.
  rollout smoke 용도이므로 retention 청소는 건너뛴다.
  대신 verify DB 안에 복원된 데이터는 검사가 끝나면 바로 다시 비우도록 유지한다.
- `npm run backup:rollout:status`
  최신 백업이 지금 `running / verifying / verified / legacy / failed` 중 어디에 있는지 읽는 버튼이다.
  쉽게 말해, 메뉴바 백업 상태 카드가 지금 어떤 이야기를 해야 하는지 터미널에서 바로 읽어보는 버튼이다.
- `npm run backup:rollout:smoke`
  preflight 통과 여부를 먼저 보고, one-shot verified-backup를 한 번 돌린 뒤, 마지막 백업 행이 진짜 `verified`로 끝났는지까지 확인하는 버튼이다.
  쉽게 말해, 준비물 검사 + 시험 한 번 보기 + 성적표 확인을 한 번에 하는 버튼이다.

## What Is Already Done In Code

- 메뉴바 백업 상태 카드는 `running / verifying / verified / legacy / failed` 의미를 구분한다.
- 백업 워커는 R2 업로드만으로 성공 처리하지 않고, verify DB라는 연습장 DB에 다시 복원 검증이 통과해야 success를 찍는다.
- 백업 파일에는 restore manifest가 들어 있고, JSON-heavy sentinel 데이터와 sequence 상태까지 검사한다.
- 빈 DB 복구 훈련도 한 번 끝냈고, 이 환경에서는 isolated FK fallback이 실제로 필요하다는 점까지 확인됐다.

## Rollout Rule

항상 이 순서를 지킨다:

1. `scripts/migrate-backup-logs.sql`
2. worker deploy
3. monitor app deploy
4. one manual backup verification smoke

쉽게 말해:
- 먼저 기록장 종이 양식을 새 버전으로 바꾼다.
- 그 다음에 새 백업 기계(worker)를 켠다.
- 마지막으로 새 메뉴바 상태판을 켠다.

## Step 1. Apply The DB Migration First

Run:

```bash
psql "$DATABASE_URL" -f scripts/migrate-backup-logs.sql
```

Expected result:
- `backup_logs` has:
  - `format_version`
  - `verification_status`
  - `verified_at`
  - `verified_from_r2_key`

Why this must be first:
- worker는 이 칸들에 백업 검증 결과를 적는다.
- monitor app은 이 칸들을 읽어서 메뉴바 백업 상태 카드를 만든다.
- 쉽게 말해, 새 점검표 칸을 먼저 만든 뒤에야 점원과 기계가 그 칸을 쓸 수 있다.

## Step 2. Deploy The Worker

Required env:
- `DATABASE_URL`
- `BACKUP_VERIFY_DATABASE_URL`
- `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`

Check before turning it on:
- `BACKUP_VERIFY_DATABASE_URL` must not point at the live app DB
- verify DB must already have the prepared schema
- runtime must have `psql`

Expected behavior after deploy:
- new backup rows start as `running`
- after upload, the row is still `running` but now has `r2_key`
- while restore proof is still running, the UI should show `verifying`
- once verification passes, the verify DB is emptied again immediately so restored data does not sit there until the next day's run

## Step 3. Deploy The Monitor App

Expected behavior after deploy:
- latest backup card no longer treats plain `status='success'` as enough
- only `status='success'` + `verification_status='passed'` is green
- if migration somehow was missed in a target environment, the query falls back safely instead of crashing the card

쉽게 말해:
- 상자가 창고에 올라갔다고 바로 초록 스티커를 붙이지 않는다.
- 실제로 연습장 DB에서 다시 살아난 경우에만 초록불이다.

## Step 4. Manual Smoke After Rollout

Run one real backup cycle and confirm:

Suggested commands:

```bash
npm run backup:rollout:smoke
```

1. a new `backups/v2/...sql.gz` object is created
2. the newest `backup_logs` row moves through:
   - `running`
   - `verifying`
   - `verified`
3. menu bar latest card shows restore-verified green only at the end
4. `latest_verified` in the monitor app matches the newest successful row

If the run fails:
- the row must end as `failed`
- the menu bar card must not show green
- inspect the worker log first

## Fast Triage Guide

### Symptom: worker fails immediately with rollout error

Expected message:
- `backup_logs is missing the phase-3 verification columns`

Action:
- re-run `scripts/migrate-backup-logs.sql`
- redeploy worker only after the migration is confirmed

### Symptom: menu bar backup card loads but no verified row is shown

Possible causes:
- latest run is still `verifying`
- restore verification failed
- target environment is still on legacy rows only

Action:
- inspect latest row in `backup_logs`
- confirm `verification_status`
- confirm verify DB and R2 access

### Symptom: empty-DB recovery drill fails on FK order

Action:
- use the documented isolated fallback path only in verify/recovery DB
- do not widen scope into a custom dependency-order restore planner

## Done For Rollout

The rollout is complete in an environment when:
- migration has been applied
- worker is writing phase-3 verification fields
- monitor app shows honest `verifying` vs `verified`
- one manual smoke backup has finished green
- operator can identify the latest restore-verified row without ambiguity
