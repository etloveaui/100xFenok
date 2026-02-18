# Sprint 4: Complete Data Reference

**작성일**: 2025-10-19
**작성자**: Claude Code (Technical Writer Mode)
**버전**: 1.0.0
**목적**: 22개 시트 완전한 데이터 레퍼런스 - 세션 간 컨텍스트 유지, 팀원 온보딩, 개발 레퍼런스
**프로젝트**: Stock Analyzer - 100xFenok

---

## 📖 문서 개요

### 이 문서의 목적

이 문서는 Stock Analyzer 프로젝트의 **완전한 데이터 레퍼런스**로서 다음을 보장합니다:

1. **세션 간 컨텍스트 유지**: Claude Code 세션 재시작 시 전체 프로젝트를 즉시 이해
2. **팀원 온보딩**: 신규 개발자가 30분 내 전체 데이터 구조 파악
3. **개발 레퍼런스**: 모든 Module 개발 시 즉시 참조 가능한 상세 정보
4. **의사결정 추적**: 왜 이렇게 설계했는지, 어떤 교훈을 얻었는지 기록

### 문서 사용법

**빠른 참조**:
- [Part 1: Executive Summary](#part-1-executive-summary) - 5분 개요
- [Part 2: Data Classification](#part-2-data-classification-system) - 데이터 분류 체계
- [Part 3: Sheet Reference](#part-3-complete-sheet-reference) - 시트별 상세 정보 (개발 시 참조)

**깊은 이해**:
- [Part 4: Calculation Logic](#part-4-calculation-logic-details) - 계산 로직 상세
- [Part 5: Data Relationships](#part-5-data-relationship-map) - 데이터 관계도
- [Part 6: Development Guide](#part-6-development-guidelines) - 개발 가이드라인

**문제 해결**:
- [Part 7: FAQ & Troubleshooting](#part-7-faq--troubleshooting) - 자주 묻는 질문
- [Part 8: Appendix](#part-8-appendix) - 용어 사전, 참조 문서

### 문서 구조

```
Part 1: Executive Summary (500 lines)
├─ Project Overview
├─ Data Structure At-a-Glance
├─ Quick Reference (22 sheets × 1 line)
└─ Reading Guide

Part 2: Data Classification System (800 lines)
├─ Base vs Calculated
├─ M_, A_, T_, S_, E_ Categories
├─ 1,250 Records Pattern
└─ Data Relationship Diagrams

Part 3: Complete Sheet Reference (2,500 lines)
└─ 22 Sheets × ~100 lines each
    ├─ Purpose & Use Cases
    ├─ Record Count & Distribution
    ├─ Complete Field List
    ├─ Sample Data
    ├─ Relationship with M_Company
    ├─ Calculation Logic
    ├─ Validation Rules
    ├─ Development Notes
    └─ Query Pattern Examples

Part 4: Calculation Logic Details (600 lines)
├─ PEG Ratio Calculation
├─ Expected Return Calculation
├─ Correlation Calculation
├─ Cost Structure Comparison
├─ EPS Monitoring Logic
└─ All Calculated Fields

Part 5: Data Relationship Map (400 lines)
├─ Dependency Diagram
├─ JOIN Patterns
├─ Data Flow (xlsb → CSV → JSON → Module)
└─ Filter Chain (6,176 → 1,250 → 493)

Part 6: Development Guidelines (500 lines)
├─ Module Development Pattern (7-task pattern)
├─ Performance Optimization Principles
├─ Testing Principles
├─ Validation Rule Guidelines
├─ Null Safety Pattern
└─ Error Handling Pattern

Part 7: FAQ & Troubleshooting (300 lines)
└─ Common Questions & Solutions

Part 8: Appendix (400 lines)
├─ Glossary
├─ Reference Documents
├─ Git History
└─ Change Log
```

---

# Part 1: Executive Summary

## Project Overview

**Stock Analyzer - 100xFenok Project**

Stock Analyzer는 전세계 주요 기업(6,176개)을 분석하는 웹 기반 애플리케이션으로, 성장성, 밸류에이션, 현금흐름, 상관관계 등 다면적 분석을 제공합니다.

### 핵심 수치

```yaml
Total Sheets: 22개
Total Records: ~17,076 lines (헤더 포함)
Total Companies: ~6,176 unique companies
Data Size: ~8.4 MB (CSV)

Categories:
  Master (M_): 2 sheets (BASE)
  Analysis (A_): 5 sheets (CALCULATED)
  Technical (T_): 10 sheets (CALCULATED)
  Screening (S_): 3 sheets (TOOL)
  Economic (E_): 1 sheet (INDICATOR)
  Special: 1 sheet (UP & Down)

Development Status:
  Completed: 7 sheets (Module 1, 2, Sprint 4, Sprint 5)
  In Progress: 0 sheets
  Remaining: 15 sheets (Phase 0 완료 후 착수)
```

### 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────┐
│                      Stock Analyzer                          │
│  22 CSV Sheets → JSON → Analytics Modules → Dashboard        │
└─────────────────────────────────────────────────────────────┘
                           ↓
        ┌──────────────────┴──────────────────┐
        │                                      │
   [BASE Layer]                        [CALCULATED Layer]
   M_Company (6,176)                   A_Company (1,250)
   M_ETFs (29)                         T_EPS_C (1,250)
        │                              T_Growth_C (1,250)
        │                              T_Rank (1,253)
        └─────────────┐                T_CFO (1,264)
                      │                T_Correlation (1,249)
                      │                A_Compare (493)
                      │                ... (9 more)
                      ↓
              [TOOL & INDICATOR Layer]
              S_Chart (119)
              S_Valuation (34)
              E_Indicators (1,030)
```

## Data Structure At-a-Glance

### 계층 구조 (3 Layers)

#### Layer 1: BASE (Foundation)
**원본 마스터 데이터 - 다른 모든 시트의 원천**

```yaml
M_Company (6,176 companies):
  - 전세계 주요 기업 마스터
  - 33 fields (식별자, 가격, 시총, 수익성, 밸류, 수익률, EPS)
  - Status: ✅ Module 1 완료 (CompanyMasterProvider)

M_ETFs (29 indices/ETFs):
  - 주요 지수 및 ETF 마스터
  - 44 fields (Ticker, Sector, Performance, Metrics)
  - Status: ⏳ Phase 1 대기
```

#### Layer 2: CALCULATED (Analysis)
**BASE 데이터에서 필터링, 계산, 분석하여 생성**

```yaml
1,250 Records Pattern (7 sheets):
  A_Company: 성장성, 밸류에이션, 기대수익률 (50 fields)
  T_EPS_C: EPS 컨센서스 FY+1/+2/+3 (40 fields) ✅
  T_Growth_C: 성장률 컨센서스 (49 fields) ✅
  T_Rank: 순위 및 기대수익률 (38 fields) ✅
  T_CFO: 현금흐름 분석 (36 fields) ✅
  T_Correlation: 상관관계 분석 (42 fields) ✅
  T_Chk: EPS 업데이트 추적 (78 fields)

Industry Analysis (2 sheets):
  A_Compare (493): 업종 내 비용구조 비교 (78 fields)
  A_Contrast (113): 업종 간 비교 (64 fields)

Other Analysis (6 sheets):
  A_Distribution (1,175): CAGR 분포 통계
  A_ETFs (489): ETF 상세 분석
  T_Chart (88): 차트 데이터
  T_EPS_H (53): EPS 히스토리
  T_Growth_H (53): 성장률 히스토리
  UP & Down (46): 국가/업종별 모멘텀
```

#### Layer 3: TOOL & INDICATOR (User Interface)
**사용자 탐색 도구 및 경제 지표**

```yaml
Screening Tools:
  S_Chart (119): 차트 시각화
  S_Valuation (34): 밸류에이션 평가
  S_Mylist (19): ❌ CANCELLED (사용자 미등록)

Economic Indicators:
  E_Indicators (1,030): TED, HYY, 국채금리 시계열
```

## Quick Reference: 22 Sheets × 1 Line

**M_ Series (Master - BASE)**
```
M_Company    (6,176): 전세계 주요기업 마스터 (식별자, 가격, 시총, 수익성, 밸류) [✅ Module 1]
M_ETFs       (   29): 주요 지수/ETF 마스터 (성과, 비용, 보유종목) [⏳ Phase 1]
```

**A_ Series (Analysis - CALCULATED)**
```
A_Company    (1,250): 성장성, 밸류에이션, 기대수익률 (PEG, Return, DY) [⏳ Phase 1 - Module 4]
A_Compare    (  493): 업종별 비용구조 비교 (COGS, SG&A, R&D, OPM) [⏳ Phase 1 - Module 6]
A_Contrast   (  113): 업종 간 비교 (수익성, 성장성, 밸류에이션) [⏳ Phase 2]
A_Distribution(1,175): CAGR 분포 통계 (S&P 500 기준) [⏳ Phase 3]
A_ETFs       (  489): ETF 상세 분석 (매출, EPS 시계열) [⏳ Phase 1 - Module 8]
```

**T_ Series (Technical - CALCULATED)**
```
T_EPS_C      (1,250): EPS 컨센서스 FY+1/+2/+3 시계열 [✅ Sprint 4 - EPSAnalytics]
T_Growth_C   (1,250): 성장률 컨센서스 (Sales, OP, EPS 7년/3년) [✅ Sprint 4 - GrowthAnalytics]
T_Rank       (1,253): 순위 및 기대수익률 (Regression) [✅ Sprint 4 - RankingAnalytics]
T_CFO        (1,264): 현금흐름 분석 (영업CF, 당기순이익 FY-4~FY+3) [✅ Sprint 5 - CFOAnalytics]
T_Correlation(1,249): 상관관계 (Fwd Sales, Fwd EPS vs HYY) [✅ Sprint 5 - CorrelationEngine]
T_Chk        (1,250): EPS 업데이트 추적 (72 date columns) [⏳ Phase 1 - Module 5]
T_Chart      (   88): 차트 생성용 데이터 [⏳ Phase 2]
T_EPS_H      (   53): EPS 히스토리 샘플 [⏳ Phase 3]
T_Growth_H   (   53): 성장률 히스토리 샘플 [⏳ Phase 3]
```

**S_ Series (Screening - TOOL)**
```
S_Chart      (  119): 차트 시각화 도구 [⏳ Phase 2]
S_Valuation  (   34): 밸류에이션 평가 도구 (PER/PBR Range) [⏳ Phase 2]
S_Mylist     (   19): ❌ CANCELLED (관심종목 - 사용자 미등록)
```

**E_ Series (Economic - INDICATOR)**
```
E_Indicators (1,030): 경제지표 (TED, HYY, 국채금리) 주간 시계열 [⏳ Phase 1 - Module 7]
```

**Special**
```
UP & Down    (   46): 국가/업종별 기업 실적 모멘텀 (주간/월간/3M/6M/년간) [⏳ Phase 2]
```

## Reading Guide

### 개발자 워크플로우별 읽기 가이드

#### Scenario 1: 신규 Module 개발 시작
```
1. Part 1: Executive Summary (5분)
   → 전체 구조 파악

2. Part 3: 해당 시트 상세 레퍼런스 (~10분)
   → 목적, 필드, 샘플, 관계, 계산 로직

3. Part 4: 해당 계산 로직 상세 (필요 시)
   → 수식, 예외 처리

4. Part 6: Development Guidelines
   → 7-task 패턴, 성능 원칙, 테스트 원칙

5. 개발 시작!
```

#### Scenario 2: 세션 재시작 후 컨텍스트 복구
```
1. Part 1: Quick Reference
   → 22개 시트 1줄 설명 확인

2. Part 5: Data Relationship Map
   → 의존성 다이어그램 확인

3. 마지막 작업 Module의 Part 3 레퍼런스 재확인
   → 즉시 작업 재개
```

#### Scenario 3: 버그 또는 테스트 실패 시
```
1. Part 7: FAQ & Troubleshooting
   → 자주 발생하는 문제 확인

2. Part 3: 해당 시트 Validation Rules
   → 검증 규칙 재확인

3. Part 4: 계산 로직 상세
   → 수식 정확성 검증

4. Part 5: JOIN 패턴
   → M_Company와의 관계 확인
```

#### Scenario 4: 데이터 구조 변경 시
```
1. Part 5: Filter Chain
   → 6,176 → 1,250 → 493 흐름 이해

2. Part 2: 1,250 Records Pattern
   → 필터링 기준 확인

3. Part 3: 관련 시트 모두 확인
   → 영향 범위 파악

4. Part 8: Change Log 업데이트
   → 변경 이력 기록
```

### 중요 표기법

이 문서에서 사용하는 표기법:

```yaml
✅ Completed: 개발 완료
🔄 In Progress: 개발 중
⏳ Pending: 대기 중
❌ Cancelled: 취소됨

🔴 Critical (P0): 필수 개발
🟡 High (P1): 2차 개발
🟢 Medium (P2): 3차 개발

[BASE]: 원본 마스터 데이터
[CALCULATED]: 파생 계산 데이터
[TOOL]: 사용자 도구
[INDICATOR]: 경제 지표
```

---

# Part 2: Data Classification System

## 베이스 vs 계산 구분

### BASE (원본 마스터 데이터)

**정의**: 외부 소스에서 직접 가져온 가공되지 않은 원본 데이터

**특징**:
- 다른 모든 시트의 원천 데이터 (Source of Truth)
- 필드 수 적음 (33~44개)
- 레코드 수 많음 (M_Company 6,176개)
- 계산 필드 없음, 직접 수집 데이터만
- 주차별 업데이트 시 완전 교체

**시트 목록** (2개):
```yaml
M_Company (6,176 companies):
  Source: Global stock exchanges
  Fields: 33 (identification, price, market cap, profitability, valuation)
  Update: Weekly
  Purpose: Foundation for all analysis

M_ETFs (29 indices/ETFs):
  Source: Major index providers
  Fields: 44 (ticker, sector, performance, holdings)
  Update: Weekly
  Purpose: Market context and portfolio comparison
```

**데이터 흐름**:
```
External Sources → xlsb → CSV → M_Company.json
                                    │
                                    └─→ All CALCULATED sheets
```

### CALCULATED (파생 계산 데이터)

**정의**: BASE 데이터에서 필터링, 계산, 분석하여 생성된 데이터

**특징**:
- BASE 데이터에 의존 (M_Company, M_ETFs)
- 필드 수 많음 (40~151개, 계산 필드 추가)
- 레코드 수 다양 (53~1,264개, 필터링 기준에 따라)
- 계산 로직 포함 (PEG, Return, Correlation 등)
- 주차별 업데이트 시 재계산 필요

**패턴 분류** (3가지):

#### 1. 1,250 Records Pattern (7 sheets)
**특징**: M_Company (6,176) → 동일한 필터링 기준 → 1,250개 선별

**필터링 기준**:
```yaml
Market Capitalization: >$10B (일부 >$1B)
Data Completeness: Fwd EPS Consensus 존재
Liquidity: 활발한 거래 (유동성 기준)
Quality: 데이터 완전성 (null 필드 최소)
```

**시트 목록**:
```yaml
A_Company (1,250):
  Common: 33 from M_Company
  Calculated: 17 (PEG, Expected Return, DY)
  Total: 50 fields

T_EPS_C (1,250):
  Common: 12 from M_Company
  Calculated: 28 (FY+1/+2/+3 EPS time-series)
  Total: 40 fields

T_Growth_C (1,250):
  Common: 12 from M_Company
  Calculated: 37 (Sales/OP/EPS growth 7Y/3Y)
  Total: 49 fields

T_Rank (1,253):
  Common: 12 from M_Company
  Calculated: 26 (Rank, PEG, Expected Return)
  Total: 38 fields
  Note: +3 companies (slightly different filter)

T_CFO (1,264):
  Common: 12 from M_Company
  Calculated: 24 (CFO, Net Income FY-4~FY+3)
  Total: 36 fields
  Note: +14 companies (CFO data availability)

T_Correlation (1,249):
  Calculated: 42 (Correlation analysis)
  Note: -1 company (correlation data requirement)

T_Chk (1,250):
  Common: 12 from M_Company
  Calculated: 66 (72 date columns for EPS tracking)
  Total: 78 fields
```

**교훈 (From Module 2)**:
```
"Validator 정의(39) ≠ 데이터 존재(33) ≠ 데이터 populated(14)"

Test 작성 시:
- 데이터 스키마 (33 fields in M_Company.json)
- 실제 populated fields (14 fields with data)
- Validator 정의 (39 validators 정의됨)
→ 이 세 가지를 명확히 구분하고 Test expectation 설정
```

#### 2. Industry Analysis (2 sheets)
**특징**: M_Company → 업종별/업종 간 필터링

```yaml
A_Compare (493 companies):
  Filter: Industry-specific (업종 내 비교)
  Fields: 78 (Cost structure: COGS, SG&A, R&D, OPM)
  Purpose: Within-industry comparison

A_Contrast (113 companies):
  Filter: Cross-industry sampling
  Fields: 64 (Profitability, Growth, Valuation)
  Purpose: Cross-industry comparison
```

#### 3. Time-Series Expansion (2 sheets)
**특징**: BASE → 시간 축 확장 → 레코드 증가

```yaml
A_ETFs (489 rows):
  Base: M_ETFs (29)
  Expansion: 16.9× (날짜별 시계열)
  Fields: 151 (Date, Price, Fwd Sales, Fwd EPS, Holdings)

E_Indicators (1,030 points):
  Base: External economic data
  Expansion: Weekly time-series
  Fields: 68 (TED, HYY, Treasury Yield, Inflation)
```

### TOOL (사용자 도구)

**정의**: 사용자가 기업을 탐색하고 평가하는 도구

**특징**:
- 사용자 인터페이스 관련
- 필터링, 정렬, 차트 생성
- 레코드 수 적음 (34~119개, 샘플링)
- M_Company 데이터 재활용

**시트 목록** (2개 active, 1개 cancelled):
```yaml
S_Chart (119):
  Purpose: 차트 시각화 도구
  Fields: 60
  Status: ✅ Active

S_Valuation (34):
  Purpose: 밸류에이션 평가 (PER/PBR Range, Expected Return)
  Fields: 48
  Status: ✅ Active

S_Mylist (19):
  Purpose: 관심종목 관리
  Fields: 58
  Status: ❌ CANCELLED (사용자 미등록, M_Company 중복)
```

### INDICATOR (경제 지표)

**정의**: 거시경제 지표 및 시장 지수 데이터

**특징**:
- 독립 외부 데이터 소스
- M_Company와 무관 (독립 실행 가능)
- 시계열 데이터
- 투자 환경 컨텍스트 제공

**시트 목록** (1개):
```yaml
E_Indicators (1,030 points):
  Source: Economic data providers
  Fields: 68 (TED, HYY(US/EM/EU), T30Y/20Y/10Y/2Y, Inflation)
  Frequency: Weekly
  Purpose: Macro economic context
```

## M_, A_, T_, S_, E_ 카테고리 설명

### M_ = Master (마스터)

**의미**: 원본 마스터 데이터, 시스템의 기초

**명명 규칙**: M_[Entity]
- M_Company: 기업 마스터
- M_ETFs: ETF/지수 마스터

**특징**:
- Layer 1 (Foundation)
- 다른 모든 시트의 의존 대상
- 주차별 완전 교체
- 계산 필드 없음

**개발 우선순위**: 🔴 Critical (가장 먼저 개발)

### A_ = Analysis (분석)

**의미**: 고급 분석 및 비교 도구

**명명 규칙**: A_[Analysis Type]
- A_Company: 개별 기업 심화 분석
- A_Compare: 업종별 비교 분석
- A_Contrast: 업종 간 대조 분석
- A_Distribution: 분포 통계 분석
- A_ETFs: ETF 상세 분석

**특징**:
- Layer 2 (Analysis)
- M_Company 또는 M_ETFs 기반
- 다중 계산 필드 포함
- 사용자 의사결정 지원

**개발 우선순위**: 🔴 Critical (A_Company, A_Compare), 🟡 High (나머지)

### T_ = Technical (기술 지표)

**의미**: 기술적 분석 및 시계열 지표

**명명 규칙**: T_[Indicator Type]_[Variant]
- T_EPS_C: EPS Consensus
- T_EPS_H: EPS Historical
- T_Growth_C: Growth Consensus
- T_Growth_H: Growth Historical
- T_Rank: Ranking
- T_CFO: Cash Flow from Operations
- T_Correlation: Correlation Analysis
- T_Chk: Check/Tracking
- T_Chart: Chart Data

**Variant 구분**:
- **_C (Consensus)**: 컨센서스 기준 (forward-looking)
- **_H (Historical)**: 과거 실적 기준 (backward-looking)

**특징**:
- Layer 2 (Analysis)
- 시계열 데이터 중심
- 계산 집약적
- 1,250 Records Pattern 많음

**개발 우선순위**:
- 🔴 Critical: T_EPS_C, T_Growth_C, T_Rank, T_CFO, T_Correlation, T_Chk
- 🟡 High: T_Chart
- 🟢 Medium: T_EPS_H, T_Growth_H

### S_ = Select/Screening (선택/스크리닝)

**의미**: 사용자 스크리닝 및 평가 도구

**명명 규칙**: S_[Tool Type]
- S_Chart: 차트 도구
- S_Valuation: 밸류에이션 도구
- S_Mylist: 관심종목 (Cancelled)

**특징**:
- Layer 3 (User Interface)
- 사용자 탐색 지원
- 소량 샘플링
- UI 중심

**개발 우선순위**: 🟡 High (S_Chart, S_Valuation)

### E_ = Economic (경제 지표)

**의미**: 거시경제 지표 및 시장 환경

**명명 규칙**: E_[Indicator Type]
- E_Indicators: 경제 지표

**특징**:
- Layer 2 (독립 분석)
- 외부 데이터 소스
- M_Company 무관
- 시계열 중심

**개발 우선순위**: 🔴 Critical (투자 환경 컨텍스트)

## 1,250 Records Pattern 상세

### 발견 배경

Sprint 4 Phase 0 Task 0.1 (전수 조사) 중 발견:
```
A_Company: 1,250
T_EPS_C: 1,250
T_Growth_C: 1,250
T_Rank: 1,253 (+3)
T_CFO: 1,264 (+14)
T_Correlation: 1,249 (-1)
T_Chk: 1,250
```

**→ "1,250개 고품질 기업" 패턴 확인**

### 필터링 기준

**M_Company (6,176) → 1,250 선별 과정**:

```yaml
Step 1: Market Capitalization Filter
  - Threshold: >$10B (대부분)
  - Exception: Display, Shipbuilding >$1B
  - Result: ~2,500 companies

Step 2: Data Completeness Filter
  - Requirement: Fwd 12M EPS Consensus 존재
  - Requirement: ROE (Fwd), OPM (Fwd) 존재
  - Result: ~1,800 companies

Step 3: Liquidity Filter
  - Requirement: 활발한 거래 (Average Daily Volume)
  - Requirement: 충분한 애널리스트 커버리지
  - Result: ~1,400 companies

Step 4: Quality Filter
  - Requirement: Null 필드 최소 (<10%)
  - Requirement: 연속 데이터 (No gaps)
  - Result: 1,250 companies

Final: 1,250 High-Quality Companies
```

### 예외 시트 분석

**T_Rank (1,253, +3 companies)**:
```yaml
Reason: Ranking 계산 시 약간 완화된 기준
Additional: 시가총액 >$8B 허용 (특정 업종)
Impact: Minimal (1,250 core는 동일)
```

**T_CFO (1,264, +14 companies)**:
```yaml
Reason: CFO 데이터 가용성 기준
Additional: EPS Consensus 없어도 CFO 있으면 포함
Impact: CFO 분석 전용 기업 추가
```

**T_Correlation (1,249, -1 company)**:
```yaml
Reason: 상관관계 계산 위한 충분한 시계열 필요
Excluded: 최근 상장 기업 (데이터 기간 부족)
Impact: Minimal (1 company)
```

### 개발 시 고려사항

**1. 인덱싱 전략**:
```javascript
// CompanyMasterProvider (Module 1)
// M_Company 6,176개 전체 인덱싱
companyIndex = {
  'NVDA': { /* 33 fields */ },
  'MSFT': { /* 33 fields */ },
  // ... 6,176 companies
}

// A_Company Provider (Module 4)
// 1,250개 서브셋 인덱싱
analyticsIndex = {
  'NVDA': { /* 50 fields (33 common + 17 calculated) */ },
  'MSFT': { /* 50 fields */ },
  // ... 1,250 companies
}
```

**2. JOIN 패턴**:
```javascript
// 1,250 패턴 시트에서 M_Company 데이터 필요 시
const companyData = companyMasterProvider.getByTicker(ticker);
const epsData = epsAnalytics.getByTicker(ticker);

if (!companyData) {
  // M_Company에는 있지만 1,250에는 없을 수 있음
  console.warn(`${ticker} not in 1,250 pattern sheets`);
}
```

**3. 테스트 전략**:
```javascript
// Module 2 교훈: 데이터 스키마 vs populated 구분
describe('A_Company Data Validation', () => {
  test('should have 1,250 companies', () => {
    expect(analyticsData.length).toBe(1250); // ✅ 정확한 expectation
  });

  test('should all have Ticker field', () => {
    analyticsData.forEach(company => {
      expect(company.Ticker).toBeDefined(); // ✅ 필수 필드만 검증
    });
  });

  test('calculated fields may be null', () => {
    // ❌ expect(company.PEG).toBeDefined(); // 틀린 expectation
    // ✅ expect(company.PEG === null || typeof company.PEG === 'number').toBe(true);
  });
});
```

**4. 성능 최적화**:
```yaml
1,250 companies target performance:
  Initial Loading: <500ms
  Individual Query: <1ms (O(1) lookup)
  Batch Query (10): <5ms
  Filtering: <50ms (O(n) acceptable)
  Sorting: <100ms (O(n log n) acceptable)

10,000 companies future target:
  Initial Loading: <2000ms
  Filtering: <200ms
  → 알고리즘 최적화 필요 (O(n²) → O(n))
```

## Data Relationship Diagrams

### Overall Dependency Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         Layer 1: BASE                            │
│                                                                  │
│  M_Company (6,176)                    M_ETFs (29)               │
│  [✅ Module 1]                         [⏳ Phase 1]              │
└────────┬────────────────────────────────────┬────────────────────┘
         │                                    │
         ├────────────────────────────────────┼──────────────┐
         │                                    │              │
         ↓                                    ↓              ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Layer 2: CALCULATED                         │
│                                                                  │
│  ┌─ 1,250 Pattern (7 sheets) ──────────────────────────┐       │
│  │  A_Company    (1,250) [⏳ Module 4]                  │       │
│  │  T_EPS_C      (1,250) [✅ Sprint 4]                 │       │
│  │  T_Growth_C   (1,250) [✅ Sprint 4]                 │       │
│  │  T_Rank       (1,253) [✅ Sprint 4]                 │       │
│  │  T_CFO        (1,264) [✅ Sprint 5]                 │       │
│  │  T_Correlation(1,249) [✅ Sprint 5]                 │       │
│  │  T_Chk        (1,250) [⏳ Module 5]                  │       │
│  └───────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌─ Industry Analysis (2 sheets) ──────────────────────┐       │
│  │  A_Compare    (  493) [⏳ Module 6]                  │       │
│  │  A_Contrast   (  113) [⏳ Phase 2]                   │       │
│  └───────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌─ Time-Series & Others (6 sheets) ───────────────────┐       │
│  │  A_ETFs       (  489) [⏳ Module 8]                  │       │
│  │  A_Distribution(1,175) [⏳ Phase 3]                  │       │
│  │  T_Chart      (   88) [⏳ Phase 2]                   │       │
│  │  T_EPS_H      (   53) [⏳ Phase 3]                   │       │
│  │  T_Growth_H   (   53) [⏳ Phase 3]                   │       │
│  │  UP & Down    (   46) [⏳ Phase 2]                   │       │
│  └───────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌─ Independent Indicator ───────────────────────────┐         │
│  │  E_Indicators (1,030) [⏳ Module 7]                 │         │
│  └─────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 3: TOOL & UI                            │
│                                                                  │
│  S_Chart      (  119) [⏳ Phase 2]                              │
│  S_Valuation  (   34) [⏳ Phase 2]                              │
│  S_Mylist     (   19) [❌ CANCELLED]                            │
└─────────────────────────────────────────────────────────────────┘
```

### Filtering Chain: 6,176 → 1,250 → 493 → 113

```
M_Company (6,176 companies)
│
├─ Filter: High Quality (Market Cap >$10B, Data Complete, Liquidity)
│  ↓
│  1,250 Pattern (7 sheets)
│  ├─ A_Company    (1,250): Growth, Valuation, Expected Return
│  ├─ T_EPS_C      (1,250): EPS Consensus FY+1/+2/+3
│  ├─ T_Growth_C   (1,250): Growth Consensus
│  ├─ T_Rank       (1,253): Ranking & Expected Return
│  ├─ T_CFO        (1,264): Cash Flow Analysis
│  ├─ T_Correlation(1,249): Correlation Analysis
│  └─ T_Chk        (1,250): EPS Update Tracking
│
├─ Filter: Industry-Specific (Within-industry comparison)
│  ↓
│  A_Compare (493 companies)
│  └─ Cost Structure: COGS, SG&A, R&D, OPM
│
├─ Filter: Cross-Industry Sampling (Cross-sector comparison)
│  ↓
│  A_Contrast (113 companies)
│  └─ Profitability, Growth, Valuation across sectors
│
├─ Filter: Chart Sampling
│  ↓
│  T_Chart (88 companies), S_Chart (119 companies)
│
└─ Filter: Valuation Tool Sampling
   ↓
   S_Valuation (34 companies)
```

### Data Flow: xlsb → CSV → JSON → Module

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Weekly Data Update                                     │
│                                                                  │
│  Global_Scouter_YYMMDD.xlsb (85 MB)                            │
│  ├─ 22 Main Sheets (M_, A_, T_, S_, E_, Special)               │
│  └─ 1,465 Individual Ticker Sheets                             │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ↓ Python Conversion Script
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: xlsb → CSV Conversion                                  │
│                                                                  │
│  scripts/simple_csv_converter.py                                │
│  ├─ Read xlsb (pyxlsb)                                          │
│  ├─ Extract 22 main sheets only                                │
│  ├─ Sheet name normalization ("T_EPS C" → "T_EPS_C")          │
│  ├─ Header row = Row 2 (skip Row 0-1 metadata)                │
│  ├─ Remove empty rows                                           │
│  └─ Save to data/csv/[SheetName].csv                           │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ↓ CSV → JSON Conversion
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: CSV → JSON Conversion                                  │
│                                                                  │
│  22 CSV files → 22 JSON files                                   │
│  ├─ M_Company.csv → data/M_Company.json                        │
│  ├─ T_EPS_C.csv → data/T_EPS_C.json                           │
│  └─ ... (20 more)                                               │
│                                                                  │
│  Encoding: UTF-8                                                │
│  Format: Array of objects [{...}, {...}, ...]                  │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ↓ Module Loading
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: JSON → Analytics Modules                               │
│                                                                  │
│  HTML → fetch('data/M_Company.json')                           │
│          ↓                                                       │
│  CompanyMasterProvider (Module 1)                               │
│  ├─ Parse JSON                                                  │
│  ├─ Build index (Ticker → Company)                             │
│  ├─ Validate fields                                             │
│  └─ Provide O(1) lookup API                                    │
│                                                                  │
│  Other Modules: EPSAnalytics, GrowthAnalytics, etc.            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  ↓ Dashboard Integration
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: Dashboard Display                                      │
│                                                                  │
│  DashboardManager                                               │
│  ├─ Tab 1: Company Master (Module 1)                           │
│  ├─ Tab 2: EPS Analytics (Sprint 4)                            │
│  ├─ Tab 3: Growth Analytics (Sprint 4)                         │
│  ├─ Tab 4: Ranking Analytics (Sprint 4)                        │
│  ├─ Tab 5: CFO Analytics (Sprint 5)                            │
│  └─ Tab 6: Correlation Engine (Sprint 5)                       │
└─────────────────────────────────────────────────────────────────┘
```

### 주차별 업데이트 워크플로우

```
Weekly Update Cycle (매주 목요일)
│
├─ User: Download Global_Scouter_YYMMDD.xlsb
│
├─ User: Run conversion script
│  $ python scripts/simple_csv_converter.py
│  ├─ Auto-detect latest xlsb
│  ├─ Convert 22 main sheets
│  ├─ Validate record counts
│  └─ Generate CSV + JSON
│
├─ System: Auto-replace JSON files
│  ├─ data/M_Company.json (overwrite)
│  ├─ data/T_EPS_C.json (overwrite)
│  └─ ... (20 more overwrites)
│
└─ User: Refresh HTML (F5)
   └─ Dashboard auto-reloads new data
```

---

(계속 Part 3으로 이어짐...)

