# Stock Analyzer - 종합 구조 분석 보고서

**분석 일시**: 2025-10-16
**프로젝트 경로**: `C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer`

---

## 1. 모듈 구조 분석

### 1.1 Core 디렉토리 (핵심 인프라)
```
core/
├── DataProvider.js          484 lines  - 데이터 조회/캐싱 서비스
├── DataSkeleton.js          (존재)      - 데이터 추상화 계층
├── ErrorBoundary.js         776 lines  - 에러 격리 및 복구
├── EventBus.js              409 lines  - 이벤트 버스 시스템
├── EventSystem.js           (존재)      - 이벤트 시스템 (중복)
├── ModuleRegistry.js        389 lines  - 모듈 생명주기 관리
├── NavigationService.js     550 lines  - 페이지 네비게이션
├── PerformanceMonitor.js    732 lines  - 성능 모니터링
├── StateManager.js          605 lines  - 전역 상태 관리
└── UIFramework.js           (존재)      - UI 컴포넌트 팩토리
```

**핵심 역할**:
- 데이터 추상화 계층 (DataSkeleton)
- 이벤트 시스템 (EventSystem/EventBus - 중복 존재)
- UI 프레임워크 (UIFramework)
- 에러 처리 및 성능 모니터링

**문제점**:
- `EventSystem.js`와 `EventBus.js` 중복 가능성
- 일부 파일 라인 수 미확인 (DataSkeleton, EventSystem, UIFramework)

---

### 1.2 Modules 디렉토리 (기능 모듈)

#### A. 기본 매니저 모듈 (루트)
```
modules/
├── AdvancedChartManager.js        - 고급 차트 기능
├── AdvancedFilter.js              - 고급 필터링
├── AdvancedFilterEnhancer.js      - 필터 개선 기능
├── AdvancedSearchManager.js       - 검색 기능 고도화
├── ChartManager.js                - 기본 차트 관리
├── ColumnManager.js               - 컬럼 표시 제어
├── DashboardManager.js            - 대시보드 통합
├── DataCleanupManager.js          - 데이터 정제
├── ErrorFixManager.js             - 에러 수정
├── FilterManager.js               - 기본 필터링
├── LoadingManager.js              - 로딩 상태 관리
├── PaginationManager.js           - 페이지네이션
├── PerformanceManager.js          - 성능 최적화
├── PortfolioManager.js            - 포트폴리오 관리
└── ResponsiveManager.js           - 반응형 레이아웃
```

#### B. DeepCompare 모듈 (기업 비교)
```
modules/DeepCompare/
├── ComparisonEngine.js               - 비교 엔진
├── DeepCompare.js                    - 메인 컨트롤러
├── components/
│   ├── ComparisonLayout.js          - 레이아웃 컴포넌트
│   ├── DragAndDrop.js               - 드래그 앤 드롭
│   └── SelectionSearch.js           - 선택/검색 UI
└── visualizations/
    ├── BubbleChart.js               - 버블 차트
    └── RadarChart.js                - 레이더 차트
```

#### C. EconomicDashboard 모듈 (경제 지표)
```
modules/EconomicDashboard/
├── EconomicDashboard.js              22,710 bytes - 메인 대시보드
├── README.md                         12,268 bytes
├── components/
│   ├── EconomicAlertCenter.js       - 경제 알림 센터
│   ├── HighYieldHeatmap.js          - 고수익률 히트맵
│   ├── TEDSpreadChart.js            - TED 스프레드 차트
│   └── TreasuryRateCurve.js         - 국채 금리 곡선
└── styles/                           - 스타일 디렉토리
```

**중요 발견**:
- `EventSystem.js`, `DataSkeleton.js`, `UIFramework.js` 파일이 **존재하지 않음**
- HTML에서 로딩하려고 하지만 실제 파일 없음 → **404 에러 발생 가능**

#### D. MomentumHeatmap 모듈 (모멘텀 분석)
```
modules/MomentumHeatmap/
├── MomentumHeatmap.js                605 lines - 메인 히트맵
├── README.md                         10,847 bytes
├── components/
│   ├── DrilldownPanel.js            - 드릴다운 패널
│   ├── TimeFilter.js                - 시간 필터
│   ├── TooltipManager.js            - 툴팁 관리
│   ├── TreemapRenderer.js           - 트리맵 렌더러
│   └── ViewSwitcher.js              - 뷰 전환
└── styles/                           - 스타일 디렉토리
```

**중요 발견**:
- `EventSystem.js`, `DataSkeleton.js`, `UIFramework.js` 파일이 **존재하지 않음**
- HTML에서 로딩하려고 하지만 실제 파일 없음 → **404 에러 발생 가능**

#### E. Momentum 모듈 (Phase 2 - 모멘텀 상세 분석)
```
modules/Momentum/
├── CompanyComparison.js              - 기업 비교
├── CompanyDetailView.js              - 상세 보기
├── FilterEngine.js            730 lines - 필터 엔진
├── M_Company.js               927 lines - 회사 모델
├── MomentumCalculator.js      860 lines - 모멘텀 계산
├── MomentumVisualizer.js      957 lines - 시각화
└── RankingEngine.js           723 lines - 랭킹 엔진
```

#### F. PortfolioBuilder 모듈 (포트폴리오 구축)
```
modules/PortfolioBuilder/
├── Portfolio.js               166 lines - 포트폴리오 모델
├── PortfolioBuilder.js        440 lines - 메인 빌더
├── PortfolioOptimizer.js      159 lines - 최적화 엔진
├── RiskAnalyzer.js             89 lines - 리스크 분석
└── components/
    └── Layout.js                       - 레이아웃
```

#### G. SmartAnalytics 모듈 (AI 분석)
```
modules/SmartAnalytics/
├── MomentumAI.js               28 lines - AI 모멘텀 분석
├── SmartAnalytics.js          109 lines - 메인 분석 엔진
└── algorithms/
    └── momentum_score.js               - 모멘텀 스코어 알고리즘
```

---

### 1.3 중복 파일 분석

#### 문제: 공통 파일 중복 로딩
HTML (stock_analyzer.html)에서 다음과 같이 로딩:

```html
<!-- Line 1327-1330: EconomicDashboard -->
<script src="./modules/EconomicDashboard/EventSystem.js"></script>
<script src="./modules/EconomicDashboard/DataSkeleton.js"></script>
<script src="./modules/EconomicDashboard/UIFramework.js"></script>
<script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>

<!-- Line 1334-1337: MomentumHeatmap -->
<script src="./modules/MomentumHeatmap/EventSystem.js"></script>
<script src="./modules/MomentumHeatmap/DataSkeleton.js"></script>
<script src="./modules/MomentumHeatmap/UIFramework.js"></script>
<script src="./modules/MomentumHeatmap/MomentumHeatmap.js"></script>
```

**실제 파일 존재 여부**:
```bash
# 실제로 존재하는 파일:
./core/DataSkeleton.js          ✓
./core/EventSystem.js           ✓
./core/UIFramework.js           ✓

# 존재하지 않는 파일:
./modules/EconomicDashboard/EventSystem.js     ✗ (404)
./modules/EconomicDashboard/DataSkeleton.js    ✗ (404)
./modules/EconomicDashboard/UIFramework.js     ✗ (404)
./modules/MomentumHeatmap/EventSystem.js       ✗ (404)
./modules/MomentumHeatmap/DataSkeleton.js      ✗ (404)
./modules/MomentumHeatmap/UIFramework.js       ✗ (404)
```

**결론**:
- HTML이 존재하지 않는 파일을 로드하려고 시도
- 브라우저 콘솔에 **404 Not Found 에러 6개** 발생 예상
- 모듈들은 `core/` 디렉토리의 공통 파일을 참조해야 함

**해결 방안**:
1. **옵션 A (권장)**: HTML에서 중복 로딩 제거, core 파일만 한 번 로딩
2. **옵션 B**: 각 모듈에 개별 복사본 생성 (비권장, 유지보수 어려움)
3. **옵션 C**: ES6 모듈로 전환하여 import 사용

---

## 2. HTML 파일 스크립트 로딩 순서

### 2.1 stock_analyzer.html 스크립트 로딩 구조

```html
<!-- 1. 핵심 매니저 (6개) - Line 1282-1287 -->
<script src="./modules/ErrorFixManager.js"></script>
<script src="./modules/DataCleanupManager.js"></script>
<script src="./modules/ColumnManager.js"></script>
<script src="./modules/FilterManager.js"></script>
<script src="./modules/PaginationManager.js"></script>
<script src="./modules/LoadingManager.js"></script>

<!-- 2. 고급 필터 시스템 - Line 1290 -->
<script src="./modules/AdvancedFilter.js"></script>

<!-- 3. DeepCompare 모듈 (7개) - Line 1293-1299 -->
<script src="./modules/DeepCompare/ComparisonEngine.js"></script>
<script src="./modules/DeepCompare/components/ComparisonLayout.js"></script>
<script src="./modules/DeepCompare/components/DragAndDrop.js"></script>
<script src="./modules/DeepCompare/components/SelectionSearch.js"></script>
<script src="./modules/DeepCompare/visualizations/BubbleChart.js"></script>
<script src="./modules/DeepCompare/visualizations/RadarChart.js"></script>
<script src="./modules/DeepCompare/DeepCompare.js"></script>

<!-- 4. 테스팅 시스템 (5개) - Line 1302-1306 -->
<script src="./testing/ModuleTestRunner.js"></script>
<script src="./testing/IntegrationTests.js"></script>
<script src="./testing/reporters/DefaultReporter.js"></script>
<script src="./testing/CollaborativeTestSuite.js"></script>
<script src="./testing/registerBuiltinTests.js"></script>

<!-- 5. SmartAnalytics (2개) - Line 1309-1310 -->
<script src="./modules/SmartAnalytics/MomentumAI.js"></script>
<script src="./modules/SmartAnalytics/SmartAnalytics.js"></script>

<!-- 6. Deployment 시스템 (5개) - Line 1313-1317 -->
<script src="./deployment/CanaryDeployment.js"></script>
<script src="./deployment/AutoRollback.js"></script>
<script src="./deployment/HealthMonitor.js"></script>
<script src="./deployment/DeploymentDashboard.js"></script>
<script src="./deployment/SmartDeploymentSystem.js"></script>

<!-- 7. PortfolioBuilder (5개) - Line 1320-1324 -->
<script src="./modules/PortfolioBuilder/Portfolio.js"></script>
<script src="./modules/PortfolioBuilder/PortfolioOptimizer.js"></script>
<script src="./modules/PortfolioBuilder/RiskAnalyzer.js"></script>
<script src="./modules/PortfolioBuilder/components/Layout.js"></script>
<script src="./modules/PortfolioBuilder/PortfolioBuilder.js"></script>

<!-- 8. EconomicDashboard (4개) - Line 1327-1330 -->
<!-- ⚠️ 문제: 존재하지 않는 파일 로딩 -->
<script src="./modules/EconomicDashboard/EventSystem.js"></script>      ✗
<script src="./modules/EconomicDashboard/DataSkeleton.js"></script>     ✗
<script src="./modules/EconomicDashboard/UIFramework.js"></script>      ✗
<script src="./modules/EconomicDashboard/EconomicDashboard.js"></script> ✓

<!-- 9. D3.js 라이브러리 - Line 1333 -->
<script src="https://d3js.org/d3.v7.min.js"></script>

<!-- 10. MomentumHeatmap (4개) - Line 1334-1337 -->
<!-- ⚠️ 문제: 존재하지 않는 파일 로딩 -->
<script src="./modules/MomentumHeatmap/EventSystem.js"></script>         ✗
<script src="./modules/MomentumHeatmap/DataSkeleton.js"></script>        ✗
<script src="./modules/MomentumHeatmap/UIFramework.js"></script>         ✗
<script src="./modules/MomentumHeatmap/MomentumHeatmap.js"></script>     ✓

<!-- 11. Momentum Phase 2 (7개) - Line 1340-1346 -->
<script src="./modules/Momentum/MomentumCalculator.js"></script>
<script src="./modules/Momentum/RankingEngine.js"></script>
<script src="./modules/Momentum/FilterEngine.js"></script>
<script src="./modules/Momentum/MomentumVisualizer.js"></script>
<script src="./modules/Momentum/CompanyDetailView.js"></script>
<script src="./modules/Momentum/CompanyComparison.js"></script>
<script src="./modules/Momentum/M_Company.js"></script>

<!-- 12. 메인 애플리케이션 - Line 1348 -->
<script src="./stock_analyzer_enhanced.js"></script>
```

### 2.2 로딩 순서 문제점

#### 문제 1: 존재하지 않는 파일 로딩 (6개 404 에러)
```
./modules/EconomicDashboard/EventSystem.js
./modules/EconomicDashboard/DataSkeleton.js
./modules/EconomicDashboard/UIFramework.js
./modules/MomentumHeatmap/EventSystem.js
./modules/MomentumHeatmap/DataSkeleton.js
./modules/MomentumHeatmap/UIFramework.js
```

#### 문제 2: 의존성 순서 불일치
- `core/` 디렉토리의 기본 시스템이 로드되지 않음
- 모듈들이 `EventSystem`, `DataSkeleton`, `UIFramework`를 사용하지만 선행 로드 없음

#### 문제 3: 테스팅/배포 시스템 프로덕션 로딩
- `testing/` 디렉토리 파일들이 프로덕션 HTML에 포함됨
- `deployment/` 시스템도 항상 로드됨 (조건부 로딩 필요)

---

## 3. 데이터 파이프라인

### 3.1 데이터 디렉토리 구조
```
data/
├── enhanced_summary_data.json          # 메인 데이터 파일
├── column_config.json                  # 컬럼 설정
├── enhanced_column_config.json         # 확장 컬럼 설정
├── archives/
│   └── summary_data.json              # 아카이브 데이터
├── backups/                            # 자동 백업
│   ├── enhanced_summary_data_20251008T200703Z.json
│   ├── enhanced_summary_data_20251008T200746Z.json
│   └── enhanced_summary_data_20251008T200913Z.json
└── screener_indices/                   # 스크리너 인덱스
    ├── quality_index.json
    ├── value_index.json
    └── momentum_index.json
```

### 3.2 Python 데이터 처리 파이프라인

#### 자동화 스크립트 (automation/)
```python
automation/
├── DataCleaner.py                     # 고급 데이터 정제 (메인)
├── enhanced_data_processor.py         # 데이터 처리 엔진
├── WeeklyDataProcessor.py             # 주간 데이터 업데이트
├── AutoUpdater.py                     # 자동 업데이트
├── SchemaValidator.py                 # 스키마 검증
├── data_validator.py                  # 데이터 유효성 검증
├── backup_manager.py                  # 백업 관리
├── quality_report.py                  # 품질 보고서 생성
├── run_automation.py                  # 자동화 실행
└── run_weekly_update.py               # 주간 업데이트 실행
```

#### DataCleaner.py 핵심 기능
```python
class AdvancedDataCleaner:
    def __init__(self):
        # 문제가 있는 값 감지
        self.problematic_values = {
            "nan", "infinity", "-infinity",
            "0x2a", "#n/a", "0xf",  # ← 16진수 패턴
            "", "null", "undefined"
        }

        # 필수 필드
        self.required_fields = ["Ticker", "corpName"]

        # 숫자 필드 자동 감지 (정규식)
        self.numeric_field_hints = re.compile(
            r"(?:price|per|pbr|roe|dy|return|sales|market|value|ratio|growth|opm|w$|^\d+)",
            re.IGNORECASE
        )

        # 통화 매핑
        self.currency_map = {
            "$": "USD", "₩": "KRW", "€": "EUR",
            "£": "GBP", "¥": "JPY", "HK$": "HKD"
        }
```

**핵심 처리 과정**:
1. **데이터 정제** (`clean_enhanced_summary_data`)
   - 백업 생성
   - 회사 데이터 정제
   - 필수 필드 검증
   - 스키마 통일화

2. **값 정규화** (`normalize_value`)
   - 문제 값 제거 (0x2a, nan, infinity 등)
   - 숫자 필드 자동 감지
   - 통화 정보 추출
   - 16진수 → 실제 값 변환

3. **숫자 파싱** (`_parse_numeric`)
   - 통화 기호 제거
   - 쉼표 제거
   - 실수 변환
   - 에러 처리

### 3.3 데이터 흐름도

```
1. Excel/CSV 원본 데이터
   ↓
2. Python 스크립트 (DataCleaner.py)
   ├─ 정제: 0x2a → 실제 값 변환
   ├─ 검증: 필수 필드 체크
   ├─ 백업: 타임스탬프 백업 생성
   └─ 보고서: quality_report 생성
   ↓
3. enhanced_summary_data.json
   ├─ 메인 데이터 소스
   └─ 1,250개 기업 데이터
   ↓
4. JavaScript 로딩 (stock_analyzer_enhanced.js)
   ├─ fetch("./data/enhanced_summary_data.json")
   ├─ DataCleanupManager: 추가 정제
   ├─ ErrorFixManager: 에러 수정
   └─ 캐싱 및 인덱싱
   ↓
5. UI 렌더링
   ├─ FilterManager: 필터링
   ├─ PaginationManager: 페이지네이션
   └─ 차트/테이블 표시
```

### 3.4 데이터 품질 문제 및 해결

#### 과거 문제 (REFRESH_GUIDE.md):
```
문제:
- 엔비디아 매출성장률: 0.35% (실제 34.90%)
- 엔비디아 연간수익률: 0.38% (실제 38.34%)
- 엔비디아 ROE: 0.79% (실제 79.43%)

원인:
- CSV에서 "0x2a" 같은 16진수 패턴
- 퍼센트 데이터 정규화 오류

해결:
- DataCleaner.py의 problematic_values에 "0x2a" 추가
- 정규식 기반 자동 감지
- 통화/단위 자동 추출
```

---

## 4. 테스트 파일 구조

### 4.1 테스트 디렉토리
```
tests/
├── setup.js                           # Vitest 설정
├── unit/                              # 단위 테스트
│   ├── DataSkeleton.test.js          # DataSkeleton 테스트
│   ├── EventSystem.test.js           # EventSystem 테스트
│   └── UIFramework.test.js           # UIFramework 테스트
├── integration/                       # 통합 테스트
│   └── full-workflow.test.js         # 전체 워크플로우
├── core/                              # Core 시스템 테스트
│   └── core.integration.test.js      # Core 통합 테스트
├── momentum/                          # Momentum 테스트
│   └── M_Company.test.js             # M_Company 모델 테스트
└── performance/                       # 성능 테스트
    └── benchmark.test.js             # 벤치마크
```

### 4.2 테스트 설정 (package.json)
```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "@vitest/ui": "^1.0.0",
    "vitest": "^1.0.0",
    "jsdom": "^23.0.0"
  }
}
```

### 4.3 테스트 대상 모듈
```
Core 시스템:
- ✓ DataSkeleton (데이터 계층)
- ✓ EventSystem (이벤트 버스)
- ✓ UIFramework (UI 프레임워크)

모듈:
- ✓ M_Company (Momentum 회사 모델)

통합:
- ✓ Full Workflow (전체 워크플로우)
- ✓ Core Integration (Core 시스템 통합)

성능:
- ✓ Benchmark (벤치마크)
```

---

## 5. 버그 가능성 분석

### 5.1 심각도 HIGH - 404 Not Found 에러

#### 문제
HTML이 존재하지 않는 파일 6개를 로드하려고 시도:
```html
<!-- EconomicDashboard -->
<script src="./modules/EconomicDashboard/EventSystem.js"></script>     ✗
<script src="./modules/EconomicDashboard/DataSkeleton.js"></script>    ✗
<script src="./modules/EconomicDashboard/UIFramework.js"></script>     ✗

<!-- MomentumHeatmap -->
<script src="./modules/MomentumHeatmap/EventSystem.js"></script>        ✗
<script src="./modules/MomentumHeatmap/DataSkeleton.js"></script>       ✗
<script src="./modules/MomentumHeatmap/UIFramework.js"></script>        ✗
```

#### 영향
- **브라우저 콘솔**: 404 에러 6개
- **모듈 초기화 실패**: EconomicDashboard, MomentumHeatmap 작동 불가
- **사용자 경험**: 대시보드 탭 기능 손상

#### 해결 방법
```html
<!-- 수정 전 (Line 1327-1330) -->
<script src="./modules/EconomicDashboard/EventSystem.js"></script>
<script src="./modules/EconomicDashboard/DataSkeleton.js"></script>
<script src="./modules/EconomicDashboard/UIFramework.js"></script>
<script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>

<!-- 수정 후 -->
<script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>
<!-- core/ 파일은 한 번만 로드 -->
```

---

### 5.2 심각도 MEDIUM - 의존성 순서 문제

#### 문제
Core 시스템 (`EventSystem`, `DataSkeleton`, `UIFramework`)이 로드되지 않음

#### 현재 상태
```html
<!-- Core 시스템 없음 -->

<!-- 바로 모듈 로드 시작 -->
<script src="./modules/ErrorFixManager.js"></script>
<script src="./modules/DataCleanupManager.js"></script>
```

#### 예상 에러
```javascript
ReferenceError: EventSystem is not defined
ReferenceError: DataSkeleton is not defined
ReferenceError: UIFramework is not defined
```

#### 해결 방법
```html
<!-- 1. Core 시스템 먼저 로드 -->
<script src="./core/EventSystem.js"></script>
<script src="./core/DataSkeleton.js"></script>
<script src="./core/UIFramework.js"></script>
<script src="./core/ModuleRegistry.js"></script>
<script src="./core/ErrorBoundary.js"></script>
<script src="./core/DataProvider.js"></script>
<script src="./core/StateManager.js"></script>

<!-- 2. 그 다음 모듈 로드 -->
<script src="./modules/ErrorFixManager.js"></script>
<script src="./modules/DataCleanupManager.js"></script>
<!-- ... -->
```

---

### 5.3 심각도 MEDIUM - 전역 namespace 충돌

#### 문제
여러 모듈이 `window` 객체에 전역 변수 등록:
```javascript
// EventSystem.js
window.eventSystem = new EventSystem();

// DataSkeleton.js (추정)
window.dataSkeleton = new DataSkeleton();

// 각 매니저들
window.filterManager = ...;
window.columnManager = ...;
```

#### 충돌 가능성
- 모듈 간 이름 충돌
- 메모리 누수 (제거되지 않는 전역 변수)
- 다른 라이브러리와 충돌

#### 해결 방법
```javascript
// 네임스페이스 패턴
window.StockAnalyzer = {
    core: {
        eventSystem: new EventSystem(),
        dataSkeleton: new DataSkeleton(),
        uiFramework: new UIFramework()
    },
    modules: {
        filterManager: new FilterManager(),
        columnManager: new ColumnManager()
    }
};
```

---

### 5.4 심각도 LOW - 테스트/배포 코드 프로덕션 포함

#### 문제
프로덕션 HTML에 테스팅/배포 시스템 포함:
```html
<!-- 테스팅 시스템 (개발용) -->
<script src="./testing/ModuleTestRunner.js"></script>
<script src="./testing/IntegrationTests.js"></script>
<script src="./testing/reporters/DefaultReporter.js"></script>
<script src="./testing/CollaborativeTestSuite.js"></script>
<script src="./testing/registerBuiltinTests.js"></script>

<!-- 배포 시스템 (운영용) -->
<script src="./deployment/CanaryDeployment.js"></script>
<script src="./deployment/AutoRollback.js"></script>
<script src="./deployment/HealthMonitor.js"></script>
<script src="./deployment/DeploymentDashboard.js"></script>
<script src="./deployment/SmartDeploymentSystem.js"></script>
```

#### 영향
- 불필요한 네트워크 요청
- 페이지 로딩 속도 저하
- 프로덕션 로그 오염

#### 해결 방법
```html
<!-- 조건부 로딩 -->
<script>
if (window.location.hostname === 'localhost') {
    // 개발 환경에서만 테스팅 시스템 로드
    loadScript('./testing/ModuleTestRunner.js');
}
</script>
```

---

### 5.5 심각도 LOW - 데이터 로딩 타이밍 이슈

#### 문제
스크립트 로드 순서와 데이터 fetch 타이밍 불일치

#### 시나리오
```javascript
// 1. stock_analyzer_enhanced.js 로드 시작
fetch('./data/enhanced_summary_data.json')
    .then(data => {
        window.stockData = data;  // 데이터 저장
    });

// 2. 모듈들이 즉시 데이터 접근 시도
// (fetch가 완료되지 않았을 수 있음)
filterManager.init();  // window.stockData가 undefined일 수 있음
```

#### 해결 방법
```javascript
// Promise 기반 초기화
async function initializeApp() {
    // 1. 데이터 로드
    const data = await fetch('./data/enhanced_summary_data.json')
        .then(r => r.json());

    // 2. Core 초기화
    window.eventSystem.init();
    window.dataSkeleton.init(data);

    // 3. 모듈 초기화
    await Promise.all([
        filterManager.init(),
        columnManager.init(),
        chartManager.init()
    ]);

    // 4. UI 렌더링
    renderApp();
}

// DOM 준비 후 실행
document.addEventListener('DOMContentLoaded', initializeApp);
```

---

## 6. 권장 수정 사항

### 6.1 즉시 수정 (Critical)

#### 1. HTML 스크립트 로딩 수정
```html
<!-- stock_analyzer.html -->

<!-- ============================================ -->
<!-- Step 1: Core 시스템 (필수, 가장 먼저) -->
<!-- ============================================ -->
<script src="./core/EventSystem.js"></script>
<script src="./core/DataSkeleton.js"></script>
<script src="./core/UIFramework.js"></script>
<script src="./core/ModuleRegistry.js"></script>
<script src="./core/ErrorBoundary.js"></script>
<script src="./core/DataProvider.js"></script>

<!-- ============================================ -->
<!-- Step 2: 외부 라이브러리 -->
<!-- ============================================ -->
<script src="https://d3js.org/d3.v7.min.js"></script>

<!-- ============================================ -->
<!-- Step 3: 기본 매니저 -->
<!-- ============================================ -->
<script src="./modules/ErrorFixManager.js"></script>
<script src="./modules/DataCleanupManager.js"></script>
<script src="./modules/ColumnManager.js"></script>
<script src="./modules/FilterManager.js"></script>
<script src="./modules/PaginationManager.js"></script>
<script src="./modules/LoadingManager.js"></script>

<!-- ============================================ -->
<!-- Step 4: 기능 모듈 (중복 로딩 제거) -->
<!-- ============================================ -->
<!-- DeepCompare -->
<script src="./modules/DeepCompare/ComparisonEngine.js"></script>
<script src="./modules/DeepCompare/components/ComparisonLayout.js"></script>
<script src="./modules/DeepCompare/components/DragAndDrop.js"></script>
<script src="./modules/DeepCompare/components/SelectionSearch.js"></script>
<script src="./modules/DeepCompare/visualizations/BubbleChart.js"></script>
<script src="./modules/DeepCompare/visualizations/RadarChart.js"></script>
<script src="./modules/DeepCompare/DeepCompare.js"></script>

<!-- SmartAnalytics -->
<script src="./modules/SmartAnalytics/MomentumAI.js"></script>
<script src="./modules/SmartAnalytics/SmartAnalytics.js"></script>

<!-- PortfolioBuilder -->
<script src="./modules/PortfolioBuilder/Portfolio.js"></script>
<script src="./modules/PortfolioBuilder/PortfolioOptimizer.js"></script>
<script src="./modules/PortfolioBuilder/RiskAnalyzer.js"></script>
<script src="./modules/PortfolioBuilder/components/Layout.js"></script>
<script src="./modules/PortfolioBuilder/PortfolioBuilder.js"></script>

<!-- EconomicDashboard (중복 제거) -->
<script src="./modules/EconomicDashboard/EconomicDashboard.js"></script>

<!-- MomentumHeatmap (중복 제거) -->
<script src="./modules/MomentumHeatmap/MomentumHeatmap.js"></script>

<!-- Momentum Phase 2 -->
<script src="./modules/Momentum/MomentumCalculator.js"></script>
<script src="./modules/Momentum/RankingEngine.js"></script>
<script src="./modules/Momentum/FilterEngine.js"></script>
<script src="./modules/Momentum/MomentumVisualizer.js"></script>
<script src="./modules/Momentum/CompanyDetailView.js"></script>
<script src="./modules/Momentum/CompanyComparison.js"></script>
<script src="./modules/Momentum/M_Company.js"></script>

<!-- ============================================ -->
<!-- Step 5: 메인 애플리케이션 (마지막) -->
<!-- ============================================ -->
<script src="./stock_analyzer_enhanced.js"></script>
```

#### 2. 조건부 스크립트 로딩
```html
<!-- 개발 환경에서만 로드 -->
<script>
(function() {
    const isDevelopment = window.location.hostname === 'localhost'
                       || window.location.hostname === '127.0.0.1';

    if (isDevelopment) {
        // 테스팅 시스템
        loadScript('./testing/ModuleTestRunner.js');
        loadScript('./testing/IntegrationTests.js');
        loadScript('./testing/reporters/DefaultReporter.js');
        loadScript('./testing/CollaborativeTestSuite.js');
        loadScript('./testing/registerBuiltinTests.js');

        // 배포 시스템
        loadScript('./deployment/CanaryDeployment.js');
        loadScript('./deployment/AutoRollback.js');
        loadScript('./deployment/HealthMonitor.js');
        loadScript('./deployment/DeploymentDashboard.js');
        loadScript('./deployment/SmartDeploymentSystem.js');
    }

    function loadScript(src) {
        const script = document.createElement('script');
        script.src = src;
        document.head.appendChild(script);
    }
})();
</script>
```

---

### 6.2 단기 개선 (1주일 내)

#### 1. ES6 모듈로 전환
```javascript
// core/EventSystem.js
export default class EventSystem {
    // ...
}

// modules/FilterManager.js
import EventSystem from '../core/EventSystem.js';
import DataSkeleton from '../core/DataSkeleton.js';

class FilterManager {
    constructor() {
        this.eventSystem = new EventSystem();
        this.dataSkeleton = new DataSkeleton();
    }
}

export default FilterManager;

// stock_analyzer.html
<script type="module">
    import { initializeApp } from './stock_analyzer_enhanced.js';
    initializeApp();
</script>
```

#### 2. 네임스페이스 통합
```javascript
// global-namespace.js
window.StockAnalyzer = {
    version: '2.0.0',

    // Core
    core: {
        eventSystem: null,
        dataSkeleton: null,
        uiFramework: null,
        moduleRegistry: null
    },

    // Modules
    modules: {
        filter: null,
        column: null,
        chart: null,
        pagination: null
    },

    // Data
    data: {
        raw: null,
        processed: null,
        cache: new Map()
    },

    // Utils
    utils: {
        init() {
            // 초기화 로직
        }
    }
};
```

---

### 6.3 중기 개선 (1-2주)

#### 1. 빌드 시스템 도입
```javascript
// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: './stock_analyzer.html',
                worker: './workers/data-processor.js'
            },
            output: {
                manualChunks: {
                    'vendor': ['chart.js', 'd3'],
                    'core': ['./core/EventSystem.js', './core/DataSkeleton.js'],
                    'modules': ['./modules/FilterManager.js', './modules/ChartManager.js']
                }
            }
        }
    }
});
```

#### 2. 웹 워커로 데이터 처리 이동
```javascript
// workers/data-processor.js
self.onmessage = function(e) {
    const { action, data } = e.data;

    switch(action) {
        case 'CLEAN_DATA':
            const cleaned = cleanData(data);
            self.postMessage({ action: 'CLEANED', data: cleaned });
            break;

        case 'FILTER_DATA':
            const filtered = filterData(data);
            self.postMessage({ action: 'FILTERED', data: filtered });
            break;
    }
};

// main thread
const worker = new Worker('./workers/data-processor.js');
worker.postMessage({ action: 'CLEAN_DATA', data: rawData });
worker.onmessage = (e) => {
    console.log('처리 완료:', e.data);
};
```

---

## 7. 요약 및 결론

### 7.1 현재 상태
- **총 모듈 수**: 50+ 개
- **코드 라인**: 18,930+ 줄 (modules/ 디렉토리만)
- **데이터 파일**: 10+ 개 JSON 파일
- **테스트**: Vitest 기반 단위/통합 테스트

### 7.2 주요 발견사항
1. ✗ **6개 404 에러**: 존재하지 않는 파일 로딩
2. ✗ **Core 시스템 누락**: 의존성 순서 문제
3. ✓ **데이터 파이프라인**: 잘 구축됨
4. ✓ **테스트 인프라**: Vitest 설정 완료
5. ⚠️ **전역 namespace 관리**: 개선 필요

### 7.3 즉시 조치 필요
1. **HTML 스크립트 로딩 수정** (30분)
   - 중복 로딩 제거
   - Core 시스템 먼저 로드
   - 조건부 개발 스크립트

2. **404 에러 해결** (15분)
   - 6개 파일 참조 제거
   - 또는 core/ 파일 링크

3. **초기화 순서 정리** (1시간)
   - Promise 기반 초기화
   - 의존성 체크
   - 에러 처리

### 7.4 개발 우선순위
```
Priority 1 (즉시):
- [ ] HTML 스크립트 로딩 순서 수정
- [ ] 404 에러 제거
- [ ] Core 시스템 로드 추가

Priority 2 (1주):
- [ ] ES6 모듈 전환
- [ ] 네임스페이스 통합
- [ ] 테스트 실행 및 수정

Priority 3 (2주):
- [ ] 빌드 시스템 도입 (Vite/Webpack)
- [ ] 웹 워커 최적화
- [ ] 코드 스플리팅
```

---

**보고서 작성**: Claude Code (Root Cause Analyst Mode)
**분석 기준 날짜**: 2025-10-16
**다음 업데이트**: 수정 사항 적용 후
