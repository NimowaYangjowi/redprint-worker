# Docs

이 폴더는 레드프린트 워커의 운영/설계 문서를 모아둔 곳입니다.

문서 구성:

- [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
  워커 전체 구조 설명.
  쉽게 말해 "이 저장소 안의 백업 기계, 트랜스코드 기계, 메뉴바 상태판이 어떻게 연결되는지"를 설명하는 큰 지도입니다.

- [backup/railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
  Railway verify DB를 실제로 만들고 매일 어떻게 돌리는지 설명.
  쉽게 말해 "연습장 DB를 처음 어떻게 준비하고, 매일 백업 상자를 어떻게 열어보는지"를 설명하는 운영 문서입니다.

- [backup/verify-db-schema-ops.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/verify-db-schema-ops.md)
  메인 DB schema 변경 시 verify DB를 어떻게 같이 운영할지 설명.
  쉽게 말해 "진짜 가게 구조를 바꿀 때 연습장 가게 구조도 어떻게 같이 맞추는지"를 설명하는 배포 순서표입니다.
