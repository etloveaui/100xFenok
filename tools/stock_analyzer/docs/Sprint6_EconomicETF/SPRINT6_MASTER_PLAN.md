# Sprint 6: 경제지표 & ETF 분석 - Master Plan

**작성일**: 2025-10-19
**Sprint**: Sprint 6 - Economic Indicators & ETF Analytics
**Phase**: Phase 2 - Master Plan Creation
**방법론**: SPEC_DRIVEN_WORKFLOW

---

## 📋 Executive Summary

**현재 상황**: Sprint 4, 5 완료 - Sprint 6 시작 준비

**배경**:
- Sprint 4: 6개 모듈 (5개 완료, 1개 취소)
  - Module 1 (CompanyMasterProvider): ✅ 완료
  - Module 2 (ValidationAnalytics): ✅ 완료
  - Module 3 (WatchlistManager): ❌ 취소
  - Module 4 (CompanyAnalyticsProvider): ✅ 완료
  - Module 5 (EPSMonitoringProvider): ✅ 완료
  - Module 6 (IndustryCostAnalytics): ✅ 완료
- Sprint 5: 2개 모듈 완료
  - CFOAnalytics: ✅ 완료 (1,264 companies)
  - CorrelationEngine: ✅ 완료 (1,249 companies)
- **테스트 현황**: Sprint 4 (93/93, 100%), Sprint 5 (20/85, 24% - 개선 필요)

**Sprint 6 목표**:
- Module 7: EconomicIndicatorsProvider (거시경제 지표 분석)
- Module 8: ETFAnalyticsProvider (ETF 분석 및 포트폴리오)

**예상 기간**: 3.5-4주

**성공 기준**:
- [ ] Module 7, 8 구현 완료
- [ ] 테스트 통과율 > 95%
- [ ] API 문서 완성
- [ ] Sprint 5 테스트 개선 (24% → 95%+)

---

## 🚀 에이전트/모드/MCP 활용 전략

### 병렬 실행 계획

**Module 7, 8 분석 단계 (병렬 가능)**:
```yaml
동시 투입:
  - Task 7.1: @root-cause-analyst (E_Indicators Analysis, 1일)
  - Task 8.1: @root-cause-analyst (A_ETFs Analysis, 1일)

예상 효과: 2일 → 1일 (50% 단축)
```

**Implementation 단계 (순차)**:
```yaml
순차 진행:
  1. Module 7 완료 (1.5-2주)
  2. Module 8 시작 (2주)

이유: 각 모듈 복잡도 높음, 병렬 시 품질 저하 우려
```

**Testing 단계 (병렬 + Sprint 5 개선)**:
```yaml
동시 투입:
  - Task 7.7: @quality-engineer (Module 7 Testing)
  - Task 8.7: @quality-engineer (Module 8 Testing)
  - Sprint 5 Testing 개선 (65개 테스트 수정)

예상 효과: 6일 → 3-4일
```

### MCP 서버 활용 매핑

| Task 유형 | 추천 MCP | 이유 |
|----------|---------|------|
| 경제지표 분석 | Sequential | 시계열 데이터 구조 분석 |
| ETF 필드 분석 | Sequential | 151개 필드 체계적 분류 |
| 테스트 작성 | Playwright | 실제 브라우저 E2E |
| API 문서 | Context7 | 문서 패턴 참조 |

### 에이전트 배정

**Module 7 (EconomicIndicators)**:
- Task 7.1-7.2: @root-cause-analyst + @system-architect
- Task 7.3-7.5: @backend-architect (시계열 분석)
- Task 7.6: @frontend-architect (차트 시각화)
- Task 7.7: @quality-engineer (테스트)
- Task 7.8: @technical-writer (문서)

**Module 8 (ETFAnalytics)**:
- Task 8.1-8.2: @root-cause-analyst + @system-architect
- Task 8.3-8.5: @backend-architect (포트폴리오 분석)
- Task 8.6: @frontend-architect (ETF 대시보드)
- Task 8.7: @quality-engineer (테스트)
- Task 8.8: @technical-writer (문서)

---

## 📊 Module 7: EconomicIndicatorsProvider

### 데이터 개요

**파일**: `E_Indicators.csv`
**레코드**: 1,030 data points
**필드**: 68 fields
**주요 지표**:
- TED Spread (신용 스프레드)
- High Yield Yield (고수익 채권)
- Treasury Yields (국채 수익률)
- BEI (인플레이션 기대)
- 기타 경제 지표

**용도**: 거시경제 환경 분석, 리스크 평가, 포트폴리오 컨텍스트

### Task Breakdown

#### Task 7.1: E_Indicators Schema Analysis ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @root-cause-analyst
**Mode**: --think-hard
**MCP**: Sequential
**병렬 가능**: Yes (Task 8.1과 동시)

**작업 내용**:
- 68개 필드 전수 분석
- 시계열 데이터 구조 파악
- 경제 지표 분류 (금리, 스프레드, 인플레이션 등)
- 데이터 범위 및 주기 확인

**완료 기준**:
- [ ] 68개 필드 모두 분석
- [ ] 시계열 구조 명확히 파악
- [ ] 지표별 분류 완료
- [ ] 1,500+ lines 분석 문서

**산출물**:
- `TASK_7.1_E_INDICATORS_ANALYSIS.md`

---

#### Task 7.2: EconomicIndicatorsProvider Class Design ⏳
**기간**: 0.5일
**담당**: Claude
**에이전트**: @system-architect
**Mode**: --task-manage
**MCP**: None
**병렬 가능**: No (Task 7.1 완료 후)

**작업 내용**:
- Class 구조 설계
- 시계열 인덱싱 전략
- 주요 메서드 정의
- 성능 최적화 방안 (O(log n) time-series query)

**완료 기준**:
- [ ] Class diagram 작성
- [ ] 15-20개 메서드 정의
- [ ] 인덱싱 구조 설계
- [ ] 성능 목표 명시

**산출물**:
- `modules/EconomicIndicatorsProvider.js` (skeleton)

---

#### Task 7.3: Time-Series Data Loading & Indexing ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @backend-architect
**Mode**: --task-manage
**MCP**: None
**병렬 가능**: No

**작업 내용**:
- CSV → JSON 로딩
- 날짜 기반 인덱싱 (O(log n) binary search)
- 데이터 검증 (missing values, outliers)
- 캐싱 구조 구현

**완료 기준**:
- [ ] 1,030 points 로딩 < 1초
- [ ] 날짜 조회 O(log n)
- [ ] 데이터 검증 완료
- [ ] 유닛 테스트 통과

---

#### Task 7.4: Indicator Retrieval Methods ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @backend-architect
**Mode**: --task-manage

**메서드**:
1. `getTEDSpread(date)` - TED 스프레드 조회
2. `getHighYieldYield(date)` - 고수익 채권 수익률
3. `getTreasuryYields(date, maturity)` - 국채 수익률 (10Y, 2Y 등)
4. `getBEI(date)` - 인플레이션 기대
5. `getIndicatorRange(indicator, startDate, endDate)` - 기간별 조회

**완료 기준**:
- [ ] 5개 메서드 구현
- [ ] 각 메서드 < 10ms
- [ ] Edge case 처리 (missing data)
- [ ] 유닛 테스트 각 5개

---

#### Task 7.5: Economic Analysis Methods ⏳
**기간**: 1.5일
**담당**: Claude
**에이전트**: @backend-architect

**메서드**:
1. `calculateSpreadTrend(indicator, days)` - 스프레드 추세 계산
2. `detectYieldCurveInversion()` - 수익률 곡선 역전 감지
3. `getRiskIndicators(date)` - 리스크 지표 종합
4. `compareHistoricalLevels(indicator, date)` - 역사적 수준 비교
5. `getCreditConditions(date)` - 신용 환경 평가

**완료 기준**:
- [ ] 5개 분석 메서드 구현
- [ ] 통계적 정확성 검증
- [ ] 성능 < 50ms per method
- [ ] 유닛 테스트 각 5개

---

#### Task 7.6: HTML Integration & Visualization ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @frontend-architect

**작업 내용**:
- Dashboard 탭 추가 ("Economic Indicators")
- Chart.js 시계열 차트 (TED, HYY, Treasury)
- 수익률 곡선 시각화
- 리스크 지표 대시보드

**완료 기준**:
- [ ] 탭 추가 및 통합
- [ ] 3-4개 주요 차트
- [ ] 반응형 레이아웃
- [ ] 사용자 인터랙션 (날짜 선택)

---

#### Task 7.7: E2E Testing (Playwright) ⏳
**기간**: 1.5일
**담당**: Claude
**에이전트**: @quality-engineer
**MCP**: Playwright

**테스트 범위**:
- 데이터 로딩 (1,030 points)
- 날짜 조회 (binary search)
- 지표 계산 (스프레드, 추세)
- UI 렌더링 (차트)
- 성능 (<1초 초기화)

**완료 기준**:
- [ ] 30+ tests
- [ ] 100% 통과율
- [ ] Coverage > 85%
- [ ] 성능 기준 충족

**산출물**:
- `tests/sprint6-economic-indicators.spec.js`

---

#### Task 7.8: API Documentation ⏳
**기간**: 0.5일
**담당**: Claude
**에이전트**: @technical-writer
**MCP**: Context7

**문서 내용**:
- Class 개요
- 15-20개 메서드 상세 (params, returns, examples)
- 사용 예제 (시나리오별)
- 성능 특성

**완료 기준**:
- [ ] 1,200+ lines
- [ ] 모든 public 메서드 문서화
- [ ] 코드 예제 10+개
- [ ] 성능 메트릭 명시

**산출물**:
- `docs/API_ECONOMIC_INDICATORS.md`

---

## 📊 Module 8: ETFAnalyticsProvider

### 데이터 개요

**파일**: `A_ETFs.csv`
**레코드**: 489 ETFs
**필드**: 151 fields
**주요 정보**:
- ETF 기본 정보 (ticker, name, category)
- 보유 종목 (holdings)
- 재무 지표 (Fwd Sales, Fwd EPS, P/E, P/B)
- 성과 지표 (returns, volatility)

**용도**: ETF 분석, 포트폴리오 구성, 섹터 노출 분석

### Task Breakdown

#### Task 8.1: A_ETFs Schema Analysis ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @root-cause-analyst
**Mode**: --think-hard
**MCP**: Sequential
**병렬 가능**: Yes (Task 7.1과 동시)

**작업 내용**:
- 151개 필드 전수 분석
- ETF 카테고리 분류 (Equity, Bond, Sector 등)
- 보유 종목 구조 파악
- 재무/성과 지표 분류

**완료 기준**:
- [ ] 151개 필드 모두 분석
- [ ] 카테고리별 분류 완료
- [ ] 보유 종목 파싱 전략 수립
- [ ] 1,800+ lines 분석 문서

**산출물**:
- `TASK_8.1_A_ETFS_ANALYSIS.md`

---

#### Task 8.2: ETFAnalyticsProvider Class Design ⏳
**기간**: 0.5일
**담당**: Claude
**에이전트**: @system-architect

**작업 내용**:
- Class 구조 설계
- Ticker/Category 인덱싱 전략
- 주요 메서드 정의 (20-25개)
- Holdings 파싱 및 분석 방안

**완료 기준**:
- [ ] Class diagram 작성
- [ ] 20-25개 메서드 정의
- [ ] 인덱싱 구조 설계
- [ ] 성능 목표 명시

**산출물**:
- `modules/ETFAnalyticsProvider.js` (skeleton)

---

#### Task 8.3: ETF Data Loading & Indexing ⏳
**기간**: 1일
**담당**: Claude
**에이전트**: @backend-architect

**작업 내용**:
- CSV → JSON 로딩 (489 ETFs, 151 fields)
- Ticker/Category 인덱싱 (O(1) lookup)
- Holdings 파싱 (nested data)
- 데이터 검증

**완료 기준**:
- [ ] 489 ETFs 로딩 < 1초
- [ ] Ticker 조회 O(1)
- [ ] Holdings 파싱 완료
- [ ] 유닛 테스트 통과

---

#### Task 8.4: ETF Search & Filter Methods ⏳
**기간**: 1.5일
**담당**: Claude
**에이전트**: @backend-architect

**메서드**:
1. `getETFByTicker(ticker)` - Ticker로 조회
2. `searchETFsByCategory(category)` - 카테고리별 필터
3. `filterByPerformance(metric, threshold)` - 성과 기준 필터
4. `filterByExpenseRatio(max)` - 비용 기준 필터
5. `searchByHolding(ticker)` - 특정 종목 보유 ETF
6. `getTopETFsByAUM(n)` - AUM 상위 ETF

**완료 기준**:
- [ ] 6개 메서드 구현
- [ ] 각 메서드 < 20ms
- [ ] Edge case 처리
- [ ] 유닛 테스트 각 5개

---

#### Task 8.5: Portfolio Analysis Methods ⏳
**기간**: 1.5일
**담당**: Claude
**에이전트**: @backend-architect

**메서드**:
1. `analyzeHoldings(ticker)` - 보유 종목 분석
2. `calculateSectorExposure(ticker)` - 섹터 노출
3. `compareETFs(tickers[])` - ETF 비교
4. `getCorrelatedETFs(ticker, threshold)` - 상관관계 ETF
5. `analyzeDiversification(tickers[])` - 포트폴리오 분산 분석

**완료 기준**:
- [ ] 5개 분석 메서드 구현
- [ ] 정확성 검증
- [ ] 성능 < 100ms per method
- [ ] 유닛 테스트 각 5개

---

#### Task 8.6: HTML Integration & Dashboard ⏳
**기간**: 1.5일
**담당**: Claude
**에이전트**: @frontend-architect

**작업 내용**:
- Dashboard 탭 추가 ("ETF Analytics")
- ETF 검색 UI
- 보유 종목 테이블
- 섹터 노출 차트 (pie/bar chart)
- ETF 비교 테이블

**완료 기준**:
- [ ] 탭 추가 및 통합
- [ ] 검색/필터 UI
- [ ] 차트 시각화 3-4개
- [ ] 반응형 레이아웃

---

#### Task 8.7: E2E Testing (Playwright) ⏳
**기간**: 2일
**담당**: Claude
**에이전트**: @quality-engineer
**MCP**: Playwright

**테스트 범위**:
- 데이터 로딩 (489 ETFs, 151 fields)
- Ticker/Category 조회
- Holdings 파싱
- 포트폴리오 분석
- UI 렌더링

**완료 기준**:
- [ ] 40+ tests
- [ ] 100% 통과율
- [ ] Coverage > 85%
- [ ] 성능 기준 충족

**산출물**:
- `tests/sprint6-etf-analytics.spec.js`

---

#### Task 8.8: API Documentation ⏳
**기간**: 0.5일
**담당**: Claude
**에이전트**: @technical-writer
**MCP**: Context7

**문서 내용**:
- Class 개요
- 20-25개 메서드 상세
- 사용 예제 (시나리오별)
- Holdings 파싱 가이드
- 성능 특성

**완료 기준**:
- [ ] 1,500+ lines
- [ ] 모든 public 메서드 문서화
- [ ] 코드 예제 15+개
- [ ] 성능 메트릭 명시

**산출물**:
- `docs/API_ETF_ANALYTICS.md`

---

## 🧪 Sprint 5 Testing 개선

**현황**: 20/85 tests (24%)
**목표**: 95%+ 통과율

### 개선 계획

**기간**: Sprint 6과 병행 (1-2주)

**작업 내용**:
1. 65개 실패 테스트 분석
   - CFOAnalytics: 30개 테스트 수정
   - CorrelationEngine: 35개 테스트 수정
2. 데이터 이슈 해결 (있다면)
3. 테스트 로직 개선
4. 전체 재실행 및 검증

**병렬 진행**:
- Module 7 개발 중 (Week 1-2): CFOAnalytics 테스트 개선
- Module 8 개발 중 (Week 3-4): CorrelationEngine 테스트 개선

**완료 기준**:
- [ ] 80/85 tests 이상 (95%+)
- [ ] 실패 원인 문서화
- [ ] 회귀 방지 메커니즘

---

## 📅 타임라인

### Week 1: Module 7 (Part 1)
- **Day 1**: Task 7.1 (분석, 병렬 Task 8.1)
- **Day 2**: Task 7.2 (설계)
- **Day 3**: Task 7.3 (로딩/인덱싱)
- **Day 4**: Task 7.4 (조회 메서드)
- **Day 5-6**: Task 7.5 (분석 메서드)

**Sprint 5 병행**: CFOAnalytics 테스트 개선 (15개)

### Week 2: Module 7 (Part 2)
- **Day 7**: Task 7.6 (HTML 통합)
- **Day 8-9**: Task 7.7 (E2E 테스트)
- **Day 10**: Task 7.8 (문서)

**Sprint 5 병행**: CFOAnalytics 테스트 개선 완료 (30개)

### Week 3: Module 8 (Part 1)
- **Day 11**: Task 8.2 (설계, Task 8.1은 Day 1 완료)
- **Day 12**: Task 8.3 (로딩/인덱싱)
- **Day 13-14**: Task 8.4 (검색/필터)
- **Day 15-16**: Task 8.5 (포트폴리오 분석)

**Sprint 5 병행**: CorrelationEngine 테스트 개선 (20개)

### Week 4: Module 8 (Part 2) & Sprint 완료
- **Day 17-18**: Task 8.6 (HTML 통합)
- **Day 19-20**: Task 8.7 (E2E 테스트)
- **Day 21**: Task 8.8 (문서)
- **Day 22**: 전체 통합 테스트
- **Day 23**: 성능 검증 및 최적화
- **Day 24**: Sprint 6 회고 작성
- **Day 25**: Git commit & 정리

**Sprint 5 병행**: CorrelationEngine 테스트 개선 완료 (35개)

---

## 🎯 완료 기준

### Code Metrics
- **신규 파일**: 2개 (Module 7, 8)
- **수정 파일**: 2개 (HTML, DashboardManager)
- **신규 테스트**: 2개 (Module 7, 8)
- **테스트 커버리지**: > 85%

### Performance Metrics
- **Module 7 초기화**: < 1초 (1,030 points)
- **Module 8 초기화**: < 1초 (489 ETFs, 151 fields)
- **시계열 조회**: O(log n) < 10ms
- **Ticker 조회**: O(1) < 5ms
- **전체 시스템**: < 6초 (11 modules)

### Quality Metrics
- **Module 7 테스트**: 30+ tests, 100%
- **Module 8 테스트**: 40+ tests, 100%
- **Sprint 5 테스트**: 80/85+ (95%+)
- **전체 테스트**: 200+ tests, > 95%

### Documentation
- **API 문서**: 2개 (Module 7, 8), 2,700+ lines
- **분석 문서**: 2개 (Task 7.1, 8.1), 3,300+ lines
- **회고 문서**: SPRINT6_RETROSPECTIVE.md

---

## 🔄 데이터 교체 검증 (선택)

**시점**: Sprint 6 완료 후

**최신 데이터**:
- Global_Scouter_20251010.xlsb (90.0 MB)
- Global_Scouter_20251017.xlsb (90.6 MB)

**절차**:
1. 현재 데이터 백업 (data/)
2. 최신 xlsb → CSV → JSON 변환
3. 전체 테스트 실행 (200+ tests)
4. 결과 비교 (레코드 수 ±10%, 구조 일치)
5. 통과 → 배포, 실패 → 롤백/개선

**예상 소요**: 2-3일

---

## 🚀 다음 단계

### Implementation 준비
1. ✅ Sprint 6 Master Plan 작성 완료
2. ⏳ Git commit (Sprint 6 계획)
3. ⏳ Task 7.1, 8.1 병렬 시작 (분석)

### 리소스 준비
- [ ] E_Indicators.json 확인
- [ ] A_ETFs.json 확인
- [ ] Python 서버 실행 (port 8080)
- [ ] 테스트 환경 준비 (Playwright)

### Sprint 5 개선 준비
- [ ] 실패 테스트 목록 작성 (65개)
- [ ] 실패 원인 분류
- [ ] 개선 우선순위 설정

---

## 📚 관련 문서

- `SHEET_PRIORITY_MATRIX.md`: Sprint 6-8 전체 로드맵
- `SPRINT4_5_INTEGRATED_RETROSPECTIVE.md`: Sprint 4, 5 회고
- `SPRINT4_FINAL_STATUS.md`: Sprint 4, 5 완료 상태
- `CLAUDE.md`: 프로젝트 절대 원칙

---

**작성자**: Claude Code (Sonnet 4.5)
**방법론**: SPEC_DRIVEN_WORKFLOW
**다음 단계**: Git commit → Task 7.1, 8.1 병렬 시작
**예상 완료**: 2025-11-15 (4주 후)
