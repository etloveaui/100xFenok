# Valuation Lab DEV.md

> **생성일**: 2025-12-14
> **목적**: 100xFenok Benchmarks 밸류에이션 MVP 개발/테스트

---

## 개요

| 항목 | 값 |
|------|-----|
| 위치 | `admin/valuation-lab/` |
| 목적 | MVP 기능 개발 → 완성 시 메인 이동 |
| 데이터 | `/data/benchmarks/` (고정) |

---

## 데이터 경로 (절대 고정)

> **이 경로는 스킬에서 사용 중이므로 절대 변경 금지**

| 파일 | 내용 |
|------|------|
| `us.json` | S&P500, NASDAQ100, Russell2000 |
| `us_sectors.json` | GICS 11섹터 + 주택 |
| `micro_sectors.json` | 반도체, 지역은행, 바이오 등 |
| `developed.json` | 유럽, 일본, 홍콩 |
| `emerging.json` | 중국, 인도, 한국, 브라질, 베트남 |
| `msci.json` | MSCI World/DM/EM |

**필드**: `date`, `px_last`, `best_eps`, `best_pe_ratio`, `px_to_book_ratio`, `roe`

---

## MVP 기능 목록 (72시간)

### Layer 0: 인프라 (27h)

| # | 기능 | 공수 | 상태 | 파일 |
|---|------|------|------|------|
| 1 | 3-Tier Caching | 4h | ✅ | `shared/cache-manager.js` |
| 2 | 공통 DataManager | 6h | ✅ | `shared/data-manager.js` |
| 3 | 데이터 검증 | 4h | ✅ | `shared/validator.js` |
| 4 | Formatters | 3h | ✅ | `shared/formatters.js` |
| 5 | Pure Functions | 6h | ✅ | `shared/calculations.js` |
| 6 | Constants | 2h | ✅ | `shared/constants.js` |
| 7 | CDN 캐싱 | 0.5h | ✅ | (GitHub Pages 기본) |
| 8 | XSS/CSP 보안 | 3h | ✅ | `shared/security.js` |

### Layer 1A: 지표 (16h)

| # | 기능 | 공수 | 수식 |
|---|------|------|------|
| 9 | Earnings Yield | 1h | `1/PE` |
| 10 | P/E Percentile | 3h | `percentile(PE)` |
| 11 | P/B Percentile | 2h | `percentile(PB)` |
| 12 | ROE Percentile | 2h | `percentile(ROE)` |
| 13 | P/E Z-score | 2h | `(PE-mean)/std` |
| 14 | Sector Premium | 3h | `(Sector/SP500)-1` |
| 15 | 52-Week Return | 1h | `px/px_52wk-1` |
| 16 | PEG Proxy | 2h | `PE/(ROE*100)` |

### Layer 1B: UI (29h)

| # | 기능 | 공수 | 파일 |
|---|------|------|------|
| 17 | 신호등 | 4h | `signal-light.html` |
| 18 | 1문장 해석 | 2h | `one-liner.html` |
| 19 | 분위수 차트 | 4h | `percentile.html` |
| 20 | 밸류에이션 카드 | 6h | `card.html` |

---

## 워크플로우

```
1. 실험실에서 기능 개발
      ↓
2. 테스트 및 검증
      ↓
3. 완성 → Macro Monitor 등으로 이동
      ↓
4. 실험실에서 해당 기능 정리/삭제
```

---

## Shared 모듈 API

> **API 상세**: `docs/archive/2025-12/20251220_DEV_Valuation-Lab-API-Details.md`

| 모듈 | 용도 |
|------|------|
| `cache-manager.js` | 3-Tier 캐시 (Memory→Session→Fetch) |
| `data-manager.js` | 벤치마크 로드, 섹션 조회 |
| `formatters.js` | 숫자/퍼센트/신호 포맷 |
| `calculations.js` | PE/PB/ROE 계산 |
| `validator.js` | 데이터 검증 |
| `constants.js` | 임계값, 색상 상수 |
| `security.js` | XSS 방어, CSP |

---

## Layer 1A-1B: 지표 및 UI

> **상세 API**: `docs/archive/2025-12/20251220_DEV_Valuation-Lab-API-Details.md`

### 지표 (#9-16)

| # | 지표 | 수식 |
|---|------|------|
| 9 | Earnings Yield | `1/PE` |
| 10-12 | P/E, P/B, ROE Percentile | `percentile(value)` |
| 13 | P/E Z-Score | `(PE-mean)/std` |
| 14 | Sector Premium | `(Sector/SP500)-1` |
| 15 | 52-Week Return | `px/px_52wk-1` |
| 16 | PEG Proxy | `PE/(ROE*100)` |

### UI (#17-20)

| # | 컴포넌트 | 파일 |
|---|----------|------|
| 17 | SignalLight | `signal-light.html` |
| 18 | OneLiner | `one-liner.html` |
| 19 | PercentileChart | `percentile.html` |
| 20 | ValuationCard | `card.html` |

### 신호등 기준

| 지표 유형 | 🟢 | 🟡 | 🔴 |
|----------|-----|-----|-----|
| P/E, P/B | ≤30% | 30~70% | ≥70% |
| ROE | ≥70% | 30~70% | ≤30% |
| PEG | <1 | 1~2 | >2 |

---

## 관련 문서

| 문서 | 위치 |
|------|------|
| 구조 계획 | `docs/planning/valuation-lab-plan.md` |
| 실행 계획 | `docs/planning/valuation-lab-execution-plan.md` |
| 아이디어 SSOT | `docs/planning/valuation-ideas/02_MASTER.md` |
| MVP 스코프 | `docs/planning/valuation-ideas/03_MVP_SCOPE.md` |
| 데이터 스펙 | `data/benchmarks/DEV.md` |
