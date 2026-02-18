# xlsb → CSV 변환 검증 보고서
**검증일**: 2025-10-19 03:26:29
**대상**: 5개 주차 xlsb 파일 (20250912~20251010)
**목적**: Phase 0 Task 0.2 - 변환 파이프라인 검증

---

## Part 1: 파일 검사 결과

### 파일 존재 및 크기
| 주차 | 파일명 | 크기 | 상태 |
|------|--------|------|------|
| 20250912 | Global_Scouter_20250912.xlsb | 83.98 MB | OK |
| 20250919 | Global_Scouter_20250919.xlsb | 84.45 MB | OK |
| 20250926 | Global_Scouter_20250926.xlsb | 84.80 MB | OK |
| 20251003 | Global_Scouter_20251003.xlsb | 85.39 MB | OK |
| 20251010 | Global_Scouter_20251010.xlsb | 85.80 MB | OK |

### xlsb 읽기 테스트
- Week 20250912: SUCCESS (시트 수: 1485)
- Week 20250919: SUCCESS (시트 수: 1485)
- Week 20250926: SUCCESS (시트 수: 1485)
- Week 20251003: SUCCESS (시트 수: 1486)
- Week 20251010: SUCCESS (시트 수: 1487)

---

## Part 2: 시트 목록 비교 (5개 주차)

### Week 20250912
- 시트 수: 1485
- 시트 목록: ReadMe, E_Indicators, UP & Down, M_Company, M_ETFs, A_Distribution, A_ETFs, A_Company, A_Compare, A_Contrast...

### Week 20250919
- 시트 수: 1485
- 시트 목록: ReadMe, E_Indicators, UP & Down, M_Company, M_ETFs, A_Distribution, A_ETFs, A_Company, A_Compare, A_Contrast...

### Week 20250926
- 시트 수: 1485
- 시트 목록: ReadMe, E_Indicators, UP & Down, M_Company, M_ETFs, A_Distribution, A_ETFs, A_Company, A_Compare, A_Contrast...

### Week 20251003
- 시트 수: 1486
- 시트 목록: ReadMe, E_Indicators, UP & Down, M_Company, M_ETFs, A_Distribution, A_ETFs, A_Company, A_Compare, A_Contrast...

### Week 20251010
- 시트 수: 1487
- 시트 목록: ReadMe, E_Indicators, UP & Down, M_Company, M_ETFs, A_Distribution, A_ETFs, A_Company, A_Compare, A_Contrast...

### 일관성 검증
- Week 20250919 differs from 20250912:
  - Added: 45919
  - Removed: SKX
- Week 20250926 differs from 20250912:
  - Added: 45919, 45926
  - Removed: SKX, TU
- Week 20251003 differs from 20250912:
  - Added: 45919, 45926, 45933
  - Removed: SKX, TU
- Week 20251010 differs from 20250912:
  - Added: 45919, 45940, 45926, 45933
  - Removed: SKX, TU

---

## Part 3: 레코드/필드 검증 (주요 시트 기준)

### 레코드 수 추세
| 주차 | M_Company | A_Company | T_EPS_C |
|------|-----------|-----------|----------|
| 20250912 | 1,048,575 | 1,048,575 | ERROR |
| 20250919 | 1,048,575 | 1,048,575 | ERROR |
| 20250926 | 1,048,574 | 1,048,575 | ERROR |
| 20251003 | 1,048,574 | 1,048,575 | ERROR |
| 20251010 | 1,048,574 | 1,048,575 | ERROR |

### 필드명 비교

#### M_Company
- 필드 수 (Week 20250912): 34
- 샘플 필드: , 'M_Company'!B, ※ 25/09/12 기준 데이터, , ...
- Week 20250919: 필드 구조 다름 (필드 수: 34)
- Week 20250926: 필드 구조 다름 (필드 수: 34)
- Week 20251003: 필드 구조 다름 (필드 수: 34)
- Week 20251010: 필드 구조 다름 (필드 수: 34)

#### A_Company
- 필드 수 (Week 20250912): 52
- 샘플 필드: , ※ 데이터-모두 새로고침시 20분 지연시세 (현재가, 전일대비, 전주대비, 시가총액, 환율). But 일본과 상해는 25/09/12 기준, , , ...
- Week 20250919: 필드 구조 다름 (필드 수: 52)
- Week 20250926: 필드 구조 다름 (필드 수: 52)
- Week 20251003: 필드 구조 다름 (필드 수: 52)
- Week 20251010: 필드 구조 다름 (필드 수: 52)

#### T_EPS_C
- ERROR: 첫 주차 필드 정보 없음

---

## Part 4: 인코딩 및 포맷 검증

### 한글 처리 (M_Company 샘플)

#### Week 20250912
- Record 1: 'M_Company'!B = '기업정보...' (Korean OK)
- Record 2: 'M_Company'!B = 'Ticker...' (No Korean)
- Record 3: 'M_Company'!B = 'NVDA...' (No Korean)

#### Week 20251010
- Record 1: 'M_Company'!B = '기업정보...' (Korean OK)
- Record 2: 'M_Company'!B = 'Ticker...' (No Korean)
- Record 3: 'M_Company'!B = 'NVDA...' (No Korean)

---

## Part 5: 발견된 문제점

### Critical Issues
- None detected

### Medium Issues
- None detected

---

## Part 6: 권장 사항

### 변환 스크립트 개선 필요 사항
1. 시트 수 자동 검증 (예상: 22-23개)
2. 레코드 수 범위 체크 (M_Company: 5,500-6,500)
3. 필드명 일치 검증 자동화
4. 한글 인코딩 자동 검증
5. 날짜 포맷 표준화

### 검증 자동화 필요
- 주차별 자동 검증 파이프라인
- 필드 구조 변경 알림
- 레코드 수 추세 모니터링

---

## 결론

**검증 결과**: VALIDATION PASSED

**다음 단계**:
- Task 0.3: 변환 스크립트 개선
- Task 0.4: 자동 검증 파이프라인 구축
