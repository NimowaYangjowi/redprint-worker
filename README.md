# Redprint Worker

Standalone worker that processes video transcode jobs and automated DB backups.

## Setup

1. Copy `.env.worker.example` to `.env.worker` and fill in credentials
2. Build and start:

```bash
docker compose up -d --build
```

3. Check logs:

```bash
docker logs -f redprint-worker
```

4. Stop:

```bash
docker compose down
```

## Update

After receiving new source files:

```bash
docker compose up -d --build
```

## Dry-Run Testing

Set `TRANSCODE_DRY_RUN=true` in `.env.worker` to test queue flow
without actual ffmpeg transcoding or R2 uploads.

## Monitor App (macOS 메뉴바)

`monitor-app/` 디렉토리에 Tauri 기반 macOS 메뉴바 모니터 앱이 포함되어 있다.

기능:
- Docker 컨테이너 상태 모니터링 (5초 폴링)
- DB에서 오늘 완료/실패 잡 통계 조회
- Docker compose 시작/중지 제어
- Redprint 레포 Git Auto-Pull (dev/main, 5분 폴링)

### 빌드

```bash
cd monitor-app
npm install
npm run build
```

빌드 결과: `src-tauri/target/release/bundle/macos/Transcode Monitor.app`

### 개발

```bash
cd monitor-app
npm run dev
```

### 구조

```
monitor-app/
├── src/index.html              # 프론트엔드 (순수 HTML/CSS/JS)
└── src-tauri/src/
    ├── main.rs                 # 앱 초기화, 폴링 루프
    ├── config.rs               # 설정 (.env.worker, config.json)
    ├── docker.rs               # Docker 컨테이너 관리
    ├── db.rs                   # PostgreSQL 잡 통계
    ├── git.rs                  # Git Auto-Pull
    └── tray.rs                 # 시스템 트레이 + 팝업
```

> `menubar-app/`은 이전 Electron 버전으로, `monitor-app/`(Tauri)으로 대체되었다.
