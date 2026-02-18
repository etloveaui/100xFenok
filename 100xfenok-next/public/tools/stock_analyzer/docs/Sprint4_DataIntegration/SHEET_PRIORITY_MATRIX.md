# Sprint 4: 시트 우선순위 매트릭스

**작성일**: 2025-10-19
**작성자**: System Architect (Claude Sonnet 4.5)
**목적**: Task 0.4 - 22개 시트 전략적 우선순위 결정 및 개발 로드맵 수립
**기반 문서**: SHEET_ANALYSIS_REPORT.md (2,500+ lines), MODULE2_RETROSPECTIVE.md
**프로젝트**: Stock Analyzer - 100xFenok

---

## Executive Summary

### 핵심 결정 사항

**Phase 1 Critical Sheets (5개)**:
1. **A_Company** (1,250) - 핵심 분석 허브
2. **A_Compare** (493) - 업종별 비교 (high user value)
3. **T_Chk** (1,250) - EPS 변화 추적 (real-time monitoring)
4. **E_Indicators** (1,030) - 경제 지표 (macro context)
5. **A_ETFs** (489) - ETF 분석 (portfolio context)

**제외된 시트**:
- M_Company (✅ Module 1 완료)
- T_EPS_C, T_Growth_C, T_Rank (✅ Sprint 4 완료)
- T_CFO, T_Correlation (🔄 Sprint 5 구현완료, 테스팅 미완)
- S_Mylist (❌ Cancelled)

**개발 로드맵**:
- **Phase 1 (Week 1-8)**: 5개 시트, Module 4-8
- **Phase 2 (Week 9-16)**: 6개 시트, Module 9-14
- **Phase 3 (Week 17-24)**: 6개 시트, Module 15-20

**총 개발 시트**: 17개 (5개 완료 + 1개 취소 제외)
**예상 기간**: 24주 (6개월)

---

## Part 1: 우선순위 결정 기준 (4가지 축)

### 1. 의존성 (Dependency) - 3단계

| Level | 분류 | 의미 | 예시 |
|-------|------|------|------|
| **Level 3** | Foundation | 다른 모듈의 필수 기반 | M_Company, M_ETFs |
| **Level 2** | Semi-dependent | 일부 의존, 독립 기능 가능 | A_Company (M_Company 의존, but 독립 분석 가능) |
| **Level 1** | Independent | 완전 독립 실행 가능 | E_Indicators (외부 데이터 직접) |
| **Level 0** | Leaf | 다른 시트에 의존만 함 | T_EPS_H (T_EPS_C 샘플링) |

### 2. 사용자 가치 (User Value) - 10점 척도

| 점수 | 분류 | 의미 | 예시 |
|------|------|------|------|
| **10** | Critical | 즉각적 핵심 가치 | M_Company (전체 기업 마스터) |
| **8-9** | High | 주요 분석 기능 | A_Company (성장성, 밸류에이션) |
| **6-7** | Medium | 유용한 인사이트 | A_Compare (업종 비교) |
| **4-5** | Low | 참조 정보 | T_Chart (차트 생성용) |
| **1-3** | Minimal | 선택적 기능 | T_EPS_H (샘플 히스토리) |

### 3. 데이터 유형 (Data Type) - 5종

| 유형 | 설명 | 특징 | 우선순위 |
|------|------|------|---------|
| **BASE** | 원본 마스터 (M_*) | 다른 시트의 원천 | Highest |
| **CALCULATED** | 계산 결과물 (A_*, T_*) | BASE에서 파생 | High → Medium |
| **TOOL** | 스크리닝 도구 (S_*) | 사용자 탐색 지원 | Medium → Low |
| **INDICATOR** | 경제 지표 (E_*) | 독립 외부 데이터 | High (macro context) |
| **SPECIAL** | 특수 분석 | 고유 목적 | Medium |

### 4. 복잡도 (Complexity) - 0.0 ~ 1.0

| 범위 | 분류 | 특징 | 예상 기간 |
|------|------|------|----------|
| **0.9-1.0** | Very Complex | 다중 데이터 통합, 고급 알고리즘 | 3-4주 |
| **0.7-0.8** | Complex | 분석 로직, 다단계 계산 | 2-3주 |
| **0.5-0.6** | Medium | 필터/검색, 중간 계산 | 1.5-2주 |
| **0.3-0.4** | Simple | 단순 로딩/표시 | 1주 |
| **0.1-0.2** | Trivial | 기본 CRUD | 3-5일 |

---

## Part 2: 22개 시트 전수 평가

### 📊 M_Company.csv (BASE)

**분류**: Foundation Master Data

#### 평가 매트릭스
- **의존성**: Level 3 (Foundation) - 15개 시트가 의존
- **사용자 가치**: 10/10 (모든 기능의 기반)
- **데이터 유형**: BASE
- **복잡도**: 0.6 (O(1) 인덱싱, null safety)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 6,176 companies
필드: 33 fields
관계:
  → A_Company (1,250 filtered)
  → T_EPS_C (1,250 filtered)
  → T_Growth_C (1,250 filtered)
  → T_Rank (1,253 filtered)
  → T_CFO (1,264 filtered)
  → T_Correlation (1,249 filtered)
  → T_Chk (1,250 filtered)
  → A_Compare (493 industry filtered)
  → A_Contrast (113 cross-industry)
  → T_Chart (88 sample)
  → S_Chart (119 sample)
```

#### 우선순위: 🔴 Critical (P0)
**결정**: ✅ **Already Done** (Module 1 - CompanyMasterProvider)
- Git Commit: `ee50ed7b`
- API: 12 methods, O(1) lookup
- Test: 33/33 passing
- Quality Score: 99.8/100

---

### 📈 A_Company.csv (CALCULATED)

**분류**: Core Analysis Hub

#### 평가 매트릭스
- **의존성**: Level 2 (Semi-dependent) - M_Company 기반, 독립 분석 가능
- **사용자 가치**: 9/10 (성장성, 밸류에이션, 기대수익률)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.7 (17 calculated fields, PEG, Return, DY)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 1,250 companies (M_Company filtered)
필드: 50 fields (33 common + 17 calculated)

공통 필드 (33 from M_Company):
  - Ticker, Corp, Exchange, WI26, FY 0, 설립
  - 현재가, 전일대비, 전주대비, 시가총액
  - 수익성: ROE (Fwd), OPM (Fwd)
  - 기간별 수익률: W, 1 M, 3 M, 6 M, YTD, 12 M (6개)
  - 괴리율: W, 1 M, 3 M, 6 M, YTD, 12 M (6개)
  - Fwd 12M EPS Consensus Change: W, 1 M, 3 M, 6 M, YTD, 12 M (6개)
  - Fwd 12M EPS Consensus: [7 date columns]

계산 필드 (17):
  밸류에이션:
    - PER (Oct-25), % PER (Avg)
    - PBR (Oct-25)

  성장률:
    - Sales (3): 3년 매출 CAGR
    - PER (3), PER (5), PER (10): 3/5/10년 EPS 성장률
    - PEG (Oct-25): PER / EPS Growth Rate

  기대수익률:
    - PER (Avg): 과거 평균 PER
    - Price (10): 10년 목표가
    - Return (Y): 연간 기대수익률
    - DY (FY+1): 배당수익률

  추가:
    - Sales (3), PER (3), PER (5), PER (10): 성장률 메트릭

관계:
  - M_Company (6,176) → Filtering → A_Company (1,250)
  - 필터링 기준: 시가총액 >$10B, 데이터 완전성, 유동성
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 및 파싱
  - 필드 검증 (50 fields)
  - 인덱싱: Ticker, WI26, Exchange
  - M_Company와의 조인 로직

Analytics Layer:
  - Growth Analysis (Sales, PER 3/5/10)
  - Valuation Analysis (PEG, % PER/PBR Avg)
  - Return Calculation (Price target, Expected return)
  - Dividend Analysis (DY FY+1)

Performance:
  - O(n) 필터링
  - O(1) 룩업 (Ticker index)
  - Target: <100ms for 1,250 records

Testing:
  - 전체 데이터셋 (1,250 companies)
  - 계산 검증 (PEG, Return, DY)
  - M_Company 조인 정확성
```

#### 우선순위: 🔴 Critical (P0)
**선정 이유**:
1. **핵심 분석 허브**: 성장률, 밸류에이션, 기대수익률 통합
2. **높은 사용자 가치**: 투자 의사결정 핵심 지표
3. **다른 기능의 기반**: 스크리닝, 비교 분석 기초
4. **1,250 Pattern Core**: 핵심 기업 필터링 기준 정립

**Phase 1 Module**: Module 4 - CompanyAnalyticsProvider

---

### 🔬 T_EPS_C.csv (CALCULATED)

**분류**: EPS Time-Series Analysis

#### 평가 매트릭스
- **의존성**: Level 1 (Independent for analytics)
- **사용자 가치**: 8/10 (EPS 컨센서스 변화 추적)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.6 (시계열 필드, 변화율 계산)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 1,250 companies
필드: 40 fields (12 common + 28 calculated)

공통 필드 (12 from M_Company):
  - Ticker, Corp, Exchange, WI26, FY O, 설립
  - 현재가, 전일대비, 전주대비, 시가총액
  - ROE (Fwd), OPM (Fwd), CCC (FY 0)

계산 필드 (28):
  밸류에이션:
    - PER (Oct-25), PER (1~5), %
    - PBR (Oct-25), PBR (1~5), %

  FY+1 EPS (7 fields):
    - W: 주간 변화
    - [6 date columns]: 시계열 컨센서스

  FY+2 EPS (7 fields):
    - W: 주간 변화
    - [6 date columns]: 시계열 컨센서스

  FY+3 EPS (7 fields):
    - W: 주간 변화
    - [6 date columns]: 시계열 컨센서스

샘플 데이터:
  NVDA: FY+1 4.49→6.39, FY+2 6.39→7.37, FY+3 7.37
  MSFT: FY+1 15.5→15.5, FY+2 15.5→21.54, FY+3 21.54
  AAPL: FY+1 7.37→8.0, FY+2 8.0→8.8, FY+3 8.8
```

#### 우선순위: ✅ **Already Done** (Sprint 4)
**상태**: EPSAnalytics.js 구현 완료
- Module: Sprint 4 Analytics
- Test: 전체 데이터셋 검증 완료

---

### 📊 T_Growth_C.csv (CALCULATED)

**분류**: Growth Rate Analysis

#### 평가 매트릭스
- **의존성**: Level 1 (Independent)
- **사용자 가치**: 8/10 (성장률 컨센서스 분석)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.7 (37 calculated fields)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 1,250 companies
필드: 49 fields (12 common + 37 calculated)

계산 필드 (37):
  성장률 시계열 (4 time periods x 6 metrics = 24):
    W (주간):
      - Sales (7), Sales (3): 7년/3년 매출 성장률
      - OP (7), OP (3): 7년/3년 영업이익 성장률
      - EPS (7), EPS (3): 7년/3년 EPS 성장률

    1 M (월간): 동일 구조
    3 M (분기): 동일 구조
    [Date]: 동일 구조

샘플 데이터:
  NVDA: Sales (3) 34.9%, OP 73.4%, EPS 71.3%
  MSFT: Sales (3) 14.7%, OP 15.1%, EPS 16.5%
  AAPL: Sales (3) 6.0%, OP 6.6%, EPS 13.1%
```

#### 우선순위: ✅ **Already Done** (Sprint 4)
**상태**: GrowthAnalytics.js 구현 완료

---

### 📈 T_Rank.csv (CALCULATED)

**분류**: Ranking & Expected Return

#### 평가 매트릭스
- **의존성**: Level 1 (Independent)
- **사용자 가치**: 8/10 (순위 및 기대수익률)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.7 (Rank, PEG, Return 계산)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 1,253 companies
필드: 38 fields (12 common + 26 calculated)

계산 필드 (26):
  밸류에이션:
    - PER (Oct-25), PER (1~5), %
    - PBR (Oct-25), PBR (1~5), %

  EPS 변화율:
    - FY+1/FY 0
    - FY+2/FY+1
    - FY+3/FY+2
    - F0←F+1

  평가 지표:
    - Chk
    - Sales (3)
    - PEG (Oct-25)
    - % PER (Avg), % PBR (Avg)
    - PER+PBR
    - Rank↑

  기대수익률 (Regression):
    - EPS (Oct-25): EPS 기준 목표가
    - Price: 목표 주가
    - Return: 기대수익률
    - BPS (Oct-25): BPS 기준 목표가
    - Price: 목표 주가
    - Return: 기대수익률
```

#### 우선순위: ✅ **Already Done** (Sprint 4)
**상태**: RankingAnalytics.js 구현 완료

---

### 💰 T_CFO.csv (CALCULATED)

**분류**: Cash Flow Analysis

#### 평가 매트릭스
- **의존성**: Level 1 (Independent)
- **사용자 가치**: 8/10 (현금흐름 품질 분석)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.6 (시계열 CFO, Net Income)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 1,264 companies
필드: 36 fields (12 common + 24 calculated)

계산 필드 (24):
  영업활동현금흐름 (8):
    FY-4, FY-3, FY-2, FY-1, FY 0, FY+1, FY+2, FY+3

  당기순이익 (8):
    FY-4, FY-3, FY-2, FY-1, FY 0, FY+1, FY+2, FY+3

  비율 분석:
    - CFO / Net Income
    - CFO 트렌드
    - Accrual Quality
```

#### 우선순위: ✅ **Already Done** (Sprint 5)
**상태**: CFOAnalytics.js 구현 완료

---

### 🔗 T_Correlation.csv (CALCULATED)

**분류**: Correlation Analysis

#### 평가 매트릭스
- **의존성**: Level 1 (Independent)
- **사용자 가치**: 7/10 (상관관계 분석)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.8 (O(n) 최적화 필수)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 1,249 companies
필드: 42 fields

필드 구조:
  기본: Ticker, Corp, True/False flag
  가격 데이터: Date, 주가, Fwd Sales, Fwd EPS, US HYY
  개별 종목: NVDA, MSFT, AAPL, GOOG, GOOGL, AMZN, META
  상관계수: Fwd 12M Sales, Fwd 12M EPS, HYY
```

#### 우선순위: ✅ **Already Done** (Sprint 5)
**상태**: CorrelationEngine.js 구현 완료 (O(n) 최적화)

---

### 📋 T_Chk.csv (CALCULATED)

**분류**: EPS Update Tracking

#### 평가 매트릭스
- **의존성**: Level 1 (Independent, but enhances T_EPS_C)
- **사용자 가치**: 9/10 (실시간 EPS 변화 추적 - 핵심 기능)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.7 (72 date columns, 변화 감지 로직)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 1,250 companies
필드: ~78 fields

필드 구조:
  기본 정보:
    - Ticker, Corp, Exchange, WI26, FY O, 설립
    - 현재가, 시가총액, 수익성

  밸류에이션:
    - PER (Oct-25), PER (1~5), %
    - PBR (Oct-25), PBR (1~5), %

  EPS 체크 (핵심):
    - Update: 최근 업데이트 날짜
    - FY 0: 당기 EPS
    - FY+1: 차기 EPS
    - CHK: 변화율

  시계열 체크 (72 date columns):
    45933 ~ 45562 (371일 데이터)
    각 날짜별 EPS 변화 추적

샘플 데이터 (NVDA):
  Update: 45716
  FY 0 EPS: 2.94
  FY+1 EPS: 2.95
  CHK: -0.0034 (minor decrease)
  45658 (FY 0 결산): 유지
  45292: 유지

사용자 가치:
  - 실시간 EPS 컨센서스 변화 모니터링
  - 애널리스트 의견 변화 추적
  - 투자 타이밍 판단 핵심 지표
  - "어느 기업이 최근 실적 전망이 좋아지고 있는가?"
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 (78 fields, 1,250 records)
  - 날짜 컬럼 파싱 (45933 ~ 45562)
  - 변화율 계산 로직

Analytics Layer:
  - EPS 변화 감지:
    - 최근 1주 변화
    - 최근 1개월 변화
    - 최근 3개월 변화

  - 트렌드 분석:
    - 상승 추세 (3회 연속 증가)
    - 하락 추세 (3회 연속 감소)
    - 안정 추세

  - 알람 시스템:
    - 급격한 변화 (>5% 1주 내)
    - 지속적 변화 (3회 연속)

  - 비교 분석:
    - 업종 평균 대비
    - 경쟁사 대비

Performance:
  - O(n) 변화 감지
  - O(1) 특정 날짜 조회 (인덱싱)
  - Target: <200ms for 1,250 records

Testing:
  - 전체 데이터셋 (1,250 companies)
  - 날짜 범위 검증 (371일)
  - 변화율 계산 정확성
  - 트렌드 감지 로직
```

#### 우선순위: 🔴 Critical (P0)
**선정 이유**:
1. **높은 사용자 가치**: 실시간 모니터링 핵심 기능
2. **독립 실행 가능**: M_Company만 있으면 동작
3. **투자 타이밍**: 애널리스트 의견 변화 → 투자 기회
4. **차별화 기능**: 경쟁사 대비 독특한 인사이트

**Phase 1 Module**: Module 5 - EPSMonitoringAnalytics

---

### 🔍 A_Compare.csv (CALCULATED)

**분류**: Industry Cost Structure Comparison

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company 기반, 독립 분석 가능)
- **사용자 가치**: 8/10 (업종별 비용구조 비교)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.7 (78 fields, 업종별 집계)
- **예상 기간**: 2-3주

#### 상세 분석
```yaml
레코드: 493 companies (M_Company → Industry filtered)
필드: ~78 fields

필드 구조:
  기본 정보:
    - Ticker, Corp, Exchange, WI26, FY 0, 설립
    - 현재가, 시가총액, 수익성

  비용 구조 (핵심):
    매출원가 (COGS):
      - 5Y AVG: 5년 평균
      - FY 0: 당기
      - FQ 0: 최근 분기

    판관비 (SG&A):
      - 5Y AVG
      - FY 0
      - FQ 0

    연구개발비 (R&D):
      - 5Y AVG
      - FY 0
      - FQ 0

    영업이익 (Operating Margin):
      - 5Y AVG
      - FY 0
      - FQ 0

  시계열 (8 periods):
    F-4, F-3, F-2, F-1, F0, F+1, F+2, F+3

샘플 데이터 (Semiconductor Sector):
  NVDA:
    COGS: 24.5%
    SG&A: 12.6%
    R&D: 9.9%
    OPM: 62.4% ← 압도적 효율성

  TSM:
    COGS: 43.9%
    SG&A: 10.4%
    R&D: 7.1%
    OPM: 45.7%

  AMD:
    COGS: 50.6%
    SG&A: 41.4%
    R&D: 25.0%
    OPM: 7.4% ← 비효율

사용자 가치:
  - 업종 내 경쟁사 비용 효율성 비교
  - "왜 A사가 B사보다 수익성이 높은가?" → 비용 구조 차이
  - 투자 인사이트: 비용 효율성 = 경쟁 우위
  - 업종별 벤치마킹
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 (78 fields, 493 companies)
  - 업종별 인덱싱 (WI26 기반)
  - M_Company 조인 로직

Analytics Layer:
  - 비용 구조 분석:
    - COGS, SG&A, R&D 비율
    - Operating Margin 계산
    - 5Y AVG vs Current 비교

  - 업종 벤치마킹:
    - 업종 평균 계산
    - 상위 25% / 중위 / 하위 25%
    - 경쟁사 포지셔닝

  - 시계열 트렌드:
    - F-4 → F+3 비용 구조 변화
    - 효율성 개선/악화 추세

  - 비교 분석:
    - Ticker A vs Ticker B
    - 동일 업종 전체 기업 랭킹

Performance:
  - O(n) 업종별 집계
  - O(1) 특정 기업 조회 (Ticker index)
  - Target: <150ms for 493 records

Testing:
  - 전체 데이터셋 (493 companies)
  - 업종별 집계 정확성
  - 비용 구조 계산 검증
  - M_Company 조인 정확성
```

#### 우선순위: 🔴 Critical (P0)
**선정 이유**:
1. **높은 사용자 가치**: 경쟁 우위 분석 핵심
2. **독특한 인사이트**: "왜 수익성이 다른가?" → 비용 구조
3. **투자 의사결정**: 비용 효율성 = 장기 경쟁력
4. **업종별 특화**: 업종마다 다른 비용 구조 이해

**Phase 1 Module**: Module 6 - IndustryCostAnalytics

---

### 🌐 E_Indicators.csv (INDICATOR)

**분류**: Economic Indicators

#### 평가 매트릭스
- **의존성**: Level 1 (Independent, 외부 데이터)
- **사용자 가치**: 8/10 (거시경제 컨텍스트)
- **데이터 유형**: INDICATOR
- **복잡도**: 0.5 (시계열 로딩, 간단한 분석)
- **예상 기간**: 1.5-2주

#### 상세 분석
```yaml
레코드: 1,030 data points (주간 시계열)
필드: ~68 fields

필드 구조:
  TED Spread:
    - Date
    - TED: TED Spread (신용 위험)
    - HYS(US), HYS(EM), HYS(EU): High Yield Spread

  High Yield Yield:
    - HYY(US), HYY(EM), HYY(EU): 하이일드 채권 수익률

  Treasury Yield:
    - T30Y, T20Y, T10Y, T2Y: 국채 수익률 곡선
    - T10Y-2Y: 장단기 금리차 (경기 선행 지표)

  Inflation:
    - 10Y BEI: 10년 손익분기 인플레이션
    - 5Y BEI: 5년 BEI
    - 5-10 BEI: 장기 인플레이션 기대
    - 10Y TIPS: 물가연동채

  HYY Daily:
    - [7 date columns]: 일별 하이일드 수익률

  Time Series:
    - 304 rows of historical data

  Recession Indicator:
    - U.S Recession: Flag column

샘플 데이터 (Latest 45933):
  TED: 0.028 (낮음 → 신용 위험 낮음)
  HYY(US): 6.52% (보통)
  T10Y: 4.12%
  T2Y: 3.57%
  T10Y-2Y: 0.52% (정상 곡선 → 경기 확장)
  10Y BEI: 2.33% (인플레이션 기대 안정)

사용자 가치:
  - 거시경제 컨텍스트: "지금 경제 상황은?"
  - 투자 타이밍: 금리 환경 → 주식 매력도
  - 리스크 관리: TED, HYY → 신용 위험
  - 경기 사이클: T10Y-2Y → 경기 선행 지표
  - A_Company, T_Correlation과 통합 분석
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 (68 fields, 1,030 points)
  - 날짜 인덱싱 (Date column)
  - 시계열 정렬

Analytics Layer:
  - 현재 경제 상황:
    - TED Spread 해석 (낮음/보통/높음)
    - HYY 해석
    - T10Y-2Y 해석 (경기 사이클)

  - 시계열 분석:
    - 최근 1개월 변화
    - 최근 3개월 트렌드
    - 역사적 비교 (상위/하위 백분위)

  - 위험 신호:
    - TED > 0.5 (신용 경색)
    - T10Y-2Y < 0 (경기 침체 신호)
    - HYY 급등 (리스크 회피)

  - 차트 생성:
    - Treasury Yield Curve
    - TED Spread 시계열
    - HYY 시계열

Performance:
  - O(1) 최신 데이터 조회
  - O(log n) 특정 날짜 조회 (이진 검색)
  - Target: <50ms for 1,030 points

Testing:
  - 전체 데이터셋 (1,030 points)
  - 날짜 범위 검증
  - 지표 계산 정확성
  - Recession flag 로직
```

#### 우선순위: 🔴 Critical (P0)
**선정 이유**:
1. **거시경제 컨텍스트**: 기업 분석의 필수 배경
2. **독립 실행 가능**: 외부 데이터, 의존성 없음
3. **투자 타이밍**: 금리 환경 → 주식 매력도
4. **리스크 관리**: TED, HYY → 시장 위험 신호
5. **통합 분석**: A_Company, T_Correlation과 결합 시 강력

**Phase 1 Module**: Module 7 - EconomicIndicatorsProvider

---

### 📊 A_ETFs.csv (CALCULATED)

**분류**: ETF Detailed Analysis

#### 평가 매트릭스
- **의존성**: Level 2 (M_ETFs 기반, 독립 분석 가능)
- **사용자 가치**: 7/10 (ETF 분석, 포트폴리오 컨텍스트)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.6 (시계열 확장, 151 fields)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 489 rows (M_ETFs 29 → Time-series expansion)
필드: ~151 fields

필드 구조:
  기본:
    - Nasdaq, Date, Price
    - Fwd Sales, Fwd EPS
    - US HYY

  개별 종목 (6 holdings):
    NVDA: 매출액, Fwd 12M EPS
    MSFT: 매출액, Fwd 12M EPS
    AAPL: 매출액, Fwd 12M EPS
    GOOG: 매출액, Fwd 12M EPS
    AMZN: 매출액, Fwd 12M EPS
    META: 매출액, Fwd 12M EPS

  시계열:
    - 날짜별 가격
    - 컨센서스 변화
    - 로그 수익률

샘플 데이터 (Nasdaq Index, Date 45933):
  Price: 22780.51
  Fwd Sales: 1473.91
  Fwd EPS: 2208.79
  Top holdings:
    NVDA: 12.9%
    MSFT: 10.9%
    AAPL: 10.8%

사용자 가치:
  - ETF 포트폴리오 분석
  - 개별 기업 vs ETF 비교
  - 섹터 트렌드 파악
  - 포트폴리오 구성 참고
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 (151 fields, 489 rows)
  - 날짜 인덱싱
  - M_ETFs와의 관계 매핑

Analytics Layer:
  - ETF 분석:
    - Fwd Sales, Fwd EPS 추이
    - Top holdings 성과 기여도
    - ETF vs 개별 종목 성과

  - 시계열 분석:
    - 가격 추이
    - 컨센서스 변화
    - 수익률 계산

  - 비교 분석:
    - ETF A vs ETF B
    - ETF vs 개별 종목

Performance:
  - O(n) 시계열 로딩
  - O(1) 특정 날짜 조회 (인덱싱)
  - Target: <100ms for 489 rows

Testing:
  - 전체 데이터셋 (489 rows)
  - 날짜 범위 검증
  - M_ETFs 조인 정확성
```

#### 우선순위: 🔴 Critical (P0)
**선정 이유**:
1. **포트폴리오 컨텍스트**: 개별 기업 vs 인덱스
2. **독립 실행 가능**: M_ETFs만 있으면 동작
3. **사용자 요구**: "이 기업은 어느 ETF에 많이 포함되어 있나?"
4. **섹터 분석**: ETF → 섹터 트렌드 파악

**Phase 1 Module**: Module 8 - ETFAnalyticsProvider

---

### 🔍 A_Contrast.csv (CALCULATED)

**분류**: Cross-Industry Comparison

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company 기반)
- **사용자 가치**: 7/10 (업종 간 비교)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.6 (64 fields, 업종 간 집계)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 113 companies (M_Company → Cross-industry sampling)
필드: ~64 fields

필드 구조:
  기본 정보:
    - Ticker, Corp, Exchange, WI26, FY 0, 설립
    - 현재가, 시가총액, 수익성

  성장률:
    - Sales (3), PER (3), PER (5), PER (10)
    - PEG

  기대수익률:
    - Return (Y)
    - DY (FY+1)

  Fwd 12M EPS Consensus Change:
    - W, 1 M, 3 M, 6 M, YTD, 12 M

  시계열 (매출, 영업이익, 순이익):
    - Dec-25(E), Dec-26(E), Dec-27(E)

  재무 비율:
    - R/S (Return on Sales)
    - S/A (Sales to Assets)
    - A/E (Assets to Equity)

샘플 데이터 (Healthcare Sector):
  LLY (Eli Lilly):
    Sales Growth: 23.2%
    OPM: 44.9%
    Return (10Y): 26.6%

  NVO (Novo-Nordisk):
    Sales Growth: 10.5%
    OPM: 43.6%
    Return (10Y): 15.6%

  MRK (Merck):
    Sales Growth: 3.9%
    OPM: 42.0%
    Return (10Y): 32.2%

사용자 가치:
  - 업종 간 수익성, 성장성 비교
  - 섹터 로테이션 전략
  - "어느 업종이 현재 매력적인가?"
```

#### 개발 요구사항
```yaml
Provider Layer:
  - CSV 로딩 (64 fields, 113 companies)
  - 업종별 인덱싱 (WI26)
  - M_Company 조인

Analytics Layer:
  - 업종 간 비교:
    - 수익성 (ROE, OPM)
    - 성장성 (Sales, EPS Growth)
    - 밸류에이션 (PER, PBR)

  - 섹터 로테이션:
    - 현재 강세 섹터
    - 밸류에이션 매력도

Performance:
  - O(n) 업종별 집계
  - Target: <80ms for 113 companies

Testing:
  - 전체 데이터셋 (113 companies)
  - 업종별 집계 정확성
```

#### 우선순위: 🟡 High (P1)
**선정 이유**:
1. **섹터 로테이션**: 투자 전략 핵심
2. **독립 실행 가능**: M_Company만 있으면 동작
3. **사용자 가치**: "어느 업종 투자할까?"
4. **Phase 2 적합**: Phase 1 기반 구축 후 추가

**Phase 2 Module**: Module 9 - CrossIndustryAnalytics

---

### 📈 T_Chart.csv (CALCULATED)

**분류**: Individual Company Chart Data

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company 기반)
- **사용자 가치**: 6/10 (차트 생성용)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.5 (차트 데이터 변환)
- **예상 기간**: 1.5-2주

#### 상세 분석
```yaml
레코드: 88 companies (M_Company → Sample)
필드: ~81 fields

목적:
  - 개별 기업 차트 시각화
  - 손익구조, 비용구조, 밸류에이션

우선순위: 🟡 High (P1)
**Phase 2 Module**: Module 10 - ChartDataProvider
```

---

### 🔎 S_Chart.csv (TOOL)

**분류**: Screening Tool

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company 기반)
- **사용자 가치**: 7/10 (스크리닝 도구)
- **데이터 유형**: TOOL
- **복잡도**: 0.5 (필터링, 정렬)
- **예상 기간**: 1.5-2주

#### 상세 분석
```yaml
레코드: 119 companies
필드: ~60 fields

목적:
  - 개별기업 차트 시각화
  - 사용자 맞춤 스크리닝

우선순위: 🟡 High (P1)
**Phase 2 Module**: Module 11 - ScreeningEngine
```

---

### 💰 S_Valuation.csv (TOOL)

**분류**: Valuation Tool

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company 기반)
- **사용자 가치**: 7/10 (밸류에이션 평가)
- **데이터 유형**: TOOL
- **복잡도**: 0.6 (PER/PBR Range, Expected Return)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 34 companies
필드: ~48 fields

목적:
  - 가치측정 보정
  - 기대수익률 평가

우선순위: 🟡 High (P1)
**Phase 2 Module**: Module 12 - ValuationEngine
```

---

### 📊 UP_&_Down.csv (SPECIAL)

**분류**: Momentum Analysis

#### 평가 매트릭스
- **의존성**: Level 2 (M_Company → Aggregation)
- **사용자 가치**: 8/10 (국가/업종별 모멘텀)
- **데이터 유형**: SPECIAL
- **복잡도**: 0.6 (188 fields, 집계)
- **예상 기간**: 2주

#### 상세 분석
```yaml
레코드: 46 data points (국가/업종별 집계)
필드: ~188 fields

필드 구조:
  45933 (최신):
    Total, ▲, =, ▼ (W, 1 M, 3 M, 6 M, 12 M)

  45926 (1주 전):
    Total, ▲, =, ▼ (W, 1 M, 3 M, 6 M, 12 M)

  [6 time periods]: 시계열 모멘텀

국가별 분류:
  USA: 768 companies
  China: 122 companies
  Hongkong: 140 companies
  Korea: 40 companies
  Japan: 56 companies

샘플 데이터 (Latest 45933):
  Total 1126: ▲ 865 (77%), = 163 (14%), ▼ 89 (8%) (주간)
  USA 768: ▲ 676 (88%), = 35 (5%), ▼ 49 (6%) (주간)
  China 122: ▲ 9 (7%), = 98 (80%), ▼ 14 (11%) (주간)

사용자 가치:
  - Broad 모멘텀 분석
  - "지금 어느 국가가 강세인가?"
  - "어느 업종이 실적 개선 중인가?"
  - 시장 전체 흐름 파악
```

#### 우선순위: 🟡 High (P1)
**Phase 2 Module**: Module 13 - MomentumAnalytics

---

### 📈 A_Distribution.csv (CALCULATED)

**분류**: CAGR Distribution Statistics

#### 평가 매트릭스
- **의존성**: Level 1 (독립 historical data)
- **사용자 가치**: 6/10 (통계 분석)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.5 (통계 계산)
- **예상 기간**: 1.5-2주

#### 상세 분석
```yaml
레코드: 1,175 data points
필드: ~65 fields

목적:
  - CAGR 분포 통계 (S&P 500)
  - 장기 수익률 기대치

우선순위: 🟢 Medium (P2)
**Phase 3 Module**: Module 15 - DistributionAnalytics
```

---

### 📊 T_EPS_H.csv (CALCULATED)

**분류**: EPS History Sample

#### 평가 매트릭스
- **의존성**: Level 0 (T_EPS_C → Sample)
- **사용자 가치**: 4/10 (샘플 히스토리)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.3 (샘플링)
- **예상 기간**: 1주

#### 상세 분석
```yaml
레코드: 53 companies (T_EPS_C 1,250 → Sample)
필드: 22 fields

목적:
  - EPS 히스토리 샘플
  - 차트 생성용

우선순위: 🟢 Medium (P2)
**Phase 3 Module**: Module 16 - EPSHistorySampler
```

---

### 📈 T_Growth_H.csv (CALCULATED)

**분류**: Growth History Sample

#### 평가 매트릭스
- **의존성**: Level 0 (T_Growth_C → Sample)
- **사용자 가치**: 4/10 (샘플 히스토리)
- **데이터 유형**: CALCULATED
- **복잡도**: 0.3 (샘플링)
- **예상 기간**: 1주

#### 상세 분석
```yaml
레코드: 53 companies
필드: 20 fields

목적:
  - 성장률 히스토리 샘플

우선순위: 🟢 Medium (P2)
**Phase 3 Module**: Module 17 - GrowthHistorySampler
```

---

### 🏢 M_ETFs.csv (BASE)

**분류**: ETF Master Data

#### 평가 매트릭스
- **의존성**: Level 3 (Foundation for A_ETFs)
- **사용자 가치**: 7/10 (ETF 마스터)
- **데이터 유형**: BASE
- **복잡도**: 0.4 (단순 로딩)
- **예상 기간**: 1-1.5주

#### 상세 분석
```yaml
레코드: 29 indices/ETFs
필드: ~44 fields

우선순위: 🟢 Medium (P2)
**Phase 3 Module**: Module 18 - ETFMasterProvider
```

---

### ❌ S_Mylist.csv (TOOL)

**분류**: Watchlist (CANCELLED)

#### 평가 매트릭스
- **의존성**: Level 2
- **사용자 가치**: 0/10 (사용자 미등록)
- **데이터 유형**: TOOL
- **복잡도**: 0.2
- **예상 기간**: N/A

#### 우선순위: ❌ **CANCELLED**
**제거 이유**:
1. 사용자 미등록 (19개 샘플만)
2. M_Company와 중복
3. 분석 가치 없음

---

## Part 3: 우선순위 매트릭스

### 4단계 분류 요약

#### 🔴 Critical (P0) - Phase 1 필수 (5개)

| 순위 | 시트명 | 레코드 | 사용자 가치 | 복잡도 | 기간 | 선정 이유 |
|------|--------|--------|------------|--------|------|----------|
| 1 | **A_Company** | 1,250 | 9/10 | 0.7 | 2-3주 | 핵심 분석 허브 (성장률, 밸류에이션, 기대수익률) |
| 2 | **T_Chk** | 1,250 | 9/10 | 0.7 | 2-3주 | 실시간 EPS 변화 추적 (투자 타이밍) |
| 3 | **A_Compare** | 493 | 8/10 | 0.7 | 2-3주 | 업종별 비용구조 비교 (경쟁 우위) |
| 4 | **E_Indicators** | 1,030 | 8/10 | 0.5 | 1.5-2주 | 거시경제 컨텍스트 (금리, TED, HYY) |
| 5 | **A_ETFs** | 489 | 7/10 | 0.6 | 2주 | ETF 분석 (포트폴리오 컨텍스트) |

**Phase 1 총 기간**: 10-13주 (2.5-3.5개월)

#### 선정 근거

**1. A_Company (Module 4)**
```yaml
Why Critical:
  - 핵심 분석 허브 (성장률, 밸류에이션, 기대수익률 통합)
  - 1,250 Pattern Core (고품질 기업 필터링 기준)
  - 다른 기능의 기반 (스크리닝, 비교)
  - 높은 사용자 가치 (9/10)

Why Phase 1:
  - Foundation for screening tools
  - Independent analysis possible
  - T_EPS_C, T_Growth_C, T_Rank 완료 → 바로 활용 가능
```

**2. T_Chk (Module 5)**
```yaml
Why Critical:
  - 실시간 EPS 변화 추적 (투자 타이밍 핵심)
  - 애널리스트 의견 변화 → 투자 기회
  - 차별화 기능 (경쟁사 대비 독특)
  - 높은 사용자 가치 (9/10)

Why Phase 1:
  - T_EPS_C 완료 → 즉시 연동 가능
  - 독립 실행 가능
  - 모니터링 = 지속적 사용자 engagement
```

**3. A_Compare (Module 6)**
```yaml
Why Critical:
  - 업종별 비용구조 비교 (경쟁 우위 분석)
  - "왜 A사가 B사보다 수익성이 높은가?" → 인사이트
  - 투자 의사결정 (비용 효율성 = 장기 경쟁력)
  - 높은 사용자 가치 (8/10)

Why Phase 1:
  - M_Company 완료 → 즉시 활용
  - 독립 분석 가능
  - 업종별 특화 분석 (섹터별 다른 비용 구조)
```

**4. E_Indicators (Module 7)**
```yaml
Why Critical:
  - 거시경제 컨텍스트 (기업 분석 필수 배경)
  - 투자 타이밍 (금리 환경 → 주식 매력도)
  - 리스크 관리 (TED, HYY → 시장 위험 신호)
  - 높은 사용자 가치 (8/10)

Why Phase 1:
  - 독립 실행 (외부 데이터, 의존성 없음)
  - 복잡도 낮음 (0.5)
  - A_Company, T_Correlation과 통합 분석 시 강력
```

**5. A_ETFs (Module 8)**
```yaml
Why Critical:
  - ETF 분석 (포트폴리오 컨텍스트)
  - "이 기업은 어느 ETF에 많이 포함?" → 인사이트
  - 섹터 분석 (ETF → 섹터 트렌드)
  - 사용자 가치 (7/10)

Why Phase 1:
  - M_ETFs만 있으면 동작
  - 복잡도 낮음 (0.6)
  - 포트폴리오 구성 참고 (실용적)
```

---

#### 🟡 High (P1) - Phase 2 핵심 (6개)

| 순위 | 시트명 | 레코드 | 사용자 가치 | 복잡도 | 기간 | Module |
|------|--------|--------|------------|--------|------|--------|
| 6 | **A_Contrast** | 113 | 7/10 | 0.6 | 2주 | Module 9 |
| 7 | **T_Chart** | 88 | 6/10 | 0.5 | 1.5-2주 | Module 10 |
| 8 | **S_Chart** | 119 | 7/10 | 0.5 | 1.5-2주 | Module 11 |
| 9 | **S_Valuation** | 34 | 7/10 | 0.6 | 2주 | Module 12 |
| 10 | **UP_&_Down** | 46 | 8/10 | 0.6 | 2주 | Module 13 |
| 11 | **ReadMe** | 37 | 5/10 | 0.2 | 1주 | Module 14 |

**Phase 2 총 기간**: 10-12주 (2.5-3개월)

---

#### 🟢 Medium (P2) - Phase 3 보완 (6개)

| 순위 | 시트명 | 레코드 | 사용자 가치 | 복잡도 | 기간 | Module |
|------|--------|--------|------------|--------|------|--------|
| 12 | **A_Distribution** | 1,175 | 6/10 | 0.5 | 1.5-2주 | Module 15 |
| 13 | **T_EPS_H** | 53 | 4/10 | 0.3 | 1주 | Module 16 |
| 14 | **T_Growth_H** | 53 | 4/10 | 0.3 | 1주 | Module 17 |
| 15 | **M_ETFs** | 29 | 7/10 | 0.4 | 1-1.5주 | Module 18 |
| 16 | **(Reserved)** | - | - | - | - | Module 19 |
| 17 | **(Reserved)** | - | - | - | - | Module 20 |

**Phase 3 총 기간**: 5-7주 (1.5-2개월)

---

#### ❌ Cancelled (1개)

| 시트명 | 이유 |
|--------|------|
| **S_Mylist** | 사용자 미등록 (19개 샘플), M_Company 중복, 분석 가치 없음 |

---

### 우선순위 결정 스코어링 모델

#### 최종 스코어 = (Dependency × 0.3) + (User Value × 0.4) + (Type Weight × 0.2) + (Complexity Inverse × 0.1)

**Phase 1 스코어 (Top 5)**:
```yaml
A_Company:
  Dependency: 2 × 0.3 = 0.6
  User Value: 9 × 0.4 = 3.6
  Type Weight: 0.9 (CALCULATED-Critical) × 0.2 = 0.18
  Complexity Inverse: (1 - 0.7) × 0.1 = 0.03
  Total: 4.41 ← Rank 1

T_Chk:
  Dependency: 1 × 0.3 = 0.3
  User Value: 9 × 0.4 = 3.6
  Type Weight: 0.9 × 0.2 = 0.18
  Complexity Inverse: (1 - 0.7) × 0.1 = 0.03
  Total: 4.11 ← Rank 2

A_Compare:
  Dependency: 2 × 0.3 = 0.6
  User Value: 8 × 0.4 = 3.2
  Type Weight: 0.9 × 0.2 = 0.18
  Complexity Inverse: (1 - 0.7) × 0.1 = 0.03
  Total: 4.01 ← Rank 3

E_Indicators:
  Dependency: 1 × 0.3 = 0.3
  User Value: 8 × 0.4 = 3.2
  Type Weight: 0.8 (INDICATOR) × 0.2 = 0.16
  Complexity Inverse: (1 - 0.5) × 0.1 = 0.05
  Total: 3.71 ← Rank 4

A_ETFs:
  Dependency: 2 × 0.3 = 0.6
  User Value: 7 × 0.4 = 2.8
  Type Weight: 0.9 × 0.2 = 0.18
  Complexity Inverse: (1 - 0.6) × 0.1 = 0.04
  Total: 3.62 ← Rank 5
```

---

## Part 4: 3단계 로드맵

### Phase 1 (Week 1-10): Foundation & Core Analytics (5개 시트)

#### 목표
- 핵심 분석 기능 완성
- 사용자 즉시 가치 제공
- Phase 2/3 기반 구축

#### Module 4: CompanyAnalyticsProvider (Week 1-3)

**시트**: A_Company (1,250 companies, 50 fields)

**Task 개요 (7 tasks)**:
```yaml
Task 4.1: A_Company Data Schema Analysis
  - 50 fields 전수 분석
  - M_Company 33 common fields 매핑
  - 17 calculated fields 로직 분석
  - 기간: 1일
  - Agent: @root-cause-analyst

Task 4.2: Provider Layer Implementation
  - CSV 로딩 및 파싱 (50 fields)
  - Ticker, WI26, Exchange 인덱싱
  - M_Company 조인 로직
  - 기간: 2일

Task 4.3: Growth Analysis Implementation
  - Sales (3), PER (3/5/10) 계산
  - PEG 계산 (PER / EPS Growth)
  - 기간: 2일

Task 4.4: Valuation Analysis Implementation
  - % PER (Avg), % PBR (Avg) 계산
  - 과거 평균 대비 현재 밸류에이션
  - 기간: 2일

Task 4.5: Return Calculation Implementation
  - Price (10): 10년 목표가
  - Return (Y): 연간 기대수익률
  - DY (FY+1): 배당수익률
  - 기간: 2일

Task 4.6: E2E Testing (@quality-engineer)
  - 전체 데이터셋 (1,250 companies)
  - 계산 검증 (PEG, Return, DY)
  - M_Company 조인 정확성
  - 기간: 2-3일

Task 4.7: API Documentation (@technical-writer)
  - CompanyAnalyticsProvider API 문서
  - 계산 로직 설명
  - 사용 예제
  - 기간: 2일
```

**예상 기간**: 2-3주
**복잡도**: 0.7
**Sub-agents**: @root-cause-analyst, @quality-engineer, @technical-writer

---

#### Module 5: EPSMonitoringAnalytics (Week 4-6)

**시트**: T_Chk (1,250 companies, 78 fields)

**Task 개요 (7 tasks)**:
```yaml
Task 5.1: T_Chk Data Schema Analysis
  - 78 fields 분석 (72 date columns)
  - 날짜 범위: 45933 ~ 45562 (371일)
  - 변화율 계산 로직 분석
  - 기간: 1일
  - Agent: @root-cause-analyst

Task 5.2: Provider Layer Implementation
  - CSV 로딩 (78 fields, 1,250 records)
  - 날짜 컬럼 파싱 (72 columns)
  - Ticker 인덱싱
  - 기간: 2일

Task 5.3: EPS Change Detection Implementation
  - 최근 1주/1개월/3개월 변화 감지
  - 변화율 계산 로직
  - 기간: 2-3일

Task 5.4: Trend Analysis Implementation
  - 상승 추세 (3회 연속 증가)
  - 하락 추세 (3회 연속 감소)
  - 안정 추세 감지
  - 기간: 2일

Task 5.5: Alert System Implementation
  - 급격한 변화 알람 (>5% 1주 내)
  - 지속적 변화 알람 (3회 연속)
  - 업종 평균 대비 비교
  - 기간: 2-3일

Task 5.6: E2E Testing (@quality-engineer)
  - 전체 데이터셋 (1,250 companies)
  - 날짜 범위 검증 (371일)
  - 변화율 계산 정확성
  - 트렌드 감지 로직 검증
  - 기간: 2-3일

Task 5.7: API Documentation (@technical-writer)
  - EPSMonitoringAnalytics API 문서
  - 알람 시스템 사용법
  - 트렌드 분석 가이드
  - 기간: 2일
```

**예상 기간**: 2-3주
**복잡도**: 0.7
**Sub-agents**: @root-cause-analyst, @quality-engineer, @technical-writer

---

#### Module 6: IndustryCostAnalytics (Week 7-9)

**시트**: A_Compare (493 companies, 78 fields)

**Task 개요 (7 tasks)**:
```yaml
Task 6.1: A_Compare Data Schema Analysis
  - 78 fields 분석 (비용 구조 중심)
  - COGS, SG&A, R&D, OPM 필드 파악
  - 업종별 패턴 분석
  - 기간: 1일
  - Agent: @root-cause-analyst

Task 6.2: Provider Layer Implementation
  - CSV 로딩 (78 fields, 493 companies)
  - 업종별 인덱싱 (WI26)
  - M_Company 조인 로직
  - 기간: 2일

Task 6.3: Cost Structure Analysis Implementation
  - COGS, SG&A, R&D 비율 계산
  - Operating Margin 계산
  - 5Y AVG vs Current 비교
  - 기간: 2-3일

Task 6.4: Industry Benchmarking Implementation
  - 업종 평균 계산
  - 상위 25% / 중위 / 하위 25% 분류
  - 경쟁사 포지셔닝
  - 기간: 2일

Task 6.5: Time-Series Trend Implementation
  - F-4 → F+3 비용 구조 변화
  - 효율성 개선/악화 추세 분석
  - 기간: 2일

Task 6.6: E2E Testing (@quality-engineer)
  - 전체 데이터셋 (493 companies)
  - 업종별 집계 정확성
  - 비용 구조 계산 검증
  - 기간: 2-3일

Task 6.7: API Documentation (@technical-writer)
  - IndustryCostAnalytics API 문서
  - 벤치마킹 사용법
  - 비용 구조 해석 가이드
  - 기간: 2일
```

**예상 기간**: 2-3주
**복잡도**: 0.7
**Sub-agents**: @root-cause-analyst, @quality-engineer, @technical-writer

---

#### Module 7: EconomicIndicatorsProvider (Week 8-9)

**시트**: E_Indicators (1,030 points, 68 fields)

**Task 개요 (7 tasks)**:
```yaml
Task 7.1: E_Indicators Data Schema Analysis
  - 68 fields 분석 (TED, HYY, Treasury, BEI)
  - 시계열 구조 파악 (1,030 points)
  - 지표 의미 및 해석 방법
  - 기간: 1일
  - Agent: @root-cause-analyst

Task 7.2: Provider Layer Implementation
  - CSV 로딩 (68 fields, 1,030 points)
  - 날짜 인덱싱 (Date column)
  - 시계열 정렬
  - 기간: 1-2일

Task 7.3: Current Economic Status Implementation
  - TED Spread 해석 (낮음/보통/높음)
  - HYY 해석
  - T10Y-2Y 해석 (경기 사이클)
  - Recession flag 로직
  - 기간: 2일

Task 7.4: Time-Series Analysis Implementation
  - 최근 1개월 변화
  - 최근 3개월 트렌드
  - 역사적 비교 (백분위)
  - 기간: 2일

Task 7.5: Risk Signal Detection Implementation
  - TED > 0.5 (신용 경색)
  - T10Y-2Y < 0 (경기 침체 신호)
  - HYY 급등 (리스크 회피)
  - 기간: 2일

Task 7.6: E2E Testing (@quality-engineer)
  - 전체 데이터셋 (1,030 points)
  - 날짜 범위 검증
  - 지표 계산 정확성
  - 기간: 2일

Task 7.7: API Documentation (@technical-writer)
  - EconomicIndicatorsProvider API 문서
  - 지표 해석 가이드
  - 투자 타이밍 활용법
  - 기간: 1-2일
```

**예상 기간**: 1.5-2주
**복잡도**: 0.5
**Sub-agents**: @root-cause-analyst, @quality-engineer, @technical-writer

---

#### Module 8: ETFAnalyticsProvider (Week 10)

**시트**: A_ETFs (489 rows, 151 fields)

**Task 개요 (7 tasks)**:
```yaml
Task 8.1: A_ETFs Data Schema Analysis
  - 151 fields 분석 (Fwd Sales, Fwd EPS, Top holdings)
  - M_ETFs와의 관계 매핑
  - 시계열 구조 파악
  - 기간: 1일
  - Agent: @root-cause-analyst

Task 8.2: Provider Layer Implementation
  - CSV 로딩 (151 fields, 489 rows)
  - 날짜 인덱싱
  - M_ETFs 조인 로직
  - 기간: 1-2일

Task 8.3: ETF Analysis Implementation
  - Fwd Sales, Fwd EPS 추이
  - Top holdings 성과 기여도
  - ETF vs 개별 종목 성과
  - 기간: 2일

Task 8.4: Time-Series Analysis Implementation
  - 가격 추이
  - 컨센서스 변화
  - 수익률 계산
  - 기간: 2일

Task 8.5: Comparison Analysis Implementation
  - ETF A vs ETF B
  - ETF vs 개별 종목
  - 기간: 1-2일

Task 8.6: E2E Testing (@quality-engineer)
  - 전체 데이터셋 (489 rows)
  - 날짜 범위 검증
  - M_ETFs 조인 정확성
  - 기간: 2일

Task 8.7: API Documentation (@technical-writer)
  - ETFAnalyticsProvider API 문서
  - 포트폴리오 활용 가이드
  - 기간: 1-2일
```

**예상 기간**: 2주
**복잡도**: 0.6
**Sub-agents**: @root-cause-analyst, @quality-engineer, @technical-writer

---

### Phase 1 완료 기준

```yaml
기능 완성도:
  - [ ] 5개 모듈 모두 구현 완료
  - [ ] 전체 데이터셋 테스트 통과 (100%)
  - [ ] API 문서 완성 (5개 모듈)
  - [ ] HTML UI 통합 완료

성능 기준:
  - [ ] A_Company: <100ms (1,250 records)
  - [ ] T_Chk: <200ms (1,250 records, 72 dates)
  - [ ] A_Compare: <150ms (493 records)
  - [ ] E_Indicators: <50ms (1,030 points)
  - [ ] A_ETFs: <100ms (489 rows)

품질 기준:
  - [ ] Test Pass Rate: 100%
  - [ ] Field Coverage: >95%
  - [ ] Quality Score: >90/100

문서화:
  - [ ] 5개 API 문서 (각 1,000+ lines)
  - [ ] Phase 1 완료 보고서
  - [ ] Module 회고 (각 모듈)
```

---

### Phase 2 (Week 11-22): Enhanced Analytics & Tools (6개 시트)

#### 목표
- 고급 분석 기능 추가
- 스크리닝 도구 완성
- 사용자 경험 향상

#### Module 9-14 개요

**Module 9: CrossIndustryAnalytics (Week 11-12)**
- 시트: A_Contrast (113 companies, 64 fields)
- 복잡도: 0.6
- 기간: 2주
- 목적: 업종 간 수익성, 성장성, 밸류에이션 비교

**Module 10: ChartDataProvider (Week 13-14)**
- 시트: T_Chart (88 companies, 81 fields)
- 복잡도: 0.5
- 기간: 1.5-2주
- 목적: 개별 기업 차트 데이터 생성

**Module 11: ScreeningEngine (Week 15-16)**
- 시트: S_Chart (119 companies, 60 fields)
- 복잡도: 0.5
- 기간: 1.5-2주
- 목적: 사용자 맞춤 스크리닝 도구

**Module 12: ValuationEngine (Week 17-18)**
- 시트: S_Valuation (34 companies, 48 fields)
- 복잡도: 0.6
- 기간: 2주
- 목적: 가치측정 보정 및 기대수익률 평가

**Module 13: MomentumAnalytics (Week 19-20)**
- 시트: UP_&_Down (46 points, 188 fields)
- 복잡도: 0.6
- 기간: 2주
- 목적: 국가/업종별 모멘텀 분석

**Module 14: ReadMeProvider (Week 21-22)**
- 시트: ReadMe (37 rows)
- 복잡도: 0.2
- 기간: 1주
- 목적: 문서 및 가이드 제공

**Phase 2 총 기간**: 10-12주

---

### Phase 3 (Week 23-30): Completion & Polish (6개 시트)

#### 목표
- 시스템 완성도 100%
- 샘플 데이터 제공
- 장기 수익률 분석

#### Module 15-20 개요

**Module 15: DistributionAnalytics (Week 23-24)**
- 시트: A_Distribution (1,175 points, 65 fields)
- 복잡도: 0.5
- 기간: 1.5-2주
- 목적: CAGR 분포 통계 (S&P 500)

**Module 16: EPSHistorySampler (Week 25)**
- 시트: T_EPS_H (53 companies, 22 fields)
- 복잡도: 0.3
- 기간: 1주
- 목적: EPS 히스토리 샘플

**Module 17: GrowthHistorySampler (Week 26)**
- 시트: T_Growth_H (53 companies, 20 fields)
- 복잡도: 0.3
- 기간: 1주
- 목적: 성장률 히스토리 샘플

**Module 18: ETFMasterProvider (Week 27-28)**
- 시트: M_ETFs (29 ETFs, 44 fields)
- 복잡도: 0.4
- 기간: 1-1.5주
- 목적: ETF 마스터 데이터 제공

**Module 19-20: Reserved**
- 향후 확장 또는 추가 기능

**Phase 3 총 기간**: 5-7주

---

## Part 5: Module 4-8 재정의

### Module 4: CompanyAnalyticsProvider

**시트**: A_Company (1,250 companies, 50 fields)
**기간**: Week 1-3 (2-3주)
**복잡도**: 0.7
**우선순위**: 🔴 Critical (P0)

#### Task 개요
```yaml
Task 4.1: Data Schema Analysis (1일)
  Agent: @root-cause-analyst
  Output: A_COMPANY_SCHEMA_ANALYSIS.md

Task 4.2: Provider Layer (2일)
  - CSV 로딩, 인덱싱, 조인 로직
  - Output: CompanyAnalyticsProvider.js

Task 4.3: Growth Analysis (2일)
  - Sales (3), PER (3/5/10), PEG 계산
  - Output: GrowthCalculator.js

Task 4.4: Valuation Analysis (2일)
  - % PER/PBR (Avg) 계산
  - Output: ValuationCalculator.js

Task 4.5: Return Calculation (2일)
  - Price (10), Return (Y), DY (FY+1)
  - Output: ReturnCalculator.js

Task 4.6: E2E Testing (2-3일)
  Agent: @quality-engineer
  Output: company-analytics-provider.spec.js

Task 4.7: API Documentation (2일)
  Agent: @technical-writer
  Output: COMPANY_ANALYTICS_PROVIDER_API.md
```

#### 완료 기준
- [ ] 전체 데이터셋 테스트 통과 (1,250 companies)
- [ ] 계산 검증 (PEG, Return, DY 정확성)
- [ ] M_Company 조인 정확성
- [ ] 성능: <100ms
- [ ] API 문서 1,000+ lines

---

### Module 5: EPSMonitoringAnalytics

**시트**: T_Chk (1,250 companies, 78 fields)
**기간**: Week 4-6 (2-3주)
**복잡도**: 0.7
**우선순위**: 🔴 Critical (P0)

#### Task 개요
```yaml
Task 5.1: Data Schema Analysis (1일)
  Agent: @root-cause-analyst
  Output: T_CHK_SCHEMA_ANALYSIS.md

Task 5.2: Provider Layer (2일)
  - CSV 로딩 (78 fields, 72 date columns)
  - Output: EPSMonitoringProvider.js

Task 5.3: EPS Change Detection (2-3일)
  - 1주/1개월/3개월 변화 감지
  - Output: EPSChangeDetector.js

Task 5.4: Trend Analysis (2일)
  - 상승/하락/안정 추세 감지
  - Output: TrendAnalyzer.js

Task 5.5: Alert System (2-3일)
  - 급격한 변화 알람 (>5% 1주)
  - Output: AlertEngine.js

Task 5.6: E2E Testing (2-3일)
  Agent: @quality-engineer
  Output: eps-monitoring-analytics.spec.js

Task 5.7: API Documentation (2일)
  Agent: @technical-writer
  Output: EPS_MONITORING_ANALYTICS_API.md
```

#### 완료 기준
- [ ] 전체 데이터셋 테스트 (1,250 companies, 371 days)
- [ ] 변화율 계산 정확성
- [ ] 트렌드 감지 로직 검증
- [ ] 성능: <200ms
- [ ] API 문서 1,000+ lines

---

### Module 6: IndustryCostAnalytics

**시트**: A_Compare (493 companies, 78 fields)
**기간**: Week 7-9 (2-3주)
**복잡도**: 0.7
**우선순위**: 🔴 Critical (P0)

#### Task 개요
```yaml
Task 6.1: Data Schema Analysis (1일)
  Agent: @root-cause-analyst
  Output: A_COMPARE_SCHEMA_ANALYSIS.md

Task 6.2: Provider Layer (2일)
  - CSV 로딩, 업종별 인덱싱
  - Output: IndustryCostProvider.js

Task 6.3: Cost Structure Analysis (2-3일)
  - COGS, SG&A, R&D, OPM 계산
  - Output: CostStructureAnalyzer.js

Task 6.4: Industry Benchmarking (2일)
  - 업종 평균, 백분위 계산
  - Output: BenchmarkEngine.js

Task 6.5: Time-Series Trend (2일)
  - F-4 → F+3 비용 구조 변화
  - Output: TrendAnalyzer.js

Task 6.6: E2E Testing (2-3일)
  Agent: @quality-engineer
  Output: industry-cost-analytics.spec.js

Task 6.7: API Documentation (2일)
  Agent: @technical-writer
  Output: INDUSTRY_COST_ANALYTICS_API.md
```

#### 완료 기준
- [ ] 전체 데이터셋 테스트 (493 companies)
- [ ] 업종별 집계 정확성
- [ ] 비용 구조 계산 검증
- [ ] 성능: <150ms
- [ ] API 문서 1,000+ lines

---

### Module 7: EconomicIndicatorsProvider

**시트**: E_Indicators (1,030 points, 68 fields)
**기간**: Week 8-9 (1.5-2주)
**복잡도**: 0.5
**우선순위**: 🔴 Critical (P0)

#### Task 개요
```yaml
Task 7.1: Data Schema Analysis (1일)
  Agent: @root-cause-analyst
  Output: E_INDICATORS_SCHEMA_ANALYSIS.md

Task 7.2: Provider Layer (1-2일)
  - CSV 로딩, 날짜 인덱싱
  - Output: EconomicIndicatorsProvider.js

Task 7.3: Current Economic Status (2일)
  - TED, HYY, T10Y-2Y 해석
  - Output: EconomicStatusAnalyzer.js

Task 7.4: Time-Series Analysis (2일)
  - 최근 변화, 트렌드, 백분위
  - Output: TimeSeriesAnalyzer.js

Task 7.5: Risk Signal Detection (2일)
  - TED > 0.5, T10Y-2Y < 0, HYY 급등
  - Output: RiskSignalDetector.js

Task 7.6: E2E Testing (2일)
  Agent: @quality-engineer
  Output: economic-indicators-provider.spec.js

Task 7.7: API Documentation (1-2일)
  Agent: @technical-writer
  Output: ECONOMIC_INDICATORS_PROVIDER_API.md
```

#### 완료 기준
- [ ] 전체 데이터셋 테스트 (1,030 points)
- [ ] 지표 계산 정확성
- [ ] Recession flag 로직 검증
- [ ] 성능: <50ms
- [ ] API 문서 1,000+ lines

---

### Module 8: ETFAnalyticsProvider

**시트**: A_ETFs (489 rows, 151 fields)
**기간**: Week 10 (2주)
**복잡도**: 0.6
**우선순위**: 🔴 Critical (P0)

#### Task 개요
```yaml
Task 8.1: Data Schema Analysis (1일)
  Agent: @root-cause-analyst
  Output: A_ETFS_SCHEMA_ANALYSIS.md

Task 8.2: Provider Layer (1-2일)
  - CSV 로딩, 날짜 인덱싱, M_ETFs 조인
  - Output: ETFAnalyticsProvider.js

Task 8.3: ETF Analysis (2일)
  - Fwd Sales, Fwd EPS, Top holdings
  - Output: ETFAnalyzer.js

Task 8.4: Time-Series Analysis (2일)
  - 가격 추이, 컨센서스 변화
  - Output: TimeSeriesAnalyzer.js

Task 8.5: Comparison Analysis (1-2일)
  - ETF vs ETF, ETF vs 개별 종목
  - Output: ComparisonEngine.js

Task 8.6: E2E Testing (2일)
  Agent: @quality-engineer
  Output: etf-analytics-provider.spec.js

Task 8.7: API Documentation (1-2일)
  Agent: @technical-writer
  Output: ETF_ANALYTICS_PROVIDER_API.md
```

#### 완료 기준
- [ ] 전체 데이터셋 테스트 (489 rows)
- [ ] M_ETFs 조인 정확성
- [ ] 날짜 범위 검증
- [ ] 성능: <100ms
- [ ] API 문서 1,000+ lines

---

## Part 6: 전략적 인사이트

### 핵심 발견 사항

#### 1. 1,250 Records Pattern (핵심 통찰)
```yaml
패턴:
  - A_Company, T_EPS_C, T_Growth_C, T_Rank, T_Correlation, T_Chk 모두 1,250개
  - M_Company (6,176) → 동일한 필터링 기준 → 1,250개 선별

의미:
  - 고품질 기업 선별 기준 존재 (시가총액 >$10B, 데이터 완전성)
  - 이 1,250개 기업이 시스템의 "Core Universe"
  - 모든 분석 기능은 이 1,250개 중심으로 설계

전략적 활용:
  - Module 4 (A_Company)에서 1,250 필터링 로직 완성
  - 이후 모듈은 이 필터링 재사용
  - 성능 최적화: 6,176 → 1,250 필터링 O(n) 최적화
```

#### 2. 데이터 계층 구조 (3단계)
```yaml
Layer 1 (BASE):
  - M_Company (6,176)
  - M_ETFs (29)
  - 역할: 모든 데이터의 원천

Layer 2 (CORE CALCULATED):
  - A_Company, T_EPS_C, T_Growth_C, T_Rank (1,250)
  - 역할: 핵심 분석 데이터
  - Module 1-4 (Sprint 4 완료 + Module 4)

Layer 3 (SPECIALIZED):
  - A_Compare, A_ETFs, T_Chk, E_Indicators
  - 역할: 특화 분석 (비용구조, ETF, 모니터링, 거시경제)
  - Module 5-8 (Phase 1)

전략:
  - Layer 1 완료 (Module 1) → Layer 2 완료 (Sprint 4) → Layer 3 구현 (Phase 1)
```

#### 3. 독립성 vs 의존성 균형
```yaml
독립 실행 가능 (의존성 낮음):
  - E_Indicators (외부 데이터)
  - T_Chk (M_Company만 필요)
  - A_ETFs (M_ETFs만 필요)

의존성 높음:
  - T_EPS_H (T_EPS_C 필요)
  - T_Growth_H (T_Growth_C 필요)

Phase 1 전략:
  - 독립 실행 가능한 시트 우선 선택
  - 의존성 높은 시트는 Phase 2/3으로 연기
```

#### 4. 사용자 가치 vs 복잡도 매트릭스
```
High Value, Low Complexity (우선):
  - E_Indicators (8/10, 0.5)
  - A_ETFs (7/10, 0.6)

High Value, High Complexity (필수, but 시간 필요):
  - A_Company (9/10, 0.7)
  - T_Chk (9/10, 0.7)
  - A_Compare (8/10, 0.7)

Low Value, High Complexity (연기):
  - (없음, 이미 Phase 2/3으로 분류)

Low Value, Low Complexity (선택):
  - T_EPS_H (4/10, 0.3)
  - T_Growth_H (4/10, 0.3)
```

### 위험 요소 및 완화 전략

#### 위험 1: Phase 1 기간 초과 (10-13주 → 15주)
```yaml
원인:
  - Module 4-6 복잡도 0.7 (예상보다 시간 소요)
  - 테스트 실패 → 재작업

완화 전략:
  - Task 세분화 (7 tasks per module)
  - 에이전트 적극 활용 (@root-cause-analyst, @quality-engineer)
  - 주간 체크포인트 (진행 상황 모니터링)
  - 필요 시 Module 7-8을 Phase 2로 연기 (우선순위 재조정)
```

#### 위험 2: 데이터 구조 변경 (주간 업데이트)
```yaml
원인:
  - 매주 엑셀 다운로드 → 시트 구조 변경 가능

완화 전략:
  - Phase 0 Task 0.3 (변환 스크립트 개선) 중요성 강조
  - 자동 검증 로직 추가
  - 시트 구조 변경 감지
  - 필드 추가/삭제 자동 대응
```

#### 위험 3: 성능 목표 미달성
```yaml
원인:
  - O(n²) 알고리즘 사용
  - 대용량 데이터 (1,250 ~ 6,176 records)

완화 전략:
  - Module 1-2 경험 활용 (O(1) 인덱싱)
  - @performance-engineer 투입
  - 성능 테스트 우선 (Task x.6)
  - 병목 지점 조기 발견 및 최적화
```

---

## Part 7: 다음 단계 (Task 0.5 연결)

### Task 0.5: 완전한 레퍼런스 작성

**목표**: COMPLETE_DATA_REFERENCE.md 생성 (5,000+ lines)

**입력**: SHEET_PRIORITY_MATRIX.md (이 문서)

**작업 내용**:
```yaml
Part 1: 전체 개요
  - 22개 시트 분류 체계
  - 데이터 계층 구조 (BASE → CALCULATED → TOOL)
  - 1,250 Records Pattern 상세 설명

Part 2: 시트별 완전한 레퍼런스 (22개)
  각 시트별:
    - 목적 및 사용 시나리오
    - 필드 상세 설명 (각 필드별 의미, 계산 방법, 검증 규칙)
    - 데이터 관계도 (의존성, 파생 관계)
    - 샘플 쿼리 및 활용 예제
    - 성능 고려사항
    - 알려진 제약사항

Part 3: 데이터 관계도 (Dependency Map)
  - 시각적 관계도 (Mermaid 또는 PlantUML)
  - M_Company → 15개 시트 의존성
  - T_EPS_C → T_EPS_H 샘플링
  - 등등

Part 4: 계산 로직 상세
  - PEG 계산 방법
  - Expected Return 계산 방법
  - 상관계수 계산 방법
  - 업종별 벤치마킹 방법

Part 5: 검증 규칙
  - 각 필드별 검증 규칙
  - Null safety
  - Range validation
  - Cross-field validation

Part 6: 성능 최적화 가이드
  - O(n) vs O(n²) 알고리즘 선택
  - 인덱싱 전략
  - 캐싱 전략
  - 병렬 처리 가능성

Part 7: 사용 예제
  - "특정 업종의 고성장 기업 찾기"
  - "최근 EPS 전망이 개선된 기업 찾기"
  - "비용 효율성이 높은 기업 찾기"
  - 등등

Part 8: FAQ
  - 자주 묻는 질문 및 답변
```

**예상 크기**: 5,000+ lines
**작업 기간**: 1-2일
**Agent**: @technical-writer

---

## Part 8: 결론 및 권고사항

### 핵심 결정 요약

#### Phase 1 시트 5개 선정 (최종)
1. **A_Company** (Module 4) - 핵심 분석 허브
2. **T_Chk** (Module 5) - 실시간 EPS 모니터링
3. **A_Compare** (Module 6) - 업종별 비용구조 비교
4. **E_Indicators** (Module 7) - 거시경제 컨텍스트
5. **A_ETFs** (Module 8) - ETF 분석

#### 선정 근거 (4가지 축)
- **의존성**: 독립 실행 가능 (E_Indicators) 또는 Semi-dependent (A_Company, T_Chk, A_Compare, A_ETFs)
- **사용자 가치**: 평균 8.2/10 (즉각적 가치 제공)
- **데이터 유형**: CALCULATED (4개), INDICATOR (1개) - 핵심 분석 기능
- **복잡도**: 평균 0.64 (현실적 개발 범위)

#### 총 개발 기간
- **Phase 1**: 10-13주 (2.5-3.5개월)
- **Phase 2**: 10-12주 (2.5-3개월)
- **Phase 3**: 5-7주 (1.5-2개월)
- **전체**: 25-32주 (6-8개월)

### 전략적 권고사항

#### 1. Phase 0 완료 후 즉시 Module 4 착수
```yaml
이유:
  - Phase 0 완료 → 데이터 구조 완전 파악
  - Module 4 (A_Company) = Phase 1 기반
  - 빠른 사용자 가치 제공 (성장률, 밸류에이션, 기대수익률)

준비사항:
  - Task 0.5 (COMPLETE_DATA_REFERENCE.md) 완료
  - 변환 스크립트 안정화 (Task 0.3)
  - Module 1,2 패턴 재확인
```

#### 2. 에이전트 활용 극대화
```yaml
패턴:
  Task x.1: @root-cause-analyst (데이터 분석)
  Task x.6: @quality-engineer (테스트)
  Task x.7: @technical-writer (문서)

효과:
  - 품질 향상 (전문 에이전트 투입)
  - 시간 절약 (병렬 작업)
  - 일관성 유지 (동일 에이전트 패턴)
```

#### 3. 성능 최적화 우선
```yaml
목표:
  - 1,250 records: <100-200ms
  - 6,176 records: <500ms
  - 10,000 records: <1000ms (확장성)

전략:
  - O(1) 인덱싱 (Ticker, WI26, Exchange)
  - O(n) 필터링 (1,250 Records Pattern)
  - Module 1-2 경험 재활용 (O(1) 최적화)
```

#### 4. 주간 체크포인트 설정
```yaml
Week 1 (Module 4 Task 1-3):
  - [ ] A_Company 스키마 분석 완료
  - [ ] Provider Layer 구현 완료
  - [ ] Growth Analysis 구현 완료

Week 2 (Module 4 Task 4-5):
  - [ ] Valuation Analysis 구현 완료
  - [ ] Return Calculation 구현 완료

Week 3 (Module 4 Task 6-7):
  - [ ] E2E 테스트 통과 (100%)
  - [ ] API 문서 완성 (1,000+ lines)
  - [ ] Module 4 완료 ✅

[이후 Module 5-8 동일 패턴]
```

#### 5. 유연한 우선순위 재조정
```yaml
조건:
  - Module 4-6 기간 초과 시
  - 사용자 요구사항 변경 시
  - 데이터 구조 대규모 변경 시

대응:
  - Module 7-8을 Phase 2로 연기
  - Phase 1 = Module 4-6만 (핵심 3개)
  - 사용자 피드백 반영 후 재계획
```

### 최종 체크리스트

#### Task 0.4 완료 기준
- [x] 22개 시트 우선순위 확정 (상세 근거)
- [x] Phase 1 시트 5개 선별 (A_Company, T_Chk, A_Compare, E_Indicators, A_ETFs)
- [x] 로드맵 3단계 작성 (Week 단위)
- [x] Module 4-8 재정의 (각 7 tasks)

#### 산출물 확인
- [x] SHEET_PRIORITY_MATRIX.md 생성 (2,000+ lines)
- [x] 4가지 축 우선순위 결정 기준 명시
- [x] 22개 시트 전수 평가 (스코어링)
- [x] 3단계 로드맵 (Phase 1/2/3)
- [x] Module 4-8 Task 개요

#### 다음 Task 연결
- [ ] Task 0.5: COMPLETE_DATA_REFERENCE.md 작성 (5,000+ lines)
- [ ] Task 0.6: Module 1,2 검증
- [ ] Phase 1 Module 4 착수 준비

---

**문서 완료**: 2025-10-19
**작성자**: System Architect (Claude Sonnet 4.5)
**작업 시간**: ~90분
**문서 크기**: 2,800+ lines
**다음 단계**: Task 0.5 - COMPLETE_DATA_REFERENCE.md 작성

---

## 부록 A: 우선순위 스코어링 상세

### 전체 22개 시트 스코어 (최종)

| 순위 | 시트명 | Dep | Value | Type | Comp | Total | Phase | Status |
|------|--------|-----|-------|------|------|-------|-------|--------|
| 1 | M_Company | 3 | 10 | BASE | 0.6 | 4.50 | - | ✅ Done |
| 2 | A_Company | 2 | 9 | CALC | 0.7 | 4.41 | P1 | Module 4 |
| 3 | T_Chk | 1 | 9 | CALC | 0.7 | 4.11 | P1 | Module 5 |
| 4 | A_Compare | 2 | 8 | CALC | 0.7 | 4.01 | P1 | Module 6 |
| 5 | T_EPS_C | 1 | 8 | CALC | 0.6 | 3.70 | - | ✅ Done |
| 6 | E_Indicators | 1 | 8 | IND | 0.5 | 3.71 | P1 | Module 7 |
| 7 | T_Growth_C | 1 | 8 | CALC | 0.7 | 3.70 | - | ✅ Done |
| 8 | T_Rank | 1 | 8 | CALC | 0.7 | 3.70 | - | ✅ Done |
| 9 | T_CFO | 1 | 8 | CALC | 0.6 | 3.70 | - | ✅ Done |
| 10 | T_Correlation | 1 | 7 | CALC | 0.8 | 3.42 | - | ✅ Done |
| 11 | A_ETFs | 2 | 7 | CALC | 0.6 | 3.62 | P1 | Module 8 |
| 12 | UP_&_Down | 2 | 8 | SPEC | 0.6 | 3.92 | P2 | Module 13 |
| 13 | A_Contrast | 2 | 7 | CALC | 0.6 | 3.52 | P2 | Module 9 |
| 14 | S_Chart | 2 | 7 | TOOL | 0.5 | 3.41 | P2 | Module 11 |
| 15 | S_Valuation | 2 | 7 | TOOL | 0.6 | 3.52 | P2 | Module 12 |
| 16 | T_Chart | 2 | 6 | CALC | 0.5 | 3.21 | P2 | Module 10 |
| 17 | M_ETFs | 3 | 7 | BASE | 0.4 | 3.74 | P3 | Module 18 |
| 18 | A_Distribution | 1 | 6 | CALC | 0.5 | 3.11 | P3 | Module 15 |
| 19 | T_EPS_H | 0 | 4 | CALC | 0.3 | 2.27 | P3 | Module 16 |
| 20 | T_Growth_H | 0 | 4 | CALC | 0.3 | 2.27 | P3 | Module 17 |
| 21 | ReadMe | 0 | 5 | DOC | 0.2 | 2.58 | P2 | Module 14 |
| 22 | S_Mylist | 2 | 0 | TOOL | 0.2 | 0.70 | ❌ | Cancelled |

**스코어 계산 공식**:
```
Score = (Dependency × 0.3) + (User Value × 0.4) + (Type Weight × 0.2) + (Complexity Inverse × 0.1)

Dependency: 0-3 (0=Leaf, 1=Independent, 2=Semi-dependent, 3=Foundation)
User Value: 0-10 (10=Critical, 0=Minimal)
Type Weight: 1.0 (BASE), 0.9 (CALCULATED), 0.8 (INDICATOR), 0.7 (TOOL), 0.6 (SPECIAL)
Complexity Inverse: (1 - Complexity) × 0.1 (0.0-1.0 → 0.1-0.0)
```

---

## 부록 B: Module 간 의존성 그래프

```
Module 1 (M_Company) [✅ Done]
  ↓
  ├─→ Module 4 (A_Company) [P1]
  │     ↓
  │     ├─→ Module 11 (S_Chart) [P2]
  │     └─→ Module 12 (S_Valuation) [P2]
  │
  ├─→ Module 5 (T_Chk) [P1]
  │
  ├─→ Module 6 (A_Compare) [P1]
  │
  ├─→ Module 9 (A_Contrast) [P2]
  │
  └─→ Module 10 (T_Chart) [P2]

Module 18 (M_ETFs) [P3]
  ↓
  └─→ Module 8 (A_ETFs) [P1]

External Data
  ↓
  └─→ Module 7 (E_Indicators) [P1]

Module 13 (UP_&_Down) [P2] - M_Company Aggregation

Sprint 4 Done (T_EPS_C, T_Growth_C, T_Rank)
  ↓
  ├─→ Module 16 (T_EPS_H) [P3]
  └─→ Module 17 (T_Growth_H) [P3]

Sprint 5 In Progress (T_CFO, T_Correlation) [🔄 구현완료, 테스팅 미완]
```

**의존성 해석**:
- Module 1 완료 → Module 4-6, 9-10 즉시 착수 가능
- Module 18 (M_ETFs)는 Phase 3에서 구현 후 Module 8 연동
- Module 8은 M_ETFs 데이터만 있으면 동작 (Phase 1 가능)
- Module 7은 완전 독립 (외부 데이터)

---

**문서 최종 확인**: 2025-10-19
**System Architect**: Claude Sonnet 4.5
**Next**: Task 0.5 - COMPLETE_DATA_REFERENCE.md (5,000+ lines)
