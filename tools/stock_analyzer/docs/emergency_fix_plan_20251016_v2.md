# 긴급 수정 계획 v2 (Emergency Fix Plan v2)

**작성일**: 2025-10-16
**작성자**: Claude Code (Sonnet 4.5)
**목적**: 로그 002.txt 기반 체계적 버그 수정

---

## 🎯 목표

캐시 클리어 후에도 발생하는 시스템 오류 완전 해결

---

## 🔍 문제 분석 (log/002.txt 기반)

### Critical Issues (즉시 수정 필요)

#### 1. Core 파일 404 에러 (5개)
```
Lines 1-5:
- DataProvider.js: 404
- ErrorBoundary.js: 404
- PerformanceMonitor.js: 404
- NavigationService.js: 404
- StateManager.js: 404
```

**원인**: HTML에서 `./core/DataProvider.js` 로딩 시도하지만 실제 경로는 다름

**해결책**:
1. 실제 core/ 디렉토리 파일 확인
2. HTML 스크립트 경로 수정

#### 2. Core 파일 ES6 Export 에러 (3개)
```
Lines 8-10:
- EventSystem.js: Unexpected token 'export'
- DataSkeleton.js: Unexpected token 'export'
- UIFramework.js: Unexpected token 'export'
```

**원인**: ES6 module이지만 `type="module"` 없이 로딩

**해결책**: HTML에 `<script type="module">` 추가

#### 3. ROE 상세 화면 표시 오류
```
Line 170: 📊 ROE 점수 계산: 0.7943000000000001 → 95.3점
```

**문제**: 점수 계산은 정상(95.3점), BUT 상세 화면에는 0.79로 표시됨

**원인**: 모달 내 ROE 표시 로직이 formatPercentage 미사용

**해결책**: 모달 ROE 표시 부분에 formatPercentage 적용

#### 4. M_Company 렌더링 에러
```
Line 140-143:
❌ Render error: TypeError: Cannot set properties of null (setting 'textContent')
    at M_Company.updateStatistics (M_Company.js:686:63)
```

**원인**: DOM 요소가 존재하지 않는 상태에서 textContent 설정 시도

**해결책**: DOM 요소 존재 확인 후 접근

#### 5. EconomicDashboard 에러
```
Line 188-193:
❌ alertCenter 업데이트 실패: component.updateAlerts is not a function
```

**원인**: EconomicAlertCenter 컴포넌트에 updateAlerts 메서드 없음

**해결책**: updateAlerts 메서드 추가 또는 호출 제거

---

## 📝 수정 작업 순서

### Phase 1: Core 파일 404 에러 수정

**Task 1.1: Core 파일 실제 위치 확인**
- [ ] `core/` 디렉토리 ls 실행
- [ ] 각 파일 존재 여부 확인
- [ ] 파일명 불일치 확인

**Task 1.2: HTML 스크립트 경로 수정**
- [ ] stock_analyzer.html 읽기
- [ ] Core 파일 로딩 부분 찾기
- [ ] 실제 파일명과 일치하도록 수정

**예상 시간**: 15분

---

### Phase 2: ES6 Export 에러 수정

**Task 2.1: Core 파일 ES6 여부 확인**
- [ ] EventSystem.js 첫 10줄 읽기
- [ ] DataSkeleton.js 첫 10줄 읽기
- [ ] UIFramework.js 첫 10줄 읽기
- [ ] export 문 사용 확인

**Task 2.2: HTML에 type="module" 추가**
- [ ] stock_analyzer.html 수정
- [ ] Core 파일 로딩에 `type="module"` 추가

**예상 시간**: 10분

---

### Phase 3: ROE 상세 화면 표시 수정

**Task 3.1: 모달 ROE 표시 로직 찾기**
- [ ] stock_analyzer_enhanced.js 검색: `modal.*ROE` 또는 `detail.*ROE`
- [ ] 해당 함수 확인

**Task 3.2: formatPercentage 적용**
- [ ] ROE 표시 부분에 formatPercentage() 적용
- [ ] 다른 퍼센티지 필드도 일괄 수정 (OPM, Sales, etc.)

**예상 시간**: 20분

---

### Phase 4: M_Company 렌더링 에러 수정

**Task 4.1: M_Company.js:686 코드 확인**
- [ ] M_Company.js 686줄 읽기
- [ ] updateStatistics 함수 확인

**Task 4.2: DOM 존재 확인 추가**
- [ ] `if (element) element.textContent = ...` 패턴 적용
- [ ] 모든 DOM 접근에 null 체크 추가

**예상 시간**: 15분

---

### Phase 5: EconomicDashboard 에러 수정

**Task 5.1: updateAlerts 호출 위치 확인**
- [ ] EconomicDashboard.js 496줄 확인
- [ ] component.updateAlerts 호출 찾기

**Task 5.2: 메서드 확인 후 수정**
- Option A: updateAlerts 메서드 추가
- Option B: 호출 제거 (alertCenter는 자동 업데이트)

**예상 시간**: 10분

---

## ✅ 검증 계획

### Test 1: Core 파일 로딩 확인
```
예상 결과:
✅ DataProvider.js 로드 성공
✅ ErrorBoundary.js 로드 성공
✅ PerformanceMonitor.js 로드 성공
✅ NavigationService.js 로드 성공
✅ StateManager.js 로드 성공
✅ EventSystem.js export 에러 없음
✅ DataSkeleton.js export 에러 없음
✅ UIFramework.js export 에러 없음
```

### Test 2: ROE 상세 화면 확인
```
1. NVDA 클릭
2. 상세 모달 확인
예상 결과: ROE 79.43% 표시 (0.79 아님)
```

### Test 3: M_Company 렌더링 확인
```
예상 결과:
✅ Render error 없음
✅ 통계 정상 표시
```

### Test 4: EconomicDashboard 확인
```
30초 후 자동 업데이트 시:
예상 결과: ✅ updateAlerts 에러 없음
```

---

## 📊 작업 예상 시간

| Phase | 작업 | 예상 시간 |
|-------|------|----------|
| 1 | Core 404 수정 | 15분 |
| 2 | ES6 Export 수정 | 10분 |
| 3 | ROE 표시 수정 | 20분 |
| 4 | M_Company 수정 | 15분 |
| 5 | EconomicDashboard 수정 | 10분 |
| **총계** | | **70분** |

---

## 🚨 작업 원칙

1. **한 Phase씩 완료 후 다음 진행**
2. **각 수정마다 TodoWrite 업데이트**
3. **모든 수정 완료 후 Git commit**
4. **사용자 브라우저 재테스트 후 최종 확인**

---

## 📁 관련 파일

- `stock_analyzer.html` - Core 로딩 수정
- `stock_analyzer_enhanced.js` - ROE 모달 표시 수정
- `modules/Momentum/M_Company.js` - 렌더링 에러 수정
- `modules/EconomicDashboard/EconomicDashboard.js` - updateAlerts 수정

---

**작성 완료**: 2025-10-16
**다음 단계**: Phase 1 착수 대기
