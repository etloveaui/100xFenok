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
| 3 | Foundation (기초) | 펀더멘털 괜찮나? | 월간~분기 | ✅ 4-A 완료 (Banking Health) |

> **Layer 3~4 상세**: `docs/archive/2025-12/20251202_DEV_Phase3.5-4_Plan.md`
> **🆕 Phase 4 마스터 플랜**: `docs/planning/phase4-indicators-master.md` (2025-12-12)

---

## Folder Structure

```
tools/macro-monitor/
├── DEV.md                    ← 이 파일
├── index.html                ← Command Center 대시보드
├── widgets/                  ← 카드형 위젯
│   ├── liquidity-stress.html ← ⚡ Layer 1
│   ├── liquidity-flow.html   ← 💧 Layer 2
│   └── banking-health.html   ← 🏦 Layer 3 (4-A, ✅ 배포)
├── details/                  ← 상세 페이지
│   ├── liquidity-stress.html
│   ├── liquidity-flow.html
│   └── banking-health.html   ← 🏦 Layer 3 (4-A, ✅ 배포)
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

### Layer 1: Liquidity Stress ⚡ (v2 ✅)

**컨셉**: Banking Health(신전) 옆의 **정밀 센서** - 의료 장비/항공 계기판 느낌
**Widget**: Dual Precision Arc (150px 게이지 × 2)
**Detail**: SOFR-IORB 스프레드, 기간 옵션 1M~MAX

**게이지 구성**:
| 위치 | 지표 | 스트레스 로직 |
|------|------|---------------|
| 좌측 | Spread (bps) | 높을수록 위험 (직접) |
| 우측 | RB·GDP (%) | 낮을수록 위험 (역비례) |

### Layer 2: Liquidity Flow 💧 (v2 Clean Stream ✅)

**컨셉**: Digital Hydro-Dynamics - 투명한 유리관 속 흐르는 디지털 자금
**Widget**: Clean Stream (그라데이션 텍스트 + Wave SVG 배경)
**Detail**: Net Liquidity 공식, 3탭 (Liquidity Pulse / Credit Flow / Crypto Bridge)

**핵심**: `Net Liquidity = WALCL - TGA - RRP`

**위젯 구조**:
| 영역 | 내용 |
|------|------|
| Hero | Net Flow ($B) - 그라데이션 텍스트 (Teal/Red) |
| Tributaries | M2 YoY \| Net Liq \| SC/M2 (Vertical Divider)

### Layer 3: Banking Health 🏦 (4-A v4, ✅ 배포 완료)

**목적**: 금융 시스템 건전성 모니터링
**상태**: index.html 라이브 위젯 (2025-12-11)
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
| 탭 | 차트 | 기간 옵션 | 기본값 |
|-----|------|----------|--------|
| **Capital** | Capital Resilience (아래 참조) | 1Y/3Y/5Y/10Y/15Y/MAX | 10Y |
| **Credit** | Credit Health v2 (아래 참조) | 1Y/3Y/5Y/10Y/15Y/20Y/MAX | 10Y |
| **Risks** | Total 연체율 + 접이식 섹터 분석 | 5Y/10Y/15Y/25Y/MAX | MAX |

#### Banking Health 차트 상세

> **상세 사양**: `docs/archive/2025-12/20251208_DEV_Banking-Health-Charts.md`

**Capital Resilience (v3.1)**: Defense vs Offense 모델, Okabe-Ito 팔레트
**Credit Health (v2)**: 예대율 + 여신증가율, 임계값 85%/65%, 10Y 기본
**Shadow of Death**: 상각율 오버레이, 토글 ON/OFF

**공통 UI**:
- 상단 카드 순서: 자기자본비율 → 예대율 → 여신증가율 → 연체율
- 접이식 섹터 분석: 4개 카드 (CC, Consumer, Business, CRE)
- 모바일: 접힘 기본, PC: 자동 펼침

**Widget**: v4 The Solid Bank (월가 스타일 파사드)
**접근**: index.html → Banking Health 카드 클릭

---

## Widget 표준화 (요약)

| 항목 | 값 |
|------|-----|
| 최소 높이 | 280px (PC), 360px (Mobile) |
| 상태 색상 | 🟢 #16a34a / 🟡 #ca8a04 / 🟠 #ea580c / 🔴 #dc2626 |
| 캐시 | `DataManager.getWidgetDataWithStale()` / `saveWidgetData()` |
| ⚠️ 금지 | Widget에서 API 직접 호출, 데모 데이터, View Details 버튼 |

> **Note**: 위젯 카드 전체가 클릭 가능하므로 "View Details" 버튼 불필요 (2025-12-11 제거)

### 📱 반응형 브레이크포인트 (2025-12-13)

> **상세 계획**: `docs/planning/mobile-responsive-plan.md`

| 구간 | 화면 폭 | 컨테이너 높이 |
|------|---------|---------------|
| PC Desktop | 1200px+ | 280px |
| Tablet | 768-1199px | 280px |
| Mobile Large | 401-767px | 320px |
| Mobile Small | ≤400px | 360px |

**컨테이너 파일**: `main.html`, `tools/macro-monitor/index.html`
**표준 브레이크포인트**: `400px` (모든 위젯 통일)

---

## Data Flow

```
Detail 로드 → FRED/DefiLlama API → 처리 → localStorage 저장 (macro_${widgetId})
                                              ↓
Widget 로드 → localStorage 읽기 또는 postMessage 수신
```

### postMessage 통신 (iframe 환경)

**Command Center** (`tools/macro-monitor/index.html`):
- 부모 페이지에서 직접 localStorage 읽어서 위젯에 전송
- `WIDGET_DATA_UPDATE` 이벤트

**Main 페이지** (`main.html` in `index.html` iframe):
- 요청-응답 패턴 (cross-origin 제한 우회)
- **Smart 2-Slot Carousel** (2025-12-11 구현)
```
main.html → index.html: REQUEST_WIDGET_DATA
index.html → main.html: WIDGET_DATA_RESPONSE
main.html → widget: WIDGET_DATA_UPDATE
widget → main.html: WIDGET_READY (렌더링 완료 신호)
```

**Carousel 플로우** (`main.html`):
```
Timer(5s) → prepareNextWidget → 다음 슬롯에 위젯 로드
          → onload → REQUEST_WIDGET_DATA
          → WIDGET_DATA_RESPONSE → WIDGET_DATA_UPDATE
          → renderWidget() → WIDGET_READY
          → executeTransition (Cross-fade 전환)
```

**새 위젯 추가 시**: `WIDGETS` 배열에 ID만 추가
- `main.html`: line 265 (Carousel WIDGETS 배열)
- `index.html`: line 296
- `tools/macro-monitor/index.html`: line 455

---

## 새 위젯 추가 체크리스트

**Step 1: Detail** (`details/[name].html`)
- [ ] API 호출 (3단계 Fallback)
- [ ] 계산 로직
- [ ] DataManager.saveWidgetData()
- [ ] 상세 UI

**Step 2: Widget** (`widgets/[name].html`)
- [ ] API 호출 금지
- [ ] localStorage 읽기 + postMessage 수신 리스너
- [ ] 상태 표시 (게이지/신호등/etc)
- [ ] 280px+ 최소 높이
- [ ] View Details 버튼 없음 (카드 전체 클릭)
- [ ] **WIDGET_READY 신호**: `renderWidget()` 끝에 `window.parent.postMessage({ type: 'WIDGET_READY' }, '*')`

**Step 3: 등록**
- [ ] `tools/macro-monitor/index.html` WIDGET_IDS 배열
- [ ] `main.html` WIDGETS 배열 (Carousel용)
- [ ] `index.html` WIDGET_IDS 배열

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

### ✅ 해결됨: 모바일 반응형 (2025-12-13)
- **문제**: liquidity-stress 위젯 모바일에서 하단 짤림
- **원인**: 컨테이너 280px 고정 vs 위젯 340px 필요
- **해결**: 컨테이너 반응형 + 위젯 최적화 (4단계)
- **상세**: `docs/planning/mobile-responsive-plan.md`

### ✅ 해결됨: 위젯 iframe localStorage 이슈 (2025-12-11)
- **문제**: Admin 페이지 iframe에서 위젯이 "데이터 없음" 표시
- **원인**: 브라우저 Third-party Storage Partitioning 정책 (iframe 내 localStorage 차단)
- **해결**: postMessage 통신 방식으로 변경 (부모→iframe 데이터 전달)
- **상세**: `docs/DECISION_LOG.md` DEC-025

## Technical Decisions

| 결정 | 이유 |
|------|------|
| Chart.js | 가볍고 빠름 |
| widgets/details 분리 | 확장성 |
| 밝은 테마 | 사이트 톤 통일 |

> **Change Log**: `docs/CHANGELOG.md` 참조
