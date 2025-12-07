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
| 3 | Foundation (기초) | 펀더멘털 괜찮나? | 월간~분기 | 🔄 개발 중 (4-A 완료) |

> **Layer 3~4 상세**: `docs/archive/2025-12/20251202_DEV_Phase3.5-4_Plan.md`

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── index.html                ← Command Center 대시보드
├── widgets/                  ← 카드형 위젯
│   ├── liquidity-stress.html ← ⚡ Layer 1
│   ├── liquidity-flow.html   ← 💧 Layer 2
│   └── banking-health.html   ← 🏦 Layer 3 (4-A, 개발 중)
├── details/                  ← 상세 페이지
│   ├── liquidity-stress.html
│   ├── liquidity-flow.html
│   └── banking-health.html   ← 🏦 Layer 3 (4-A, 개발 중)
└── shared/                   ← 공통 모듈 (ES Module)
    ├── data-manager.js       ← 캐시 + stale + NumberFormat
    ├── constants.js          ← THRESHOLDS, COLORS, ICONS (Banking 포함)
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

### Layer 3: Banking Health 🏦 (4-A v2, 테스트 대기)

**목적**: 금융 시스템 건전성 모니터링
**📊 실제 데이터**: `docs/references/market-data-snapshot-2025-11.md` (사진 006 예대율 71.73%)

**FRED 지표**:
| 지표 | Series ID | 주기 | 비고 |
|------|-----------|------|------|
| 연체율 (Total) | DRALACBN | 분기 | 낮을수록 건전 |
| 연체율 (CC) | DRCCLACBS | 분기 | 신용카드 |
| 연체율 (Consumer) | DRCLACBS | 분기 | 소비자 대출 |
| 연체율 (Business) | DRBLACBS | 분기 | 기업 대출 |
| 연체율 (**CRE**) | DRCRELEXFACBS | 분기 | 🆕 상업부동산 (다음 위기 후보) |
| Tier 1 | FDIC RBC1AAJ | 분기 | FDIC API (2개월 지연) |
| **FED Tier 1** | `BOGZ1FL010000016Q` | 분기 | 🆕 교차검증용 (GT1R 미존재) |
| **10Y Yield** | `DGS10` | 일간 | 🆕 금리 충격 (Offense) |
| **HY Spread** | `BAMLH0A0HYM2` | 일간 | 🆕 신용 충격 (Offense) |
| ~~FED 기준금리~~ | ~~FEDFUNDS~~ | - | ❌ 제거 (Capital 탭) |
| 전체 대출 | **TOTLL** | 주간 | SA, 예대율 분자 |
| 예금 | DPSACBW027SBOG | 주간 | SA, 예대율 분모 |

**Detail 구조 (3탭)**:
| 탭 | 차트 | 기간 옵션 |
|-----|------|----------|
| **Capital** | 🆕 Capital Resilience (아래 참조) | 1Y/5Y/10Y/MAX |
| Credit | 예대율 + 여신증가율 | 1Y/5Y/10Y/MAX |
| **Risks** | Total 연체율 + 접이식 섹터 분석 | 5Y/10Y/15Y/25Y/MAX |

#### 🆕 Capital Resilience 차트 (2025-12-07 v2 디자인)

> **목표**: "Tier1 vs FED금리" → "Capital vs Macro Stress" 진단 모델
> **디자인 기준**: Okabe-Ito 색맹 안전 팔레트 + Bloomberg 컨벤션

**색상 팔레트** (접근성 최적화):
| 역할 | 지표 | Hex | 선 스타일 | 두께 | 근거 |
|------|------|-----|----------|------|------|
| Defense 주역 | FDIC Tier 1 | `#0072B2` (Steel Blue) | Solid + Fill | 3px | 색맹 안전, 신뢰/안정 |
| Defense 보조 | FED Tier 1 | `#56B4E9` (Sky Blue) | Dashed `[5,3]` | 2px | 계열 유지, 보조 강조 |
| Offense 주역 | 10Y Yield | `#E69F00` (Orange) | Solid | 2.5px | 파랑 대비, 수익률 주목 |
| Offense 보조 | HY Spread | `#CC79A7` (Reddish Purple) | Dashed `[4,2]` | 2px | 🆕 색상 대비 강화 (v3.1) |

**시각적 계층**:
```
Defense (좌측 Y축, 파랑 계열)    Offense (우측 Y축)
━━━ FDIC Tier1 (굵은 실선)      ━━━ 10Y Yield (주황 실선)
┅┅┅ FED Tier1 (점선)            ┅┅┅ HY Spread (보라 점선)
```

**Y축 스케일 (적응형)**:
- 좌측 (Defense): **8% ~ suggestedMax: 16**
- 우측 (Offense): **0% ~ suggestedMax: 10** (2008 HY 21%+ 자동 확장)

**Annotations** (경계선만, 박스 없음 - 다른 차트와 통일):
| 요소 | 축 | 값 | 색상 | 라벨 |
|------|-----|-----|------|------|
| Danger Zone | Defense | 8~10% 박스 | `rgba(239,68,68,0.08)` | - |
| 자본 위험선 | Defense | 10% 라인 | `#ef4444` | "자본 위험선 10%" |
| 스트레스 경계 | Offense | 5% 라인 | `#D55E00` | "스트레스 경계 5%" |

> ⚠️ Stress Zone 박스 제거 (2025-12-07): 5~50% 무한대 박스 → 배경 통일성 깨짐

**기간 옵션**: 1Y / 3Y / 5Y / 10Y / **15Y** / MAX (기본: 10Y)

**기술적 제약**:
1. Defense: `stepped: 'before'` (계단식, 분기 데이터)
2. 모든 데이터셋: `spanGaps: true`
3. Order: Defense(3,2) 뒤, Offense(1) 앞
4. **Fill-Forward 보간**: 분기(Tier1) → 일간 그리드 정렬 (툴팁 N/A 방지)
5. **분기 데이터 필터링**: cutoff 이전 최근 1개 포함 (첫 구간 데이터 채움)

**모바일 대응** (< 600px):
- 범례: 2x2 그리드 또는 축약 표시
- 라인 두께: 유지 (터치 대상)
- 기간 버튼: 가로 스크롤

**상단 카드 순서** (2025-12-06 변경):
자기자본비율 → 예대율 → 여신증가율 → 연체율

**접이식 섹터 분석** (2025-12-06):
- 4개 카드: CC, Consumer, Business, **CRE**
- PC (900px+): 자동 펼침
- Mobile: 접힘 기본, 토글 가능

#### 🆕 Shadow of Death - 상각율(NCO) 오버레이 (2025-12-07)

> **목적**: 연체율 뒤에 상각율(Charge-Off)을 추가하여 시각적 비교
> **상태**: ✅ Phase 1 완료 (Total 메인 차트) / ⏸️ Phase 2 대기 (미니 차트)

**⚠️ 중요 - NCO/연체율 비율 패턴 폐기 (2025-12-07)**:
```
❌ 폐기된 기능: 배지에 NCO/연체율 비율 표시
- 리서치: data-scientist + deep-research-agent (40년 FRED 데이터 분석)
- 발견: 비율 0.40 = 정상(현재)과 위기(2008) 모두에서 발생
- 결론: 절대값 없이 비율만으로는 상태 판단 불가능
∴ 상각율은 차트에만 표시, 배지 제외
```

**현재 구현**:
- ✅ 상각율 차트 오버레이 (토글로 ON/OFF)
- ❌ 배지에 NCO 비율 패턴 표시 (폐기)

**FRED 시리즈 (상각율)**:
| 섹터 | 연체율 (기존) | 상각율 (추가) |
|------|-------------|--------------|
| Total | DRALACBN | **CORALACBN** |
| Credit Card | DRCCLACBS | **CORCCACBS** |
| Consumer | DRCLACBS | **CORCACBS** |
| Business | DRBLACBS | **CORBLACBS** |
| CRE | DRCRELEXFACBS | **CORCREXFACBS** |

**차트 사양 (Dual-Axis + 토글)**:
| 지표 | Y축 | 색상 | 스타일 | fill | 기본 |
|------|-----|------|--------|------|------|
| 연체율 | 좌 (0~10%) | `#E69F00` Orange | 실선 3px | ✅ | 표시 |
| 상각율 | 우 (0~5%) | `#D55E00` Vermillion | 점선 2px `[4,4]` | ❌ | hidden |

**토글 UI**: "📊 상각율 표시" 버튼 (기본 OFF)

**구현 순서**:
1. Phase 1: Total만 먼저 (메인 차트)
2. Phase 2: 4개 미니 차트 확장

**Widget**: 2x2 그리드, 캐시 기반

**접근**: Admin → Dev Pages → Banking Health (테스트 대기)

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
