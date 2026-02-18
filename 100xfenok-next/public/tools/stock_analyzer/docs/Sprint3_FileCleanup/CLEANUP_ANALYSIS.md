# 파일 정리 작업 - As-Is Analysis
**작업일**: 2025-10-18
**목적**: 잘못된 경로 파일 정리 및 문서 체계화

---

## 🎯 문제 정의

### Issue 1: 잘못된 경로에 파일 산재
**현상**:
- 정상 작업 경로: `projects/100xFenok/tools/stock_analyzer`
- 잘못된 경로 1: `fenomeno_projects/20251015_Stock_Prompt_Claude`
- 잘못된 경로 2: `fenomeno_projects/Global_Scouter`

**원인**:
- 이전 Claude 세션에서 잘못된 경로에서 작업
- 경로 인식 오류로 중복 파일 생성

### Issue 2: docs 폴더 문서 과다
**현상**:
- docs 폴더: **47개 파일**
- Sprint별 중복 (SPRINT_2, 3, 4, 5...)
- Architecture 중복 (7개)
- 임시/긴급 문서 (emergency_fix...)

**목표**:
- docs 폴더: **10개 이하 핵심 문서**
- 나머지 → `reports/` 또는 삭제

### Issue 3: 티커 수량 불일치
**현상**:
- 사용자 보고: 6,000개 기업 데이터
- 시스템 표시: 1,249개 티커
- 테스트 코드: 1,249개 사용

**조사 필요**:
- 실제 데이터 파일 확인
- 6,000 vs 1,249 원인 규명

---

## 📊 파일 현황 분석

### 1. 정상 작업 폴더
**경로**: `projects/100xFenok/tools/stock_analyzer`

**핵심 파일**:
- ✅ stock_analyzer.html (메인)
- ✅ stock_analyzer_enhanced.js (메인 로직)
- ✅ modules/ (25개 모듈)
- ✅ data/ (JSON 데이터)
- ✅ tests/ (Sprint4/5 테스트)
- ✅ docs/ (47개 문서 - 정리 필요)

**상태**: **정상 - 정리만 필요**

---

### 2. 잘못된 경로 1
**경로**: `fenomeno_projects/20251015_Stock_Prompt_Claude`

**파일 목록**:
```
📄 문서 (6개):
- ARCHITECTURE_DIAGRAM.md
- DASHBOARD_INTEGRATION_GUIDE.md
- DELIVERY_PACKAGE.md
- QUICK_START.md
- README.md
- SPRINT4_IMPLEMENTATION_SUMMARY.md

💻 소스코드:
- stock_analyzer.html (중복)

📁 js/:
- DashboardManager.js
```

**판단**:
- 🔴 **중복 소스**: stock_analyzer.html → 삭제
- 📋 **문서 6개**: 내용 확인 후 필요시 정상 폴더로 이동 또는 삭제
- 💻 **js/**: DashboardManager.js 필요 여부 확인

**최종 결정**: 전체 폴더 삭제 예정 (문서 이동 후)

---

### 3. 잘못된 경로 2
**경로**: `fenomeno_projects/Global_Scouter`

**파일 목록**:
```
🧪 테스트:
- tests/e2e/ (Sprint4/5 테스트 - 중복)

📄 문서:
- claudedocs/SPRINT5_70K_SCALE_WORKFLOW.md
- claudedocs/sprint5-integration-test-fixes.md

📊 분석:
- csv_analysis_results.json (354KB)

🐍 Python:
- automation_master.py
- csv_analysis_deep.py
- root_cause_analysis.py

💾 대용량:
- Global_Scouter_*.zip (250MB+)
- *.xlsb 파일
```

**판단**:
- 🔴 **테스트 중복**: tests/e2e/ → 삭제 (정상 폴더에 있음)
- 📋 **문서 2개**: 내용 확인 후 필요시 이동
- 📊 **분석 JSON**: 필요 여부 확인
- 🐍 **Python 스크립트**: stock_analyzer 프로젝트와 관련 없음 → 삭제
- 💾 **대용량 zip**: 확실히 불필요 → 삭제

**최종 결정**: 전체 폴더 삭제 예정 (필요 문서만 이동 후)

---

## 📁 docs 폴더 정리 계획

### 현재 상태 (47개)
```bash
API_DOCUMENTATION.md
API_SPECIFICATION.md
architecture/ (폴더)
ARCHITECTURE_BLUEPRINT.md
ARCHITECTURE_DIAGRAMS.md
ARCHITECTURE_INDEX.md
ARCHITECTURE_SUMMARY.md
BACKEND_ARCHITECTURE.md
bugfixes/ (폴더)
COMPREHENSIVE_TEST_STRATEGY.md
DATA_UTILIZATION_STRATEGY.md
DEPLOYMENT_GUIDE.md
emergency_fix_plan_20251016_v2.md
emergency_fix_report_20251016.md
FINAL_INTEGRATION_REPORT.md
IMPLEMENTATION_GUIDE.md
IMPLEMENTATION_STRATEGY.md
MASTER_EXPANSION_PLAN.md
MASTER_PLAN.md
modules/ (폴더)
phase0/ (폴더)
phase1/ (폴더)
RELEASE_NOTES_TEMPLATE.md
reports/ (폴더)
SPRINT_2_COMPLETION_REPORT.md
SPRINT_2_TEST_RESULTS.md
SPRINT_3_COMPLETION_REPORT.md
SPRINT_3_PHASE_0_SUMMARY.md
SPRINT_4_ANALYTICS_USAGE.md
SPRINT_4_ARCHITECTURE.md
SPRINT_4_WEEK_2_COMPLETION_VERIFICATION.md
SPRINT_4_WORKFLOW_VERIFICATION.md
SPRINT5_ARCHITECTURE.md
SPRINT5_TEST_REPORT.md
SPRINT5_USAGE_GUIDE.md
SPRINT5_WEEK2_RETROSPECTIVE.md
SPRINT5_WEEK3_BUGFIX.md
SPRINT5_WEEK3_COMPLETION.md
SPRINT5_WEEK3_FINAL.md
SYSTEM_ARCHITECTURE.md
TESTING_QUICK_START.md
user/ (폴더)
workflows/ (폴더)
대화.txt
```

### 정리 계획

#### ✅ 유지 (핵심 문서 10개)
```
1. MASTER_PLAN.md (전체 마스터 플랜)
2. ARCHITECTURE_BLUEPRINT.md (시스템 아키텍처)
3. API_SPECIFICATION.md (API 스펙)
4. TESTING_QUICK_START.md (테스트 가이드)
5. DEPLOYMENT_GUIDE.md (배포 가이드)
6. CLEANUP_ANALYSIS.md (이 문서 - NEW)
7. CLEANUP_PLAN.md (정리 계획 - NEW)
```

#### 📦 이동 → reports/
```
- SPRINT_2_COMPLETION_REPORT.md
- SPRINT_2_TEST_RESULTS.md
- SPRINT_3_COMPLETION_REPORT.md
- SPRINT_4_WEEK_2_COMPLETION_VERIFICATION.md
- SPRINT5_WEEK2_RETROSPECTIVE.md
- SPRINT5_WEEK3_BUGFIX.md
- SPRINT5_WEEK3_COMPLETION.md
- SPRINT5_WEEK3_FINAL.md
- FINAL_INTEGRATION_REPORT.md
```

#### 📦 이동 → archives/ (참고용)
```
- ARCHITECTURE_DIAGRAMS.md
- ARCHITECTURE_INDEX.md
- ARCHITECTURE_SUMMARY.md
- BACKEND_ARCHITECTURE.md
- SYSTEM_ARCHITECTURE.md
- SPRINT_3_PHASE_0_SUMMARY.md
- SPRINT_4_WORKFLOW_VERIFICATION.md
- MASTER_EXPANSION_PLAN.md
- DATA_UTILIZATION_STRATEGY.md
- COMPREHENSIVE_TEST_STRATEGY.md
```

#### 🗑️ 삭제 (임시/중복 문서)
```
- emergency_fix_plan_20251016_v2.md
- emergency_fix_report_20251016.md
- API_DOCUMENTATION.md (중복 - API_SPECIFICATION.md와 통합)
- IMPLEMENTATION_GUIDE.md (중복)
- IMPLEMENTATION_STRATEGY.md (중복)
- RELEASE_NOTES_TEMPLATE.md (템플릿만 있음)
- SPRINT_4_ANALYTICS_USAGE.md (SPRINT5_USAGE_GUIDE로 대체)
- SPRINT_4_ARCHITECTURE.md (SPRINT5_ARCHITECTURE로 대체)
- SPRINT5_TEST_REPORT.md (최신 버전으로 통합)
- 대화.txt (임시 파일)
```

#### 📁 폴더 처리
```
✅ 유지:
- reports/ (Sprint 보고서 모음)
- archives/ (참고 문서 보관)

🔍 검토 후 결정:
- architecture/ (내용 확인 필요)
- bugfixes/ (내용 확인 필요)
- modules/ (내용 확인 필요)
- phase0/ (내용 확인 필요)
- phase1/ (내용 확인 필요)
- user/ (내용 확인 필요)
- workflows/ (내용 확인 필요)
```

---

## 🔍 티커 수량 조사 계획

### 조사 결과 ✅

1. **데이터 파일 확인**
   - `data/M_Company.json` → **6,176개 기업** (전체 기업 마스터)
   - `data/T_Correlation.json` → **1,249개 기업** (metadata.recordCount 확인)
   - 구조: `{metadata: {recordCount}, data: [...]}`

2. **티커 수량 미스터리 해결**
   - 사용자 언급 "6,000개" → M_Company.json 6,176개 ✅
   - 시스템 표시 "1,249개" → T_Correlation.json (상관관계 분석용) ✅
   - **결론**: 서로 다른 목적의 데이터셋. 문제 없음.

3. **docs 서브폴더 상세 현황**
   - `architecture/`: 2개 (FOUNDATION_DOCUMENTATION, PHASE_0_ARCHITECTURE)
   - `bugfixes/`: 1개 (BUGFIX_MODAL_BLOCKING)
   - `modules/`: 0개 (빈 폴더 - 삭제 예정)
   - `phase0/`: 4개 (cleanup_plan, strategy, execution_report, status_report)
   - `phase1/`: 1개 (as_is_analysis)
   - `user/`: 5개 (USER_GUIDE, FEATURE_DOCUMENTATION, DATA_DICTIONARY, FAQ, README)
   - `workflows/`: 2개 (AGENT_COLLABORATION_GUIDE, IMPLEMENTATION_ROADMAP)
   - `reports/`: 2개 (DATA_FIX_REPORT, GLOBAL_EXPANSION_STATUS)

   **서브폴더 파일 합계**: 17개
   **docs 루트 파일**: 30개
   **총 47개 파일** → 목표: 10개 이하

---

## 📋 다음 단계

### Phase 0 완료 후
1. ✅ CLEANUP_ANALYSIS.md 작성 (이 문서)
2. ⏳ 폴더 내용 상세 확인
3. ⏳ 티커 수량 조사
4. ⏳ CLEANUP_PLAN.md 작성 (Phase 1 - To-Be Design)

### Phase 1 (계획 수립)
- 파일 이동/삭제 체크리스트
- Git 안전장치 (Pre-cleanup checkpoint)
- 검증 방법 (테스트 실행)

### Phase 2 (실행)
- 파일 이동 실행
- 파일 삭제 실행
- 테스트 실행 및 검증

---

**작성일**: 2025-10-18
**상태**: Phase 0 - As-Is Analysis 진행 중
**다음**: 폴더 상세 내용 확인
