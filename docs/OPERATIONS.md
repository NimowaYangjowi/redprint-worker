# Operations Runbook

이 문서는 이 저장소를 실제로 돌리고 확인하는 운영 런북입니다.

쉽게 말해:
- 워커를 어떻게 켜고 끄는지
- 로그는 어디서 보는지
- 백업 rollout helper는 언제 쓰는지
- macOS에서 자동 실행은 어떻게 거는지
를 모아둔 실전 사용 설명서입니다.

## First Read

큰 구조를 먼저 보고 싶다면:
- [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)

메뉴바 상태판 자체 설명이 필요하면:
- [MONITOR_APP.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/MONITOR_APP.md)

## Required Files

운영 전에 보통 필요한 것은 아래입니다.

- `.env.worker`
  워커와 백업 파이프라인이 읽는 환경변수 파일
- [docker-compose.yml](/Users/jiwoo/Downloads/projects/transcode-worker/docker-compose.yml)
  워커 컨테이너 실행 정의
- [scripts/transcode-worker.ts](/Users/jiwoo/Downloads/projects/transcode-worker/scripts/transcode-worker.ts)
  워커 프로세스 진입점

쉽게 말해:
- `.env.worker`는 준비물 목록
- `docker-compose.yml`은 기계를 켜는 스위치 설명서
- `scripts/transcode-worker.ts`는 실제 출발 버튼입니다.

## Start And Stop The Worker

워커 컨테이너 실행:

```bash
docker compose up -d --build
```

로그 보기:

```bash
docker logs -f redprint-worker
```

중지:

```bash
docker compose down
```

사용자 관점에서 보면:
- 워커가 켜지면 메뉴바 상태판의 상단 상태 점과 오늘 완료/실패 숫자가 움직이기 시작합니다.
- 워커가 꺼지면 메뉴바 상태판의 시작/중지 버튼 중 "시작" 버튼이 다시 쓸 수 있는 상태가 됩니다.

## Daily Operator Commands

가장 자주 쓰는 명령은 아래입니다.

```bash
npm start
npm test
npm run backup:rollout:preflight
npm run backup:rollout:status
npm run backup:rollout:smoke
npm run backup:run-once
```

각 명령의 의미:

- `npm start`
  Docker 없이 직접 워커 루프를 띄울 때 사용
- `npm test`
  백업/rollout helper 테스트 포함 전체 테스트 실행
- `npm run backup:rollout:preflight`
  배포 전에 verify DB와 필수 칼럼 준비물을 읽기 전용으로 점검
- `npm run backup:rollout:status`
  터미널에서 현재 백업 상태를 운영자 시점으로 읽어보기
- `npm run backup:rollout:smoke`
  rollout 뒤 한 번 실제 verified backup 흐름을 검증
- `npm run backup:run-once`
  스케줄을 기다리지 않고 백업 한 번을 바로 실행

쉽게 말해:
- `preflight`는 시험 보기 전 준비물 검사
- `status`는 점원이 붙인 상태 스티커 읽기
- `smoke`는 실제로 한 번 돌려보는 리허설
- `run-once`는 알람 시간 기다리지 않고 직접 버튼 누르기입니다.

## launchd Automation On macOS

macOS에서 로그인 시 worker를 자동으로 켜고 싶다면:

```bash
./ops/register-launchd.sh
```

해제:

```bash
./ops/unregister-launchd.sh
```

관련 파일:

- [register-launchd.sh](/Users/jiwoo/Downloads/projects/transcode-worker/ops/register-launchd.sh)
- [unregister-launchd.sh](/Users/jiwoo/Downloads/projects/transcode-worker/ops/unregister-launchd.sh)

생기는 로그:

- `worker-launchd.log`
- `worker-launchd.err.log`

쉽게 말해:
- 맥이 켜질 때 자동으로 워커 기계를 올리는 예약 스위치라고 생각하면 됩니다.

## Monitor App Build And Dev

메뉴바 상태판 개발:

```bash
cd monitor-app
npm run dev
```

배포용 앱 빌드:

```bash
cd monitor-app
npm run build
```

출력물:
- `monitor-app/src-tauri/target/release/redprint-monitor`
- `monitor-app/src-tauri/target/release/bundle/dmg/Redprint Monitor_<version>_aarch64.dmg`

메뉴바 앱이 무엇을 보여주는지는:
- [MONITOR_APP.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/MONITOR_APP.md)

## Where To Look When Something Is Wrong

워커가 안 도는 것 같으면:
- `docker ps`
- `docker logs -f redprint-worker`
- `.env.worker`의 `DATABASE_URL`, `TRANSCODE_PIPELINE_ENABLED`

백업 카드가 초록불이 아니면:
- `npm run backup:rollout:status`
- [railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
- [verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)

메뉴바 앱이 데이터가 비어 보이면:
- 워커 컨테이너 상태 확인
- `.env.worker`의 `DATABASE_URL` 확인
- 메뉴바 앱의 DB 연결 로그 확인

쉽게 말해:
- 문제를 보면 먼저 "기계가 꺼졌는지"
- 다음으로 "DB 주소가 맞는지"
- 마지막으로 "상태판이 그 기계를 제대로 읽고 있는지" 순서로 보면 됩니다.
