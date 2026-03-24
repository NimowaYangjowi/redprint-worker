# TODOS

## P2: Backup monitoring alert

**What:** "백업 안 됨" alert — 25시간 이상 백업 없으면 알림 발송.

**Why:** 현재 백업 실패 시 콘솔 로그만 남음. 로그를 안 보면 백업이 며칠째 안 되는지 모름.

**Context:** Slack webhook 또는 이메일로 알림. R2에서 마지막 백업 시간을 조회하여 25시간 초과 시 트리거. 모니터 앱 통합도 고려.

**Effort:** S (human) → S (CC)
**Depends on:** 백업 시스템 구현 완료

---

## P3: Dual backup strategy (Railway failure domain mitigation)

**What:** R2 외에 별도 스토리지(예: B2, GCS)에 주 1회 추가 백업.

**Why:** R2와 Railway가 동시에 문제될 가능성은 낮지만, 금융 데이터의 경우 단일 클라우드 의존은 리스크. 다른 failure domain에 복사본을 두면 재앙 수준 장애에도 복구 가능.

**Context:** 주 1회 정도면 충분. 기존 R2 백업에서 가장 최근 파일을 다운로드 → 다른 스토리지에 업로드하는 방식으로 구현 가능. 비용 미미.

**Effort:** M (human) → S (CC)
**Depends on:** 백업 시스템 구현 완료

---

## P3: Existing code test expansion

**What:** r2-client, scheduler, runner 등 기존 코드에 테스트 추가.

**Why:** 현재 테스트가 전혀 없음. 백업 모듈에 vitest를 도입하면서 기존 모듈도 점진적으로 커버리지 확보 필요.

**Context:** vitest 세팅이 완료되면 기존 모듈도 테스트 작성 가능. 우선순위: r2-client (백업과 공유) > scheduler > runner.

**Effort:** M (human) → S (CC)
**Depends on:** vitest 세팅 완료
