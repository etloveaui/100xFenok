# FED Monitor 실행 계획 v1 (개요)

이 문서는 페이즈 인덱스입니다. 세부 계획은 각 Phase 문서를 참조하세요.

## 전체 목표
- IORB < SOFR 여부를 즉시·직관적으로 알림(최우선)
- 보조 신호: IORB−SOFR 스프레드(bp), 월말/월초 완충, RRP/TGA/지급준비금, M2
- 사이트 톤과 일관된 UI로 위젯/상세/문서의 흐름 정리
- 모바일 가독성 최적화: 소형 화면에서 2열 그리드 유지, 네 가지 카드 모두 노출, 터치 타겟/간격/대비 확보
- 위젯 최소화(핵심 신호 중심): 카드 2개(IORB·SOFR) + 헤더 스프레드 칩으로 정보 집중화(Phase 1 전환)

## 상태 규칙 v2 (요약)
- GREEN: 정상(IORB > EFFR > SOFR) & 스프레드 > 15bp
- YELLOW: 정상 & ≤ 15bp
- ORANGE: ≤ 5bp 또는 월말/월초 완충 구간
- RED: IORB ≤ SOFR(역전)

## 데이터 시리즈(FRED)
- IORB(IORB), EFFR(DFF), SOFR(SOFR), ON RRP(RRPONTSYD)
- TGA(WDTGAL), 지급준비금(WRBWFRBL), M2(M2SL/WM2NS)
- 공통 엔드포인트: https://api.stlouisfed.org/fred/series/observations

## 문서/메뉴 개요
- 위젯(홈 카드) → 상세(모니터) → 설명(문서/블로그)
- 상단 메뉴: "Insights" (기존 “분석” 대체, Phase 3에서 반영)

## Phase 인덱스
- Phase 1 — 핵심 알림/안정화: `tools/fed/phases/PHASE1.md`
- Phase 2 — 지표 확장/차트 보강: `tools/fed/phases/PHASE2.md`
- Phase 3 — 문서/네비(Insights) 구축: `tools/fed/phases/PHASE3.md`
- Phase 4 — 심화 보드/지표: `tools/fed/phases/PHASE4.md`
- Phase 5 — 리팩터/운영: `tools/fed/phases/PHASE5.md`

## 진행 상태 표기(예시)
- [ ] 미착수, [~] 진행중, [x] 완료 — 각 Phase 문서 상단에 상태 배지를 유지합니다.

## 테스트/운영
- 로컬: `node scripts/dev/fred-proxy.js` → http://127.0.0.1:8787
- 위젯: `/?path=tools/fed/fed-monitor-widget.html`
- 상세: `/?path=tools/fed/fed-rates-detail.html`
- 운영: 정적(CORS) 고려로 서버리스 프록시 권장
- 모바일 뷰포트 확인: 375×812, 390×844에서 카드 2×2 레이아웃/텍스트 겹침/탭 영역 ≥ 44px 검증

## 선행 수정(Quickfix)
- 네비게이션(모바일): 드롭다운 오픈 후 메뉴 선택/외부 클릭/ESC로 폴딩되지 않는 이슈 → Phase 1에서 우선 수정(데스크탑 영향 없음 보장)
