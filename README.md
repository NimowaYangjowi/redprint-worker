# Redprint Worker

레드프린트 워커는 두 가지를 담당합니다.

- 트랜스코드 잡 처리
- 자동 DB 백업 + restore verification

쉽게 말해:
- 영상 작업을 처리하는 백그라운드 기계이면서
- 백업 상자를 만들고, 다시 열어보는 백업 기계이기도 합니다.

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

## Docs

짧게 시작하고, 자세한 내용은 `docs/`를 봅니다.

- 문서 입구: [docs/README.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/README.md)
- 전체 구조: [docs/ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
- Railway verify DB 운영: [docs/backup/railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
- schema 변경 시 verify DB 운영: [docs/backup/verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)

## Monitor App

`monitor-app/`은 macOS 메뉴바 상태판입니다.

사용자가 보는 것:
- 워커가 살아 있는지
- 오늘 완료/실패 잡 수
- 메뉴바 백업 상태 카드

빌드:

```bash
cd monitor-app
npm install
npm run build
```

개발:

```bash
cd monitor-app
npm run dev
```

참고:
- `monitor-app/`이 현재 유지보수 대상입니다
- `menubar-app/`은 이전 Electron 버전 로컬 보관본입니다
- 현재 백업/verify DB 관련 실행 계획은 [tasks/db-backup/README.md](/Users/jiwoo/Downloads/projects/transcode-worker/tasks/db-backup/README.md)에도 정리돼 있습니다
