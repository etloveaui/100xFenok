# Market Radar - DEV.md

> Market Radar 차트 개발 메모
> 생성일: 2025-12-31

---

## Purpose

Market Sentiment + Market Indices 차트 시각화. Signal Score Timeline, MA 오버레이, 유연한 기간 선택 지원.

---

## Folder Structure

```
admin/market-radar/
├── DEV.md           ← 이 파일
└── charts/          ← 총 13개 차트
    ├── [Sentiment 5개]
    ├── [CNN Sub 6개]
    └── [Indices 2개]
```

---

## Charts Overview (총 13개)

### 1. Sentiment 차트 (5개) - Signal Score Timeline

| 파일 | 지표 | 데이터 |
|------|------|--------|
| `chart-aaii.html` | AAII 투자자 심리 | `aaii.json` |
| `chart-cftc.html` | CFTC 포지션 | `cftc-sp500.json` |
| `chart-cnn-fg.html` | CNN Fear & Greed | `cnn-fg.json` |
| `chart-crypto-fg.html` | Crypto Fear & Greed | `crypto-fg.json` |
| `chart-vix-move.html` | VIX + MOVE 듀얼 | `vix.json`, `move.json` |

### 2. CNN Sub-indicator 차트 (6개) - 원시 측정값

| 파일 | 지표 | 표시방식 |
|------|------|---------|
| `chart-cnn-momentum.html` | S&P vs 125-day MA | 듀얼 라인 |
| `chart-cnn-strength.html` | 52주 고/저점 비율 | 제로라인 기준 |
| `chart-cnn-breadth.html` | McClellan VSI | 백분위 임계값 |
| `chart-cnn-put-call.html` | Put/Call 비율 | 0.7/1.0 임계존 |
| `chart-cnn-junk-bond.html` | 정크본드 스프레드 | 동적 임계값 |
| `chart-cnn-safe-haven.html` | 주식/국채 수익률 | 제로라인 기준 |

### 3. Market Indices 차트 (2개) - MA 오버레이

| 파일 | 지표 | 데이터 |
|------|------|--------|
| `chart-sp500.html` | S&P 500 | `sp500.json` (11,594개) |
| `chart-nasdaq.html` | NASDAQ | `nasdaq.json` (11,594개) |

---

## Current Implementation

### S&P 500 차트 (2025-12-31)

**기능**:
| 항목 | 구현 |
|------|------|
| MA 토글 | 20D (🩵 cyan), 50D (🟣 purple), 200D (🟠 orange) |
| 기간 선택 | 스마트 드롭다운 (Quick/Standard/Long-term/Year/Custom) |
| YTD | ✅ 지원 |
| 특정 연도 | ✅ 최근 10년 |
| 커스텀 범위 | ✅ 시작~종료일 직접 선택 |
| Recession | 음영 annotation |
| 모바일 | 하단 시트 스타일 |

**색상 테마**: Blue (#3b82f6)

### NASDAQ 차트 (2025-12-31)

- S&P 500과 동일 기능
- **색상 테마**: Green (#10b981)

---

## Data Sources

| 파일 | 레코드 | 기간 |
|------|--------|------|
| `data/indices/sp500.json` | 11,594 | 1980-01-02 ~ |
| `data/indices/nasdaq.json` | 11,594 | 1980-01-02 ~ |

**필드**: `{ date, value }`

---

## UI/UX

**스마트 드롭다운 기간 선택**:
| 카테고리 | 옵션 |
|----------|------|
| ⚡ Quick | 1W, 2W, 1M, 3M |
| 📈 Standard | 6M, YTD, 1Y, 2Y |
| 📊 Long-term | 3Y, 5Y, 10Y, 20Y |
| 📅 Year | 2025, 2024, ... (최근 10년) |
| 🗓️ Custom | 시작 ~ 종료 날짜 |

**MA Chip 토글**:
- 20D: 기본 OFF (🩵)
- 50D: 기본 ON (🟣)
- 200D: 기본 ON (🟠)

**반응형**:
- Mobile: 하단 시트 + 3열 그리드
- Desktop: 플로팅 패널 + 4열 그리드

---

## Phase Checklist

### Phase 1: 기본 구현 ✅ (2025-12-31)
- [x] S&P 500 차트 구현
- [x] NASDAQ 차트 구현
- [x] 20/50/200 MA 토글
- [x] 스마트 드롭다운 기간 선택
- [x] YTD, 특정 연도, 커스텀 범위
- [x] 모바일 최적화
- [x] admin/index.html 등록

### Phase 2: 확장 (진행 중)
- [x] 데이터 자동 수집 파이프라인 ✅ (#77, DEC-076)
  - Apps Script + GOOGLEFINANCE + GitHub API
  - 병합 방식 (기존 데이터 유지)
  - 트리거: 매일 06:00 + 09:00
- [ ] 더 많은 지수 추가 (DJI, Russell 등)
- [ ] 비교 차트 기능

---

## Known Issues

- (현재 없음)

---

## Change Log

> 상세 이력: `CookBook/docs/CHANGELOG.md` 참조

| 날짜 | 변경 |
|------|------|
| 12-31 | 스마트 드롭다운 기간 선택기 구현 |
| 12-31 | YTD, 연도별, 커스텀 범위 지원 |
| 12-31 | 20/50/200 MA 토글 구현 |
| 12-31 | 모던 UI 리디자인 (Inter, Chip, Segment) |
