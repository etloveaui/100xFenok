# Data Utilization Strategy
## Global Scouter 22개 CSV 파일 활용 전략

**작성일**: 2025-10-17
**기반**: CSV 심층 분석 결과 (21개 파일 분석 완료)
**목표**: 데이터 기반 의사결정 지원 및 투자 인사이트 제공

---

## 1. Executive Summary

### 분석 대상
- **총 파일**: 21개 CSV 파일
- **총 레코드**: 18,721행
- **카테고리**: Main(2), Technical(9), Analysis(4), Market(4), Indicators(2)

### 티어 분류 (활용 우선순위)
- **S Tier (최우선)**: 5개 파일 - 즉시 구현
- **A Tier (우선)**: 5개 파일 - 다음 스프린트
- **B Tier (중요)**: 10개 파일 - 추가 기능
- **C Tier (보통)**: 1개 파일 - 선택적 구현

---

## 2. S Tier: 즉시 구현 (Sprint 4-6)

### 2.1 M_Company.csv ✅ IMPLEMENTED
**현황**: Sprint 3에서 6175개 기업 로딩 완료

**데이터 규모**: 6178행, 34컬럼
**Quality Score**: 91.0/100
**Importance**: 110 (최고)

**현재 활용**:
- 전체 기업 데이터의 메인 소스
- 기본 재무 지표, 거래소, 업종 정보 제공
- 검색, 필터링, 정렬의 핵심 데이터

**추가 활용 계획**:
- 시계열 데이터 분석 (컬럼 45933, 45926 등 날짜 코드 활용)
- 업종별 벤치마킹
- 모멘텀 점수 시각화

---

### 2.2 T_Rank.csv - Sprint 4 구현 예정
**데이터 규모**: 1252행, 38컬럼
**Quality Score**: 93.6/100
**Importance**: 80

**활용 전략**:
1. **Ranking Dashboard 구축**
   - 다양한 지표별 순위 시각화
   - 사용자 커스텀 랭킹 생성 기능
   - 순위 변화 추이 분석

2. **구현 계획**:
   - Sprint 4 Task 4.4: Ranking Module 추가
   - 파일: `modules/RankingAnalytics.js`
   - 기능:
     - 멀티 지표 랭킹 (ROE, OPM, Growth, etc.)
     - 업종 내 랭킹
     - 커스텀 가중치 랭킹

---

### 2.3 T_Growth_C.csv - Sprint 4 ⏳ IN PROGRESS
**데이터 규모**: 1252행, 50컬럼
**Quality Score**: 92.8/100
**Importance**: 80

**활용 전략**:
1. **Growth Analytics Module** ✅ 구현 완료
   - 7년/3년 성장률 비교 (Sales, OP, EPS)
   - 업종별 평균 성장률
   - 고성장 기업 필터링

2. **시각화**:
   - Bar Chart: 기업별 성장률 비교
   - Line Chart: 성장률 트렌드
   - Scatter Plot: 성장률 vs 밸류에이션

---

### 2.4 T_EPS_C.csv - Sprint 5 구현 예정
**데이터 규모**: 1252행, 41컬럼
**Quality Score**: 93.4/100
**Importance**: 80

**활용 전략**:
1. **EPS Analytics Module**
   - EPS 성장률 분석 (7년/3년)
   - PER 밴드 차트
   - Earnings Quality 분석

2. **구현 계획**:
   - Sprint 5 Task 5.1: EPS Module 추가
   - 파일: `modules/EPSAnalytics.js`
   - 통합: GrowthAnalytics와 결합된 대시보드

---

### 2.5 T_CFO.csv - Sprint 5 구현 예정
**데이터 규모**: 1266행, 36컬럼
**Quality Score**: 92.9/100
**Importance**: 80

**활용 전략**:
1. **Cash Flow Analytics Module**
   - Operating Cash Flow 트렌드
   - FCF (Free Cash Flow) 계산 및 시각화
   - Cash Conversion Cycle 분석
   - 현금흐름 건전성 점수

2. **구현 계획**:
   - Sprint 5 Task 5.2: CFO Module 추가
   - 파일: `modules/CashFlowAnalytics.js`
   - 기능:
     - CFO 트렌드 차트
     - FCF Yield 계산
     - Working Capital 분석

---

## 3. A Tier: 다음 우선 (Sprint 6-9)

### 3.1 A_Company.csv
**데이터 규모**: 1252행, 52컬럼
**Quality Score**: 93.8/100
**Importance**: 75

**활용 전략**:
- M_Company와 교차 검증
- 분석 대상 기업 필터링
- 추가 메타데이터 활용

**구현 계획**: Sprint 6

---

### 3.2 T_Chk.csv (체크리스트)
**데이터 규모**: 1252행, 78컬럼
**Quality Score**: 86.2/100
**Importance**: 75

**활용 전략**:
1. **Investment Checklist Dashboard**
   - 78개 체크리스트 항목 시각화
   - Pass/Fail 요약
   - 점수화 및 랭킹

2. **Quality Filter 구축**:
   - 고품질 기업 자동 선별
   - 리스크 요인 경고

**구현 계획**: Sprint 7

---

### 3.3 E_Indicators.csv (경제 지표)
**데이터 규모**: 1032행, 68컬럼
**Quality Score**: 33.5/100 (저품질 - 데이터 정제 필요)
**Importance**: 75

**활용 전략**:
1. **Macro Dashboard**
   - 1032개 경제 지표 시각화
   - 거시경제 트렌드 분석
   - 섹터별 경제 지표 상관관계

2. **데이터 정제 필요**:
   - Null 값 66.5% - 유효 데이터 필터링
   - 중요 지표 우선순위화
   - 시계열 데이터 검증

**구현 계획**: Sprint 10 (MASTER_EXPANSION_PLAN 따름)

---

### 3.4 T_Correlation.csv (상관관계)
**데이터 규모**: 1251행, 42컬럼
**Quality Score**: 13.9/100 (매우 저품질)
**Importance**: 65

**활용 전략**:
1. **Correlation Matrix 시각화**
   - 기업 간 상관관계 히트맵
   - 포트폴리오 다각화 분석
   - 유사 기업 추천

2. **데이터 품질 개선 필수**:
   - Null 값 86.1% - 심각한 데이터 부족
   - 유효 데이터만 추출하여 활용
   - 대체 데이터 소스 검토

**구현 계획**: Sprint 6 (데이터 정제 후)

---

### 3.5 A_Distribution.csv (분포 분석)
**데이터 규모**: 1177행, 61컬럼
**Quality Score**: 23.7/100 (저품질)
**Importance**: 60

**활용 전략**:
1. **Distribution Dashboard**
   - 밸류에이션 분포 (PER, PBR)
   - 재무 지표 분포 (ROE, OPM)
   - 이상치 탐지

2. **데이터 정제**:
   - Null 76.3% - 유효 데이터 필터링
   - Percentile 계산
   - Z-Score 분석

**구현 계획**: Sprint 8

---

## 4. B Tier: 추가 기능 (Sprint 10+)

### 4.1 T_Growth_H.csv (성장률 History)
**데이터 규모**: 55행, 21컬럼
**Quality Score**: 51.2/100
**Importance**: 55

**활용 전략**:
- 55개 핵심 기업의 과거 성장률 트렌드
- Time Series 차트
- Forecast 모델 학습 데이터

**구현 계획**: Sprint 4 (간단한 시계열 차트)

---

### 4.2 T_EPS_H.csv (EPS History)
**데이터 규모**: 55행, 22컬럼
**Quality Score**: 54.9/100
**Importance**: 55

**활용 전략**:
- EPS 과거 추이 분석
- Earnings Surprise 분석
- Growth Rate 계산

**구현 계획**: Sprint 5

---

### 4.3 A_Compare.csv (기업 비교)
**데이터 규모**: 495행, 79컬럼
**Quality Score**: 9.1/100 (불량)
**Importance**: 50

**활용 전략**:
- Deep Compare 모듈 강화
- 79개 비교 지표 추가
- 데이터 정제 필수 (Null 90.9%)

**구현 계획**: Sprint 7 (데이터 정제 후)

---

### 4.4 A_Contrast.csv (대조 분석)
**데이터 규모**: 115행, 98컬럼
**Quality Score**: 50.2/100
**Importance**: 55

**활용 전략**:
- 경쟁사 대조 분석
- 강점/약점 시각화
- 98개 대조 지표 활용

**구현 계획**: Sprint 7

---

### 4.5 기타 B Tier 파일
- **T_Chart.csv** (90행, 80컬럼): 차트 데이터, Quality 25.8
- **A_ETFs.csv** (491행, 151컬럼): ETF 데이터, Quality 0.0 (불량)
- **S_Mylist.csv** (21행, 59컬럼): 관심 종목, Quality 92.6 (고품질)
- **S_Valuation.csv** (36행, 48컬럼): 밸류에이션, Quality 90.9 (고품질)
- **M_ETFs.csv** (30행, 44컬럼): 모멘텀 ETF, Quality 66.5
- **S_Chart.csv** (121행, 82컬럼): 차트 스냅샷, Quality 44.0

**공통 활용 전략**:
- 소규모 데이터 → 특수 기능으로 활용
- 사용자 개인화 기능에 적합
- Sprint 9-12에 선택적 구현

---

## 5. C Tier: 선택적 구현

### 5.1 UP_&_Down.csv (등락 데이터)
**데이터 규모**: 48행, 188컬럼
**Quality Score**: 31.6/100
**Importance**: 30

**활용 전략**:
- 등락률 시각화
- 변동성 분석
- 데이터 품질 개선 필요 (Null 68.4%)

**구현 계획**: Sprint 12+ (선택적)

---

## 6. 구현 로드맵 (통합)

### Phase 4-1: Technical Data (Sprint 4-6, 6주)
**Sprint 4 (현재)**:
- ✅ GrowthAnalytics.js 기본 구현
- ⏳ RankingAnalytics.js 추가
- ⏳ T_Growth_H 시계열 차트

**Sprint 5**:
- EPSAnalytics.js 구현
- CashFlowAnalytics.js 구현
- T_EPS_H 통합

**Sprint 6**:
- T_Correlation 정제 및 시각화
- A_Company 교차 검증
- Correlation Matrix 대시보드

---

### Phase 4-2: Analysis Data (Sprint 7-9, 6주)
**Sprint 7**:
- T_Chk 체크리스트 Dashboard
- A_Compare 데이터 정제 및 통합
- A_Contrast 대조 분석

**Sprint 8**:
- A_Distribution 분포 분석 Dashboard
- Percentile 계산 및 시각화
- 이상치 탐지

**Sprint 9**:
- Market Data 통합 (S_Chart, S_Mylist, S_Valuation)
- 사용자 관심 종목 기능
- ETF 분석 (A_ETFs, M_ETFs)

---

### Phase 4-3: Economic Indicators (Sprint 10, 2주)
**Sprint 10**:
- E_Indicators 데이터 정제
- Macro Dashboard 구축
- 1032개 경제 지표 중 핵심 50개 우선 시각화

---

### Phase 5: AI & Automation (Sprint 11-15, 10주)
**Sprint 11**: AI 스크리닝
**Sprint 12**: Real-time 업데이트
**Sprint 13**: Backtesting
**Sprint 14**: 3D Visualization
**Sprint 15**: Mobile PWA

---

## 7. 데이터 품질 개선 계획

### 저품질 파일 (Quality < 50)
1. **A_ETFs.csv** (0.0) - 전면 재검토 필요
2. **A_Compare.csv** (9.1) - 90.9% Null, 데이터 소스 확인
3. **T_Correlation.csv** (13.9) - 86.1% Null, 유효 데이터만 추출
4. **A_Distribution.csv** (23.7) - 76.3% Null, 정제 필요
5. **T_Chart.csv** (25.8) - 74.2% Null, 선택적 활용
6. **UP_&_Down.csv** (31.6) - 68.4% Null, 우선순위 낮음
7. **E_Indicators.csv** (33.5) - 66.5% Null, 핵심 지표만 추출

### 개선 전략
1. **자동화된 데이터 정제 파이프라인**
   - Null 값 처리 (Drop vs Impute)
   - 이상치 탐지 및 수정
   - 데이터 타입 표준화

2. **품질 모니터링**
   - 주간 데이터 업데이트 시 품질 체크
   - Quality Score 추이 모니터링
   - 임계값 이하 시 알림

---

## 8. 기술 스택 및 도구

### 현재 사용 중
- **Frontend**: JavaScript, Chart.js, Bootstrap
- **Data Processing**: Pandas (Python)
- **Automation**: Python scripts

### 추가 필요 도구
- **Time Series Visualization**: Plotly.js or D3.js
- **Statistical Analysis**: NumPy, SciPy
- **Machine Learning** (Sprint 11+): TensorFlow.js or ONNX.js
- **Real-time Data**: WebSocket or Server-Sent Events

---

## 9. Success Metrics

### Sprint 4-6 (Phase 4-1)
- ✅ 5개 S Tier 파일 100% 활용
- 📈 사용자 인사이트 50% 증가
- ⚡ 데이터 로딩 < 3초 유지
- 🎯 Quality Score ≥ 95.0 유지

### Sprint 7-9 (Phase 4-2)
- ✅ 5개 A Tier 파일 80% 활용
- 📊 분석 기능 5개 추가
- 🔍 검색 정확도 30% 향상

### Sprint 10+ (Phase 4-3 & 5)
- ✅ 전체 21개 파일 중 18개 활용 (85%)
- 🤖 AI 기능 3개 추가
- 📱 Mobile 지원 완료

---

## 10. Risk & Mitigation

### Risk 1: 저품질 데이터
**영향**: 분석 정확도 저하
**완화**:
- 데이터 정제 파이프라인 우선 구축
- 유효 데이터만 활용
- 품질 모니터링 자동화

### Risk 2: 데이터 크기 증가
**영향**: 성능 저하
**완화**:
- Lazy Loading 전략
- 인덱싱 최적화
- CDN 사용 검토

### Risk 3: 업데이트 빈도
**영향**: 데이터 신선도 저하
**완화**:
- 자동화 스크립트 (automation_master.py) 활용
- 주간 업데이트 프로세스 확립
- 변경 사항 알림

---

## 11. Next Actions (즉시 실행)

1. ✅ **automation_master.py** 완성 - XLSB → CSV → JSON 자동화
2. ✅ **csv_analysis_deep.py** 실행 - 21개 파일 분석 완료
3. ⏳ **Sprint 4 완료**:
   - GrowthAnalytics.js 통합 테스트
   - RankingAnalytics.js 구현
   - Task 4.3: Integrated Dashboard

4. **Sprint 5 준비**:
   - EPSAnalytics.js 설계
   - CashFlowAnalytics.js 설계
   - Chart.js 확장 라이브러리 조사

5. **데이터 품질 개선**:
   - 저품질 7개 파일 정제 계획 수립
   - 자동 정제 스크립트 작성

---

**문서 버전**: 1.0
**최종 업데이트**: 2025-10-17
**작성자**: Claude (fenomeno-auto-v9)
**승인 대기**: User Review Required
