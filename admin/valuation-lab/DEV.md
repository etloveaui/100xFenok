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

### cache-manager.js

```javascript
// 3-Tier 캐시 조회 (Memory → Session → Fetch)
const data = await CacheManager.get('us_data', () => fetch('/data/benchmarks/us.json').then(r => r.json()));

// 캐시 무효화
CacheManager.invalidate('us_data');

// 전체 클리어
CacheManager.clear();
```

### formatters.js

```javascript
Formatters.formatNumber(1234.5, 2);        // "1,234.50"
Formatters.formatPercent(0.156, 1, true);  // "+15.6%"
Formatters.formatDate('2025-01-15');       // "2025-01-15"
Formatters.formatSignal(25);               // { signal: '🟢', label: '저평가', color: 'green' }
Formatters.formatPE(18.5);                 // "18.5x"
Formatters.formatPB(2.3);                  // "2.30x"
Formatters.formatCompact(1500000);         // "1.5M"
```

### constants.js

```javascript
CONSTANTS.DATA_BASE                    // '/data/benchmarks'
CONSTANTS.THRESHOLDS.PERCENTILE.CHEAP  // 30
CONSTANTS.COLORS.SIGNAL.GREEN.hex      // '#16a34a'
CONSTANTS.LABELS.SIGNAL.CHEAP          // '저평가'
```

### data-manager.js

```javascript
// 단일 벤치마크 로드 (캐싱 적용)
const usData = await DataManager.loadBenchmark('US');

// 다중 벤치마크 배치 로드
const data = await DataManager.loadBenchmarks(['US', 'SECTORS', 'EMERGING']);

// 전체 로드
const allData = await DataManager.loadAllBenchmarks();

// 섹션 키 목록 (JSON 구조: { sections: { sp500, nasdaq100, ... } })
const sections = DataManager.getSectionKeys(usData);  // ['sp500', 'nasdaq100', 'russell2000']

// 특정 섹션 데이터 (시계열 배열)
const sp500Data = DataManager.getSectionData(usData, 'sp500');  // [{date, pe, pb, ...}, ...]

// 최신 데이터 (배열에서 최신 날짜)
const latest = DataManager.getLatestData(sp500Data);  // {date: '2025-12-13', ...}

// 섹션 전체 정보
const section = DataManager.getSection(usData, 'sp500');  // {name, name_en, data: [...]}
```

### calculations.js

```javascript
Calculations.earningsYield(20);                    // 0.05 (5%)
Calculations.percentile(15, [10, 12, 15, 18, 20]); // 40
Calculations.zScore(15, 14, 2);                    // 0.5
Calculations.mean([10, 15, 20]);                   // 15
Calculations.standardDeviation([10, 15, 20]);      // 4.08
Calculations.sectorPremium(22, 20);                // 0.1 (+10%)
Calculations.return52Week(110, 100);               // 0.1 (+10%)
Calculations.pegProxy(20, 15);                     // 1.33
```

### validator.js

```javascript
// 단일 레코드 검증
const result = Validator.validateRecord({ date: '2025-01-15', best_pe_ratio: 20 });
// { valid: true, errors: [], warnings: [] }

// 배열 검증
const arrayResult = Validator.validateArray(data);
// { valid: true, totalRecords: 100, validRecords: 98, ... }

// 값 유효성 체크
Validator.isValidPE(20);    // true
Validator.isValidPB(2.5);   // true
Validator.isValidROE(-5);   // true (음수 허용)

// 값 정제
Validator.sanitize(null, 0);        // 0
Validator.sanitizeRecord(record);   // 정제된 레코드
```

---

## CDN 캐싱

GitHub Pages는 기본적으로 CDN 캐싱을 제공합니다.

| 리소스 | 캐시 정책 |
|--------|----------|
| HTML | 10분 (기본) |
| JS/CSS | 10분 (기본) |
| JSON 데이터 | 10분 (기본) |

**최적화**:
- 3-Tier Caching이 브라우저 측 캐싱 처리
- GitHub Actions로 데이터 갱신 시 자동 캐시 무효화

---

## 보안 가이드 (XSS/CSP)

### security.js

```javascript
// HTML 이스케이프
Security.escapeHtml('<script>alert(1)</script>');  // "&lt;script&gt;..."

// 안전한 텍스트 설정 (innerHTML 대신)
Security.setTextSafe(element, userInput);

// URL 검증
Security.isValidUrl('javascript:alert(1)');  // false
Security.isValidUrl('https://example.com');  // true

// 숫자 입력 검증
Security.sanitizeNumber('123', { min: 0, max: 1000 });  // 123

// CSP 메타 태그 (복사하여 HTML <head>에 추가)
Security.getCSPMeta();
```

### CSP 정책

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'self';
  script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com;
  font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com;
  img-src 'self' data: https:;
  connect-src 'self' https:;
">
```

### 보안 원칙

1. **innerHTML 금지** → `Security.setTextSafe()` 사용
2. **사용자 입력 검증** → `Security.sanitizeNumber/String()` 사용
3. **URL 검증** → `Security.isValidUrl()` 사용
4. **CSP 메타 태그** → 모든 HTML에 추가

---

## Layer 1A: Indicators (지표)

> **추가일**: 2025-12-15
> **파일**: `shared/indicators.js`

### 개요

DataManager + Calculations를 조합하여 실제 데이터 기반 지표 계산.

### 지표 목록

| # | 지표 | 함수 | 반환 |
|---|------|------|------|
| 9 | Earnings Yield | `getEarningsYield(latest)` | value, formatted, description |
| 10 | P/E Percentile | `getPEPercentile(sectionData)` | value, formatted, signal, signalLabel |
| 11 | P/B Percentile | `getPBPercentile(sectionData)` | value, formatted, signal, signalLabel |
| 12 | ROE Percentile | `getROEPercentile(sectionData)` | value, formatted, signal, signalLabel |
| 13 | P/E Z-Score | `getPEZScore(sectionData)` | value, formatted, signal, signalLabel |
| 14 | Sector Premium | `getSectorPremium(sector, benchmark)` | value, formatted, description |
| 15 | 52-Week Return | `getReturn52Week(sectionData)` | value, formatted, description |
| 16 | PEG Proxy | `getPEGProxy(latest)` | value, formatted, signal, signalLabel |

### 사용 예시

```javascript
// 데이터 로드
const data = await DataManager.loadBenchmark('US');
const sp500Data = DataManager.getSectionData(data, 'sp500');
const latest = DataManager.getLatestData(sp500Data);

// 개별 지표
const ey = Indicators.getEarningsYield(latest);
console.log(ey.formatted);  // "4.44%"

const pePct = Indicators.getPEPercentile(sp500Data);
console.log(`${pePct.signal} ${pePct.formatted}`);  // "🔴 85%"

// 종합 분석 (한 번에 모든 지표)
const summary = await Indicators.getValuationSummary('US', 'sp500');
console.log(summary.pePercentile.signal);  // "🔴"
```

### 신호등 기준

| 지표 유형 | 🟢 저평가 | 🟡 적정 | 🔴 고평가 |
|----------|----------|--------|----------|
| P/E, P/B | ≤30% | 30~70% | ≥70% |
| ROE | ≥70% | 30~70% | ≤30% |
| PEG | <1 | 1~2 | >2 |
| Z-Score | \|z\|≤1 | \|z\| 1~2 | \|z\|>2 |

---

## Layer 1B: UI 컴포넌트

> **추가일**: 2025-12-15
> **파일**: `signal-light.html`, `one-liner.html`, `percentile.html`, `card.html`

### #17 신호등 컴포넌트 (SignalLight)

**파일**: `signal-light.html`

**개요**: 밸류에이션 신호(🟢🟡🔴)를 시각적 UI로 표현

**스타일 옵션**:

| 타입 | 설명 | 용도 |
|------|------|------|
| `dot` | 단순 원형 점 + 라벨 | 인라인 표시 |
| `card` | 카드형 (좌측 컬러바) | 상세 목록 |
| `badge` | 배지형 (이모지 포함) | 태그/칩 |
| `traffic-h` | 3단 신호등 (가로) | 요약 표시 |
| `traffic-v` | 3단 신호등 (세로) | 아이콘형 |

**API 사용법**:

```javascript
// 1. 기본 생성
const signal = SignalLight.create({
  type: 'card',       // dot | card | badge | traffic-h | traffic-v
  signal: 'green',    // green | yellow | red (또는 이모지)
  label: 'P/E Percentile',
  value: '25% - 저평가',
  pulse: true         // 펄스 애니메이션 (기본: false)
});
container.appendChild(signal);

// 2. Indicators 결과로 생성
const peResult = Indicators.getPEPercentile(sectionData);
const card = SignalLight.fromIndicator(peResult, {
  type: 'card',
  name: 'P/E Percentile'
});

// 3. 종합 패널 렌더링
const summary = await Indicators.getValuationSummary('US', 'sp500');
SignalLight.renderPanel(container, summary);
```

**CSS 클래스**:

```css
.signal-light      /* 기본 래퍼 */
.signal-dot        /* 원형 점 (.green | .yellow | .red) */
.signal-card       /* 카드형 (.green | .yellow | .red) */
.signal-badge      /* 배지형 (.green | .yellow | .red) */
.traffic-light-h   /* 3단 가로 */
.traffic-light-v   /* 3단 세로 */
.pulse             /* 펄스 애니메이션 */
```

### #18 1문장 해석 (OneLiner)

**파일**: `one-liner.html`

**개요**: 밸류에이션 요약을 자연어 한 문장으로 표현

**스타일 옵션**:

| 타입 | 설명 | 용도 |
|------|------|------|
| `line` | 한 줄 텍스트 (상태별 배경색) | 인라인 요약 |
| `card` | 카드형 (아이콘 + 제목 + 본문) | 대시보드 위젯 |

**종합 판정 로직**:
- 다수결 방식 (🟢🟡🔴 카운트)
- P/E, P/B, ROE, PEG, Z-Score 5개 지표 기준

**API 사용법**:

```javascript
// 1. 문장만 가져오기
const summary = await Indicators.getValuationSummary('US', 'sp500');
const text = OneLiner.getText(summary, 'S&P 500');
// → "S&P 500은 현재 P/E 98%, PEG 0.92x로 고평가 구간입니다..."

// 2. 렌더링
OneLiner.render(container, summary, {
  indexName: 'S&P 500',
  showCard: true
});

// 3. 개별 요소 생성
const line = OneLiner.createLine(summary, 'S&P 500');
const card = OneLiner.createCard(summary, 'S&P 500');
```

**CSS 클래스**:

```css
.one-liner         /* 기본 라인 (.bullish | .neutral | .bearish) */
.one-liner-card    /* 카드형 */
.mini-badge        /* 인라인 배지 (.green | .yellow | .red) */
```

### #19 분위수 차트 (PercentileChart)

**파일**: `percentile.html`

**개요**: Percentile 값을 다양한 시각적 형태로 표현

**스타일 옵션**:

| 타입 | 설명 | 용도 |
|------|------|------|
| `bar` | 그라데이션 바 + 마커 | 상세 페이지 |
| `gauge` | 반원형 게이지 미터 | 대시보드 |
| `segment` | 3단계 세그먼트 | 카테고리형 |
| `mini` | 미니 바 (한 줄) | 리스트/표 |

**색상 기준**:
- P/E, P/B: ≤30% 🟢 / 30~70% 🟡 / ≥70% 🔴
- ROE (반전): ≥70% 🟢 / 30~70% 🟡 / ≤30% 🔴

**API 사용법**:

```javascript
// 1. 그라데이션 바
const bar = PercentileChart.createBar({
  label: 'P/E Percentile',
  value: 98,
  showLabels: true
});

// 2. 게이지 미터
const gauge = PercentileChart.createGauge({
  value: 98,
  label: 'P/E'
});

// 3. 세그먼트 바
const segment = PercentileChart.createSegment({
  label: 'P/E Percentile',
  value: 98,
  inverted: false  // ROE는 true
});

// 4. 미니 바
const mini = PercentileChart.createMini({
  label: 'P/E',
  value: 98,
  formatted: '98%'
});

// 5. 종합 패널
PercentileChart.renderPanel(container, summary);
```

**CSS 클래스**:

```css
.percentile-bar    /* 그라데이션 바 */
.gauge-meter       /* 반원형 게이지 */
.segment-bar       /* 세그먼트 바 */
.mini-bar          /* 미니 바 */
```

### #20 밸류에이션 카드 (ValuationCard)

**파일**: `card.html`

**개요**: 모든 UI 컴포넌트를 통합한 종합 밸류에이션 카드

**스타일 옵션**:

| 타입 | 설명 | 용도 |
|------|------|------|
| `full` | 전체 카드 (헤더+신호등+차트+1문장) | 대시보드 메인 |
| `compact` | 컴팩트 카드 (배지 스타일) | 목록/그리드 |

**카드 구성**:

| 영역 | 내용 |
|------|------|
| 헤더 | 지수명 + 종합 판정 배지 |
| 신호등 | P/E, P/B, ROE, PEG 4개 지표 |
| 차트 | P/E, P/B 미니 바 (percentile) |
| 1문장 | OneLiner 통합 |
| 푸터 | 데이터 기준일 |

**API 사용법**:

```javascript
// 1. 전체 카드 생성
const summary = await Indicators.getValuationSummary('US', 'sp500');
const fullCard = ValuationCard.createFull(summary, {
  indexName: 'S&P 500',
  showChart: true,
  showOneLiner: true
});
container.appendChild(fullCard);

// 2. 컴팩트 카드 생성
const compactCard = ValuationCard.createCompact(summary, {
  indexName: 'S&P 500'
});

// 3. 그리드 렌더링 (여러 지수)
const data = await DataManager.loadBenchmark('US');
const sections = DataManager.getSectionKeys(data);
ValuationCard.renderGrid(container, 'US', sections);

// 4. 종합 판정 가져오기
const overall = ValuationCard.getOverall(summary);
// → { signal: '🔴', label: '고평가', class: 'bearish' }
```

**CSS 클래스**:

```css
.valuation-card         /* 전체 카드 */
.valuation-card-compact /* 컴팩트 카드 */
.overall-badge          /* 종합 배지 (.bullish | .neutral | .bearish) */
.signal-item            /* 신호등 아이템 */
.one-liner-section      /* 1문장 영역 */
```

---

## 관련 문서

| 문서 | 위치 |
|------|------|
| 구조 계획 | `docs/planning/valuation-lab-plan.md` |
| 실행 계획 | `docs/planning/valuation-lab-execution-plan.md` |
| 아이디어 SSOT | `docs/planning/valuation-ideas/02_MASTER.md` |
| MVP 스코프 | `docs/planning/valuation-ideas/03_MVP_SCOPE.md` |
| 데이터 스펙 | `data/benchmarks/DEV.md` |
