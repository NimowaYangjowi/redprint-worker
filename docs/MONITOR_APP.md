# Monitor App

이 문서는 `monitor-app/` 메뉴바 상태판의 구조를 설명합니다.

쉽게 말해:
- 사용자가 메뉴바에서 실제로 보는 카드가 무엇인지
- 그 카드가 어떤 데이터로 채워지는지
- 개발자가 어디를 고쳐야 화면과 동작이 바뀌는지
를 설명하는 문서입니다.

## What The Operator Sees

메뉴바 상태판은 크게 네 덩어리입니다.

1. 워커 상태 헤더
   워커가 실행 중인지, 처리 중인지, 찾을 수 없는지 보여줍니다.
2. 현재 잡 + 오늘 통계
   지금 처리 중인 작업과 오늘 완료/실패 수를 보여줍니다.
3. DB 백업 카드
   최신 백업이 실행 중인지, 검증 중인지, 검증 완료인지, 실패인지 보여줍니다.
4. Git Auto-Pull 카드
   `dev`와 `main` 브랜치의 자동 pull 상태와 수동 pull 버튼을 보여줍니다.

쉽게 말해:
- 위쪽은 "워커 기계가 지금 살아 있나"
- 가운데는 "오늘 얼마나 일했나"
- 아래쪽은 "백업 상자가 진짜 복원 검증까지 통과했나"
- 마지막은 "관련 앱 저장소를 자동으로 최신 상태로 맞추고 있나"
를 보는 화면입니다.

## Build And Dev

개발:

```bash
cd monitor-app
npm run dev
```

배포 빌드:

```bash
cd monitor-app
npm run build
```

핵심 설정 파일:

- [monitor-app/package.json](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/package.json)
- [tauri.conf.json](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/tauri.conf.json)

## Frontend And Backend Split

프론트엔드 화면:
- [index.html](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src/index.html)

Rust 백엔드:
- [main.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/main.rs)
- [docker.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/docker.rs)
- [db.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/db.rs)
- [git.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/git.rs)
- [tray.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/tray.rs)
- [config.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/config.rs)

역할 분리:

- `index.html`
  사용자가 눈으로 보는 카드, 버튼, 토스트, 상태 문구
- `main.rs`
  앱 시작, 공용 상태 저장, 주기 폴링 시작
- `docker.rs`
  시작/중지 버튼이 실제로 Docker를 제어하는 계층
- `db.rs`
  오늘 완료/실패 수와 백업 카드 데이터를 읽는 계층
- `git.rs`
  Git Auto-Pull 카드가 보는 브랜치 동기화 계층
- `tray.rs`
  메뉴바 아이콘과 팝업 열기/닫기 동작
- `config.rs`
  이 앱이 어느 프로젝트와 어느 Git 저장소를 읽을지 결정하는 설정 계층

쉽게 말해:
- HTML은 사용자에게 보이는 종이판
- Rust 코드는 뒤에서 실제 기계, DB, Git를 읽어오는 점원입니다.

## Polling And Data Sources

현재 상태판은 아래 주기로 데이터를 갱신합니다.

- Docker + DB 상태: 5초마다
- Git Auto-Pull: 5분마다

데이터 출처:

- Docker 컨테이너 상태
  `docker inspect`로 `redprint-worker` 상태를 읽음
- 작업 통계
  `media_transcode_jobs`에서 오늘 완료/실패 수와 현재 처리 중 잡을 읽음
- 백업 카드
  `backup_logs`에서 최신 백업, 최신 검증 성공 백업, 최근 히스토리를 읽음
- Git 카드
  대상 저장소의 `dev`/`main`을 비교해 최신 여부, pull 여부, 오류를 읽음

사용자 관점에서 보면:
- 헤더 불빛과 버튼은 Docker 상태
- 오늘 완료/실패 숫자는 PostgreSQL
- 백업 카드의 `검증 중`, `정상`, `실패` 문구는 `backup_logs`
- Git 카드의 `최신 상태`, `방금 Pull됨`은 Git 비교 결과입니다.

## Backup Card Contract

백업 카드는 아래 이야기를 보여줍니다.

- `running`
  아직 백업 파일을 만드는 중
- `verifying`
  파일은 올라갔고 verify DB에 다시 부어보는 중
- `verified`
  restore verification까지 통과
- `legacy`
  업로드는 성공했지만 현재 기준 복원 검증 정보가 없는 옛 기록
- `failed`
  백업 또는 검증 중 실패

중요한 약속:

- 초록불은 업로드 성공이 아니라 restore verification 성공일 때만 켜집니다.
- 그래서 운영자가 메뉴바에서 보는 "정상"은 진짜로 다시 열어본 백업이라는 뜻입니다.

## Git Auto-Pull Contract

Git 카드는 별도 Git 저장소를 읽습니다.

기본 규칙:

- `gitProjectDir`가 있으면 그 경로를 우선 사용
- 없으면 `transcode-worker` 옆의 `Redprint/.git`를 찾음
- 그것도 없으면 `~/Downloads/projects/Redprint`를 기본값으로 사용

사용자 관점에서 보면:
- 이 카드는 현재 저장소가 아니라, 같이 운영하는 다른 앱 저장소의 `dev`와 `main`을 자동으로 최신화하는 보조 패널입니다.

## Config And Defaults

메뉴바 앱은 `config.json`을 읽어 경로를 결정할 수 있습니다.

설정 키:

- `projectDir`
  워커 프로젝트 루트 경로
- `gitProjectDir`
  Git Auto-Pull 대상 저장소 경로

코드 기준 기본값:

- 워커 프로젝트 기본값: `~/Downloads/projects/transcode-worker`
- 컨테이너 이름: `redprint-worker`
- env 파일: `.env.worker`

즉:
- 앱을 별도 설정 없이 열면 기본적으로 이 저장소의 워커와 `.env.worker`를 읽으려 합니다.

## Important Files When Editing The App

화면 문구나 카드 레이아웃을 바꾸려면:
- [index.html](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src/index.html)

트레이 아이콘이나 팝업 위치를 바꾸려면:
- [tray.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/tray.rs)
- [generate-tray-icons.js](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/generate-tray-icons.js)

Docker 시작/중지 동작을 바꾸려면:
- [docker.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/docker.rs)

백업 카드 데이터 규칙을 바꾸려면:
- [db.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/db.rs)
- [scripts/backup-rollout-status.ts](/Users/jiwoo/Downloads/projects/transcode-worker/scripts/backup-rollout-status.ts)

Git 카드 동작을 바꾸려면:
- [git.rs](/Users/jiwoo/Downloads/projects/transcode-worker/monitor-app/src-tauri/src/git.rs)

## Related Docs

- 큰 구조: [ARCHITECTURE.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/ARCHITECTURE.md)
- 운영 런북: [OPERATIONS.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/OPERATIONS.md)
- verify DB 운영: [railway-verify-db.md](/Users/jiwoo/Downloads/projects/transcode-worker/docs/backup/railway-verify-db.md)
