# Redprint Worker

레드프린트 워커는 세 가지를 함께 담고 있는 저장소입니다.

- 트랜스코드 잡 처리 워커
- 자동 DB 백업 + restore verification 파이프라인
- macOS 메뉴바 상태판

쉽게 말해:
- 영상 작업을 처리하는 백그라운드 기계가 있고
- 백업 상자를 만들고 다시 열어보는 백업 기계가 있고
- 운영자가 메뉴바에서 상태를 보는 작은 상태판도 같이 있습니다.

## Quick Start

1. `.env.worker.example`을 `.env.worker`로 복사
2. 필요한 환경변수 채우기
3. 실행:

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

## Common Commands

워커 실행:

```bash
npm start
```

bootstrap schema 재생성:

```bash
npm run export:bootstrap-schema
```

verify-backup rollout 준비 점검:

```bash
npm run backup:rollout:preflight
```

verify-backup rollout smoke:

```bash
npm run backup:rollout:smoke
```

## Read Next

루트 README는 얇은 입구만 맡고, 자세한 설명은 `docs/`에 둡니다.

- 문서 입구: [docs/README.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/README.md)
- 전체 큰 지도: [docs/ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
- 실행/운영 런북: [docs/OPERATIONS.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/OPERATIONS.md)
- 메뉴바 상태판 구조: [docs/MONITOR_APP.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/MONITOR_APP.md)
- Railway verify DB 운영: [docs/backup/railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
- schema 변경 시 verify DB 운영: [docs/backup/verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)

## Monitor App

`monitor-app/`은 macOS 메뉴바 상태판입니다.

사용자가 보는 것:
- 워커가 살아 있는지
- 오늘 완료/실패 잡 수
- 메뉴바 백업 상태 카드
- Git Auto-Pull 상태 카드

참고:
- `monitor-app/`이 현재 유지보수 대상이자 유일한 데스크톱 메뉴바 앱입니다
- 개발/빌드/데이터 흐름은 [docs/MONITOR_APP.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/MONITOR_APP.md)에서 설명합니다
- 현재 백업/verify DB 관련 실행 계획은 [tasks/db-backup/README.md](/Users/jiwoo/Downloads/projects/transcode-worker/tasks/db-backup/README.md)에도 정리돼 있습니다
