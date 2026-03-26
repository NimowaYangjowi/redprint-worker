# Docs

이 폴더는 레드프린트 워커의 운영/설계 문서를 모아둔 곳입니다.

루트 README는 얇은 입구만 맡고, 자세한 설명은 여기서 찾습니다.

## Recommended Reading Order

1. [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
   저장소 전체 큰 그림.
   쉽게 말해 "이 프로젝트 안에 어떤 기계들이 있고 서로 무엇을 주고받는지"를 먼저 보는 지도입니다.

2. [OPERATIONS.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/OPERATIONS.md)
   실행/중지/로그/launchd/runbook 문서.
   쉽게 말해 "운영자가 오늘 실제로 어떤 명령을 치면 되는지"를 적어둔 실전 설명서입니다.

3. [MONITOR_APP.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/MONITOR_APP.md)
   macOS 메뉴바 상태판 구조 문서.
   쉽게 말해 "사용자가 메뉴바에서 보는 카드가 어디서 어떤 데이터를 읽는지"를 설명합니다.

## Backup Docs

- [backup/railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
  Railway verify DB를 실제로 만들고 매일 어떻게 돌리는지 설명.
  쉽게 말해 "연습장 DB를 처음 어떻게 준비하고, 매일 백업 상자를 어떻게 열어보는지"를 설명하는 운영 문서입니다.

- [backup/verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)
  메인 DB schema 변경 시 verify DB를 어떻게 같이 운영할지 설명.
  쉽게 말해 "진짜 가게 구조를 바꿀 때 연습장 가게 구조도 어떻게 같이 맞추는지"를 설명하는 배포 순서표입니다.

## Planning Docs

- [tasks/db-backup/README.md](/Users/jiwoo/Downloads/projects/transcode-worker/tasks/db-backup/README.md)
  백업/복원 rollout의 플래닝 문서 입구.
  쉽게 말해 "왜 이런 구현을 택했고, 어떤 순서로 rollout하기로 했는지"를 보는 기록 묶음입니다.
