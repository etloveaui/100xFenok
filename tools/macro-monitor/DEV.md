# Macro Monitor - DEV.md

> 기능별 개발 메모. CLAUDE.md에서 이 기능 작업 시 참조.

## Purpose

유동성 지표(SOFR-IORB 등)를 실시간으로 표시하는 위젯 및 상세 페이지.

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── widgets/                  ← 카드형 위젯 (main.html iframe용)
│   ├── sofr-iorb.html        ← SOFR-IORB 스프레드
│   ├── treasury.html         ← [Phase 3] 10Y-2Y Treasury
│   ├── vix.html              ← [Phase 3] VIX
│   └── ...
├── details/                  ← 상세 페이지 (클릭 시 이동)
│   ├── sofr-iorb.html        ← SOFR-IORB 상세
│   ├── treasury.html         ← [Phase 3] Treasury 상세
│   └── ...
└── shared/                   ← [Phase 3+] 공통 모듈
    ├── chart-config.js       ← Chart.js 공통 설정
    ├── api-fetch.js          ← CORS 프록시/API 호출
    └── styles.css            ← 공통 스타일
```

### 새 지표 추가 시
1. `widgets/[지표명].html` 생성
2. `details/[지표명].html` 생성
3. `main.html`에 iframe 추가
4. 지표 3개 이상 시 `shared/` 공통 모듈화 검토

---

## Current Implementation

### Widget (widgets/sofr-iorb.html)
- **디자인**: 카드형 (1/3 그리드)
- **데이터**: FRED API (SOFR, IORB)
- **CORS 우회**: Cloudflare Worker → isomorphic-git → allorigins
- **차트**: Chart.js 미니 차트 (no axes, fill, tension: 0)
- **상태**: 스프레드에 따라 정상/주의/경계/위험
- **클릭**: details/sofr-iorb.html로 이동

### Detail (details/sofr-iorb4.html) ⭐ 최신 완성본
- **디자인**: 밝은 테마 풀 페이지, 반응형 하이브리드
- **반응형 레이아웃**:
  - PC (≥900px): 듀얼 축 차트
  - 태블릿 (600-899px): 탭 전환 + 버튼 기간
  - 모바일 (<600px): 탭 전환 + 스와이프 기간
- **차트 개선**:
  - Gradient Fill, Glow Effect, Enhanced Tooltip
  - Threshold Backgrounds, Point Hover
- **기간 옵션**: 1M/3M/6M/1Y/3Y/MAX (기본: 1Y)
- **임계선**: 좌측 배치, 반투명 배경
- **Info Grid**: 지표 설명 카드 (내용 정리 예정)

---

## File References

| 파일 | 경로 |
|------|------|
| main.html iframe | `./tools/macro-monitor/widgets/sofr-iorb.html` |
| widget → detail | `tools/macro-monitor/details/sofr-iorb.html` |

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

## Technical Decisions

| 결정 | 이유 |
|------|------|
| Chart.js | 가볍고 빠름, 복잡한 시각화 불필요 |
| tension: 0 | 직선 스타일로 데이터 변화 명확히 표시 |
| widgets/details 분리 | 확장성: 지표 추가 시 패턴 명확 |
| 밝은 테마 | 사이트 전체 톤과 통일 |
| shared/ 지연 생성 | 지표 3개 이상 시 공통화 (YAGNI) |

---

## Phase Checklist

### Phase 1: Widget Card UI ✅
- [x] 위젯 카드형 재설계 (1/3 크기)
- [x] 직선 그래프 스타일 (tension: 0)
- [x] 상태 표시 (정상/주의/경계/위험)
- [x] iframe 높이 (280px)
- [x] 폴더 구조 정리 (widgets/, details/)
- [x] detail 밝은 테마 적용

### Phase 2: Graph Enhancement ✅ (2025-11-29)
- [x] Chart.js 설정 최적화 (5가지 개선)
- [x] 기간별 데이터 표시 (1M/3M/6M/1Y/3Y/MAX)
- [x] 스프레드 시각화 개선 (Gradient, Glow, Tooltip)
- [x] 반응형 하이브리드 레이아웃
- [x] 임계선 라벨 좌측 + 반투명

### Phase 3: Indicator Expansion (FRED)
- [ ] Treasury Spread (10Y-2Y)
  - widgets/treasury.html
  - details/treasury.html
- [ ] VIX Index
- [ ] M2 Liquidity
- [ ] shared/ 공통 모듈 생성

### Phase 4: Google Sheets Infrastructure
- [ ] Sheet 구조 설계
- [ ] Apps Script 배포
- [ ] 연동 테스트

### Phase 5: CORS Bypass Indicators
- [ ] Fear & Greed Index
- [ ] PE Ratio

---

## Known Issues

- [ ] 로컬 환경 CORS 문제 (배포 후 정상)
- [ ] 로딩 속도 개선 (캐싱 미구현)
- [ ] Google Sheets 인프라 미구축

---

## Change Log

| Date | Change |
|------|--------|
| 2025-11-29 | 반응형 하이브리드 레이아웃 (PC/태블릿/모바일) |
| 2025-11-29 | 차트 개선 5가지 (Gradient, Glow, Tooltip, Background, Hover) |
| 2025-11-29 | 기간 옵션 확장 (1Y 기본, 3Y/MAX 추가) |
| 2025-11-29 | 임계선 라벨 좌측 + 반투명 |
| 2025-11-28 | 폴더 구조 정리 (widgets/, details/), fed/ 삭제 |
| 2025-11-28 | detail 밝은 테마 적용 |
| 2025-11-27 | 위젯 카드형 재설계, 문서 정리 |
| 2025-11-26 | fed → macro-monitor 폴더 이름 변경 |
| 2025-11-25 | 위젯/상세 페이지 기본 구현 |
