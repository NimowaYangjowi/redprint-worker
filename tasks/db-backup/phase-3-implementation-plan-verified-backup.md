# Phase 3: Verified Backup V2 Implementation Plan

Generated on 2026-03-26
Repo: transcode-worker
Branch: main

Supersedes:
- `phase-0-design.md` for implementation details
- `phase-2-eng-review-test-plan-verified-restore.md` as the source of truth for QA/test coverage

Status:
- This is the implementation source of truth.
- Current branch status:
  Slice 1 shipped
  Slice 2 shipped
  Slice 3 shipped
- `phase-0-design.md` remains the historical problem statement.
- `phase-2-eng-review-test-plan-verified-restore.md` remains the QA/test checklist.

## Goal

레드프린트의 프로덕션 DB 백업을 "파일이 올라갔다"가 아니라
"방금 올린 원격 파일을 verify DB에 실제로 복원 검증까지 통과했다"로 재정의한다.

쉽게 말해:
- 예전 방식은 백업 상자를 만들고 창고(R2)에 넣기만 하면 성공으로 쳤다.
- 새 방식은 그 상자를 다시 꺼내 열어 보고, 실제로 새 연습장 DB에 부어 넣어도 살아나야만 성공이다.

## Implementation Progress

Current branch progress on 2026-03-26:
- Slice 1 is implemented.
  메뉴바 백업 상태판은 이제 `running / verifying / verified / legacy / failed`를 구분하고, 초록불은 restore-verified일 때만 켜진다.
  partial rollout에서도 monitor query는 legacy-safe fallback을 써서 카드 자체가 깨지지 않도록 잠겼다.
- Slice 2 is implemented.
  일일 검증은 live DB clone이 아니라 `BACKUP_VERIFY_DATABASE_URL` 전용 verify DB reset -> remote restore -> verify 흐름으로 바뀌었다.
  backup worker는 `backup_logs`에 phase-3 칼럼이 없으면 generic SQL error 대신 `scripts/migrate-backup-logs.sql` 먼저 적용하라는 explicit rollout error를 낸다.
- Slice 3 is implemented.
  backup artifact header manifest, `schema_fingerprint`, `sentinel_row_checksums`, verify-time checksum 검사, direct sequence smoke, trusted bootstrap export, empty-DB recovery drill, isolated FK fallback이 모두 구현/검증됐다.
- Phase 4 helper tooling added.
  rollout 전 preflight 체크, retention을 건너뛰는 수동 smoke용 one-shot backup 실행, 최신 backup 상태 조회, 그리고 preflight->smoke->verified 판정까지 묶은 rollout smoke helper script가 추가됐다.
- Slice 3 prep work added:
  trusted `bootstrap-redprint-schema.sql` 생성을 위한 `npm run export:bootstrap-schema` helper가 추가됐다.
- Slice 3 safety hardening added:
  export helper는 schema-only SQL에 data statement가 섞이면 fail-closed 하고, 관련 규칙은 automated test로 잠겼다.
- Slice 3 bootstrap progress:
  trusted `bootstrap-redprint-schema.sql`이 실제 schema-only export로 생성됐고, noisy `\\restrict` 메타 라인도 제거되도록 잠겼다.
- Slice 3 recovery proof:
  disposable local Postgres에서 checked-in bootstrap schema + latest v2 dump로 empty-DB recovery drill을 실제 실행했고, normal constraint path는 FK order에서 실패했으며 isolated `session_replication_role = replica` fallback 경로는 성공적으로 restore + manifest + sequence smoke를 통과했다.
- Automated validation on current branch:
  `npm test -- tests/backup` passed with `12` test files and `100` tests.
  `cargo check` in `monitor-app/src-tauri` also passed after the legacy-safe fallback query change.

## Final Decisions Locked

1. 기존 깨진 백업 형식(v1)은 호환하지 않는다.
2. 새 백업 계약은 `data + sequence state + remote restore verification`이다.
3. 일일 자동 검증은 `BACKUP_VERIFY_DATABASE_URL`로 붙는 전용 verify DB에서만 수행한다.
4. 앱이 실제 데이터를 읽고 쓰는 연결은 계속 `DATABASE_URL`만 사용한다.
5. 백업 포맷은 단일 `.sql.gz`를 유지한다.
6. 파일 내용은 Postgres-native `COPY FROM STDIN` 블록 + `SELECT setval(...)` 문으로 생성한다.
7. 성공 로그는 `R2 업로드 후 원격 파일 복원 검증까지 통과`했을 때만 남긴다.
8. 검증은 전용 verify DB에서 수행하고, 실제 사용자 트래픽이 붙는 DB는 일일 백업 검증 때문에 잠그지 않는다.
9. 새 백업은 `backups/v2/` 아래에 저장해 옛 깨진 백업과 분리한다.
10. 복원 검증은 `psql exit code`만으로 통과시키지 않고 restore manifest를 함께 확인한다.
11. `BACKUP_ADMIN_DATABASE_URL`이 남더라도 그것은 수동 bootstrap/maintenance 용도이며, 일일 검증 critical path에는 넣지 않는다.
12. restore manifest 메타데이터는 같은 `.sql.gz` 파일의 SQL header comment 안에 넣고, phase 3에서 별도 sidecar JSON 파일은 만들지 않는다.
13. phase 3는 verify DB 준비와 빈 DB 재복구에 공통으로 쓰는 단일 schema bootstrap 경로를 포함하되, 그것을 매일 스케줄 검증의 기본 경로로 사용하지 않는다.
14. custom `COPY` restore가 남는다면 raw alphabetical table order에 기대지 않고, 운영자 복구 런북과 최대한 같은 가정으로 검증한다.
15. `session_replication_role = replica`는 기본 검증 경로가 아니라, 권한과 격리 조건이 검증된 verify DB fallback일 때만 허용한다.
16. phase 3는 새 persisted `status` enum인 `verifying`를 추가하지 않고, `status=running` + `verification_status=pending` + `r2_key 있음`을 UI의 "업로드 후 검증 중" 상태로 해석한다.
17. phase 3 rollout은 `scripts/migrate-backup-logs.sql` 적용이 항상 먼저이고, 그 다음에 worker/monitor 코드 배포가 따라온다.
18. `Dockerfile` 변경은 phase 3 기본 범위가 아니며, 실제 런타임에 `psql`이 없다는 증거가 있을 때만 다시 연다.
19. `scripts/bootstrap-redprint-schema.sql`의 진짜 원본은 Drizzle TypeScript schema가 아니라, trusted deployed DB에서 뽑은 checked-in `pg_dump --schema-only` snapshot이다.
20. 빈 DB restore는 먼저 normal constraint path로 시도하고, FK 순서 때문에만 실패가 재현될 때만 `session_replication_role = replica`를 격리된 verify/recovery DB 공식 fallback으로 허용한다.

## What Already Exists

- `src/lib/backup/backup-scheduler.ts`
  매일 자동으로 백업을 돌리는 시계 역할이 이미 있다.
- `src/lib/backup/backup-uploader.ts`
  만든 파일을 R2로 올리는 단계가 이미 있다.
- `src/lib/backup/retention.ts`
  오래된 백업을 정리하는 청소기 역할이 이미 있다.
- `src/lib/backup/backup-logger.ts`
  백업 시작/성공/실패를 DB에 남기는 기록장이 이미 있다.
- `src/db/schema/backup-logs.ts`
  모니터 앱이 읽는 `backup_logs` 테이블이 이미 있다.
- `monitor-app/src-tauri/src/db.rs`
  메뉴바 백업 상태판이 이미 `backup_logs`를 읽는다.
- `src/lib/storage/r2-client.ts`
  R2 업로드/목록/다운로드 스트림 helper가 이미 있다.

재사용 원칙:
- 새 TypeScript 모듈은 `src/lib/backup/backup-verify.ts` 하나만 추가한다.
- 새 운영 스크립트는 `scripts/bootstrap-redprint-schema.sql`과 그 생성 helper `scripts/export-bootstrap-schema.ts`를 사용한다.
- 나머지는 기존 스케줄러/업로더/리텐션/로그/모니터 조회를 확장한다.

## High-Level Flow

```text
DATABASE_URL (real app DB)
  │
  ├─ build dump file (.sql.gz)
  ├─ upload to R2: backups/v2/redprint-db-<timestamp>.sql.gz
  └─ keep serving app traffic

BACKUP_VERIFY_DATABASE_URL (dedicated verify DB)
  │
  ├─ reset verify DB to empty data state
  ├─ download uploaded R2 object again
  ├─ psql restore from remote object stream
  ├─ run restore manifest checks
  └─ mark success only if all checks pass
```

Connection roles:
- `DATABASE_URL`: 실제 서비스 DB
- `BACKUP_VERIFY_DATABASE_URL`: 매일 복원 검증을 돌리는 전용 verify DB
- `BACKUP_ADMIN_DATABASE_URL`: 필요할 때만 쓰는 수동 관리용 연결

## Source Of Truth Contracts

### 1. Backup Artifact Contract

- Path: `backups/v2/redprint-db-{YYYY-MM-DD-HHmmss}.sql.gz`
- Format version: `v2`
- SQL body:
  - header metadata
  - `COPY ... FROM STDIN` per table
  - `SELECT setval(...)` per owned sequence
- Header metadata must include:
  - `format_version`
  - `schema_fingerprint`
  - `public_table_count`
  - `sentinel_tables`
  - `sentinel_row_checksums`
- No hand-built `INSERT` serialization
- No `[object Object]`-style stringification
- No separate restore-manifest sidecar file for phase 3

User-facing meaning:
- 작품 카드 본문, 예시 이미지 메타데이터, 알림 부가정보, 유저 프로필 설정 같은 JSON 데이터가 찌그러지면 안 된다.

### 2. Success Contract

`backup_logs.status = 'success'` means all of the following are true:
- dump file generation succeeded
- R2 upload succeeded
- the same remote object was downloaded again
- restore into verify DB succeeded through `psql`
- sequence restore statements succeeded
- restore manifest checks all passed
- verify DB was emptied again immediately after verification finished, so restored user data does not remain there until the next day

If any step above fails:
- `backup_logs.status = 'failed'`
- no "success" state is written

Required restore manifest checks:
- expected public-table count matches
- key business tables exist
- selected sentinel-row checksums from JSON-heavy tables match the embedded header metadata
- sequence-backed insert smoke passes and restores the original sequence state before verification ends
- backup header `format_version` is recognized and `schema_fingerprint` matches the prepared verify DB

Manifest source rule:
- the restore manifest is parsed from the backup file's own SQL header metadata
- verify-time checks must compare restored DB state against that embedded metadata
- the implementation must not invent a second source of truth in a separate JSON object

### 3. Log Schema Contract

`backup_logs` adds:
- `format_version`
- `verification_status`
- `verified_at`
- `verified_from_r2_key`

Recommended meaning:
- `status`: `running | success | failed`
- `verification_status`: `pending | passed | failed | null`

State rules:
- start: `status=running`, `verification_status=pending`
- uploaded and still verifying: `status=running`, `verification_status=pending`, `r2_key is not null`
- verified success: `status=success`, `verification_status=passed`
- verification failure: `status=failed`, `verification_status=failed`
- legacy rows: `verification_status=null`

### 4. Dashboard Contract

The menu bar backup status panel must distinguish:
- legacy backup row with no verification columns
- running backup
- uploaded but still verifying
- verified success
- failed verification

Rules:
- old rows with `null` verification fields must not crash queries
- latest verified backup and latest attempted backup may be different concepts in the UI
- "green / healthy" must mean restore-verified, not merely uploaded
- "verifying" in the menu bar means the file is already in R2 but restore proof is still running, not the same thing as "dump still being written"
- both `monitor-app/src-tauri/src/db.rs` and `monitor-app/src/index.html` must implement the same rule

### 5. Prefix Contract

- New scheduler duplicate-check logic only inspects `backups/v2/`
- New retention logic only deletes from `backups/v2/`
- Old `backups/` v1 objects are ignored by v2 scheduling logic

This prevents:
- a broken old backup from blocking today's verified run
- new retention from silently deleting historical v1 artifacts by mistake

### 6. Deployment Contract

- `scripts/migrate-backup-logs.sql` must run before any phase 3 worker or monitor build that reads/writes verification columns is deployed
- phase 3 prefers explicit rollout ordering over adding runtime column-detection complexity to every query
- old worker/dashboard builds may coexist with the new columns, but new worker/dashboard builds must not assume those columns exist before migration
- if migration has not run in an environment yet, keep the old dashboard build there rather than attempting a partial phase 3 rollout

## Dedicated Verify DB Contract

Daily verification uses a dedicated verify database that is never attached to user traffic.

Rules:
- no daily `CREATE DATABASE ... TEMPLATE railway`
- no daily forced session termination on the live DB
- no daily blocking of new live DB connections
- verify DB reset/restore failures must not affect user traffic

Schema drift handling:
- verify DB must be prepared ahead of time with the expected schema
- if backup `format_version` is unsupported or `schema_fingerprint` mismatches, verification fails closed
- schema refresh of verify DB is an explicit maintenance step, not an invisible side effect of daily backup

Reset and restore safety:
- every verification run must start from a proven-empty verify DB data state
- "best effort cleanup" is not enough if old rows could survive into the next restore
- preferred daily reset path for phase 3 is: assert schema fingerprint -> truncate/reset data -> assert zero user rows -> restore backup
- `scripts/bootstrap-redprint-schema.sql` is for initial verify DB provisioning and empty-DB recovery drills, not for every scheduled verification run
- default daily proof path should match the operator recovery runbook as closely as the environment allows
- raw alphabetical table restore order is forbidden
- `session_replication_role = replica` may be used only as an isolated verify-DB fallback when the runtime has the needed privilege and the path is explicitly documented
- if neither the runbook-matching path nor the isolated fallback is workable here, phase 3 must fail closed and be re-scoped rather than growing a custom dependency-graph sorter

```text
Daily verify run
  prepared verify DB
    -> fingerprint check
    -> truncate/reset data
    -> assert zero rows
    -> restore same R2 object
    -> manifest checks

Recovery drill / empty DB bootstrap
  empty DB
    -> bootstrap-redprint-schema.sql
    -> restore latest v2 backup
    -> recovery smoke checks
```

쉽게 말해:
- 매일 점검은 손님이 없는 연습장 매장에서만 한다
- 진짜 매장 문은 백업 검사 때문에 닫지 않는다

## Implementation Scope

Files expected to change:
- `src/lib/backup/pg-dump.ts`
- `src/lib/backup/backup-scheduler.ts`
- `src/lib/backup/backup-uploader.ts`
- `src/lib/backup/retention.ts`
- `src/lib/backup/backup-logger.ts`
- `src/lib/backup/constants.ts`
- `src/db/schema/backup-logs.ts`
- `monitor-app/src-tauri/src/db.rs`
- `monitor-app/src/index.html`
- `scripts/migrate-backup-logs.sql`
- `tests/backup/*`

New files:
- `src/lib/backup/backup-verify.ts`
- `scripts/bootstrap-redprint-schema.sql`
- `scripts/export-bootstrap-schema.ts`

## Code-Level Direction

### `src/lib/backup/pg-dump.ts`

- Replace current hand-built table/index/INSERT dump path
- Generate v2 SQL using Postgres-native data export semantics
- Include explicit sequence state restore
- Emit restore manifest metadata in the SQL header comment
- Include sentinel row checksum metadata for a small fixed set of JSON-heavy/business-critical sample rows
- Keep gzip integrity check
- Keep connection-string masking
- Do not assemble giant table-wide SQL chunk arrays in memory

### `src/lib/backup/backup-verify.ts`

Owns:
- verify DB connection
- verify DB reset helpers for the pre-provisioned daily verify DB
- remote object restore via `psql`
- manifest header parsing
- restore manifest checks
- verification result object returned to scheduler
- zero-row precondition checks before restore
- sequence-safe smoke checks that leave verify DB state unchanged after verification
- runbook-matching restore path selection, with isolated fallback only when explicitly allowed

### `src/lib/backup/backup-scheduler.ts`

Pipeline becomes:
1. log start
2. generate local dump
3. upload to R2 v2 path
4. verify by re-reading the same remote object into the dedicated verify DB
5. apply v2 retention
6. write success log only after verify passes

### `src/lib/backup/backup-uploader.ts`

- Write v2 path and metadata
- Keep local-file cleanup after successful upload
- Do not mark upload completion as backup success

### `src/lib/backup/retention.ts`

- Scope list/delete operations to v2 prefix only
- Keep minimum-one-backup rule

### `monitor-app/src-tauri/src/db.rs`

- Query new verification columns
- Handle legacy rows with nulls
- Expose enough state for the backup status panel to show verified vs legacy

### `monitor-app/src/index.html`

- Replace `status === 'success'` green logic with `verified restore passed` logic
- Keep legacy rows visible but not silently green
- Show a distinct label for `verifying` / `legacy` / `failed verification`
- Derive `verifying` from `status=running` + `verification_status=pending` + `r2_key present` rather than introducing a new persisted status enum

### `scripts/migrate-backup-logs.sql`

- Add the new verification columns used by phase 3
- Keep migration safe to run on existing environments
- Match the runtime schema exactly so fresh/manual environments do not drift
- Be treated as the first rollout step in every environment before worker/dashboard code is upgraded

### `scripts/bootstrap-redprint-schema.sql`

- Provide the single explicit schema bootstrap path for verify DB prep and empty-DB recovery drills
- Prefer one durable SQL/bootstrap artifact over introducing another migration system
- Be kept in sync with the schema assumptions used by restore manifest validation
- Not be invoked by every scheduled verification run
- Current branch note:
  this file is now a checked-in trusted schema-only export generated from the canonical deployed schema source and is ready for verify DB prep plus empty-DB recovery drills

### `scripts/export-bootstrap-schema.ts`

- Generate `scripts/bootstrap-redprint-schema.sql` from a trusted deployed DB using `pg_dump --schema-only`
- Prefer `BACKUP_ADMIN_DATABASE_URL`, with `DATABASE_URL` as a manual fallback when the operator intentionally uses the canonical schema source
- Keep the bootstrap file as a checked-in artifact instead of making daily verification regenerate schema at runtime
- Avoid using Drizzle schema files alone as the bootstrap source of truth because some FK/index constraints live outside those files

## Memory And Performance Guardrails

- Restore verification must use `getR2ObjectStream()`, not whole-file buffering
- `psql` restore should consume a stream directly
- Scheduler must not block live DB user traffic while remote restore runs
- Retention and "today backup exists" must use the v2 prefix to avoid scanning unrelated objects
- dump generation must not accumulate table-wide SQL strings in memory
- verify-time restore must not depend on implicit FK ordering luck
- daily verification must not rebuild schema from scratch on every run

Known acceptable compromise for this phase:
- upload path may remain buffer-based if compressed file size stays within current limits
- if real-world backup size grows enough to threaten worker memory, stream upload becomes the next follow-up

Native `pg_dump` note:
- boring-default `pg_dump` is preferred if direct connectivity is revalidated in this environment
- this repo previously moved away from CLI `pg_dump` because the Railway path was observed to hang
- phase 3 therefore does not assume `pg_dump` CLI is safely usable today
- regardless of implementation choice, table-wide reads and giant in-memory SQL chunk assembly are not acceptable

Runtime tooling note:
- the current container image already installs `postgresql-client-17`, so phase 3 should not reopen `Dockerfile` unless the actual deploy target proves `psql` is missing

## Regression Tests Required

### Critical regressions

1. JSON-heavy tables restore without `[object Object]` corruption
2. sequence-backed tables continue inserting after restore without duplicate key errors
3. a failed remote restore never writes `status='success'`
4. old v1 objects do not block v2 scheduler duplicate checks
5. monitor UI never shows green for an unverified row
6. backup_logs migration matches the runtime schema
7. bootstrap schema + latest v2 backup can restore into an empty verify DB
8. verify run fails if old rows remain in verify DB before restore
9. sequence smoke verification leaves verify DB sequence state unchanged after the run
10. sentinel row checksum mismatch fails verification instead of silently passing
11. uploaded-but-verifying rows render as `verifying`, not `success`

Current branch coverage note:
- 1, 3, 4, 5, 6, 8, 10, 11 are covered by automated tests on this branch
- 2 is covered by direct `nextval/setval` smoke in automation plus one manual empty-DB recovery drill against a disposable Postgres instance
- 7 is covered by one manual empty-DB recovery drill using the checked-in bootstrap schema and a real v2 dump
- 9 is covered by automated tests: sequence smoke restores the original sequence state or fails closed

### Required test layers

- Unit:
  - v2 path generation
  - log field mapping
  - v2 retention prefix scoping
  - duplicate-check prefix scoping
  - restore manifest header parsing
- Integration:
  - prepared verify DB -> truncate/reset -> restore via `psql`
  - bootstrap schema -> empty verify DB -> restore via `psql`
    current branch: manually rehearsed on a disposable Postgres instance; normal constraint path failed on FK order and the isolated verify-DB fallback succeeded
  - restore manifest checks catch broken JSON/sequence restores
  - restore manifest checks catch sentinel-row checksum mismatches
  - verify run fails closed when schema fingerprint mismatches
  - sequence smoke probe restores original sequence state
  - monitor query handles legacy and v2 rows together
- QA/ops smoke:
  - one rollout rehearsal where SQL migration is applied before the new worker/dashboard build
  - one manual end-to-end verified restore in a safe environment before trusting production success logs
  - one manual empty-DB recovery drill using `bootstrap-redprint-schema.sql` + latest v2 backup before calling the system disaster-ready

## Failure Modes

| Failure | Test required | Error handling | User-visible effect |
|---|---|---|---|
| bootstrap schema asset is stale or missing | yes | fail closed | operator sees failed backup, no false green |
| verify DB reset/schema fingerprint mismatch fails | yes | fail closed | operator sees failed backup, app traffic unaffected |
| remote object download fails | yes | fail log | backup panel shows failure |
| restore fails on JSON/sequence/FK-order issue | yes | fail log + verify DB cleanup | backup panel shows failure |
| sentinel row checksum does not match after restore | yes | fail closed | backup panel never shows false green for corrupted user data |
| sequence smoke probe changes verify DB state for the next run | yes | restore original sequence state or fail closed | next backup check stays deterministic |
| verify DB cleanup/reset fails | yes | fail closed on success-path cleanup, append cleanup error on failure-path cleanup | backup panel never shows green while restored data is still stranded in verify DB |
| legacy rows missing new columns | yes | null-safe dashboard query | backup panel still loads |
| phase 3 code is deployed before `backup_logs` migration | yes | block rollout / keep old dashboard build | avoid monitor crash from missing columns |
| normal empty-DB restore fails on FK order | yes | reset verify DB and retry once with isolated replica fallback | backup panel stays honest and the live DB is still untouched |

Critical gap rule:
- No failure mode may be left in a state where there is no test, no error handling, and the operator sees a silent green state.

## NOT In Scope

- Repairing or converting old v1 backup objects
- Multi-cloud secondary backup replication
- Scheduled alerting when no backup has run for 25 hours
- Full PITR / WAL shipping
- Building a custom dependency-graph restore planner for all tables

## Delivery Slices

### Slice 1. Honest Dashboard + Schema Rollout

Status:
- Implemented on current branch

Goal:
- 메뉴바 백업 상태판이 더 이상 "업로드만 됐는데 정상"이라고 거짓말하지 않게 만든다.

Files:
- `src/db/schema/backup-logs.ts`
- `scripts/migrate-backup-logs.sql`
- `monitor-app/src-tauri/src/db.rs`
- `monitor-app/src/index.html`

Outcome:
- legacy / running / verifying / verified / failed 표시 규칙이 문서대로 잠긴다
- phase 3 배포 순서가 `migration first`로 고정된다
- 아직 verify engine이 완성되지 않았더라도, 화면 의미부터 정직해진다
- migration이 늦은 환경에서도 메뉴바 백업 상태 카드는 legacy-safe fallback으로 죽지 않는다

### Slice 2. Verification Plumbing

Status:
- Implemented on current branch

Goal:
- 스케줄러가 "파일 업로드"가 아니라 "원격 복원 검증 통과"까지를 하나의 백업 성공으로 취급하게 만든다.

Files:
- `src/lib/backup/constants.ts`
- `src/lib/backup/backup-logger.ts`
- `src/lib/backup/backup-scheduler.ts`
- `src/lib/backup/backup-uploader.ts`
- `src/lib/backup/backup-verify.ts`
- `tests/backup/*`

Outcome:
- 업로드 후 검증 중 상태가 실제 로그와 UI에 반영된다
- 실패한 복원은 절대 초록불로 보이지 않는다
- worker가 phase-3 칼럼 누락을 만나면 rollout 순서 문제를 explicit하게 알려준다

### Slice 3. Artifact Hardening + Recovery Drill

Status:
- Implemented on current branch

Goal:
- 실제 백업 파일이 JSON/sequence 기준으로 믿을 만하고, 빈 verify DB에서도 다시 살아나는지 잠근다.

Files:
- `src/lib/backup/pg-dump.ts`
- `src/lib/backup/retention.ts`
- `scripts/bootstrap-redprint-schema.sql`
- `tests/backup/*`

Outcome:
- embedded manifest + sentinel checksum으로 데이터 무결성 증거가 생긴다
- empty-DB recovery drill까지 smoke-tested 상태가 된다

Current branch reality:
- embedded manifest + sentinel checksum은 구현 완료
- trusted bootstrap export helper script는 추가 완료
- export helper의 schema-only safety checks와 unit tests도 추가 완료
- direct sequence smoke 검증과 sequence state restore도 구현 완료
- `scripts/bootstrap-redprint-schema.sql`은 이제 checked-in trusted schema-only export다
- disposable recovery drill도 완료됐고, 이 환경에서는 normal constraint path 대신 isolated FK fallback이 실제로 필요하다는 점까지 확인됐다

## Implementation Order

1. Ship Slice 1 first: migration + dashboard semantics
2. Ship Slice 2 next: verification plumbing and honest success/failure logging
3. Ship Slice 3 last: artifact hardening, bootstrap path, and recovery-drill coverage

## Done Definition

- Latest green backup in the menu bar means "restore-verified from remote object"
- "verifying" label in the menu bar means "R2 upload finished, restore proof still running"
- live DB user traffic is never blocked by daily verification
- v2 scheduler ignores v1 objects
- empty verify DB bootstrap + restore path is documented and smoke-tested
- daily verification uses the prepared verify DB path and does not rebuild schema from scratch each run
- JSON and sequence regressions are covered by automated tests
- implementation matches this file, not the superseded phase-0 details

Current branch against done definition:
- Achieved now:
  green semantics, verifying semantics, dedicated verify DB daily flow, v2 prefix isolation, automated JSON manifest checks, trusted checked-in bootstrap schema, manual empty-DB recovery drill, isolated FK fallback proof

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 6 | PLAN UPDATED / IMPLEMENTATION IN PROGRESS | checksum proof, verifying-state rule, migration-first rollout, and delivery slices were folded into this plan; current branch status is tracked inline |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

- **RESOLVED:** empty-DB recovery drill has been completed, and this environment does require the isolated FK fallback for empty-DB restores
- **LOCKED NEXT STEP:** keep runtime/docs aligned with the verified fallback path and avoid widening scope into a custom dependency-order restore planner
- **VERDICT:** PLAN UPDATED AND IMPLEMENTED — current branch has shipped slices 1, 2, and 3, with the remaining work now operational rollout rather than plan uncertainty.
