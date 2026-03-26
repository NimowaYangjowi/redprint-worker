# DB Backup Planning Docs

이 폴더는 레드프린트 DB 백업/복원 작업 관련 플래닝 문서를 한곳에 모아둔 곳입니다.

문서 순서:

1. `phase-0-design.md`
   초기 문제 정의와 접근 방식 비교 문서입니다.
   쉽게 말해 "왜 백업이 필요한지, 가장 작은 첫 버전은 무엇인지"를 정한 설계 초안입니다.
   구현 기준으로는 더 이상 최신이 아닙니다.

2. `phase-1-eng-review-test-plan-initial.md`
   초기에 잡았던 엔지니어링 테스트 플랜입니다.
   쉽게 말해 "기존 백업 기능을 어떤 항목으로 검사할지"를 적어둔 첫 점검표입니다.

3. `phase-2-eng-review-test-plan-verified-restore.md`
   verified restore 방향을 잡은 최신 테스트 체크리스트입니다.
   쉽게 말해 "R2에 올린 백업 파일을 다시 읽어 verify DB라는 연습장 DB에 실제로 복원 검증까지 통과해야만 성공으로 인정한다"는 점검표입니다.

4. `phase-3-implementation-plan-verified-backup.md`
   현재 기준 구현 source of truth입니다.
   쉽게 말해 "무엇을 어떤 규칙으로 바꾸고, success를 어떤 뜻으로 다시 정의하는지"를 한 장에 모은 구현 계약서입니다.
   현재 브랜치 기준으로는 Slice 1/2/3 구현과 빈 DB 복구 훈련 결과까지 반영된 최신 상태판 역할도 합니다.

5. `phase-4-rollout-checklist.md`
   운영 rollout 체크리스트입니다.
   쉽게 말해 "이제 각 환경에 어떤 순서로 migration, worker, monitor app을 배포해야 하는지"를 적어둔 실행 순서표입니다.
   `npm run backup:rollout:preflight`, `npm run backup:run-once`, `npm run backup:rollout:status`, `npm run backup:rollout:smoke` 같은 rollout helper 명령도 이 문서를 기준으로 사용합니다.

정리 원칙:

- 문서가 500줄을 넘으면 phase별 파일로 분리합니다.
- 현재 이 폴더의 문서들은 모두 500줄 미만이라 추가 분리는 하지 않았습니다.
- 구현 기준은 `phase-3-implementation-plan-verified-backup.md`를 우선합니다.
- `phase-0-design.md`는 배경 설명용, `phase-2-eng-review-test-plan-verified-restore.md`는 QA 체크리스트용으로 봅니다.
- 실제 배포 순서는 `phase-4-rollout-checklist.md`를 따릅니다.
- 현재 남은 일은 큰 설계 검토가 아니라, 각 환경에서 `scripts/migrate-backup-logs.sql`을 먼저 적용한 뒤 새 worker/monitor build를 배포하는 운영 rollout입니다.
