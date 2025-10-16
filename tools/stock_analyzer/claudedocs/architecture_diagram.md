# Stock Analyzer 아키텍처 다이어그램

## 1. 전체 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Stock Analyzer System                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Data Source (Python Processing)                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Excel/CSV                                                                │
│      ↓                                                                    │
│  DataCleaner.py ──→ [정제] ──→ enhanced_summary_data.json               │
│      │                              │                                     │
│      ├─ 0x2a → 실제 값             ├─ companies: [...]                 │
│      ├─ nan, infinity 제거          └─ metadata: {...}                  │
│      ├─ 통화 정보 추출                                                   │
│      └─ 필수 필드 검증                                                   │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 2: Core Foundation (Infrastructure)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │EventSystem  │  │DataSkeleton │  │UIFramework  │                     │
│  │             │  │             │  │             │                     │
│  │• emit()     │  │• query()    │  │• create()   │                     │
│  │• on()       │  │• subscribe()│  │• mount()    │                     │
│  │• off()      │  │• update()   │  │• unmount()  │                     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                     │
│         │                 │                 │                            │
│         └─────────────────┴─────────────────┘                            │
│                           │                                               │
│  ┌────────────────────────┴───────────────────────┐                     │
│  │          ModuleRegistry                         │                     │
│  │  • register(name, module)                       │                     │
│  │  • get(name)                                    │                     │
│  │  • lifecycle management                         │                     │
│  └─────────────────────────────────────────────────┘                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Manager Modules (Business Logic)                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │FilterManager   │  │ColumnManager   │  │ChartManager    │           │
│  │                │  │                │  │                │           │
│  │• applyFilters()│  │• showColumn()  │  │• renderChart() │           │
│  │• clearFilters()│  │• hideColumn()  │  │• updateChart() │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
│                                                                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │PaginationMgr   │  │LoadingManager  │  │DataCleanupMgr  │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Feature Modules (Advanced Features)                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ DeepCompare (기업 비교)                                   │          │
│  │  ├─ ComparisonEngine    : 비교 로직                       │          │
│  │  ├─ DragAndDrop         : 드래그 앤 드롭 UI               │          │
│  │  ├─ BubbleChart         : 버블 차트 시각화                │          │
│  │  └─ RadarChart          : 레이더 차트 시각화              │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ EconomicDashboard (경제 지표)                             │          │
│  │  ├─ TreasuryRateCurve   : 국채 금리 곡선                  │          │
│  │  ├─ TEDSpreadChart      : TED 스프레드                    │          │
│  │  ├─ HighYieldHeatmap    : 고수익률 히트맵                 │          │
│  │  └─ EconomicAlertCenter : 알림 센터                       │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ MomentumHeatmap (모멘텀 히트맵)                           │          │
│  │  ├─ TreemapRenderer     : 트리맵 렌더러 (D3.js)          │          │
│  │  ├─ TimeFilter          : 시간 필터                       │          │
│  │  ├─ DrilldownPanel      : 드릴다운 패널                   │          │
│  │  └─ TooltipManager      : 툴팁 관리                       │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ Momentum (모멘텀 상세 분석)                               │          │
│  │  ├─ MomentumCalculator  : 모멘텀 계산 (860 lines)        │          │
│  │  ├─ RankingEngine       : 랭킹 엔진 (723 lines)          │          │
│  │  ├─ FilterEngine        : 필터 엔진 (730 lines)          │          │
│  │  ├─ MomentumVisualizer  : 시각화 (957 lines)             │          │
│  │  ├─ M_Company           : 회사 모델 (927 lines)          │          │
│  │  ├─ CompanyComparison   : 기업 비교                       │          │
│  │  └─ CompanyDetailView   : 상세 보기                       │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ PortfolioBuilder (포트폴리오 빌더)                        │          │
│  │  ├─ Portfolio           : 포트폴리오 모델                 │          │
│  │  ├─ PortfolioOptimizer  : 최적화 엔진                     │          │
│  │  ├─ RiskAnalyzer        : 리스크 분석                     │          │
│  │  └─ Layout              : 레이아웃 컴포넌트               │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────┐          │
│  │ SmartAnalytics (AI 스마트 분석)                           │          │
│  │  ├─ MomentumAI          : AI 모멘텀 분석                  │          │
│  │  ├─ SmartAnalytics      : 메인 분석 엔진                  │          │
│  │  └─ momentum_score      : 알고리즘                        │          │
│  └───────────────────────────────────────────────────────────┘          │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 5: UI Layer (Presentation)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  stock_analyzer.html                                                     │
│    ├─ Tab 1: Screener (스크리닝)                                        │
│    │   ├─ FilterPanel                                                    │
│    │   ├─ DataTable                                                      │
│    │   └─ Pagination                                                     │
│    │                                                                      │
│    ├─ Tab 2: Dashboard (대시보드)                                        │
│    │   ├─ EconomicDashboard                                              │
│    │   ├─ MomentumHeatmap                                                │
│    │   ├─ ValuationMatrix                                                │
│    │   └─ SectorPerformance                                              │
│    │                                                                      │
│    └─ Tab 3: Portfolio (포트폴리오)                                      │
│        ├─ PortfolioBuilder                                               │
│        ├─ RiskAnalysis                                                   │
│        └─ Optimization                                                   │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 데이터 흐름 다이어그램

```
┌────────────────────────────────────────────────────────────────────┐
│ Data Flow Architecture                                              │
└────────────────────────────────────────────────────────────────────┘

1. DATA SOURCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Excel/CSV 원본
        │
        ↓
   ┌─────────────────┐
   │ DataCleaner.py  │
   ├─────────────────┤
   │ • 0x2a 제거     │
   │ • nan 제거      │
   │ • 통화 추출     │
   │ • 필수 필드 검증│
   └────────┬────────┘
            │
            ↓
   enhanced_summary_data.json
   {
     "companies": [1250 companies],
     "metadata": {...}
   }

2. LOAD & VALIDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   fetch('./data/enhanced_summary_data.json')
        │
        ↓
   ┌──────────────────────┐
   │ DataCleanupManager   │
   │ • 추가 정제           │
   │ • null 처리           │
   │ • 타입 변환           │
   └──────────┬───────────┘
              │
              ↓
   ┌──────────────────────┐
   │ ErrorFixManager      │
   │ • 에러 탐지           │
   │ • 자동 수정           │
   │ • 로그 기록           │
   └──────────┬───────────┘
              │
              ↓
   window.stockData (전역 저장)

3. PROCESS & INDEX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   window.stockData
        │
        ├──→ DataSkeleton.query()
        │    • 필터링
        │    • 정렬
        │    • 페이지네이션
        │
        ├──→ Cache Layer
        │    • 결과 캐싱
        │    • 인덱싱
        │
        └──→ EventSystem
             • data:loaded
             • data:updated
             • data:filtered

4. RENDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   DataSkeleton.subscribe()
        │
        ↓
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ FilterManager│  │ ChartManager │  │ TableRenderer│
   │              │  │              │  │              │
   │ • UI 업데이트│  │ • 차트 렌더링│  │ • 테이블 렌더│
   └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 3. 이벤트 시스템 흐름

```
┌────────────────────────────────────────────────────────────────────┐
│ Event System Architecture                                           │
└────────────────────────────────────────────────────────────────────┘

EventBus (중앙 이벤트 버스)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

         ┌─────────────────────────────┐
         │      EventSystem            │
         │                             │
         │  eventBus: Map<name, Set>   │
         │  eventQueue: Array          │
         │  processing: boolean        │
         └──────────┬──────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ↓           ↓           ↓
   [Emit]      [Subscribe]  [Process]


1. 이벤트 발행 (Emit)
─────────────────────────────────────────────────────────────────────

   User Action (필터 적용)
        │
        ↓
   filterManager.applyFilters()
        │
        ↓
   eventSystem.emit('data:filtered', {
       filters: [...],
       resultCount: 150
   })
        │
        ↓
   [이벤트 큐에 추가]
        │
        ↓
   [우선순위 정렬]
        │
        ↓
   [비동기 처리 시작]


2. 이벤트 구독 (Subscribe)
─────────────────────────────────────────────────────────────────────

   Module Initialization:

   chartManager.init() {
       this.unsubscribe = eventSystem.on('data:filtered',
           (event) => {
               this.updateChart(event.payload);
           },
           { priority: 5, module: 'chartManager' }
       );
   }

   tableRenderer.init() {
       this.unsubscribe = eventSystem.on('data:filtered',
           (event) => {
               this.renderTable(event.payload);
           },
           { priority: 10, module: 'tableRenderer' }
       );
   }


3. 이벤트 처리 (Process Queue)
─────────────────────────────────────────────────────────────────────

   Event Queue:
   [
     { name: 'data:filtered', payload: {...}, priority: 10 },
     { name: 'ui:update', payload: {...}, priority: 5 },
     { name: 'chart:render', payload: {...}, priority: 0 }
   ]
        │
        ↓
   [우선순위 순으로 처리]
        │
        ├──→ Priority 10: tableRenderer 실행
        │
        ├──→ Priority 5: chartManager 실행
        │
        └──→ Priority 0: 기타 핸들러 실행


4. 에러 격리
─────────────────────────────────────────────────────────────────────

   Handler Execution:
        │
        ├─ try {
        │    handler(event)
        │  }
        │
        ├─ catch(error) {
        │    errorHandler(error, event)
        │    emit('system:error', {...})
        │  }
        │
        └─ [다른 핸들러는 계속 실행]
```

---

## 4. 모듈 로딩 순서 (현재 문제)

```
┌────────────────────────────────────────────────────────────────────┐
│ Current Module Loading (INCORRECT)                                 │
└────────────────────────────────────────────────────────────────────┘

HTML Script 로딩 순서:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ErrorFixManager.js                ← Core 없이 실행 ✗
2. DataCleanupManager.js             ← DataSkeleton 없음 ✗
3. ColumnManager.js                  ← EventSystem 없음 ✗
4. FilterManager.js                  ← 의존성 누락 ✗
5. ...
   ...
   [많은 모듈들]
   ...
30. EconomicDashboard/EventSystem.js  ← 파일 없음 404 ✗
31. EconomicDashboard/DataSkeleton.js ← 파일 없음 404 ✗
32. EconomicDashboard/UIFramework.js  ← 파일 없음 404 ✗
33. EconomicDashboard/EconomicDashboard.js
34. MomentumHeatmap/EventSystem.js    ← 파일 없음 404 ✗
35. MomentumHeatmap/DataSkeleton.js   ← 파일 없음 404 ✗
36. MomentumHeatmap/UIFramework.js    ← 파일 없음 404 ✗
37. MomentumHeatmap/MomentumHeatmap.js
38. stock_analyzer_enhanced.js


결과:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

브라우저 콘솔:
  ✗ 404 Not Found (6개)
  ✗ ReferenceError: EventSystem is not defined
  ✗ ReferenceError: DataSkeleton is not defined
  ✗ ReferenceError: UIFramework is not defined
  ✗ 모듈 초기화 실패
  ✗ 기능 동작 불가


┌────────────────────────────────────────────────────────────────────┐
│ Correct Module Loading (RECOMMENDED)                               │
└────────────────────────────────────────────────────────────────────┘

HTML Script 로딩 순서:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CORE FOUNDATION (필수, 가장 먼저)
   ├─ core/EventSystem.js              ← 이벤트 버스 ✓
   ├─ core/DataSkeleton.js             ← 데이터 계층 ✓
   ├─ core/UIFramework.js              ← UI 프레임워크 ✓
   ├─ core/ModuleRegistry.js           ← 모듈 관리 ✓
   ├─ core/ErrorBoundary.js            ← 에러 처리 ✓
   └─ core/DataProvider.js             ← 데이터 제공 ✓

2. EXTERNAL LIBRARIES
   └─ https://d3js.org/d3.v7.min.js    ← D3.js ✓

3. BASIC MANAGERS (Core 의존)
   ├─ modules/ErrorFixManager.js       ← Core 사용 ✓
   ├─ modules/DataCleanupManager.js    ← Core 사용 ✓
   ├─ modules/ColumnManager.js         ← Core 사용 ✓
   ├─ modules/FilterManager.js         ← Core 사용 ✓
   ├─ modules/PaginationManager.js     ← Core 사용 ✓
   └─ modules/LoadingManager.js        ← Core 사용 ✓

4. FEATURE MODULES (Manager 의존)
   ├─ modules/DeepCompare/...          ← 비교 기능 ✓
   ├─ modules/SmartAnalytics/...       ← AI 분석 ✓
   ├─ modules/PortfolioBuilder/...     ← 포트폴리오 ✓
   ├─ modules/EconomicDashboard/       ← 경제 지표 ✓
   │   └─ EconomicDashboard.js         ← (중복 제거)
   ├─ modules/MomentumHeatmap/         ← 모멘텀 히트맵 ✓
   │   └─ MomentumHeatmap.js           ← (중복 제거)
   └─ modules/Momentum/...             ← 모멘텀 분석 ✓

5. MAIN APPLICATION (마지막)
   └─ stock_analyzer_enhanced.js       ← 메인 앱 ✓


결과:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

브라우저 콘솔:
  ✓ 모든 파일 로드 성공
  ✓ Core 시스템 초기화 완료
  ✓ 모듈 초기화 완료
  ✓ 이벤트 시스템 작동
  ✓ 모든 기능 정상 동작
```

---

## 5. 의존성 그래프

```
┌────────────────────────────────────────────────────────────────────┐
│ Module Dependency Graph                                             │
└────────────────────────────────────────────────────────────────────┘

                     Core Foundation
                     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ↓                ↓                ↓
    EventSystem      DataSkeleton      UIFramework
          │                │                │
          └────────────────┼────────────────┘
                           │
                   ModuleRegistry
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ↓                ↓                ↓
   ErrorBoundary     DataProvider    StateManager
          │                │                │
          └────────────────┼────────────────┘
                           │
                    Basic Managers
                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ↓                ↓                ↓
   FilterManager    ColumnManager    ChartManager
          │                │                │
          └────────────────┼────────────────┘
                           │
                   Feature Modules
                   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                           │
       ┌───────┬───────────┼───────────┬───────┐
       │       │           │           │       │
       ↓       ↓           ↓           ↓       ↓
  DeepCompare │    EconomicDashboard  │  SmartAnalytics
              │                       │
       MomentumHeatmap         PortfolioBuilder
              │
              ↓
          Momentum (Phase 2)
```

---

## 6. 주요 문제점 시각화

```
┌────────────────────────────────────────────────────────────────────┐
│ Problem: Missing Files (404 Errors)                                │
└────────────────────────────────────────────────────────────────────┘

HTML Expects:                          Reality:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

modules/EconomicDashboard/           modules/EconomicDashboard/
├─ EventSystem.js      ✗ 404        ├─ EconomicDashboard.js  ✓
├─ DataSkeleton.js     ✗ 404        ├─ components/           ✓
├─ UIFramework.js      ✗ 404        │   ├─ TreasuryRateCurve.js
└─ EconomicDashboard.js ✓            │   ├─ TEDSpreadChart.js
                                     │   └─ ...
                                     └─ styles/

modules/MomentumHeatmap/             modules/MomentumHeatmap/
├─ EventSystem.js      ✗ 404        ├─ MomentumHeatmap.js    ✓
├─ DataSkeleton.js     ✗ 404        ├─ components/           ✓
├─ UIFramework.js      ✗ 404        │   ├─ TreemapRenderer.js
└─ MomentumHeatmap.js  ✓             │   ├─ TimeFilter.js
                                     │   └─ ...
                                     └─ styles/


Core System (Should Use):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

core/
├─ EventSystem.js       ✓ EXISTS
├─ DataSkeleton.js      ✓ EXISTS
├─ UIFramework.js       ✓ EXISTS
└─ ... (7 more files)


Solution:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Load core/ files ONCE at the beginning
2. Remove duplicate loading from module-specific paths
3. Modules use global instances: window.eventSystem, etc.
```

---

**다이어그램 생성**: Claude Code
**작성 일시**: 2025-10-16
