# PROJECT_REFERENCE.md - Stock Analyzer 기술 참조

**작성일**: 2025년 10월 19일
**목적**: 프로젝트 구조, 데이터, 워크플로우 기술 참조
**읽기 트리거**: 프로젝트 구조 확인, 데이터 작업, 테스트 실행 시

---

## 📁 디렉터리 구조

```
C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\
├── data/                                # 데이터 저장소
│   ├── *.csv                           # xlsb 변환 CSV 파일 (20개)
│   └── integrated_stock_data.json      # 통합 JSON (89.5 MB)
│
├── docs/                               # 프로젝트 문서
│   ├── CLAUDE.md                       # 핵심 가이드 (286 lines)
│   ├── CLAUDE_PROTOCOLS.md             # 프로토콜 (~400 lines)
│   ├── PROJECT_REFERENCE.md            # 이 파일 (기술 참조)
│   │
│   ├── Sprint4_DataIntegration/        # Sprint 4 문서
│   │   ├── SPRINT4_MASTER_PLAN.md
│   │   ├── SPRINT4_5_INTEGRATED_RETROSPECTIVE.md
│   │   ├── SPRINT4_FINAL_STATUS.md
│   │   ├── DATA_COMPLETE_REFERENCE.md  # 데이터 완전 참조 (5,000+ lines)
│   │   ├── SHEET_PRIORITY_MATRIX.md    # 로드맵
│   │   └── [회고 문서들...]
│   │
│   └── Sprint6_EconomicETF/            # Sprint 6 문서
│       └── SPRINT6_MASTER_PLAN.md
│
├── providers/                          # Analytics Providers
│   ├── CompanyMasterProvider.js        # Module 1 (6,176 companies)
│   ├── ValidationAnalytics.js          # Module 2 (Quality Score)
│   ├── CompanyAnalyticsProvider.js     # Module 4 (1,250 companies)
│   ├── EPSMonitoringProvider.js        # Module 5 (Time-series)
│   ├── IndustryCostAnalytics.js        # Module 6 (6 companies)
│   ├── CFOAnalytics.js                 # Module 7 - Sprint 5 (1,264)
│   └── CorrelationEngine.js            # Module 8 - Sprint 5 (1,249)
│
├── scripts/                            # 유틸리티 스크립트
│   └── xlsb_to_csv_converter.py        # xlsb → CSV 변환 (280 lines)
│
├── tests/                              # E2E 테스트
│   ├── setup/
│   │   └── test-setup.js               # 테스트 초기화
│   ├── sprint4/
│   │   ├── module1-company-master.spec.js      # 33 tests
│   │   ├── module2-validation-analytics.spec.js # 26 tests
│   │   ├── module4-company-analytics.spec.js    # 38 tests
│   │   ├── module5-eps-monitoring.spec.js       # 31 tests
│   │   └── module6-industry-cost.spec.js        # 24 tests
│   └── sprint5/
│       ├── module7-cfo-analytics.spec.js        # 85 tests (20 passing, 24%)
│       └── module8-correlation-engine.spec.js   # (포함됨)
│
├── playwright.config.js                # Playwright 설정
├── package.json                        # 프로젝트 설정
└── index.js                            # 메인 진입점

```

---

## 💾 데이터 워크플로우

### 주간 데이터 업데이트 프로세스

**1. 데이터 소스**:
```
입력: Global_Scouter_YYYYMMDD.xlsb
크기: ~90 MB
주기: 매주 목요일 업데이트 (WISE 제공)
위치: C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\
```

**2. 변환 파이프라인**:
```bash
# Step 1: xlsb → CSV 변환 (20개 시트)
python scripts/xlsb_to_csv_converter.py Global_Scouter_20251017.xlsb

# 출력: data/*.csv (20개 CSV 파일)

# Step 2: CSV → JSON 통합 (Node.js 프로세스)
# index.js 실행 시 자동 처리
node index.js

# 출력: data/integrated_stock_data.json (89.5 MB)
```

**3. 파일 명명 규칙**:
```yaml
xlsb 파일: Global_Scouter_YYYYMMDD.xlsb
  예: Global_Scouter_20251017.xlsb (2025년 10월 17일)

CSV 파일: [SheetName].csv
  예: A_Company.csv, T_Chk.csv, T_EPS_C.csv

JSON 파일: integrated_stock_data.json (고정)
```

**4. 데이터 검증**:
```bash
# 변환 검증 스크립트 (자동)
python scripts/xlsb_to_csv_converter.py Global_Scouter_20251017.xlsb

# 검증 항목:
- 시트 개수: 20개
- 레코드 수: 예상 범위 내 (±10%)
- 필드 구조: 기존과 일치
- 인코딩: UTF-8
```

**5. 데이터 교체 절차** (Sprint 완료 시):

참조: `SPRINT4_FINAL_STATUS.md` - "데이터 교체 검증 계획"

```bash
# Step 1: 백업
cp -r data/ data_backup_20251003/

# Step 2: 최신 데이터 변환
python scripts/xlsb_to_csv_converter.py Global_Scouter_[최신날짜].xlsb

# Step 3: 전체 테스트 실행
npx playwright test

# Step 4: 검증 기준
- 변환 성공: 20/20 시트
- 테스트 통과율: > 95%
- 레코드 수: ±10% 범위
- 성능: 초기화 < 5초

# Step 5: 의사결정
✅ 통과 → 배포
❌ 실패 → 롤백, 이슈 해결
```

---

## 🧪 테스트 실행 가이드

### 기본 실행

```bash
# 전체 테스트 실행 (모든 브라우저)
npx playwright test

# Chromium만 실행 (가장 빠름)
npx playwright test --project=chromium

# 특정 Sprint 테스트만 실행
npx playwright test tests/sprint4/
npx playwright test tests/sprint5/

# 특정 모듈 테스트만 실행
npx playwright test tests/sprint4/module4-company-analytics.spec.js

# UI 모드 (디버깅용)
npx playwright test --ui
```

### 테스트 결과 해석

**성공 기준**:
```yaml
Sprint 4 Standard:
  Passing: 93/93 (100%)
  Duration: < 60 seconds
  Failures: 0

Sprint 5 Current (문제):
  Passing: 20/85 (24%)
  Duration: N/A
  Failures: 65 tests
  Status: ⚠️ 미완성
```

**테스트 실패 시 대응**:
```yaml
절대 금지:
  - ❌ .slice()로 데이터 축소
  - ❌ 테스트 skip/disable
  - ❌ expect() 조건 완화
  - ❌ 데이터셋 크기 줄이기

올바른 대응:
  - ✅ 시스템 개선 (O(n) 최적화)
  - ✅ 알고리즘 개선
  - ✅ 메모리 관리 개선
  - ✅ 전체 데이터셋으로 재테스트
```

### 테스트 디버깅

```bash
# 단일 테스트 디버깅
npx playwright test tests/sprint5/module7-cfo-analytics.spec.js --debug

# 헤드풀 모드 (브라우저 보이기)
npx playwright test --headed

# 특정 테스트만 실행 (it.only)
# module7-cfo-analytics.spec.js에서 it.only() 사용

# 테스트 리포트 확인
npx playwright show-report
```

---

## ⚡ 성능 최적화 패턴

### O(n) 최적화

**사례: CorrelationEngine (Sprint 5)**

**문제**: O(n²) 알고리즘 → 1,249 companies에서 느림
```javascript
// ❌ O(n²) - 느림
for (const company of companies) {
  for (const other of companies) {
    calculateCorrelation(company, other);
  }
}
```

**해결**: O(n) 최적화 → Map 기반 조회
```javascript
// ✅ O(n) - 빠름
const companyMap = new Map(companies.map(c => [c.ticker, c]));
for (const company of companies) {
  const related = companyMap.get(company.relatedTicker);
  if (related) {
    calculateCorrelation(company, related);
  }
}
```

### 대규모 데이터셋 처리

**원칙**: 10,000개 기업까지 확장 가능하게 설계

```yaml
현재 규모:
  A_Company: 6,176 companies
  Core Universe (T_Chk): 1,250 companies
  T_CFO: 1,264 companies
  T_Correlation: 1,249 companies

목표 규모:
  확장: 10,000+ companies
  제약: 로딩/성능 중단 없이
  요구: 아키텍처 확장성 우선
```

**최적화 기법**:
1. **메모리 관리**: Lazy loading, streaming
2. **알고리즘**: O(n²) → O(n log n) → O(n)
3. **캐싱**: 계산 결과 재사용
4. **인덱싱**: Map/Set 활용, 배열 탐색 최소화

### 초기화 성능 기준

```yaml
목표:
  초기화 시간: < 5초
  메모리 사용: < 500 MB
  테스트 실행: < 120초 (전체)

현재 달성:
  Sprint 4 Modules: ✅ 모두 기준 충족
  Sprint 5 Modules: ⚠️ 테스트 미완성
```

---

## 🗑️ 임시 파일 정리 프로토콜

### 자동 정리 대상

**매 작업 완료 시 삭제**:
```bash
# Playwright 테스트 결과
rm -rf playwright-report/
rm -rf test-results/

# 임시 분석 파일
rm temp_*.txt
rm temp_*.json

# 테스트 HTML 출력
rm test_*.html
rm *_debug.html
```

### 수동 정리 대상

**Sprint 완료 시 정리** (사용자 확인 후):
```bash
# 불필요 데이터 파일 (Module 3 취소)
rm data/S_Mylist.json          # 36KB, Module 3 cancelled

# 오래된 백업 파일
rm data_backup_old/            # 필요 시

# 개발 중 생성된 스크립트
rm scripts/temp_*.py
rm scripts/debug_*.js
```

### 절대 삭제 금지

```bash
# ❌ 절대 삭제 금지
data/*.csv                     # 원본 CSV 파일
data/integrated_stock_data.json # 통합 JSON
docs/**/*.md                   # 모든 문서
providers/**/*.js              # Provider 코드
tests/**/*.spec.js             # 테스트 코드
scripts/xlsb_to_csv_converter.py # 변환 스크립트
```

---

## 🔍 기술 세부사항

### Module별 데이터 규모

| Module | Provider | Companies | Tests | Status |
|--------|----------|-----------|-------|--------|
| 1 | CompanyMasterProvider | 6,176 | 33 | ✅ 100% |
| 2 | ValidationAnalytics | 6,176 | 26 | ✅ 100% |
| 3 | WatchlistManager | - | - | ❌ Cancelled |
| 4 | CompanyAnalyticsProvider | 1,250 | 38 | ✅ 100% |
| 5 | EPSMonitoringProvider | 1,250 | 31 | ✅ 100% |
| 6 | IndustryCostAnalytics | 6 | 24 | ✅ 100% |
| 7 | CFOAnalytics | 1,264 | 85 | ⚠️ 24% |
| 8 | CorrelationEngine | 1,249 | (포함) | ⚠️ 24% |

**총계**:
- Sprint 4: 93/93 tests (100%)
- Sprint 5: 20/85 tests (24%) ⚠️ **미완성**

### Provider 패턴

**구조**:
```javascript
class CompanyAnalyticsProvider {
  constructor(stockData) {
    this.data = stockData.data.main; // 1,250 companies
    this.initialize();
  }

  initialize() {
    // Setup indices, caches
  }

  // Public Methods (15-23 methods per provider)
  getCompanyByTicker(ticker) { }
  calculateMetrics() { }
  // ...
}

module.exports = CompanyAnalyticsProvider;
```

**초기화 패턴**:
```javascript
// test-setup.js
const data = require('../data/integrated_stock_data.json');
const provider = new CompanyAnalyticsProvider(data);

test.beforeAll(async () => {
  // Provider 준비 완료
});
```

### 테스트 구조

**E2E 테스트 패턴**:
```javascript
// module4-company-analytics.spec.js
const { test, expect } = require('@playwright/test');

test.describe('Module 4: CompanyAnalyticsProvider', () => {
  test('데이터 초기화 검증', async () => {
    const provider = new CompanyAnalyticsProvider(data);
    expect(provider.data).toBeDefined();
    expect(provider.data.length).toBe(1250);
  });

  test('메서드 기능 검증', async () => {
    const company = provider.getCompanyByTicker('005930');
    expect(company.name).toBe('삼성전자');
  });

  // 38 tests total
});
```

---

## 📊 데이터 구조 참조

**상세 데이터 구조**: `docs/Sprint4_DataIntegration/DATA_COMPLETE_REFERENCE.md` (5,000+ lines) 참조

**주요 데이터셋**:

```yaml
A_Company: # 기업 마스터
  Records: 6,176 companies
  Fields: 50+ fields
  Key: Ticker, Name, Sector, Industry

T_Chk: # Core Universe (1,250 Pattern)
  Records: 1,250 companies
  Fields: 20+ fundamental indicators
  Purpose: 핵심 분석 대상

T_EPS_C: # EPS 시계열 (1,250 Pattern)
  Records: 1,250 companies × 54 snapshots
  Fields: EPS, Revenue, Operating Profit
  Time Range: 371 days (54 weekly snapshots)

T_CFO: # Cash Flow Operations
  Records: 1,264 companies
  Fields: 23 cash flow metrics
  Analysis: Operating, Investing, Financing

T_Correlation: # 상관관계 매트릭스
  Records: 1,249 companies
  Fields: 19 correlation metrics
  Optimization: O(n) achieved
```

---

## 🔗 관련 문서

### 핵심 가이드
- **CLAUDE.md** - 핵심 원칙, Quick Reference (매 세션 시작)
- **CLAUDE_PROTOCOLS.md** - 세션/파일/MASTER_PLAN 프로토콜

### 상세 참조
- **DATA_COMPLETE_REFERENCE.md** - 전체 데이터 구조 (5,000+ lines)
- **SHEET_PRIORITY_MATRIX.md** - 모듈 우선순위 로드맵 (2,800+ lines)
- **SPRINT4_5_INTEGRATED_RETROSPECTIVE.md** - Sprint 4, 5 통합 회고

### Sprint별 문서
- **SPRINT4_MASTER_PLAN.md** - Sprint 4 마스터 플랜
- **SPRINT6_MASTER_PLAN.md** - Sprint 6 마스터 플랜

---

**최종 업데이트**: 2025년 10월 19일
**작성자**: Claude Code (Sonnet 4.5)
**프로젝트**: Stock Analyzer - 100xFenok

---

**⚠️ 이 문서는 필요 시 참조하세요! 매 세션 시작 시 읽기 불필요.**
