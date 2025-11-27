# Macro Monitor - DEV.md

> 기능별 개발 메모. CLAUDE.md에서 이 기능 작업 시 참조.

## Purpose

SOFR-IORB 스프레드 등 유동성 지표를 실시간으로 표시하는 위젯 및 상세 페이지.

---

## Files

| File | Role |
|------|------|
| `widget.html` | 메인 페이지 임베드용 위젯 (iframe) |
| `detail.html` | 클릭 시 상세 분석 페이지 |

---

## Current Implementation

### Widget (widget.html)
- **데이터 소스**: FRED API (SOFR, IORB)
- **CORS 우회**: Cloudflare Worker → isomorphic-git → allorigins (폴백 체인)
- **차트**: Chart.js (직선 스타일, tension: 0)
- **시그널 라인**: 0bp (기준), 10bp (주의), 30bp (위험)
- **레이아웃**: 차트 상단 + 값 하단 가로 배치
- **iframe 높이**: 280px (main.html)

### Detail (detail.html)
- 확장된 차트 뷰
- 기간 선택 (1M/3M/6M/1Y)
- 상세 설명 및 해석

---

## Technical Decisions

| 결정 | 이유 |
|------|------|
| Chart.js | 가볍고 빠름, 복잡한 시각화 불필요 |
| tension: 0 | 직선 스타일로 데이터 변화 명확히 표시 |
| Google Sheets (예정) | CORS 우회 + 캐싱 + 확장성 |
| 시그널 라인 | 컬러 존 대신 라인으로 더 깔끔한 UI |

---

## Data Flow

```
FRED API
    ↓ (CORS 차단)
Cloudflare Worker (1차 프록시)
    ↓ (실패 시)
isomorphic-git proxy (2차)
    ↓ (실패 시)
allorigins (3차)
    ↓
Chart.js 렌더링
```

---

## Known Issues

- [ ] PC 버전 카드 레이아웃 미세 조정 필요
- [ ] 로딩 속도 개선 (캐싱 미구현)
- [ ] Google Sheets 인프라 미구축

---

## Phase Checklist

### Phase 1: Widget Card UI
- [x] 위젯 기본 레이아웃
- [x] 직선 그래프 스타일
- [x] 시그널 라인 (0bp, 10bp, 30bp)
- [x] 값 표시 (Spread, SOFR, IORB)
- [x] iframe 높이 조정 (280px)
- [ ] 반응형 최종 점검

### Phase 2: Graph Enhancement
- [ ] Chart.js 설정 최적화
- [ ] 기간별 데이터 표시
- [ ] 스프레드 시각화 개선

### Phase 3: Indicator Expansion (FRED)
- [ ] 10Y/2Y Treasury
- [ ] T10Y2Y Spread
- [ ] VIX
- [ ] M2

### Phase 4: Google Sheets Infrastructure
- [ ] Sheet 구조 설계
- [ ] Apps Script 배포
- [ ] 연동 테스트

### Phase 5: CORS Bypass Indicators
- [ ] Fear & Greed Index
- [ ] PE Ratio

---

## References

| Document | Path |
|----------|------|
| Master Plan | `docs/planning/macro-monitor-plan.md` |
| Data Sources | `docs/references/data-sources.md` |
| Site Architecture | `docs/manuals/site-architecture.md` |

---

## Change Log

| Date | Change |
|------|--------|
| 2025-11-27 | DEV.md 생성, Phase 1 진행 중 |
| 2025-11-26 | fed → macro-monitor 폴더 이름 변경 |
| 2025-11-25 | 위젯/상세 페이지 기본 구현 |
