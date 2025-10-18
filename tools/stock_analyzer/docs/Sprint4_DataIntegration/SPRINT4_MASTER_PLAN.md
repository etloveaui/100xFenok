# Sprint 4: 데이터 통합 완성 - Master Plan

**작성일**: 2025-10-18
**Sprint**: Sprint 4 - 데이터 통합 완성
**Phase**: Phase 2 - Master Plan Creation
**방법론**: SPEC_DRIVEN_WORKFLOW

---

## 📋 Executive Summary

**범위**: Phase 1 모듈 (Critical) 4개 구현
**기간**: 8주 (Module 1-4 순차 개발)
**완료 기준**: 4/22 모듈 구현, 전체 데이터셋 테스트, Dashboard UI 통합

**모듈 목록**:
1. CompanyMasterProvider (M_Company.json, 6,179 companies)
2. ValidationAnalytics (데이터 품질 검증)
3. WatchlistManager (S_Mylist.json, 사용자 관심종목)
4. ComparisonEngine (A_Compare.json, 496 comparisons)

---

## 🚀 에이전트/모드/MCP 활용 전략

### 병렬 실행 계획

**Task 1.5-1.7 (병렬 가능)**:
```yaml
동시 투입:
  - Task 1.5: @frontend-architect (HTML Integration, 30분)
  - Task 1.6: @quality-engineer + Playwright (Testing, 2시간)
  - Task 1.7: @technical-writer + Context7 (Documentation, 1시간)

예상 효과: 3일 → 3-4시간 (90% 단축)
```

**각 Module 첫 Task (분석)**:
```yaml
분석 작업:
  - Task 2.1: @root-cause-analyst + Sequential (Field Coverage)
  - Task 3.1: @root-cause-analyst + Sequential (S_Mylist Analysis)
  - Task 4.1: @root-cause-analyst + Sequential (A_Compare Analysis)

병렬 가능: Module 1 완료 후 3개 동시 진행
```

### MCP 서버 활용 매핑

| Task 유형 | 추천 MCP | 이유 |
|----------|---------|------|
| 데이터 분석 | Sequential | 체계적 구조 분석 |
| 테스트 작성 | Playwright | 실제 브라우저 E2E |
| API 문서 | Context7 | 문서 패턴 참조 |
| 메모리 관리 | Serena | 세션 간 컨텍스트 |

### 에이전트 배정 원칙

**복잡도 기반**:
- 0.0-0.3: 직접 처리 (에이전트 불필요)
- 0.4-0.6: 도메인 에이전트 (선택)
- 0.7-0.9: 전문 에이전트 (권장)
- 0.9-1.0: 다중 에이전트 (필수)

**Task별 복잡도**:
- Schema Analysis: 0.5 (중간)
- Class Design: 0.7 (높음) → @system-architect
- Index Implementation: 0.8 (높음) → @performance-engineer
- Testing: 0.6 (중간) → @quality-engineer

---

## 🎯 Phase 1 모듈 우선순위 배경

### Why These 4 Modules First?

**CompanyMasterProvider** (Foundation):
- **이유**: 모든 다른 모듈의 기반 (ticker → company mapping)
- **의존성**: 0 (독립적)
- **가치**: 6,179 companies 마스터 데이터 제공
- **우선순위**: 🔴 Critical #1

**ValidationAnalytics** (Quality):
- **이유**: 데이터 품질 보장 (39개 필드 검증)
- **의존성**: CompanyMasterProvider
- **가치**: 자동 오류 감지 및 보정
- **우선순위**: 🔴 Critical #2

**WatchlistManager** (User Feature):
- **이유**: 사용자 핵심 기능 (관심종목 관리)
- **의존성**: CompanyMasterProvider
- **가치**: 즉각적인 사용자 가치 제공
- **우선순위**: 🔴 Critical #3

**ComparisonEngine** (Advanced Feature):
- **이유**: 고급 분석 기능 (기업 비교)
- **의존성**: CompanyMasterProvider, ValidationAnalytics
- **가치**: 496 comparison pairs 제공
- **우선순위**: 🔴 Critical #4

---

## 📊 Module 1: CompanyMasterProvider

### 목표
M_Company.json (6,179 companies) 로딩 및 O(1) 검색 제공

### 기간
2주 (Task 1.1 ~ 1.7)

### Tasks

#### Task 1.1: Data Schema Analysis ✅
**기간**: 1일
**담당**: Claude
**에이전트**: @root-cause-analyst (데이터 구조 분석)
**Mode**: --think (구조적 분석)
**MCP**: Sequential (체계적 필드 분류)
**병렬 가능**: No (독립 작업)

**작업 내용**:
- M_Company.json 구조 분석 (39 fields)
- 필수 필드 식별 (Ticker, corpName, industry, exchange)
- 선택 필드 분류 (financial, valuation, analyst)
- 데이터 타입 검증 (string, number, null 처리)

**산출물**:
- `M_COMPANY_SCHEMA.md` (필드별 타입, 범위, 예시)

**완료 기준**:
- [ ] 39개 필드 전체 문서화
- [ ] 샘플 데이터 10개 검증
- [ ] 스키마 문서 작성 완료

---

#### Task 1.2: Provider Class Design ✅
**기간**: 1일
**담당**: Claude
**에이전트**: @system-architect (클래스 아키텍처)
**Mode**: --task-manage (구조화된 설계)
**MCP**: Sequential (아키텍처 패턴 분석)
**병렬 가능**: No (Task 1.1 의존)

**작업 내용**:
- CompanyMasterProvider 클래스 설계
- BaseAnalytics 상속 구조 확인
- 인덱스 구조 설계 (ticker, industry, exchange)
- 메서드 목록 정의 (get, filter, search)

**산출물**:
- `CompanyMasterProvider.js` (클래스 골격)

**완료 기준**:
- [ ] 클래스 구조 정의
- [ ] 인덱스 Map 설계 (3개)
- [ ] 메서드 시그니처 정의 (8개)

**Class Skeleton**:
```javascript
class CompanyMasterProvider extends BaseAnalytics {
  constructor() {
    super();
    // Indexes for O(1) lookup
    this.companyMap = new Map();        // ticker → company
    this.industryIndex = new Map();     // industry → companies[]
    this.exchangeIndex = new Map();     // exchange → companies[]
  }

  async loadFromJSON(jsonPath) { }
  processData(rawData) { }
  buildIndexes() { }

  // Getters
  getCompanyByTicker(ticker) { }
  getCompaniesByIndustry(industry) { }
  getCompaniesByExchange(exchange) { }

  // Filters
  filterByMarketCap(min, max) { }
  filterByPER(min, max) { }

  // Search
  searchByName(query) { }
}
```

---

#### Task 1.3: Index Structure Implementation ✅
**기간**: 2일
**담당**: Claude
**에이전트**: @performance-engineer (O(n) 최적화)
**Mode**: --orchestrate (성능 우선)
**MCP**: Sequential (인덱스 구조 분석)
**병렬 가능**: No (Task 1.2 의존)

**작업 내용**:
- companyMap 구현 (ticker → company, O(1))
- industryIndex 구현 (industry → companies[], O(1))
- exchangeIndex 구현 (exchange → companies[], O(1))
- buildIndexes() 메서드 구현 (O(n))

**완료 기준**:
- [ ] 3개 인덱스 구현
- [ ] 6,179 companies 인덱싱 < 1초
- [ ] 메모리 사용 < 50MB

**Implementation**:
```javascript
buildIndexes() {
  console.log(`Building indexes for ${this.data.length} companies...`);
  const start = Date.now();

  for (const company of this.data) {
    // Ticker index
    this.companyMap.set(company.ticker, company);

    // Industry index
    if (!this.industryIndex.has(company.industry)) {
      this.industryIndex.set(company.industry, []);
    }
    this.industryIndex.get(company.industry).push(company);

    // Exchange index
    if (!this.exchangeIndex.has(company.exchange)) {
      this.exchangeIndex.set(company.exchange, []);
    }
    this.exchangeIndex.get(company.exchange).push(company);
  }

  const duration = Date.now() - start;
  console.log(`✅ Indexes built in ${duration}ms`);
}
```

---

#### Task 1.4: Core Methods Implementation ✅
**기간**: 3일
**담당**: Claude
**에이전트**: @backend-architect (메서드 구현)
**Mode**: --task-manage (체계적 구현)
**MCP**: None (직접 구현)
**병렬 가능**: No (Task 1.3 의존)

**작업 내용**:
- getCompanyByTicker() 구현
- getCompaniesByIndustry() 구현
- getCompaniesByExchange() 구현
- filterByMarketCap() 구현
- filterByPER() 구현
- searchByName() 구현 (부분 일치)

**완료 기준**:
- [ ] 6개 메서드 구현
- [ ] O(1) 또는 O(n) 성능 보장
- [ ] Null safety 처리

**Example Implementation**:
```javascript
getCompanyByTicker(ticker) {
  if (!ticker) {
    console.warn('Invalid ticker');
    return null;
  }
  return this.companyMap.get(ticker) || null;
}

getCompaniesByIndustry(industry) {
  if (!industry) return [];
  return this.industryIndex.get(industry) || [];
}

filterByMarketCap(min = 0, max = Infinity) {
  return this.data.filter(c => {
    const marketCap = c['(USD mn)'];
    return marketCap >= min && marketCap <= max;
  });
}

searchByName(query) {
  if (!query || query.length < 2) return [];
  const lowerQuery = query.toLowerCase();
  return this.data.filter(c =>
    c.corpName.toLowerCase().includes(lowerQuery)
  );
}
```

---

#### Task 1.5: HTML Integration ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @frontend-architect (UI 통합)
**Mode**: None (단순 통합)
**MCP**: None (HTML 수정)
**병렬 가능**: Yes (Task 1.6, 1.7과 독립)

**작업 내용**:
- stock_analyzer.html에 스크립트 추가
- loadAllAnalytics()에 CompanyMasterProvider 추가
- DashboardManager에 모듈 등록
- 간단한 UI 테스트 (콘솔)

**완료 기준**:
- [ ] HTML에서 모듈 로딩 확인
- [ ] 콘솔에서 메서드 호출 가능
- [ ] 6,179 companies 로딩 확인

**HTML Changes**:
```html
<!-- stock_analyzer.html -->
<script src="modules/CompanyMasterProvider.js"></script>

<script>
async function loadAllAnalytics() {
  // Company Master Data
  window.companyMaster = new CompanyMasterProvider();
  await window.companyMaster.loadFromJSON('data/M_Company.json');
  console.log(`✅ Loaded ${window.companyMaster.data.length} companies`);

  // ... existing modules
}
</script>
```

---

#### Task 1.6: Unit Testing ⏳
**기간**: 2일
**담당**: Claude
**에이전트**: @quality-engineer (테스트 전문)
**Mode**: --task-manage (체계적 테스트)
**MCP**: Playwright (E2E 테스트)
**병렬 가능**: Yes (Task 1.5, 1.7과 독립)

**작업 내용**:
- tests/modules/company-master-provider.spec.js 작성
- 전체 데이터셋 (6,179 companies) 테스트
- 성능 테스트 (O(1) 조회 < 10ms)
- Edge case 테스트 (null, empty, invalid)

**완료 기준**:
- [ ] 15+ test cases
- [ ] 100% pass rate
- [ ] 성능 기준 충족

**Test Cases**:
```javascript
// tests/modules/company-master-provider.spec.js
test.describe('CompanyMasterProvider', () => {
  test('should load all 6,179 companies', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    const count = await page.evaluate(() =>
      window.companyMaster.data.length
    );
    expect(count).toBe(6179);
  });

  test('should find Samsung Electronics by ticker', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    const company = await page.evaluate(() =>
      window.companyMaster.getCompanyByTicker('005930')
    );
    expect(company).toBeDefined();
    expect(company.corpName).toContain('삼성전자');
  });

  test('should return null for invalid ticker', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    const company = await page.evaluate(() =>
      window.companyMaster.getCompanyByTicker('INVALID')
    );
    expect(company).toBeNull();
  });

  test('should filter by industry in O(1)', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    const start = Date.now();
    const companies = await page.evaluate(() =>
      window.companyMaster.getCompaniesByIndustry('Technology')
    );
    const duration = Date.now() - start;
    expect(companies.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(10);
  });

  test('should search by name (partial match)', async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    const companies = await page.evaluate(() =>
      window.companyMaster.searchByName('삼성')
    );
    expect(companies.length).toBeGreaterThan(1);
    expect(companies[0].corpName).toContain('삼성');
  });
});
```

---

#### Task 1.7: Documentation ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @technical-writer (문서 전문)
**Mode**: None (문서 작성)
**MCP**: Context7 (API 문서 패턴)
**병렬 가능**: Yes (Task 1.5, 1.6과 독립)

**작업 내용**:
- CompanyMasterProvider API 문서 작성
- 사용 예제 작성
- 성능 특성 문서화
- MASTER_PLAN.md 업데이트 (Task 1.1-1.7 완료 표시)

**완료 기준**:
- [ ] API 문서 완성
- [ ] 5+ 사용 예제
- [ ] Git commit

**API Documentation Template**:
```markdown
# CompanyMasterProvider API

## Overview
Provides O(1) access to 6,179 companies with indexed lookups.

## Methods

### getCompanyByTicker(ticker)
Returns company by ticker symbol.
- **Parameters**: ticker (string)
- **Returns**: Company object or null
- **Complexity**: O(1)
- **Example**: `companyMaster.getCompanyByTicker('005930')`

### getCompaniesByIndustry(industry)
Returns all companies in industry.
- **Parameters**: industry (string)
- **Returns**: Company[] (may be empty)
- **Complexity**: O(1) lookup + O(k) result
- **Example**: `companyMaster.getCompaniesByIndustry('Technology')`

...
```

---

## 📊 Module 2: ValidationAnalytics

### 목표
39개 필드 전체 검증 + 자동 오류 감지/보정

### 기간
2주 (Task 2.1 ~ 2.7)

### Tasks

#### Task 2.1: Field Coverage Analysis ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @root-cause-analyst (커버리지 분석)
**Mode**: --think (체계적 분석)
**MCP**: Sequential (필드 분류 및 우선순위)
**병렬 가능**: No (Module 1 완료 필요)

**작업 내용**:
- 39개 필드 분류 (identity, financial, valuation, etc.)
- 현재 validator 커버리지 확인 (10/39 = 26%)
- 누락 필드 29개 식별
- 우선순위 설정 (High/Medium/Low)

**산출물**:
- `FIELD_COVERAGE_ANALYSIS.md`

**완료 기준**:
- [ ] 39개 필드 전체 분류
- [ ] 누락 29개 필드 문서화
- [ ] 우선순위 확정

---

#### Task 2.2: Validator Design (High Priority Fields) ⏳
**기간**: 2일

**작업 내용**:
- High priority 15개 필드 validator 설계
- 각 필드별 validation 규칙 정의
- Error types 분류 (format, range, null, etc.)
- Auto-correction 전략 수립

**완료 기준**:
- [ ] 15개 validator 설계
- [ ] Validation 규칙 문서화

**Example Validators**:
```javascript
validators: {
  'PER (Oct-25)': {
    type: 'number',
    range: [0, 1000],
    nullable: true,
    autoCorrect: {
      percentageAsDecimal: true,  // 0.15 → 15
      decimalAsPercentage: true,  // 1500 → 15
    }
  },
  'Debt/Equity (Fwd)': {
    type: 'number',
    range: [0, 10],
    nullable: true,
    autoCorrect: {
      percentageAsDecimal: true,
    }
  },
  // ... 13 more
}
```

---

#### Task 2.3: Validator Implementation ⏳
**기간**: 3일

**작업 내용**:
- DataCleanupManager 확장 (10 → 39 validators)
- 각 validator 구현
- Auto-correction 로직 구현
- Confidence scoring 구현

**완료 기준**:
- [ ] 39개 validator 구현
- [ ] Auto-correction 동작
- [ ] Confidence > 0.8 for high priority

---

#### Task 2.4: Validation Report Enhancement ⏳
**기간**: 2일

**작업 내용**:
- generateValidationReport() 개선
- 39개 필드 커버리지 표시
- Quality Score 계산 (100% 커버리지 기준)
- 우선순위별 recommendations

**완료 기준**:
- [ ] 39/39 필드 커버리지 표시
- [ ] Quality Score 계산 정확
- [ ] Recommendations 생성

---

#### Task 2.5: HTML Integration ⏳
**기간**: 1일

**작업 내용**:
- ValidationAnalytics 모듈 등록
- loadData() 파이프라인 통합
- UI에 Validation Report 표시 (선택)

**완료 기준**:
- [ ] 모듈 로딩 확인
- [ ] Validation Report 콘솔 출력
- [ ] Quality Score > 95%

---

#### Task 2.6: Testing ⏳
**기간**: 2일

**작업 내용**:
- tests/modules/validation-analytics.spec.js 작성
- 전체 데이터셋 검증
- Edge cases 테스트 (Infinity, null, out-of-range)
- Auto-correction 테스트

**완료 기준**:
- [ ] 20+ test cases
- [ ] 100% pass rate
- [ ] Auto-correction 정확도 > 90%

---

#### Task 2.7: Documentation ⏳
**기간**: 1일

**작업 내용**:
- ValidationAnalytics API 문서
- Validator 목록 문서
- Auto-correction 가이드
- Git commit

**완료 기준**:
- [ ] API 문서 완성
- [ ] Validator 레퍼런스 작성
- [ ] MASTER_PLAN.md 업데이트

---

## 📊 Module 3: WatchlistManager

### 목표
S_Mylist.json (22 entries) 관리 + 사용자 관심종목 UI

### 기간
2주 (Task 3.1 ~ 3.7)

### Tasks

#### Task 3.1: S_Mylist Data Analysis ⏳
**기간**: 1일

**작업 내용**:
- S_Mylist.json 구조 분석
- 22개 종목 데이터 확인
- CompanyMasterProvider 연동 방안

**완료 기준**:
- [ ] 데이터 구조 문서화
- [ ] 연동 방안 확정

---

#### Task 3.2: WatchlistManager Class Design ⏳
**기간**: 1일

**작업 내용**:
- WatchlistManager 클래스 설계
- CRUD 메서드 정의 (add, remove, get, clear)
- LocalStorage 연동 설계 (영구 저장)

**완료 기준**:
- [ ] 클래스 구조 정의
- [ ] 메서드 시그니처 정의
- [ ] LocalStorage 전략 수립

**Class Skeleton**:
```javascript
class WatchlistManager extends BaseAnalytics {
  constructor() {
    super();
    this.watchlist = new Set(); // tickers
  }

  async loadFromJSON(jsonPath) { }
  processData(rawData) { }

  // CRUD
  addTicker(ticker) { }
  removeTicker(ticker) { }
  getTickers() { }
  clearAll() { }

  // Persistence
  saveToLocalStorage() { }
  loadFromLocalStorage() { }

  // Integration
  getCompanies(companyMaster) { }
}
```

---

#### Task 3.3: CRUD Implementation ⏳
**기간**: 2일

**작업 내용**:
- add, remove, get, clear 구현
- Set 기반 중복 방지
- 입력 검증 (ticker 존재 여부)

**완료 기준**:
- [ ] 4개 CRUD 메서드 구현
- [ ] 중복 방지 동작
- [ ] 입력 검증 완료

---

#### Task 3.4: LocalStorage Persistence ⏳
**기간**: 2일

**작업 내용**:
- saveToLocalStorage() 구현
- loadFromLocalStorage() 구현
- Auto-save 트리거 (add/remove 시)

**완료 기준**:
- [ ] 영구 저장 동작
- [ ] 페이지 리로드 후 복원 확인

---

#### Task 3.5: UI Integration ⏳
**기간**: 2일

**작업 내용**:
- Dashboard에 Watchlist 탭 추가
- 종목 추가/제거 버튼
- Watchlist 테이블 렌더링

**완료 기준**:
- [ ] UI 완성
- [ ] 실시간 업데이트 동작

---

#### Task 3.6: Testing ⏳
**기간**: 2일

**작업 내용**:
- tests/modules/watchlist-manager.spec.js 작성
- CRUD 테스트
- LocalStorage 테스트
- UI 테스트

**완료 기준**:
- [ ] 15+ test cases
- [ ] 100% pass rate

---

#### Task 3.7: Documentation ⏳
**기간**: 1일

**작업 내용**:
- WatchlistManager API 문서
- 사용 가이드
- Git commit

**완료 기준**:
- [ ] API 문서 완성
- [ ] MASTER_PLAN.md 업데이트

---

## 📊 Module 4: ComparisonEngine

### 목표
A_Compare.json (496 comparison pairs) 로딩 + 기업 비교 UI

### 기간
2주 (Task 4.1 ~ 4.7)

### Tasks

#### Task 4.1: A_Compare Data Analysis ⏳
**기간**: 1일

**작업 내용**:
- A_Compare.json 구조 분석
- 496 comparison pairs 확인
- CompanyMasterProvider 연동 방안

**완료 기준**:
- [ ] 데이터 구조 문서화
- [ ] 연동 방안 확정

---

#### Task 4.2: ComparisonEngine Class Design ⏳
**기간**: 1일

**작업 내용**:
- ComparisonEngine 클래스 설계
- 비교 메서드 정의 (2개 기업, N개 기업)
- 차트 렌더링 방안

**완료 기준**:
- [ ] 클래스 구조 정의
- [ ] 메서드 시그니처 정의

**Class Skeleton**:
```javascript
class ComparisonEngine extends BaseAnalytics {
  constructor() {
    super();
  }

  async loadFromJSON(jsonPath) { }
  processData(rawData) { }

  // Comparison
  compare(ticker1, ticker2, companyMaster) { }
  compareMultiple(tickers, companyMaster) { }

  // Analysis
  findSimilarCompanies(ticker, companyMaster, limit = 5) { }

  // UI
  renderComparisonTable(comparison) { }
  renderComparisonChart(comparison) { }
}
```

---

#### Task 4.3: Core Methods Implementation ⏳
**기간**: 3일

**작업 내용**:
- compare() 구현 (2개 기업)
- compareMultiple() 구현 (N개 기업)
- findSimilarCompanies() 구현

**완료 기준**:
- [ ] 3개 메서드 구현
- [ ] 39개 필드 비교 지원

---

#### Task 4.4: UI Rendering ⏳
**기간**: 2일

**작업 내용**:
- renderComparisonTable() 구현
- renderComparisonChart() 구현 (Chart.js)
- Dashboard에 Comparison 탭 추가

**완료 기준**:
- [ ] 테이블 렌더링 동작
- [ ] 차트 렌더링 동작

---

#### Task 4.5: HTML Integration ⏳
**기간**: 1일

**작업 내용**:
- stock_analyzer.html에 모듈 추가
- Dashboard 탭 생성
- 간단한 테스트

**완료 기준**:
- [ ] 모듈 로딩 확인
- [ ] UI 동작 확인

---

#### Task 4.6: Testing ⏳
**기간**: 2일

**작업 내용**:
- tests/modules/comparison-engine.spec.js 작성
- 496 comparison pairs 테스트
- UI 테스트

**완료 기준**:
- [ ] 15+ test cases
- [ ] 100% pass rate

---

#### Task 4.7: Documentation ⏳
**기간**: 1일

**작업 내용**:
- ComparisonEngine API 문서
- 사용 가이드
- Git commit

**완료 기준**:
- [ ] API 문서 완성
- [ ] MASTER_PLAN.md 업데이트

---

## 📊 전체 진행 추적

### Module Completion Checklist

#### Module 1: CompanyMasterProvider ⏳
- [ ] Task 1.1: Data Schema Analysis
- [ ] Task 1.2: Provider Class Design
- [ ] Task 1.3: Index Structure Implementation
- [ ] Task 1.4: Core Methods Implementation
- [ ] Task 1.5: HTML Integration
- [ ] Task 1.6: Unit Testing
- [ ] Task 1.7: Documentation

#### Module 2: ValidationAnalytics ⏳
- [ ] Task 2.1: Field Coverage Analysis
- [ ] Task 2.2: Validator Design
- [ ] Task 2.3: Validator Implementation
- [ ] Task 2.4: Validation Report Enhancement
- [ ] Task 2.5: HTML Integration
- [ ] Task 2.6: Testing
- [ ] Task 2.7: Documentation

#### Module 3: WatchlistManager ⏳
- [ ] Task 3.1: S_Mylist Data Analysis
- [ ] Task 3.2: WatchlistManager Class Design
- [ ] Task 3.3: CRUD Implementation
- [ ] Task 3.4: LocalStorage Persistence
- [ ] Task 3.5: UI Integration
- [ ] Task 3.6: Testing
- [ ] Task 3.7: Documentation

#### Module 4: ComparisonEngine ⏳
- [ ] Task 4.1: A_Compare Data Analysis
- [ ] Task 4.2: ComparisonEngine Class Design
- [ ] Task 4.3: Core Methods Implementation
- [ ] Task 4.4: UI Rendering
- [ ] Task 4.5: HTML Integration
- [ ] Task 4.6: Testing
- [ ] Task 4.7: Documentation

---

## 🎯 완료 기준 (Sprint 4 Phase 1)

### Code Metrics
- **신규 파일**: 4개 (모듈)
- **수정 파일**: 2개 (HTML, DashboardManager)
- **신규 테스트**: 4개 (모듈별)
- **테스트 커버리지**: > 80%

### Performance Metrics
- **초기 로딩**: < 5초 (4 modules + 기존 5 modules)
- **Ticker 조회**: O(1) < 10ms
- **Validation**: < 2초 (6,179 companies)
- **메모리**: < 300MB (9 modules)

### Quality Metrics
- **테스트 통과율**: 100% (60+ tests)
- **필드 커버리지**: 100% (39/39 fields)
- **Quality Score**: > 95%

### User Value
- ✅ 6,179 companies 마스터 데이터 접근
- ✅ 39개 필드 자동 검증
- ✅ 관심종목 관리 기능
- ✅ 기업 비교 기능 (496 pairs)

---

## 📅 타임라인

### Week 1-2: Module 1 (CompanyMasterProvider)
- Day 1: Task 1.1-1.2 (Schema + Design)
- Day 2-3: Task 1.3 (Index Implementation)
- Day 4-6: Task 1.4 (Core Methods)
- Day 7: Task 1.5 (HTML Integration)
- Day 8-9: Task 1.6 (Testing)
- Day 10: Task 1.7 (Documentation)

### Week 3-4: Module 2 (ValidationAnalytics)
- Day 11: Task 2.1 (Field Coverage)
- Day 12-13: Task 2.2 (Validator Design)
- Day 14-16: Task 2.3 (Implementation)
- Day 17-18: Task 2.4 (Report Enhancement)
- Day 19: Task 2.5 (HTML Integration)
- Day 20-21: Task 2.6 (Testing)
- Day 22: Task 2.7 (Documentation)

### Week 5-6: Module 3 (WatchlistManager)
- Day 23: Task 3.1-3.2 (Analysis + Design)
- Day 24-25: Task 3.3 (CRUD)
- Day 26-27: Task 3.4 (LocalStorage)
- Day 28-29: Task 3.5 (UI Integration)
- Day 30-31: Task 3.6 (Testing)
- Day 32: Task 3.7 (Documentation)

### Week 7-8: Module 4 (ComparisonEngine)
- Day 33: Task 4.1-4.2 (Analysis + Design)
- Day 34-36: Task 4.3 (Core Methods)
- Day 37-38: Task 4.4 (UI Rendering)
- Day 39: Task 4.5 (HTML Integration)
- Day 40-41: Task 4.6 (Testing)
- Day 42: Task 4.7 (Documentation)

### Week 8: Sprint 4 Phase 1 완료
- Day 43-44: 전체 통합 테스트
- Day 45: 성능 최적화
- Day 46: 문서 정리
- Day 47: Git commit & 배포 준비
- Day 48-50: 사용자 인수 테스트

---

## 🚀 다음 단계 (Phase 3)

### Implementation 준비
1. ✅ Master Plan 작성 완료 (이 문서)
2. ⏳ MASTER_PLAN.md 업데이트
3. ⏳ Git commit (Phase 2 완료)
4. ⏳ Phase 3: Module 1 Task 1.1 시작

### 리소스 준비
- [ ] M_Company.json 최신 버전 확인
- [ ] S_Mylist.json 최신 버전 확인
- [ ] A_Compare.json 최신 버전 확인
- [ ] Python 서버 실행 (port 8080)
- [ ] 테스트 환경 준비 (Playwright)

---

**작성자**: Claude Code (Sonnet 4.5)
**방법론**: SPEC_DRIVEN_WORKFLOW
**다음 단계**: Phase 3 - Implementation (Module 1 Task 1.1)
**Git Commit 예정**: Sprint 4 Phase 2 완료 checkpoint
