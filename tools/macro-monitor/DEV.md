# Macro Monitor - DEV.md

> 기능별 개발 메모. CLAUDE.md에서 이 기능 작업 시 참조.
> **설계 철학**: `docs/planning/macro-monitor-philosophy.md` 필독
> **검증 체크리스트**: `docs/manuals/chart-dev-checklist.md` (차트 작업 시 필수)

## Purpose

유동성 및 펀더멘털 지표를 **조합**하여 **의미 있는 신호**로 시각화하는 위젯 시스템.

- ❌ 지표 단순 나열 (VIX 숫자만, M2 차트만)
- ✅ 개별 지표 조합 → 해석 가능한 신호로 변환

---

## 3-Layer 아키텍처

| Layer | 이름 | 질문 | 시간 프레임 | 상태 |
|-------|------|------|------------|------|
| 1 | Shield (방패) | 지금 터지나? | 실시간~일간 | ✅ 완료 |
| 2 | Fuel (연료) | 돈이 풀리고 있나? | 주간~월간 | ✅ 완료 |
| 3 | Foundation (기초) | 펀더멘털 괜찮나? | 월간~분기 | 📋 계획 |

> **Layer 3~4 상세**: `docs/archive/2025-12/20251202_DEV_Phase3.5-4_Plan.md`

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── index.html                ← Command Center 대시보드
├── widgets/                  ← 카드형 위젯
│   ├── liquidity-stress.html ← ⚡ Layer 1
│   └── liquidity-flow.html   ← 💧 Layer 2
├── details/                  ← 상세 페이지
│   ├── liquidity-stress.html
│   └── liquidity-flow.html
└── shared/                   ← 공통 모듈 (ES Module)
    ├── data-manager.js       ← 캐시 + stale + NumberFormat
    ├── constants.js          ← THRESHOLDS, COLORS, ICONS
    ├── recession-data.js     ← NBER 리세션 기간
    └── chart-annotations.js  ← 차트 annotation
```

### ✅ 인프라 완료 (2025-12-01)

| 항목 | 값 |
|------|-----|
| CORS 프록시 | `https://fed-proxy.etloveaui.workers.dev/` |
| FRED API Key | `6dda7dc3956a2c1d6ac939133de115f1` |
| 캐시 TTL | 30분 fresh / 6시간 stale (localStorage) |
| Admin | `admin/DEV.md` 참조 |

---

## Current Implementation

### Layer 1: Liquidity Stress ⚡

- **Widget**: 신호등 스타일, 캐시 기반
- **Detail**: SOFR-IORB 스프레드, 기간 옵션 1M~MAX

### Layer 2: Liquidity Flow 💧 (v2.1 ✅)

**핵심**: `Net Liquidity = WALCL - TGA - RRP`

| 지표 | Primary | Subtext |
|------|---------|---------|
| M2 | YoY% | $22.3T |
| Net Liquidity | $5.8T | Δ +$39B |
| Stablecoin | $226B | SC/M2 % |

**상태 판단** (Widget=Detail 동일):
- Expanding: Net Liq > 50 AND M2 YoY >= 4
- Contracting: Net Liq < -50 OR M2 YoY < 2
- Neutral: 그 외

**Detail 탭 3개**: Liquidity Pulse / Credit Flow / Crypto Bridge

> **v2.1 정합성 수정 상세**: CLAUDE.md Current Status 참조

---

## Widget 표준화 가이드

| 항목 | 규격 |
|------|------|
| 최소 높이 | 280px |
| 헤더 | 아이콘 + 타이틀 + 상태 배지 |
| 폰트 | Orbitron (타이틀), Inter (본문) |
| 상태 색상 | 🟢 #16a34a / 🟡 #ca8a04 / 🟠 #ea580c / 🔴 #dc2626 |

### 캐시 연동 패턴

```javascript
// Widget: 캐시 + stale 상태 읽기
const { data, isStale, ageMs } = DataManager.getWidgetDataWithStale('widget-id');
if (isStale) showStaleWarning(MacroDataManager.formatAge(ageMs));
if (!data) await loadDetailInBackground();

// Detail: API 호출 + 캐시 저장
DataManager.saveWidgetData('widget-id', processedData);
```

### 숫자 포맷팅 유틸

```javascript
MacroDataManager.formatCurrency(22300000000000, { unit: 'T' }); // "$22.3T"
MacroDataManager.formatCurrency(39000000000, { sign: true });   // "+$39.0B"
MacroDataManager.formatPercent(5.91, { sign: true });           // "+5.91%"
MacroDataManager.formatNumber(39, { sign: true, suffix: '$B' });// "+39$B"
```

### ⚠️ 절대 금지

1. Widget에서 API 직접 호출
2. 의미 없는 데모 데이터
3. 스타일 임의 변경
4. 타이틀에 아이콘 추가

---

## Data Flow

```
Detail 로드 → FRED/DefiLlama API → 처리 → localStorage 저장
                                              ↓
Widget 로드 → localStorage 읽기 → 없으면 hidden iframe Detail 로드
```

---

## 새 위젯 추가 체크리스트

**Step 1: Detail** (`details/[name].html`)
- [ ] API 호출 (3단계 Fallback)
- [ ] 계산 로직
- [ ] DataManager.saveWidgetData()
- [ ] 상세 UI

**Step 2: Widget** (`widgets/[name].html`)
- [ ] API 호출 금지
- [ ] localStorage만 읽기
- [ ] 신호등 상태 표시
- [ ] 260px+ 높이

**Step 3: 등록**
- [ ] index.html Command Center
- [ ] main.html iframe (필요 시)

---

## Phase Checklist

### ✅ Phase 1~2.7 (완료)

> **상세**: `docs/archive/2025-12/20251202_DEV_Phase1-2_Checklist.md`

### ✅ Phase 3: Layer 2 Liquidity Flow (완료 2025-12-01)

> **상세 설계**: `docs/archive/2025-12/20251201_DEV_Phase3_Detail.md`

- Net Liquidity 정식 공식, Signal Matrix 3개, Detail 탭 3개
- Widget-Detail 정합성 100% (v2.1)

### ✅ Phase 5-0: Infrastructure (완료 2025-12-01)

- Google Sheets + Apps Script
- Admin Panel (`admin/DEV.md`)

### 📋 대기: Phase 3.5, 4, 5-1

> **상세**: `docs/archive/2025-12/20251202_DEV_Phase3.5-4_Plan.md`

---

## Known Issues

- (현재 없음)

## Technical Decisions

| 결정 | 이유 |
|------|------|
| Chart.js | 가볍고 빠름 |
| widgets/details 분리 | 확장성 |
| 밝은 테마 | 사이트 톤 통일 |

> **Change Log**: `docs/CHANGELOG.md` 참조
