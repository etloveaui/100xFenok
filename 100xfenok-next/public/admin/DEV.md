# Admin Panel - DEV.md

> 관리자 패널 기능별 개발 메모
> 생성일: 2025-12-01

---

## Purpose

사이트 관리 기능을 위한 숨겨진 관리자 패널.
일반 사용자에게 노출되지 않으며, 인증된 사용자만 접근 가능.

---

## Folder Structure

```
admin/
├── DEV.md           ← This file
├── shared/          ← ★ Unified shared modules (NEW 2026-01-20)
│   ├── config/      # ManifestLoader
│   ├── core/        # CacheManager, DataManager, Formatters
│   ├── ui/          # StatusCard
│   └── validators/  # FreshnessChecker v2.1.0, SchemaValidator
├── valuation-lab/   ← Valuation analysis tools
├── data-lab/        ← Data management dashboard
├── design-lab/      ← Design experiments
└── market-radar/    ← Combo/sentiment admin surface; detailed charts live under tools/macro-monitor
    └── charts/      ← admin gallery/remap only
```

> **shared/ Details**: See `admin/shared/README.md`

---

## 진입 방식

The legacy root admin shell, Apps Script API test page, and GA stats page were
retired on 2026-07-08. Use the authenticated Next admin hub at `/admin`.

---

## 인증 로직

Current admin access is owned by the Next.js admin session gate. Do not restore
the retired static root shell as an auth entry point.

---

## Apps Script 연동

### 스프레드시트
- **이름**: `100xFenok_Data`
- **시트**: `Config` (설정값 저장용)

### Apps Script 웹앱
- **이름**: `100xFenok_API`
- **배포**: 웹앱 (누구나 접근 가능, 익명 실행)

### API 엔드포인트

| Action | Method | 설명 |
|--------|--------|------|
| `ping` | GET | 연결 확인 |
| `read` | GET | 시트 데이터 읽기 |
| `write` | POST | 행 추가 |

### 확장 가능 기능
- 특정 셀/범위 읽기/쓰기
- 트리거 (자동화, 스케줄링)
- 외부 API 호출 (크롤링)
- 이메일/알림 발송

---

## Quick Actions

| 기능 | 상태 | 설명 |
|------|------|------|
| Telegram 알림 | ✅ 완료 | 기존 페이지 연결 |
| API Test | 🧹 retired | 2026-07-08 root admin cleanup |
| Market Radar | ✅ 완료 | S&P 500, NASDAQ 차트 (MA 토글, 스마트 기간 선택) |
| 설정 | ⏳ 예정 | Coming soon |

---

## UI/UX

- **테마**: 밝은 테마 (사이트 전체 톤 통일)
- **반응형**: 모바일 대응
- **카드 레이아웃**: Quick Actions 카드형 배치

---

## Phase Checklist

### Phase 1: 기본 구현 ✅ 완료 (2025-12-01)
- [x] 진입점 구현 (alive 클릭)
- [x] 비밀번호 인증 (SHA-256)
- [x] 대시보드 UI
- [x] Telegram 연결
- [x] API Test 페이지 (retired 2026-07-08)

### Phase 2: 확장 (대기)
- [ ] 설정 페이지
- [x] 데이터 관리 UI (Data Lab 기본 구조)
- [x] Valuation Lab 확장 섹션
- [ ] 로그 뷰어

---

## Known Issues

- (현재 없음)

---

## 정리 이력

### Banking Health 섹션 삭제 (2025-12-11)
- **이유**: index.html로 배포 완료 → Admin 개발용 섹션 불필요
- **삭제 항목**:
  - Dev Pages: Banking Health 링크
  - Current Widget: iframe 프리뷰
  - Widget Prototype Comparison: 4개 프로토타입 비교
  - postMessage 데이터 전달 스크립트

---

## Change Log

### 2026-06-15: Option C hardening + one-turn transcript-lag fix + KO-first STT
- Adversarial re-audit (Codex) of the Option C empty-attemptText patch found 5 latent risks; hardened all: empty-only override (on mismatch KEEP the model args instead of regressing to bad STT), clear transcript FIFO on resetRuntime + before SYSTEM_KICKOFF, move the helper consume after all cancellation guards, and flush the buffered transcript only on turnComplete. Control intents (`next_material`/`easier`/`harder`/`switch_theme`/`stop`) skip override.
- Owner smoke (`mqemm0x5`, hardened build) confirmed the English card reveals, but telemetry exposed a one-turn transcript lag: `mLen` matched the current utterance while `tLen` matched the previous one, because the client enqueued transcripts only on `turnComplete` though `coachTurn` usually arrives first. Fixed: the client now passes the current turn's pending transcript and the helper prefers a non-blank `currentPendingTranscript` over the finalized FIFO (`consumedCurrentPending` + `source=current-pending|finalized-fifo|none` telemetry).
- STT: the Mona profile `languageHints` were `en-US,ko-KR`, which made native-audio mis-hear Korean as Indonesian/Spanish/German; switched to `ko-KR,en-US` (server + client fallback). English repeats stay clear under the en-US fallback. Real Korean-STT quality must be confirmed on the owner device mic.
- Added a TTS-injection smoke harness (`probe-gemini-live-stall.ts --post-tts-text`, macOS say -> PCM16 16k). It currently carries only `mona-show-card` + a minimal setup, so it does NOT yet exercise the full `coachTurn` flow and an initial run returned `events=0`/`sawSetupComplete=false`; extending it to the real coach setup is pending (Codex). Owner device mic remains the acceptance gate.
- Commits: `7f8e18386` (lag + KO-first STT), `e649f03ac` (TTS harness). Earlier this series: `dc0cd5e2` (Option C), `425c26ec8` (hardening).

### 2026-06-14: Mona coach v3 — empty-attemptText guard + English-reveal classifier
- Live owner smoke (mqdunt24) showed the English sentence never revealing on the card. Root cause split in two: the deployed build lacked the "show English" intent classifier, and the live model could fire `coachTurn` with empty/garbled `attemptText`.
- Server FSM (`session-machine.ts`): added a classifier so an English-card/answer request maps to `repeat_target` -> reveal card carrying `en`.
- Client Option C (`AdminLiveBench.tsx` + `lib/admin-live/coach-turn-args.ts`): client caches final input transcripts (monotonic id, consume-once guard) and patches an empty/mismatched `coachTurn` `attemptText` via `resolveCoachTurnArgsForTranscript`, so the server grades Mona's actual recognized words instead of a blank attempt. Sanitized telemetry (override/skip reason + lengths) logged for the next smoke.
- Reference: `data/voice-logs/owner-test/2026-06-14_mona_live-mona-mqdunt24.json`

> Details: `docs/CHANGELOG.md`

### 2026-01-21: Momentum Dashboard Syntax Error Fix (ROOT CAUSE)
- Fixed: Line 12 Tailwind config missing closing brace
- 11 closing braces → 12 (now matches 12 opening braces)
- Entire JavaScript now executes (line 196-597)
- Reference: CHANGELOG.md, BACKLOG #185

### 2026-01-21: Momentum Dashboard Tab Switch Bug Fix
- Fixed: Tab UI changes but table data doesn't update
- Added try-catch error isolation in render() function (line 287-293)
- Each render function now executes independently
- Reference: CHANGELOG.md, BACKLOG #184

### 2026-01-20: Data Lab Bug Fix + Localization
- Fixed: Details panel click not working (function clickHandler support)
- Korean localization: index.html, status-card.js, renderer.js

### 2026-07-07: Notification Control retired
- Legacy GitHub Pages notification panel, hourly notification index workflow, and Telegram helper scripts were retired with the root SPA cleanup.
- Public admin navigation now omits the removed notification control entry.
- Reference: GitHub Pages retirement cleanup

### 2026-04-14: Embed shell mode for legacy admin iframes
- Added `?embed=1` handling to `admin/data-lab/index.html` and `admin/market-radar/index.html`
- In embed mode, legacy header/footer stay hidden so Next.js outer shell is the only visible navigation/footer
- Reference: #269 Next.js Shell Duplication Fix

### 2026-01-20: Unified Shared Modules
- Created `admin/shared/` folder with 7 modules
- CacheManager: Added `setPrefix()` for multi-lab support
- DataManager: Added `loadFromManifest()` for dynamic loading
- Modules shared between Data Lab and Valuation Lab
- Reference: `admin/shared/README.md`
