# Miyakojima Web – AGENT Handbook

## 📌 Mission Summary
- 목표: 여자친구에게 선물할 완벽한 미야코지마 여행 동반자 앱 (Vanilla HTML/CSS/JS 기반).
- 현재 버전: `v2.3.0-Complete`, 런타임은 정적 리소스를 로컬/배포 환경에서 직접 서빙.
- 디자인 시스템 리팩터링은 Claude가 주도(claudedocs 참고); 나는 런타임 안정화/데이터 파이프라인에 집중.

## ⚙️ Runtime Flow
- `index.html` → `<script type="module" src="js/main.js">` → `safeInitialize()`가 CONFIG · DataService · App 순서로 초기화.
- `App`(`js/app-new.js`)은 각 매니저 초기화를 `loadModulesSafely()`에서 병렬 처리하고 `modules` 맵에 등록.
- Google Maps는 `<script ... callback=initGoogleMaps>`가 로드된 뒤 `window.app.googleMapsManager.initialize()`를 호출하므로, `App` 인스턴스 내 `googleMapsManager`를 반드시 유지해야 함.
- D-Day · 로딩 화면 등 글로벌 UI는 `js/main.js`에서 직접 DOM을 다루니, 변경 시 여기부터 확인.

## 🧩 Core Modules
- 데이터 계층: `js/services/data.js` (POI/예산/일정/맛집 JSON 로딩 + 캐시/재시도 + 목업).
- 기능 매니저: `js/modules/` (예: `poi.js`, `budget.js`, `weather-widget.js`, `location-ui.js`). 각 모듈은 `initialize()`로 UI 바인딩.
- 지도: `js/maps.js` → `GoogleMapsManager` (마커·경로·Places); App에서 싱글턴으로 관리.
- 위치: `js/services/location.js` (Geolocation watch, 구독/알림) + `js/modules/location-ui.js` (권한 UI).

## 🌐 Integrations
- Google Maps JS API: `index.html` 끝부분에서 async 로드, Referer 화이트리스트 필수 (`REMAINING_TASKS.md` 참고).
- OpenWeather API: `js/config.js`/`js/modules/weather.js`에 키가 하드코딩 → `.env` 분리 예정.
- Google Sheets 동기화: `download_from_sheets.py`, `upload_to_sheets.py`, `backend/google-apps-script.js`.
- 로컬 테스트는 `python -m http.server 8080` 등 정적 서버로 수행 (서비스 워커가 있으니 `http` 경로 권장).

## 🚨 Current Risks & Fix Log
- ✅ (2025-09-16) `window.app.googleMapsManager` 누락으로 Maps 콜백 실패 → `App`에서 싱글턴 유지하도록 수정.
- ✅ (2025-09-16) Weather 서비스가 2차 호출에서 데이터 미반환 → `initialize(force)` 패턴과 주기적 타이머 정비.
- ✅ (2025-09-16) D-Day가 UTC 기준으로 하루 어긋나던 문제 → 현지 자정 기준 계산으로 보정.
- ⚠️ Google Maps `RefererNotAllowedMapError` 해결을 위해 GCP 콘솔 도메인 허용 필요.
- ⚠️ API 키 노출 상태 → 배포 전 `.env`/빌드 파이프라인 정리.
- ⚠️ 디자인/CSS 대수술 Phase는 Claude 진행; 충돌 피하려면 `claudedocs/` 단계 계획 확인 후 작업.

## 🛠 Workflow Tips
- 콘솔 오류는 `safeInitialize` 단계(Progress UI 업데이트 포함)에서 먼저 확인; 모듈 실패는 warning 으로 로깅됨.
- 새 모듈 추가 시 `App.loadModulesSafely()`에 등록하고 `modules` 맵을 통해 다른 모듈과 통신.
- 위치/지도 기능은 브라우저 권한·HTTPS 요구 → 로컬 테스트 시 `localhost` 도메인 사용.
- 장시간 세션용 자동화 도구는 `automation/` 참고 (`checkpoint-manager.js`, `session-recovery.js`).

## 📚 Reference Material
- 프로젝트 개요: `PROJECT_DNA.md`, `MASTER_PLAN.md`.
- 진행 상황/이슈: `REMAINING_TASKS.md`, `PROGRESS_UPDATE_20250916.md`.
- Claude 디자인 플랜: `claudedocs/1단계_디자인_체크리스트.md`, `claudedocs/Agent_작업_계획서.md`.
- 데이터 사양: `DATA_INTEGRATION_COMPLETE.md`, `sheets_config.py`.

## 🔄 Maintenance Notes
- 본 문서는 에이전트 협업을 위한 스냅샷이므로, 런타임 플로우/핵심 이슈가 바뀌면 즉시 업데이트.
- 새 API 통합, 빌드 스크립트, 대규모 리팩터링 착수 시 "Runtime Flow"와 "Risks" 섹션에 반영.
- 수정 이력은 날짜와 결과(✅/⚠️)로 표기해 추적성 유지.