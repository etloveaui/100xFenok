# xlsb → CSV 변환 검증 보고서 (최종)

**검증일**: 2025-10-19
**대상**: 5개 주차 xlsb 파일 (20250912~20251010)
**목적**: Phase 0 Task 0.2 - 변환 파이프라인 검증 및 데이터 구조 완전 파악

---

## Executive Summary

xlsb 파일의 실제 구조를 완전히 파악하여 CSV 변환 파이프라인의 정확성을 검증했습니다.

**핵심 발견사항**:
1. xlsb 파일은 22개 메인 시트 + ~1,465개 개별 티커 시트로 구성 (총 ~1,487개 시트)
2. 시트명에 공백 존재: "T_EPS C", "T_Growth C" (언더스코어 아님)
3. 헤더 행이 Row 2에 위치 (Row 0-1은 메타데이터)
4. 실제 데이터 레코드 수는 시트별로 1,200~6,200개 범위
5. 5개 주차 간 주요 시트 구조는 일관성 유지

---

## Part 1: 파일 검사 결과

### 파일 존재 및 크기

| 주차 | 파일명 | 크기 | 상태 |
|------|--------|------|------|
| 2025-09-12 | Global_Scouter_20250912.xlsb | 83.98 MB | OK |
| 2025-09-19 | Global_Scouter_20250919.xlsb | 84.45 MB | OK |
| 2025-09-26 | Global_Scouter_20250926.xlsb | 84.80 MB | OK |
| 2025-10-03 | Global_Scouter_20251003.xlsb | 85.39 MB | OK |
| 2025-10-10 | Global_Scouter_20251010.xlsb | 85.80 MB | OK |

**결과**: ✅ 모든 파일 존재, 정상 크기 범위 (80-90MB), 주차별 약간의 증가 추세

### xlsb 읽기 테스트

| 주차 | 시트 수 | 상태 |
|------|---------|------|
| 2025-09-12 | 1,485 | SUCCESS |
| 2025-09-19 | 1,485 | SUCCESS |
| 2025-09-26 | 1,485 | SUCCESS |
| 2025-10-03 | 1,486 | SUCCESS |
| 2025-10-10 | 1,487 | SUCCESS |

**결과**: ✅ 모든 주차 pyxlsb로 읽기 성공

---

## Part 2: 시트 구조 분석 (2025-10-10 기준)

### 시트 카테고리 분류

| 카테고리 | 시트 수 | 설명 |
|---------|---------|------|
| **Master (M_*)** | 2 | 기업 마스터 데이터 |
| **Technical (T_*)** | 9 | 기술적 분석 지표 |
| **Advanced (A_*)** | 5 | 고급 분석 |
| **Screening (S_*)** | 3 | 스크리닝 도구 |
| **Economic (E_*)** | 1 | 경제 지표 |
| **Special** | 2 | ReadMe, UP & Down |
| **Ticker Sheets** | 1,465 | 개별 티커 상세 시트 |
| **총계** | 1,487 | |

### 22개 메인 데이터 시트 목록

**Master 시트 (2개)**:
- M_Company: 기업 마스터 정보
- M_ETFs: ETF 마스터 정보

**Technical 시트 (9개)**:
- T_CFO: CFO (Cash Flow from Operations) 분석
- T_Chart: 차트 데이터
- T_Chk: 체크리스트
- T_Correlation: 상관관계 분석
- **T_EPS C**: EPS (Earnings Per Share) - Consensus 기준
- **T_EPS H**: EPS - Historical 기준
- **T_Growth C**: 성장률 - Consensus 기준
- **T_Growth H**: 성장률 - Historical 기준
- T_Rank: 순위 분석

**Advanced 시트 (5개)**:
- A_Company: 기업 고급 분석
- A_Compare: 비교 분석
- A_Contrast: 대조 분석
- A_Distribution: 분포 분석
- A_ETFs: ETF 고급 분석

**Screening 시트 (3개)**:
- S_Chart: 차트 스크리닝
- S_Mylist: 관심 종목 리스트
- S_Valuation: 밸류에이션 스크리닝

**Economic 시트 (1개)**:
- E_Indicators: 경제 지표

**Special 시트 (2개)**:
- ReadMe: 설명 문서
- UP & Down: 등락 분석

---

## Part 3: 데이터 구조 상세 분석

### Critical Finding: 헤더 행 위치

**모든 메인 시트의 구조**:
```
Row 0: 메타데이터 (시트 참조, 업데이트 날짜 등)
Row 1: 메타데이터 (추가 설명)
Row 2: 실제 헤더 행 (Ticker, Corp, Exchange, ...)
Row 3+: 데이터 행
```

**이는 CSV 변환 시 반드시 고려해야 함**:
- 헤더 행 = Row 2 (0-indexed)
- 데이터 시작 = Row 3
- Row 0-1은 변환 시 제외 또는 별도 처리

### 주요 시트별 구조 (2025-10-10 기준)

#### M_Company (기업 마스터)
```yaml
Total rows (raw): 1,048,575 (Excel 최대)
Actual data rows: ~6,200
Header row: Row 2
Fields: 34 fields
Key fields: Ticker, Corp, Exchange, WI26, Price, Market Cap, ROE, OPM
Encoding: 한글 정상 (기업정보, 종목명, 국가 등)
```

#### A_Company (고급 분석)
```yaml
Total rows (raw): 1,048,576
Actual data rows: ~1,250
Header row: Row 2
Fields: 52 fields
Key fields: Ticker, Corp, Exchange, WI26, FY 0, Price, Market Cap
Data quality: 20분 지연 시세, 일본/상해는 기준일자 데이터
```

#### T_EPS C (EPS Consensus)
```yaml
Sheet name: "T_EPS C" (공백 주의! 언더스코어 아님)
Status: Sheet exists (이전 검증 스크립트 오류)
Estimated data rows: ~1,250
Fields: EPS 관련 지표
```

#### T_Growth C (성장률 Consensus)
```yaml
Sheet name: "T_Growth C" (공백 주의!)
Estimated data rows: ~1,250
Fields: Growth rate 관련 지표
```

#### T_Rank (순위)
```yaml
Total rows (raw): 1,048,576
Actual data rows: ~1,250
Header row: Row 2
Fields: 38 fields
```

#### T_CFO (CFO 분석)
```yaml
Total rows: 1,297
Actual data rows: 1,294
Header row: Row 2
Fields: 38 fields
Clean structure: 실제 데이터만 포함
```

#### T_Correlation (상관관계)
```yaml
Total rows: 1,257
Actual data rows: 1,254
Header row: Row 2
Fields: 42 fields
Clean structure: 실제 데이터만 포함
```

#### S_Mylist (관심 종목)
```yaml
Total rows (raw): 1,048,576
Actual data rows: 사용자가 등록한 만큼 (가변)
Header row: Row 2
Fields: 59 fields
Purpose: 사용자 관심 종목 저장용
```

---

## Part 4: 주차별 일관성 검증

### 시트 수 추이

| 주차 | 시트 수 | 변화 |
|------|---------|------|
| 2025-09-12 | 1,485 | Baseline |
| 2025-09-19 | 1,485 | No change |
| 2025-09-26 | 1,485 | No change |
| 2025-10-03 | 1,486 | +1 (45933 티커 추가) |
| 2025-10-10 | 1,487 | +1 (45940 티커 추가) |

**분석**:
- 메인 시트 22개는 모든 주차 동일
- 주차별 변화는 티커 시트 추가/제거
- 예: SKX, TU 티커 제거, 45919/45926/45933/45940 티커 추가

### 필드 구조 일관성

**검증 결과**:
- M_Company: 모든 주차 34 fields (일관성 유지)
- A_Company: 모든 주차 52 fields (일관성 유지)
- T_* 시트: 필드 수 일관성 유지
- 필드명 변경: 업데이트 날짜만 변경 (예: "25/09/12 기준" → "25/10/10 기준")

**결론**: ✅ 메인 시트 구조는 주차별로 안정적

---

## Part 5: 인코딩 및 포맷 검증

### 한글 처리

**테스트 샘플** (M_Company, Week 2025-10-10):
```
Record 1: '기업정보' (Korean OK)
Record 2: 'Ticker' (English)
Record 3: 'NVDA' (Ticker code)
```

**결과**: ✅ 한글 인코딩 정상, pyxlsb UTF-8 처리 문제없음

### 날짜 포맷

**메타데이터 행** (Row 0-1):
- "※ 25/10/10 기준 데이터"
- 주차별 업데이트 날짜 자동 반영

**주의사항**:
- 메타데이터는 CSV 변환 시 별도 처리 필요
- 또는 Row 2부터 변환 시작 (헤더)

---

## Part 6: 발견된 문제점 및 권장사항

### Critical Issues (🔴)

**1. 시트명 불일치**
- **문제**: "T_EPS C", "T_Growth C" (공백 포함)
- **현재 CSV**: T_EPS_C.csv, T_Growth_C.csv (언더스코어)
- **영향**: 자동 변환 스크립트 실패 가능
- **해결**:
  - Option A: 변환 시 시트명 정규화 (공백 → 언더스코어)
  - Option B: CSV 파일명을 시트명에 맞춤 ("T_EPS C.csv")

**2. 헤더 행 위치 (Row 2)**
- **문제**: Row 0-1은 메타데이터
- **영향**: 변환 스크립트가 Row 0을 헤더로 오인식 가능
- **해결**: skip_rows=2 또는 header=2 옵션 사용

**3. Excel 최대 행 수 (1,048,575)**
- **문제**: M_Company, A_Company 등이 Excel 행 한계에 도달
- **영향**: 실제 데이터 행 수 파악 어려움
- **해결**: 빈 행 스킵 로직 필요

### Medium Issues (🟡)

**1. 티커 시트 1,465개 처리**
- **문제**: 변환 시 1,465개 개별 시트 어떻게 처리?
- **권장**:
  - 메인 22개 시트만 변환 (우선)
  - 티커 시트는 필요 시 별도 처리

**2. S_Mylist 사용자 데이터**
- **문제**: 사용자가 등록한 데이터, 비어있을 가능성
- **권장**: 변환 전 데이터 존재 여부 체크

### Low Issues (🟢)

**1. 메타데이터 보존**
- Row 0-1의 업데이트 날짜, 설명 등 유실 가능
- 권장: 별도 메타데이터 파일 생성 또는 JSON 필드로 저장

**2. 주차별 티커 변동**
- 일부 티커 추가/삭제 (SKX → 45919 등)
- 권장: 티커 변동 추적 로그

---

## Part 7: 변환 스크립트 개선 권장사항

### 필수 개선사항 (Priority 1)

1. **시트명 정규화**
   ```python
   # 공백을 언더스코어로 변환
   csv_filename = sheet_name.replace(' ', '_') + '.csv'
   ```

2. **헤더 행 올바르게 지정**
   ```python
   # pandas 예시
   df = pd.read_excel(xlsb_file, sheet_name=sheet, header=2)
   # 또는 pyxlsb
   rows = list(ws.rows())
   header = rows[2]  # Row 2가 헤더
   data = rows[3:]   # Row 3부터 데이터
   ```

3. **빈 행 제거**
   ```python
   # 모든 필드가 비어있는 행 제거
   df = df.dropna(how='all')
   ```

4. **메인 시트 필터링**
   ```python
   MAIN_SHEETS = ['M_Company', 'M_ETFs', 'A_Company', 'A_Compare',
                  'T_EPS C', 'T_Growth C', 'T_Rank', 'T_CFO', 'T_Correlation',
                  'S_Mylist', ...]
   # 메인 시트만 변환
   sheets_to_convert = [s for s in wb.sheets if s in MAIN_SHEETS]
   ```

### 권장 개선사항 (Priority 2)

1. **자동 검증 로직**
   ```python
   # 변환 후 자동 검증
   expected_sheets = 22
   expected_records = {
       'M_Company': (5500, 6500),
       'T_CFO': (1200, 1400),
       'T_Correlation': (1200, 1400),
   }
   ```

2. **메타데이터 보존**
   ```python
   # Row 0-1을 별도 메타데이터로 저장
   metadata = {
       'update_date': rows[0][1],  # "25/10/10 기준"
       'description': rows[0][2],
   }
   ```

3. **한글 인코딩 검증**
   ```python
   # 변환 후 한글 필드 샘플 체크
   korean_fields = ['Corp', 'WI26', '국가', '업종']
   for field in korean_fields:
       assert any('\uac00' <= c <= '\ud7a3' for c in df[field].iloc[0])
   ```

---

## Part 8: 자동 검증 파이프라인 제안

### Pipeline 구조

```
1. xlsb 파일 검사
   ├─ 파일 존재 여부
   ├─ 파일 크기 (80-90MB)
   └─ pyxlsb 읽기 가능

2. 시트 구조 검증
   ├─ 메인 시트 22개 존재
   ├─ 시트명 정확성
   └─ 티커 시트 수 (1,460-1,500)

3. 변환 실행
   ├─ 메인 22개 시트만 변환
   ├─ 헤더 행 = Row 2
   ├─ 빈 행 제거
   └─ 시트명 정규화 (공백 → 언더스코어)

4. 변환 결과 검증
   ├─ CSV 파일 22개 생성 확인
   ├─ 레코드 수 범위 체크
   ├─ 필드 수 일치
   ├─ 한글 인코딩 정상
   └─ JSON 변환 성공

5. 주차별 비교
   ├─ 시트 구조 변경 감지
   ├─ 필드 추가/삭제 알림
   └─ 레코드 수 추세 모니터링

6. 리포트 생성
   └─ 변환 품질 리포트 자동 생성
```

### 검증 기준

| 항목 | 기준 | 조치 |
|------|------|------|
| 파일 크기 | 80-90 MB | 범위 벗어나면 경고 |
| 시트 수 | 1,480-1,500 | 급격한 변화 시 알림 |
| M_Company 레코드 | 5,500-6,500 | 범위 벗어나면 검증 |
| T_CFO 레코드 | 1,200-1,400 | 범위 벗어나면 검증 |
| T_Correlation 레코드 | 1,200-1,400 | 범위 벗어나면 검증 |
| 필드 수 (M_Company) | 34 | 변경 시 알림 |
| 한글 인코딩 | 정상 | 깨짐 시 중단 |

---

## 결론

### 검증 결과: ✅ **VALIDATION PASSED WITH CRITICAL FINDINGS**

### 주요 발견사항 요약

1. ✅ 5개 주차 모두 xlsb 파일 정상, 읽기 성공
2. ✅ 메인 22개 시트 구조 주차별 일관성 유지
3. ✅ 한글 인코딩 정상, UTF-8 처리 문제없음
4. 🔴 **Critical**: 시트명에 공백 존재 ("T_EPS C", "T_Growth C")
5. 🔴 **Critical**: 헤더 행이 Row 2에 위치 (Row 0-1은 메타데이터)
6. 🔴 **Critical**: Excel 최대 행 수로 인한 실제 데이터 행 수 파악 어려움
7. 🟡 **Medium**: 1,465개 티커 시트 처리 방안 필요
8. 🟡 **Medium**: S_Mylist 비어있을 가능성

### 다음 단계

**Immediate Actions (Task 0.3)**:
1. 변환 스크립트 수정:
   - 시트명 정규화 (공백 → 언더스코어)
   - header=2 지정
   - 빈 행 제거 로직
   - 메인 22개 시트만 변환

2. 변환 스크립트 재실행 및 검증

**Follow-up Actions (Task 0.4)**:
1. 자동 검증 파이프라인 구축
2. 주차별 비교 자동화
3. 변환 품질 리포트 자동 생성
4. CI/CD 파이프라인 통합

### 권장사항

**변환 스크립트 개선 우선순위**:
1. 🔴 헤더 행 위치 수정 (가장 중요)
2. 🔴 시트명 정규화
3. 🔴 빈 행 제거
4. 🟡 메인 시트 필터링
5. 🟢 메타데이터 보존

**검증 자동화 우선순위**:
1. 🔴 레코드 수 범위 체크
2. 🔴 필드 수 일치 검증
3. 🟡 한글 인코딩 자동 검증
4. 🟡 주차별 변경 추적
5. 🟢 티커 변동 로그

---

**보고서 작성일**: 2025-10-19
**검증 도구**: Python 3.x, pyxlsb
**검증 대상**: Global_Scouter xlsb files (5 weeks)
**작성자**: Claude Code Validation Script
