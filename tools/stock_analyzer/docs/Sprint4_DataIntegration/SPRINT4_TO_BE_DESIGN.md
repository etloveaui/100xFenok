# Sprint 4: 데이터 통합 완성 - To-Be Design

**작성일**: 2025-10-18
**Sprint**: Sprint 4 - 데이터 통합 완성
**Phase**: Phase 1 - To-Be Design
**방법론**: SPEC_DRIVEN_WORKFLOW

---

## 📋 Executive Summary

**설계 방향**: Option 1 - HTML 수정 (개별 JSON 로딩)

**핵심 결정 사항**:
- 개별 JSON 파일이 PRIMARY 데이터 소스
- 각 Analytics 모듈이 개별 JSON 파일 직접 로딩
- 매주 Excel → CSV → JSON 덮어쓰기 워크플로우 지원
- 22개 CSV 전체 활용 (현재 3개 → 목표 22개)

**예상 개발 기간**: 4-6주 (단계별)
- Phase 1 모듈 (Critical): 5개, 8주
- Phase 2 모듈 (High): 6개, 11주
- Phase 3 모듈 (Medium): 6개, 9주

---

## 🎯 Option 선택 배경

### Option 1 vs Option 2 비교

| 기준 | Option 1 (개별 JSON) | Option 2 (통합 JSON) |
|------|---------------------|-------------------|
| **매주 업데이트** | ✅ 간단 (파일 덮어쓰기) | ❌ 복잡 (통합 스크립트) |
| **자동화** | ✅ 1회 스크립트 실행 | ❌ 2단계 (변환 + 통합) |
| **유지보수** | ✅ 쉬움 (독립적) | ❌ 어려움 (의존성) |
| **확장성** | ✅ 모듈 추가 쉬움 | ⚠️ 통합 스크립트 수정 |
| **개발 복잡도** | ⚠️ HTML 수정 필요 | ✅ 기존 구조 유지 |

### 최종 선택: Option 1

**이유**:
1. **매주 반복 작업 최소화** - 사용자가 매주 Excel 받음
2. **워크플로우 단순화** - 엑셀 → CSV → JSON 끝
3. **유지보수 용이** - 각 모듈 독립적 운영
4. **확장성** - 새 CSV 추가 시 JSON만 생성하면 끝

**Trade-off 수용**:
- HTML/JS 수정 필요 (1회성 작업)
- 모듈별 개별 로딩 (성능 영향 미미)

---

## 🏗️ To-Be 아키텍처

### 1. 데이터 흐름 (개별 JSON 방식)

```
┌─────────────────────────────────────────────────────────┐
│ 주간 업데이트 워크플로우 (사용자 수행)                       │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────┐
    │ Global_Scouter_YYMMDD.xlsx (1 file)  │
    │                                      │
    │ Sheets:                              │
    │ - M_Company (6,176 rows)             │
    │ - M_ETFs (32 rows)                   │
    │ - T_EPS_C (1,253 rows)               │
    │ - T_Growth_C (1,253 rows)            │
    │ - T_Rank (1,256 rows)                │
    │ - T_CFO (1,267 rows)                 │
    │ - T_Correlation (1,252 rows)         │
    │ - [15 more sheets...]                │
    └──────────────────────────────────────┘
                        │
                        ▼
    ┌──────────────────────────────────────┐
    │ Python Script: simple_csv_converter  │
    │ $ python scripts/simple_csv_converter.py │
    └──────────────────────────────────────┘
                        │
            ┌───────────┴───────────┐
            ▼                       ▼
    ┌──────────────┐       ┌──────────────┐
    │ CSV 생성     │       │ JSON 생성    │
    │              │       │              │
    │ M_Company.csv│  →    │M_Company.json│
    │ T_EPS_C.csv  │  →    │T_EPS_C.json  │
    │ T_Growth_C...│  →    │T_Growth_C... │
    │ [22 files]   │       │ [22 files]   │
    └──────────────┘       └──────────────┘
                                    │
                                    ▼
    ┌──────────────────────────────────────┐
    │ 기존 JSON 파일 덮어쓰기 (Overwrite)    │
    │ data/M_Company.json ← 새 데이터       │
    │ data/T_EPS_C.json ← 새 데이터         │
    │ data/T_Growth_C.json ← 새 데이터      │
    │ [22 files 자동 업데이트]               │
    └──────────────────────────────────────┘
```

### 2. HTML 로딩 구조 (To-Be)

```javascript
// stock_analyzer.html - 메인 로딩 로직

async function loadAllAnalytics() {
  try {
    // 1. Master Data Loading
    const masterProvider = new CompanyMasterProvider();
    await masterProvider.loadFromJSON('data/M_Company.json');

    const etfProvider = new ETFMasterProvider();
    await etfProvider.loadFromJSON('data/M_ETFs.json');

    // 2. Technical Analytics Loading
    const epsAnalytics = new EPSAnalytics();
    await epsAnalytics.loadFromJSON('data/T_EPS_C.json');

    const growthAnalytics = new GrowthAnalytics();
    await growthAnalytics.loadFromJSON('data/T_Growth_C.json');

    const rankingAnalytics = new RankingAnalytics();
    await rankingAnalytics.loadFromJSON('data/T_Rank.json');

    const cfoAnalytics = new CFOAnalytics();
    await cfoAnalytics.loadFromJSON('data/T_CFO.json');

    const correlationEngine = new CorrelationEngine();
    await correlationEngine.loadFromJSON('data/T_Correlation.json');

    // 3. Advanced Analytics Loading (Phase 1 개발 필요)
    const comparisonEngine = new ComparisonEngine();
    await comparisonEngine.loadFromJSON('data/A_Compare.json');

    const contrastAnalytics = new ContrastAnalytics();
    await contrastAnalytics.loadFromJSON('data/A_Contrast.json');

    // 4. Screening Tools Loading (Phase 2 개발 필요)
    const chartScreener = new ChartScreener();
    await chartScreener.loadFromJSON('data/S_Chart.json');

    const valuationScreener = new ValuationScreener();
    await valuationScreener.loadFromJSON('data/S_Valuation.json');

    // 5. Economic Indicators (Phase 2 개발 필요)
    const economicIndicatorEngine = new EconomicIndicatorEngine();
    await economicIndicatorEngine.loadFromJSON('data/E_Indicators.json');

    // [... 더 많은 모듈 ...]

    console.log('✅ All analytics modules loaded successfully');

  } catch (error) {
    console.error('❌ Failed to load analytics:', error);
  }
}
```

### 3. 모듈별 JSON 매핑 (22개 전체)

#### Master Data (2개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| CompanyMasterProvider | M_Company.json | 6,179 | 🔴 Phase 1 |
| ETFMasterProvider | M_ETFs.json | 32 | 🟡 Phase 2 |

#### Technical Analytics (10개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| EPSAnalytics | T_EPS_C.json | 1,253 | ✅ 완료 |
| GrowthAnalytics | T_Growth_C.json | 1,253 | ✅ 완료 |
| RankingAnalytics | T_Rank.json | 1,256 | ✅ 완료 |
| CFOAnalytics | T_CFO.json | 1,267 | ✅ 완료 |
| CorrelationEngine | T_Correlation.json | 1,252 | ✅ 완료 |
| HistoricalAnalytics | T_EPS_H.json | 56 | 🟢 Phase 3 |
| HistoricalGrowthAnalytics | T_Growth_H.json | 56 | 🟢 Phase 3 |
| ChartDataProvider | T_Chart.json | 91 | 🟡 Phase 2 |
| ChecklistManager | T_Chk.json | 1,253 | 🟡 Phase 2 |
| MarketCapAnalytics | UP_&_Down.csv | 49 | 🟢 Phase 3 |

#### Advanced Analytics (5개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| AdvancedCompanyAnalytics | A_Company.json | 1,253 | 🟡 Phase 2 |
| ComparisonEngine | A_Compare.json | 496 | 🔴 Phase 1 |
| ContrastAnalytics | A_Contrast.json | 116 | 🟢 Phase 3 |
| DistributionAnalytics | A_Distribution.json | 1,178 | 🟢 Phase 3 |
| AdvancedETFAnalytics | A_ETFs.json | 492 | 🟢 Phase 3 |

#### Screening Tools (3개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| ChartScreener | S_Chart.json | 122 | 🟡 Phase 2 |
| ValuationScreener | S_Valuation.json | 37 | 🟡 Phase 2 |
| WatchlistManager | S_Mylist.json | 22 | 🔴 Phase 1 |

#### Economic Indicators (1개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| EconomicIndicatorEngine | E_Indicators.json | 1,033 | 🟡 Phase 2 |

#### Documentation (1개)
| Module | JSON File | Records | Status |
|--------|-----------|---------|--------|
| ReadMeProvider | ReadMe.csv | 37 | 🟢 Phase 3 |

**총계**: 22 modules, 17 신규 개발 필요 (5개 완료)

---

## 📐 To-Be 시스템 설계

### 1. BaseAnalytics 패턴 (모든 모듈 공통)

```javascript
// BaseAnalytics.js (기존 유지)
class BaseAnalytics {
  constructor() {
    this.data = null;
    this.cache = new Map();
  }

  async loadFromJSON(jsonPath) {
    const response = await fetch(jsonPath);
    const rawData = await response.json();
    this.data = this.processData(rawData);
    console.log(`✅ Loaded ${this.constructor.name} from ${jsonPath}`);
  }

  processData(rawData) {
    // Override in subclass
    return rawData;
  }

  // Common methods...
}
```

### 2. 신규 모듈 구현 패턴

```javascript
// Example: CompanyMasterProvider.js (Phase 1 - Critical)
class CompanyMasterProvider extends BaseAnalytics {
  constructor() {
    super();
    this.companyMap = new Map(); // ticker → company data
    this.industryIndex = new Map(); // industry → companies[]
    this.exchangeIndex = new Map(); // exchange → companies[]
  }

  async loadFromJSON(jsonPath) {
    await super.loadFromJSON(jsonPath);
    this.buildIndexes();
  }

  processData(rawData) {
    // M_Company.json: 6,179 companies
    return rawData.map(company => ({
      ticker: company.Ticker,
      corpName: company.corpName,
      industry: company.industry,
      exchange: company.exchange,
      // ... all 39 fields
    }));
  }

  buildIndexes() {
    // O(n) indexing for fast lookups
    for (const company of this.data) {
      this.companyMap.set(company.ticker, company);

      if (!this.industryIndex.has(company.industry)) {
        this.industryIndex.set(company.industry, []);
      }
      this.industryIndex.get(company.industry).push(company);

      // ... more indexes
    }
  }

  getCompanyByTicker(ticker) {
    return this.companyMap.get(ticker); // O(1)
  }

  getCompaniesByIndustry(industry) {
    return this.industryIndex.get(industry) || []; // O(1)
  }
}
```

### 3. HTML Integration Pattern

```html
<!-- stock_analyzer.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- ... existing head ... -->
</head>
<body>
  <!-- ... existing UI ... -->

  <!-- Module Scripts (개별 로딩) -->
  <script src="core/BaseAnalytics.js"></script>

  <!-- Master Data Providers -->
  <script src="modules/CompanyMasterProvider.js"></script>
  <script src="modules/ETFMasterProvider.js"></script>

  <!-- Technical Analytics (기존 5개) -->
  <script src="modules/EPSAnalytics.js"></script>
  <script src="modules/GrowthAnalytics.js"></script>
  <script src="modules/RankingAnalytics.js"></script>
  <script src="modules/CFOAnalytics.js"></script>
  <script src="modules/CorrelationEngine.js"></script>

  <!-- Advanced Analytics (Phase 1 - 신규 5개) -->
  <script src="modules/ComparisonEngine.js"></script>
  <script src="modules/WatchlistManager.js"></script>
  <script src="modules/ValidationAnalytics.js"></script>
  <!-- ... -->

  <!-- Phase 2 - 신규 6개 -->
  <script src="modules/ChartScreener.js"></script>
  <script src="modules/ValuationScreener.js"></script>
  <!-- ... -->

  <!-- Phase 3 - 신규 6개 -->
  <script src="modules/HistoricalAnalytics.js"></script>
  <script src="modules/DistributionAnalytics.js"></script>
  <!-- ... -->

  <!-- Main App -->
  <script src="stock_analyzer_enhanced.js"></script>

  <script>
    // Initialize all modules on page load
    window.addEventListener('DOMContentLoaded', async () => {
      await loadAllAnalytics();
      initializeDashboard();
    });
  </script>
</body>
</html>
```

### 4. Dashboard Integration

```javascript
// DashboardManager.js (확장)
class DashboardManager {
  constructor() {
    this.modules = {
      // Master Data
      companyMaster: null,
      etfMaster: null,

      // Technical Analytics (기존)
      eps: null,
      growth: null,
      ranking: null,
      cfo: null,
      correlation: null,

      // Advanced Analytics (Phase 1)
      comparison: null,
      watchlist: null,
      validation: null,

      // Screening (Phase 2)
      chartScreener: null,
      valuationScreener: null,

      // Economic (Phase 2)
      economicIndicators: null,

      // Historical (Phase 3)
      historicalEPS: null,
      historicalGrowth: null,
    };
  }

  async initializeAllModules() {
    // Load all modules in parallel
    await Promise.all([
      this.initMasterData(),
      this.initTechnicalAnalytics(),
      this.initAdvancedAnalytics(),
      this.initScreeningTools(),
      this.initEconomicIndicators(),
    ]);
  }

  async initMasterData() {
    this.modules.companyMaster = new CompanyMasterProvider();
    await this.modules.companyMaster.loadFromJSON('data/M_Company.json');

    this.modules.etfMaster = new ETFMasterProvider();
    await this.modules.etfMaster.loadFromJSON('data/M_ETFs.json');
  }

  // ... more initialization methods
}
```

---

## 🔄 매주 업데이트 워크플로우 (To-Be)

### 사용자 관점 (매주 반복)

```bash
# 1. Excel 다운로드 (주간 데이터)
Global_Scouter_20251025.xlsx  # 예: 10월 25일

# 2. 작업 디렉토리 이동
cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer

# 3. 변환 스크립트 실행 (1회)
python scripts/simple_csv_converter.py

# 4. 자동 처리 결과 확인
# ✅ 22개 CSV 파일 생성 (data/csv/)
# ✅ 22개 JSON 파일 생성 (data/)
# ✅ 기존 JSON 파일 덮어쓰기 완료

# 5. HTML 리로드 → 자동 반영 ✅
```

**소요 시간**: < 5분
**수동 작업**: 스크립트 1회 실행만

### 시스템 관점 (자동 처리)

```python
# scripts/simple_csv_converter.py (개선 버전)
import pandas as pd
import json
from pathlib import Path

def convert_weekly_data():
    # 1. Excel 파일 찾기 (가장 최근)
    excel_files = list(Path('.').glob('Global_Scouter_*.xlsx'))
    latest_excel = max(excel_files, key=lambda p: p.stat().st_mtime)

    print(f"📊 Processing: {latest_excel}")

    # 2. 모든 시트 읽기
    excel_data = pd.ExcelFile(latest_excel)

    # 3. 시트별 처리 (22개)
    for sheet_name in excel_data.sheet_names:
        if sheet_name in SKIP_SHEETS:
            continue

        df = excel_data.parse(sheet_name)

        # CSV 저장
        csv_path = f'data/csv/{sheet_name}.csv'
        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        print(f"✅ CSV: {csv_path}")

        # JSON 저장 (기존 파일 덮어쓰기)
        json_path = f'data/{sheet_name}.json'
        json_data = df.to_dict(orient='records')
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)
        print(f"✅ JSON: {json_path} ({len(json_data)} records)")

    print("\n🎉 Weekly data update completed!")

if __name__ == '__main__':
    convert_weekly_data()
```

---

## 📊 개발 우선순위 및 로드맵

### Phase 1: Critical Modules (8주)

**목표**: Foundation 구축 + 핵심 기능

| Week | Module | JSON File | Priority | Effort |
|------|--------|-----------|----------|--------|
| 1-2 | CompanyMasterProvider | M_Company.json | 🔴 Critical | 2주 |
| 3-4 | ValidationAnalytics | (M_Company) | 🔴 Critical | 2주 |
| 5-6 | WatchlistManager | S_Mylist.json | 🔴 Critical | 2주 |
| 7-8 | ComparisonEngine | A_Compare.json | 🔴 Critical | 2주 |

**완료 기준**:
- 4개 모듈 100% 구현
- 전체 데이터셋 테스트 통과
- O(n) 성능 최적화 완료
- Dashboard UI 통합

### Phase 2: High-Value Modules (11주)

**목표**: Advanced Features + Screening Tools

| Week | Module | JSON File | Priority | Effort |
|------|--------|-----------|----------|--------|
| 9-10 | ETFMasterProvider | M_ETFs.json | 🟡 High | 2주 |
| 11-13 | AdvancedCompanyAnalytics | A_Company.json | 🟡 High | 3주 |
| 14-15 | ChartScreener | S_Chart.json | 🟡 High | 2주 |
| 16-17 | ValuationScreener | S_Valuation.json | 🟡 High | 2주 |
| 18-19 | ChartDataProvider | T_Chart.json | 🟡 High | 2주 |

**완료 기준**:
- 5개 모듈 구현
- Screening 도구 완성
- ETF 분석 가능

### Phase 3: Enhanced Features (9주)

**목표**: Historical Data + Distribution + Economic

| Week | Module | JSON File | Priority | Effort |
|------|--------|-----------|----------|--------|
| 20-21 | DistributionAnalytics | A_Distribution.json | 🟢 Medium | 2주 |
| 22-23 | AdvancedETFAnalytics | A_ETFs.json | 🟢 Medium | 2주 |
| 24-25 | ContrastAnalytics | A_Contrast.json | 🟢 Medium | 2주 |
| 26-27 | HistoricalAnalytics | T_EPS_H, T_Growth_H | 🟢 Medium | 2주 |
| 28 | EconomicIndicatorEngine | E_Indicators.json | 🟢 Medium | 1주 |

**완료 기준**:
- 5개 모듈 구현
- Historical 분석 완성
- Economic 지표 통합

### 전체 완료 (28주 = 7개월)

**최종 목표**:
- ✅ 22/22 모듈 구현 (100% 커버리지)
- ✅ 6,179 기업 전체 활용
- ✅ 10,000 기업 확장 준비
- ✅ 매주 업데이트 워크플로우 완성

---

## 🧪 Testing Strategy

### 1. 모듈별 테스트 패턴

```javascript
// tests/modules/company-master-provider.spec.js
import { test, expect } from '@playwright/test';

test.describe('CompanyMasterProvider', () => {
  test('should load all 6,179 companies', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');

    const masterProvider = await page.evaluate(() => {
      return window.dashboardManager.modules.companyMaster.data.length;
    });

    expect(masterProvider).toBe(6179); // 전체 데이터
  });

  test('should find company by ticker in O(1)', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');

    const start = Date.now();
    const company = await page.evaluate(() => {
      return window.dashboardManager.modules.companyMaster
        .getCompanyByTicker('005930'); // Samsung Electronics
    });
    const duration = Date.now() - start;

    expect(company).toBeDefined();
    expect(company.corpName).toContain('삼성전자');
    expect(duration).toBeLessThan(10); // < 10ms
  });
});
```

### 2. 통합 테스트 (All Modules)

```javascript
// tests/integration/all-modules.spec.js
test('should load all 22 modules successfully', async ({ page }) => {
  await page.goto('http://localhost:8080/stock_analyzer.html');

  const loadedModules = await page.evaluate(() => {
    const dm = window.dashboardManager;
    return Object.keys(dm.modules).filter(key => dm.modules[key] !== null);
  });

  expect(loadedModules.length).toBe(22); // 22개 모듈 모두 로딩
});
```

### 3. 성능 테스트

```javascript
test('should initialize all modules in <5 seconds', async ({ page }) => {
  const start = Date.now();
  await page.goto('http://localhost:8080/stock_analyzer.html');
  await page.waitForFunction(() => window.dashboardManager.isReady);
  const duration = Date.now() - start;

  expect(duration).toBeLessThan(5000); // < 5초
});
```

---

## 📏 성능 목표

### 로딩 성능
- **초기 로딩**: < 5초 (22 modules, 6,179 companies)
- **모듈별 로딩**: < 500ms per module
- **병렬 로딩**: Promise.all() 활용

### 메모리 사용
- **총 메모리**: < 500MB (모든 모듈 로드 시)
- **모듈당 메모리**: < 30MB average

### 검색/필터 성능
- **Ticker 조회**: O(1) < 10ms
- **Industry 필터**: O(n) < 100ms (6,179 companies)
- **Correlation 검색**: O(n) < 200ms (indexed structure)

---

## 🔒 데이터 무결성 보장

### 1. 파일 명명 규칙 검증

```python
# scripts/validate_data_files.py
EXPECTED_FILES = [
    'M_Company.json', 'M_ETFs.json',
    'T_EPS_C.json', 'T_Growth_C.json', 'T_Rank.json',
    'T_CFO.json', 'T_Correlation.json',
    # ... 22개 전체
]

def validate_all_files_exist():
    missing = []
    for filename in EXPECTED_FILES:
        if not Path(f'data/{filename}').exists():
            missing.append(filename)

    if missing:
        raise ValueError(f"Missing JSON files: {missing}")

    print("✅ All 22 JSON files exist")
```

### 2. 스키마 검증

```javascript
// core/SchemaValidator.js
class SchemaValidator {
  static validateCompanyData(data) {
    const required = ['Ticker', 'corpName', 'industry', 'exchange'];
    for (const field of required) {
      if (!(field in data)) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
  }

  static validateAllModules(dashboardManager) {
    for (const [name, module] of Object.entries(dashboardManager.modules)) {
      if (module === null) {
        console.warn(`⚠️ Module not loaded: ${name}`);
      } else if (!module.data || module.data.length === 0) {
        console.warn(`⚠️ Module has no data: ${name}`);
      }
    }
  }
}
```

---

## 🚀 배포 계획

### Phase 1 배포 (8주 후)
- CompanyMasterProvider, ValidationAnalytics, WatchlistManager, ComparisonEngine
- Beta Testing with 4 modules
- User Feedback Collection

### Phase 2 배포 (19주 후)
- + ETFMasterProvider, AdvancedCompanyAnalytics, ChartScreener, ValuationScreener, ChartDataProvider
- Feature Complete (9/22 modules)
- Extended Beta Testing

### Phase 3 배포 (28주 후)
- + Distribution, ETF, Contrast, Historical, Economic modules
- 100% Feature Complete (22/22 modules)
- Production Release

---

## 📋 Next Steps (Phase 2 준비)

### Immediate Actions
1. ✅ To-Be Design 완성 (이 문서)
2. ⏳ MASTER_PLAN.md 업데이트 (Option 1 반영)
3. ⏳ Phase 2: Master Plan 작성 (Task 체크리스트)
4. ⏳ Phase 3: Implementation 시작 (Phase 1 모듈부터)

### Documentation
- [ ] API Specification 작성
- [ ] Module Development Guide 작성
- [ ] Weekly Update Workflow Guide 작성

### Infrastructure
- [ ] 변환 스크립트 개선 (auto-detect latest Excel)
- [ ] Schema Validator 구현
- [ ] 성능 모니터링 도구

---

## 🎯 Success Criteria

**Sprint 4 완료 기준**:
- ✅ Phase 0: As-Is Analysis (완료)
- ✅ Phase 1: To-Be Design (이 문서)
- ⏳ Phase 2: Master Plan (상세 Task)
- ⏳ Phase 3: Implementation (최소 Phase 1 모듈)

**최종 성공 기준**:
- 22/22 modules 구현 (100%)
- 6,179 companies 전체 활용
- 매주 업데이트 < 5분
- 전체 테스트 통과 (100%)
- 성능 목표 달성 (< 5초 초기화)

---

**작성자**: Claude Code (Sonnet 4.5)
**방법론**: SPEC_DRIVEN_WORKFLOW
**다음 단계**: Phase 2 - Master Plan Creation
