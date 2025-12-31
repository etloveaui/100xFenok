# Market Radar - DEV.md

> Market Indices 차트 개발 메모
> 생성일: 2025-12-31

---

## Purpose

시장 지수 (S&P 500, NASDAQ) 차트 시각화. MA 오버레이 및 유연한 기간 선택 지원.

---

## Folder Structure

```
admin/market-radar/
├── DEV.md           ← 이 파일
└── charts/
    ├── chart-sp500.html   ← S&P 500 차트
    └── chart-nasdaq.html  ← NASDAQ 차트
```

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

### Phase 2: 확장 (예정)
- [ ] 데이터 자동 수집 파이프라인
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
