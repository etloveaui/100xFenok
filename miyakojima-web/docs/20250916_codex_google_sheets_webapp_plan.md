# 20250916 codex Google Sheets 실시간 연동 계획

## 개요
- 정적 GitHub Pages 기반인 miyakojima-web에서 Google Sheets 데이터를 *실시간에 가깝게* 반영하기 위한 접근입니다.
- 현재 앱은 data/*.json을 로컬에서 로드하며, 파이썬 스크립트로 수동 동기화 중입니다.
- 목표: Apps Script Web App을 백엔드로 두고 프런트엔드(DataService)가 직접 호출하도록 구조를 확장.

## 제안 아키텍처
1. **Apps Script Web App**
   - ackend/google-apps-script.js를 기반으로 doGet/doPost 엔드포인트 구성.
   - 응답은 현행 JSON 캐시 구조(pois, udget, itinerary, estaurants)와 동일하게 반환.
   - CORS: GitHub Pages 도메인(https://etloveaui.github.io/100xFenok/miyakojima-web/) 허용.
   - 간단 토큰 또는 서비스 계정 서명 검증으로 인증 처리.
2. **프런트엔드 수정**
   - js/services/data.js의 loadJSON 흐름을 etch(WEBSCRIPT_URL)로 확장.
   - 성공 시 캐시에 저장, 실패 시 기존 로컬 JSON fallback 유지.
   - 업로드(예산/일정 편집) 기능이 필요하면 POST 경로 추가하여 double-write(시트 + 로컬 캐시) 처리.
3. **환경 변수 관리**
   - Web App URL, 시크릿 키를 .env → 빌드 시 JS에 주입하거나 CONFIG에 안전하게 저장.
   - GitHub Pages 배포용 빌드 스크립트에서 공개 키 노출이 없도록 주의.

## 작업 단계 제안
1. Apps Script 프로젝트 생성 → Web App 배포 (develop 버전, 인증 방식 결정).
2. 응답 포맷을 맞추기 위한 DTO 설계 (DATA_INTEGRATION_COMPLETE.md 참고).
3. DataService에 fetch/timeout/retry 로직 추가, 로깅/에러 핸들링 정비.
4. QA: 오프라인/시간초과 시 fallback 정상 작동 확인, 캐시 전환이 seamless 한지 테스트.
5. 문서화: 엔드포인트 URL, 파라미터, 인증 방식, 장애 대응 플로우 정리.

## 향후 고려
- GitHub Actions 정적 동기화는 백업/레포 기록용으로 유지 (야간 배치).
- Sheets 구조 변경 시 DTO 업데이트를 즉시 반영할 수 있도록 docs/ 문서 갱신.
- 필요 시 App Script 로그/에러를 Slack 등으로 전달하는 모니터링 연동 검토.
