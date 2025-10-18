# Sprint 4: 데이터 통합 완성 - Master Plan

**작성일**: 2025-10-18
**Sprint**: Sprint 4 - 데이터 통합 완성
**Phase**: Phase 2 - Master Plan Creation
**방법론**: SPEC_DRIVEN_WORKFLOW

---

## 📋 Executive Summary

**현재 상황**: ⏸️ Phase 0 - 전체 데이터 재검토 단계

**배경**:
- Module 1 (CompanyMasterProvider): ✅ 완료 (2025-10-19)
- Module 2 (ValidationAnalytics): ✅ 완료 (2025-10-19)
- Module 3 (WatchlistManager): ❌ 취소 (불필요 데이터)
- Module 4+: ⏸️ **Phase 0 완료 후 재평가**

**발견된 문제**:
1. ❌ 전체 22개 시트 상세 분석 미완료
2. ❌ xlsb → CSV 변환 검증 안 됨
3. ❌ 베이스 vs 계산 구분 불명확
4. ❌ 필수 vs 선택 우선순위 미확정
5. ❌ 개발 방향 재설정 필요

**Phase 0 목표** (1주일):
- 22개 시트 전수 분석 및 명문화
- 변환 파이프라인 검증 및 개선
- 필수 시트 선별 및 우선순위 확정
- 올바른 개발 로드맵 재작성
- Module 1,2 검증 및 조정

**Phase 0 완료 후**:
- Module 4+ 재정의
- 필수 시트만 선별 개발
- 체계적 단계별 진행

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

### Why These 3 Modules? (1개 취소)

**CompanyMasterProvider** (Foundation): ✅ 완료
- **이유**: 모든 다른 모듈의 기반 (ticker → company mapping)
- **의존성**: 0 (독립적)
- **가치**: 6,176 companies 마스터 데이터 제공
- **우선순위**: 🔴 Critical #1
- **상태**: 완료 (2025-10-19)

**ValidationAnalytics** (Quality): ✅ 완료
- **이유**: 데이터 품질 보장 (31개 필드 검증)
- **의존성**: CompanyMasterProvider
- **가치**: 자동 오류 감지 및 보정, Quality Score 94.9/100
- **우선순위**: 🔴 Critical #2
- **상태**: 완료 (2025-10-19)

~~**WatchlistManager** (User Feature)~~: ❌ 취소
- ~~**이유**: 사용자 핵심 기능 (관심종목 관리)~~
- ~~**의존성**: CompanyMasterProvider~~
- ~~**가치**: 즉각적인 사용자 가치 제공~~
- **취소 이유**: S_Mylist.json 불필요 (중복, 미사용, 분석 가치 없음)
- **상태**: 취소 (2025-10-19)

**ComparisonEngine** (Advanced Feature): ⏸️ Phase 0 완료 후 재평가
- **이유**: 고급 분석 기능 (기업 비교)
- **의존성**: CompanyMasterProvider, ValidationAnalytics
- **가치**: 496 comparison pairs 제공
- **상태**: Phase 0 완료 후 필요성 재검토

---

## 🔍 Phase 0: 전체 데이터 재검토 ⏳

### 목표
22개 시트 완전 분석 + 변환 검증 + 올바른 로드맵

### 기간
1주일 (Task 0.1 ~ 0.6)

### 배경
Module 1,2 개발 후 다음 문제 발견:
- xlsb → CSV 변환 검증 안 됨
- A_, T_, S_ 계열 시트 목적 불명확
- 베이스 데이터 vs 계산 결과물 구분 필요
- 필수 vs 선택 우선순위 미확정
- 전체 22개 시트 중 2개만 파악됨

→ **개발 중단, Phase 0 선행 필요**

### Tasks

#### Task 0.1: 전체 시트 데이터 분석 ✅
**기간**: 2일
**담당**: Claude
**에이전트**: @root-cause-analyst (데이터 구조 전수 분석)
**Mode**: --think-hard (복잡한 분석)
**MCP**: Sequential (체계적 필드 분류)
**병렬 가능**: No (독립 작업)
**완료 시각**: 2025-10-19
**Git Commit**: f702abd

**작업 내용**:
- 22개 CSV 파일 전수 분석 (레코드, 필드, 샘플)
- M_Company 기준 관계 분석 (공통 필드, 레코드 수)
- 베이스 vs 계산 분류 (M_ vs A_/T_/S_)
- ReadMe.csv 설명 vs 실제 데이터 대조

**완료 기준**:
- [x] 22개 시트 모두 분석
- [x] 베이스 vs 계산 분류 완료
- [x] 필드 관계도 작성

**산출물**:
- `SHEET_ANALYSIS_REPORT.md` (2,500+ lines 상세 분석)

---

#### Task 0.2: xlsb → CSV 변환 검증 ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @quality-engineer (변환 검증)
**Mode**: --task-manage (체계적 검증)
**MCP**: None (직접 검증)
**병렬 가능**: No (Task 0.1 완료 후)

**작업 내용**:
- 5개 주차 xlsb 샘플 테스트 (20250912~20251010)
- 시트 수/레코드 수/필드명/인코딩 검증
- 주차별 일관성 검증 (시트 구조 변경)

**완료 기준**:
- [ ] 5개 주차 모두 변환 테스트
- [ ] 검증 통과 or 문제점 명시
- [ ] 수정 필요 사항 리스트업

**산출물**:
- `CONVERSION_VALIDATION_REPORT.md` (주차별 비교)

---

#### Task 0.3: 변환 스크립트 개선 ⏳
**기간**: 1일
**담당**: Claude
**Mode**: None (스크립트 작성)
**MCP**: None
**병렬 가능**: No (Task 0.2 완료 후)

**작업 내용**:
- xlsb → CSV 스크립트 작성/개선
- 22-23개 시트만 명시적 추출 (수백/수천개 잡다한 시트 필터링)
- 유연성 개선 (시트명 변경, 필드 추가/삭제 대응)
- 검증 로직 내장 (레코드/필드 체크, 인코딩 검증)

**완료 기준**:
- [ ] 5개 주차 모두 성공
- [ ] 검증 리포트 자동 생성
- [ ] 명확한 에러 메시지

**산출물**:
- `validated_xlsb_to_csv.py` (신규 or 개선)

---

#### Task 0.4: 필수 시트 선별 및 우선순위 ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @system-architect (전략 수립)
**Mode**: --think-hard (우선순위 결정)
**MCP**: Sequential (아키텍처 분석)
**병렬 가능**: No (Task 0.1 완료 후)

**작업 내용**:
- 시트 분류 (🔴 Critical / 🟡 High / 🟢 Medium / ⚪ Low)
- 우선순위 결정 기준 수립
- 개발 로드맵 작성 (Phase 1/2/3)
- Module 재정의

**완료 기준**:
- [ ] 22개 시트 우선순위 확정
- [ ] Phase 1 시트 5개 이하 선별
- [ ] 로드맵 3단계 작성

**산출물**:
- `SHEET_PRIORITY_MATRIX.md` (우선순위 매트릭스)

---

#### Task 0.5: 명문화 - 완전한 데이터 레퍼런스 ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @technical-writer (전문 문서화)
**Mode**: --task-manage (체계적 작성)
**MCP**: Context7 (문서 패턴)
**병렬 가능**: Yes (Task 0.4와 병렬 가능)

**작업 내용**:
- DATA_COMPLETE_ANALYSIS.md 작성 (2,000+ lines 예상)
  - Part 1: 전체 개요 (ReadMe 기반)
  - Part 2: 시트별 상세 (22개 각각)
  - Part 3: 관계도 (dependency map)
  - Part 4: 변환 파이프라인
  - Part 5: 개발 로드맵
- 시각화 (시트 관계도, 우선순위 매트릭스, 타임라인)

**완료 기준**:
- [ ] 22개 시트 모두 문서화
- [ ] 관계도 완성
- [ ] 로드맵 명확화
- [ ] MASTER_PLAN.md 업데이트

**산출물**:
- `DATA_COMPLETE_ANALYSIS.md` (완전한 레퍼런스)

**시트 문서 템플릿**:
```markdown
## [시트명]

**목적**: [ReadMe 설명]
**레코드**: [n개]
**필드**: [n개]
**분류**: [베이스 / 계산]
**우선순위**: [Critical / High / Medium / Low]
**의존성**: [다른 시트와 관계]
**계산 필드**: [있으면 리스트]
**개발 계획**: [언제, 어떻게]
```

---

#### Task 0.6: Module 1,2 검증 및 조정 ⏳
**기간**: 1일
**담당**: Claude
**Mode**: None (검증 작업)
**MCP**: Playwright (E2E 재테스트)
**병렬 가능**: No (Task 0.3 완료 후)

**작업 내용**:
- Module 1 (CompanyMasterProvider) 검증
  - M_Company.json 변환 재확인
  - 필드 누락 없는지 체크
  - 테스트 재실행 (33 tests)
- Module 2 (ValidationAnalytics) 검증
  - 31개 validator 재확인
  - 데이터 품질 스코어 재계산
  - 테스트 재실행 (26 tests)
- 필요 시 수정 및 재테스트

**완료 기준**:
- [ ] Module 1,2 검증 완료
- [ ] 테스트 모두 통과
- [ ] 문서 업데이트

**산출물**:
- `MODULE1_VALIDATION_REPORT.md`
- `MODULE2_VALIDATION_REPORT.md`
- 수정 사항 (있으면)

---

### Phase 0 완료 기준

- [x] Task 0.1: 전체 시트 데이터 분석
- [ ] Task 0.2: xlsb → CSV 변환 검증
- [ ] Task 0.3: 변환 스크립트 개선
- [ ] Task 0.4: 필수 시트 선별 및 우선순위
- [ ] Task 0.5: 명문화 - 완전한 데이터 레퍼런스
- [ ] Task 0.6: Module 1,2 검증 및 조정

**산출물 요약**:
- SHEET_ANALYSIS_REPORT.md
- CONVERSION_VALIDATION_REPORT.md
- validated_xlsb_to_csv.py
- SHEET_PRIORITY_MATRIX.md
- DATA_COMPLETE_ANALYSIS.md (2,000+ lines)
- MODULE1_VALIDATION_REPORT.md
- MODULE2_VALIDATION_REPORT.md

**타임라인**:
- Day 1-2: Task 0.1 (전체 시트 분석)
- Day 3: Task 0.2 (변환 검증)
- Day 4: Task 0.3 (스크립트 개선)
- Day 5: Task 0.4 (우선순위 결정) + Task 0.5 (명문화) 병렬
- Day 6: Task 0.5 완료 (명문화)
- Day 7: Task 0.6 (Module 1,2 검증)

---

## 📊 Module 1: CompanyMasterProvider ✅

### 목표
M_Company.json (6,179 companies) 로딩 및 O(1) 검색 제공

### 기간
2주 (Task 1.1 ~ 1.7)

### 완료 시각
2025-10-19 (Git: ee50ed7b, a62a525)

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
- [x] 39개 필드 전체 문서화
- [x] 샘플 데이터 10개 검증
- [x] 스키마 문서 작성 완료

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
- [x] 클래스 구조 정의
- [x] 인덱스 Map 설계 (3개)
- [x] 메서드 시그니처 정의 (8개)

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
- [x] 3개 인덱스 구현
- [x] 6,179 companies 인덱싱 < 1초
- [x] 메모리 사용 < 50MB

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
- [x] 6개 메서드 구현
- [x] O(1) 또는 O(n) 성능 보장
- [x] Null safety 처리

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

#### Task 1.5: HTML Integration ✅
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
- [x] HTML에서 모듈 로딩 확인
- [x] 콘솔에서 메서드 호출 가능
- [x] 6,179 companies 로딩 확인

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

#### Task 1.6: Unit Testing ✅
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
- [x] 15+ test cases (33 tests)
- [x] 100% pass rate
- [x] 성능 기준 충족 (0.0001ms << 10ms)

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

#### Task 1.7: Documentation ✅
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
- [x] API 문서 완성 (1,200+ lines)
- [x] 5+ 사용 예제
- [x] Git commit (ee50ed7b)

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

## 📊 Module 2: ValidationAnalytics ✅

### 목표
39개 필드 전체 검증 + 자동 오류 감지/보정

### 기간
2주 (Task 2.1 ~ 2.7)

### 완료 시각
2025-10-19 (Git: a62a525)

### 성과
- Field Coverage: 75.8% → 93.9% (+18.1%)
- Quality Score: 94.9/100
- Validator Count: 31/33 fields (6개 신규 추가)
- Test Pass: 26/26 (100%)

### Tasks

#### Task 2.1: Field Coverage Analysis ✅
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
- [x] 39개 필드 전체 분류
- [x] 누락 6개 Medium Priority 필드 문서화
- [x] 우선순위 확정

---

#### Task 2.2: Add Medium Priority Validators ✅
**기간**: 2일

**작업 내용**:
- Medium priority 6개 필드 validator 추가
- 각 필드별 validation 규칙 정의
- Null safety 처리

**완료 기준**:
- [x] 6개 validator 추가 (결산, W, 1M, 3M, 6M, 12M)
- [x] Validation 규칙 문서화

---

#### Task 2.3: Update Arrays ✅
**기간**: 1일

**작업 내용**:
- numericFields 배열 업데이트 (+5개)
- percentageFields 배열 업데이트 (+5개)
- stringFields 배열 업데이트 (+1개)

**완료 기준**:
- [x] 3개 배열 업데이트 완료
- [x] 필드 분류 정확성 검증

---

#### Task 2.4: Enhanced Reporting ✅
**기간**: 1일

**작업 내용**:
- printValidationReport() 개선
- Sprint 4 Module 2 식별 추가
- Quality Score 강조

**완료 기준**:
- [x] Report 출력 개선
- [x] Quality Score 94.9/100 달성

---

#### Task 2.5: HTML Integration ✅
**기간**: 1일

**작업 내용**:
- ValidationAnalytics 모듈 등록
- loadData() 파이프라인 통합
- UI에 Validation Report 표시 (선택)

**완료 기준**:
- [x] 모듈 로딩 확인
- [x] Validation Report 콘솔 출력
- [x] Quality Score 94.9/100

---

#### Task 2.6: Testing ✅
**기간**: 2일

**작업 내용**:
- tests/modules/data-cleanup-manager.spec.js 작성
- 전체 데이터셋 검증 (6,176 companies)
- Edge cases 테스트 (Infinity, null, out-of-range)
- 신규 validator 테스트

**완료 기준**:
- [x] 26 test cases
- [x] 100% pass rate (26/26)
- [x] Performance 12.6ms (<5000ms target)

---

#### Task 2.7: Documentation ✅
**기간**: 1일

**작업 내용**:
- ValidationAnalytics API 문서
- Validator 목록 문서 (31개 전체)
- Auto-correction 가이드
- Git commit

**완료 기준**:
- [x] API 문서 완성 (1,243 lines)
- [x] Validator 레퍼런스 작성 (31개)
- [x] Git commit (a62a525)

---

## 📊 Module 3: WatchlistManager ❌ CANCELLED

### 취소 이유
**S_Mylist.json 분석 결과 불필요**
- 사용자가 등록한 데이터 아님 (자동 생성 샘플)
- M_Company.json (6,176개)과 완전 중복
- 분석적 가치 없음 (단순 저장 용도)
- 실제 레코드: 19개 (계획 22개와 불일치)

**결정**: 전체 Module 제거
- S_Mylist.json 제거 예정 (전체 재정리 시)
- WatchlistManager 개발 중단
- 필요 시 향후 재검토

**취소 일자**: 2025-10-19

---

### ~~목표~~ (취소됨)
~~S_Mylist.json (22 entries) 관리 + 사용자 관심종목 UI~~

### ~~기간~~ (취소됨)
~~2주 (Task 3.1 ~ 3.7)~~

### Tasks (참고용 - 모두 취소됨)

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

## 📊 Module 4: [TBD] ⏸️ Phase 0 완료 후 결정

### 현재 상태
⏸️ Phase 0 전체 데이터 분석 후 재정의 예정

### 배경
- 당초 계획: ComparisonEngine (A_Compare.json, 493 records)
- 발견: A_Company.json (1,250 records, 2.1MB) 우선순위 높을 가능성
- 결론: Phase 0 완료 후 필수 시트 선별하여 Module 4+ 확정

### 후보
1. **A_Company.json**: 개별 기업 심화 분석 (성장성/밸류에이션)
   - 레코드: 1,250개 (M_Company의 부분집합)
   - 필드: 50개 (33 공통 + 17 계산)
   - 분류: 계산 결과물

2. **A_Compare.json**: 기업 간 비교 (동일 업종 수익/비용구조)
   - 레코드: 493개
   - 필드: 68개
   - 분류: 계산 결과물

3. **T_EPS_C.json, T_Growth_C.json**: 기술 지표
   - 레코드: 각 1,250개
   - 필드: 40개, 49개
   - 분류: 계산 결과물

4. **기타**: Phase 0 분석 결과에 따라 추가

### Tasks (대기)
Task 4.1-4.7: Phase 0 완료 후 작성 예정

**Phase 0 완료 시점에 결정할 사항**:
- [ ] 필수 시트 5개 선별
- [ ] Module 4, 5, 6 재정의
- [ ] 각 Module Task 작성
- [ ] 타임라인 재조정

---

## 📊 전체 진행 추적

### Phase 0: 전체 데이터 재검토 🔄
- [x] Task 0.1: 전체 시트 데이터 분석 (2일) ✅ 2025-10-19
- [ ] Task 0.2: xlsb → CSV 변환 검증 (1일)
- [ ] Task 0.3: 변환 스크립트 개선 (1일)
- [ ] Task 0.4: 필수 시트 선별 및 우선순위 (1일)
- [ ] Task 0.5: 명문화 - 완전한 데이터 레퍼런스 (1일)
- [ ] Task 0.6: Module 1,2 검증 및 조정 (1일)

**목표**: 22개 시트 완전 파악 + 올바른 로드맵 + Module 1,2 검증
**진행**: 1/6 tasks 완료 (16.7%)

### Module Completion Checklist

#### Module 1: CompanyMasterProvider ✅
- [x] Task 1.1: Data Schema Analysis
- [x] Task 1.2: Provider Class Design
- [x] Task 1.3: Index Structure Implementation
- [x] Task 1.4: Core Methods Implementation
- [x] Task 1.5: HTML Integration
- [x] Task 1.6: Unit Testing (33 tests passing)
- [x] Task 1.7: Documentation (1,200+ lines)

#### Module 2: ValidationAnalytics ✅
- [x] Task 2.1: Field Coverage Analysis
- [x] Task 2.2: Add Medium Priority Validators (6개)
- [x] Task 2.3: Update Arrays (numericFields, percentageFields, stringFields)
- [x] Task 2.4: Enhanced Reporting
- [x] Task 2.5: HTML Integration
- [x] Task 2.6: Testing (26 tests passing)
- [x] Task 2.7: Documentation (1,243 lines)

#### Module 3: WatchlistManager ❌ CANCELLED
- [x] ~~Task 3.1: S_Mylist Data Analysis~~ (취소)
- [x] ~~Task 3.2: WatchlistManager Class Design~~ (취소)
- [x] ~~Task 3.3: CRUD Implementation~~ (취소)
- [x] ~~Task 3.4: LocalStorage Persistence~~ (취소)
- [x] ~~Task 3.5: UI Integration~~ (취소)
- [x] ~~Task 3.6: Testing~~ (취소)
- [x] ~~Task 3.7: Documentation~~ (취소)
**취소 이유**: S_Mylist.json 불필요 (중복, 미사용, 분석 가치 없음)

#### Module 4: [TBD] ⏸️ Phase 0 완료 후 결정
- [ ] Phase 0 완료 후 필수 시트 선별
- [ ] Module 4 재정의
- [ ] Task 4.1-4.7 작성 예정

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
