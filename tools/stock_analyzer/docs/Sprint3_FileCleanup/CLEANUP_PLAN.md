# 파일 정리 작업 - To-Be Design & Execution Plan

**작업일**: 2025-10-18
**Phase**: Phase 1 - To-Be Design
**목적**: 잘못된 경로 파일 정리 + docs 폴더 체계화 (47개 → 10개)

---

## 🎯 목표 상태 (To-Be State)

### 1. 잘못된 경로 완전 제거
```
❌ fenomeno_projects/20251015_Stock_Prompt_Claude/ → 삭제
❌ fenomeno_projects/Global_Scouter/ → 삭제
✅ projects/100xFenok/tools/stock_analyzer/ → 유일한 작업 경로
```

### 2. docs 폴더 구조 (47개 → 10개)
```
docs/
├── MASTER_PLAN.md               # 1. 전체 Sprint 마스터 플랜
├── ARCHITECTURE_BLUEPRINT.md    # 2. 시스템 아키텍처
├── API_SPECIFICATION.md         # 3. API 스펙
├── TESTING_QUICK_START.md       # 4. 테스트 가이드
├── DEPLOYMENT_GUIDE.md          # 5. 배포 가이드
├── CLEANUP_ANALYSIS.md          # 6. 이 정리 작업 As-Is 분석
├── CLEANUP_PLAN.md              # 7. 이 정리 작업 To-Be 계획
├── USER_GUIDE.md                # 8. 사용자 가이드 (user/에서 이동)
├── reports/                     # Sprint 보고서 모음
│   └── [Sprint 보고서들]
└── archives/                    # 참고 문서 보관
    └── [아카이브 문서들]
```

### 3. 데이터 무결성 보장
- M_Company.json: 6,176개 유지
- T_Correlation.json: 1,249개 유지
- 모든 테스트 통과 (108 tests)

---

## 📋 실행 계획 (Phase 1)

### Step 1: Git 안전장치 생성 ✅
```bash
# Pre-cleanup checkpoint
git add .
git commit -m "checkpoint: Before file cleanup (Sprint 3)"
git log -1 --oneline  # 복구 지점 기록
```

**목적**: 문제 발생 시 즉시 복구 가능

---

### Step 2: 잘못된 경로 유용 파일 이동

#### 2.1 fenomeno_projects/20251015_Stock_Prompt_Claude/
**판단**: 모두 Sprint 4 관련 문서, stock_analyzer에 이미 최신 버전 존재

**조치**: 전체 폴더 삭제
```bash
# 유용한 파일 없음 - 전부 중복
rm -rf fenomeno_projects/20251015_Stock_Prompt_Claude/
```

**파일 목록** (전부 삭제):
- ARCHITECTURE_DIAGRAM.md (Sprint 4 - 중복)
- DASHBOARD_INTEGRATION_GUIDE.md (Sprint 4 - 중복)
- DELIVERY_PACKAGE.md (Sprint 4 - 중복)
- QUICK_START.md (Sprint 4 - 중복)
- README.md (Sprint 4 - 중복)
- SPRINT4_IMPLEMENTATION_SUMMARY.md (Sprint 4 - 중복)
- stock_analyzer.html (중복)
- js/DashboardManager.js (중복)

#### 2.2 fenomeno_projects/Global_Scouter/
**판단**: 2개 문서 확인 후 필요시 이동, 나머지 삭제

**보존 가능 문서**:
1. `claudedocs/SPRINT5_70K_SCALE_WORKFLOW.md` (483 lines)
   - **내용**: 70K 기업 확장 계획, O(n²)→O(n) 최적화 설명
   - **판단**: 참고용으로 유용
   - **조치**: `docs/archives/SPRINT5_70K_SCALE_WORKFLOW.md`로 이동

2. `claudedocs/sprint5-integration-test-fixes.md` (115 lines)
   - **내용**: 테스트 의존성 수정 기록
   - **판단**: 참고용
   - **조치**: `docs/archives/sprint5-integration-test-fixes.md`로 이동

**삭제 파일**:
- tests/e2e/ (중복 - stock_analyzer/tests에 최신 버전)
- csv_analysis_results.json (354KB - 임시 분석 파일)
- automation_master.py (stock_analyzer와 무관)
- csv_analysis_deep.py (stock_analyzer와 무관)
- root_cause_analysis.py (stock_analyzer와 무관)
- Global_Scouter_*.zip (250MB+ - 대용량 백업)
- *.xlsb 파일 (원본 데이터)

```bash
# 유용 문서 2개 이동
mkdir -p docs/archives
cp fenomeno_projects/Global_Scouter/claudedocs/SPRINT5_70K_SCALE_WORKFLOW.md docs/archives/
cp fenomeno_projects/Global_Scouter/claudedocs/sprint5-integration-test-fixes.md docs/archives/

# 전체 폴더 삭제
rm -rf fenomeno_projects/Global_Scouter/
```

---

### Step 3: docs 폴더 재구성 (47개 → 10개)

#### 3.1 핵심 문서 유지 (8개)
```
✅ MASTER_PLAN.md                (전체 마스터 플랜)
✅ ARCHITECTURE_BLUEPRINT.md     (시스템 아키텍처)
✅ API_SPECIFICATION.md          (API 스펙)
✅ TESTING_QUICK_START.md        (테스트 가이드)
✅ DEPLOYMENT_GUIDE.md           (배포 가이드)
✅ CLEANUP_ANALYSIS.md           (새로 작성 - As-Is)
✅ CLEANUP_PLAN.md               (새로 작성 - To-Be)
✅ USER_GUIDE.md                 (user/USER_GUIDE.md 이동)
```

#### 3.2 reports/ 폴더로 이동 (9개)
```bash
mkdir -p docs/reports

# Sprint 완료 보고서
mv docs/SPRINT_2_COMPLETION_REPORT.md docs/reports/
mv docs/SPRINT_2_TEST_RESULTS.md docs/reports/
mv docs/SPRINT_3_COMPLETION_REPORT.md docs/reports/
mv docs/SPRINT_4_WEEK_2_COMPLETION_VERIFICATION.md docs/reports/
mv docs/SPRINT5_WEEK2_RETROSPECTIVE.md docs/reports/
mv docs/SPRINT5_WEEK3_BUGFIX.md docs/reports/
mv docs/SPRINT5_WEEK3_COMPLETION.md docs/reports/
mv docs/SPRINT5_WEEK3_FINAL.md docs/reports/
mv docs/FINAL_INTEGRATION_REPORT.md docs/reports/
```

#### 3.3 archives/ 폴더로 이동 (10개)
```bash
mkdir -p docs/archives

# 아키텍처 참고 문서
mv docs/ARCHITECTURE_DIAGRAMS.md docs/archives/
mv docs/ARCHITECTURE_INDEX.md docs/archives/
mv docs/ARCHITECTURE_SUMMARY.md docs/archives/
mv docs/BACKEND_ARCHITECTURE.md docs/archives/
mv docs/SYSTEM_ARCHITECTURE.md docs/archives/

# 전략/계획 문서
mv docs/SPRINT_3_PHASE_0_SUMMARY.md docs/archives/
mv docs/SPRINT_4_WORKFLOW_VERIFICATION.md docs/archives/
mv docs/MASTER_EXPANSION_PLAN.md docs/archives/
mv docs/DATA_UTILIZATION_STRATEGY.md docs/archives/
mv docs/COMPREHENSIVE_TEST_STRATEGY.md docs/archives/
```

#### 3.4 삭제 (11개)
```bash
# 임시/긴급 문서
rm docs/emergency_fix_plan_20251016_v2.md
rm docs/emergency_fix_report_20251016.md

# 중복 문서
rm docs/API_DOCUMENTATION.md              # API_SPECIFICATION.md와 통합
rm docs/IMPLEMENTATION_GUIDE.md           # MASTER_PLAN.md로 대체
rm docs/IMPLEMENTATION_STRATEGY.md        # MASTER_PLAN.md로 대체

# 템플릿만 있는 파일
rm docs/RELEASE_NOTES_TEMPLATE.md

# 최신 버전으로 대체된 문서
rm docs/SPRINT_4_ANALYTICS_USAGE.md       # SPRINT5_USAGE_GUIDE로 대체
rm docs/SPRINT_4_ARCHITECTURE.md          # SPRINT5_ARCHITECTURE로 대체
rm docs/SPRINT5_TEST_REPORT.md            # 최신 통합됨

# 임시 파일
rm docs/대화.txt
```

#### 3.5 서브폴더 정리
```bash
# user/ 폴더 → USER_GUIDE.md만 루트로, 나머지 archives
mv docs/user/USER_GUIDE.md docs/
mv docs/user/FEATURE_DOCUMENTATION.md docs/archives/
mv docs/user/DATA_DICTIONARY.md docs/archives/
mv docs/user/FAQ.md docs/archives/
mv docs/user/README.md docs/archives/
rmdir docs/user/

# workflows/ → archives로 이동
mv docs/workflows/AGENT_COLLABORATION_GUIDE.md docs/archives/
mv docs/workflows/IMPLEMENTATION_ROADMAP.md docs/archives/
rmdir docs/workflows/

# modules/ → 빈 폴더 삭제
rmdir docs/modules/

# architecture/ → archives로 통합
mv docs/architecture/FOUNDATION_DOCUMENTATION.md docs/archives/
mv docs/architecture/PHASE_0_ARCHITECTURE.md docs/archives/
rmdir docs/architecture/

# bugfixes/ → archives로 이동
mv docs/bugfixes/BUGFIX_MODAL_BLOCKING.md docs/archives/
rmdir docs/bugfixes/

# phase0/ → archives로 이동
mv docs/phase0/*.md docs/archives/
rmdir docs/phase0/

# phase1/ → archives로 이동
mv docs/phase1/*.md docs/archives/
rmdir docs/phase1/

# reports/ 폴더 내 2개 파일은 그대로 유지
# (DATA_FIX_REPORT.md, GLOBAL_EXPANSION_STATUS.md)
```

---

### Step 4: 검증

#### 4.1 파일 수 확인
```bash
# docs 루트 파일 수 확인 (목표: 8개)
ls docs/*.md | wc -l

# reports 폴더 (11개 예상)
ls docs/reports/*.md | wc -l

# archives 폴더 (26개 예상)
ls docs/archives/*.md | wc -l

# 전체 docs 파일 수
find docs -name "*.md" | wc -l
```

**목표**:
- docs 루트: 8개
- docs/reports/: 11개
- docs/archives/: 26개
- **총 45개** (원래 47개 - 2개 삭제됨)

#### 4.2 데이터 무결성 확인
```bash
# M_Company.json 레코드 수
python3 -c "import json; data = json.load(open('data/M_Company.json')); print(len(data))"
# 예상: 6176

# T_Correlation.json 레코드 수
python3 -c "import json; data = json.load(open('data/T_Correlation.json')); print(len(data['data']))"
# 예상: 1249
```

#### 4.3 테스트 실행
```bash
# 전체 테스트 실행 (108 tests)
npx playwright test

# 목표: 108/108 passing
```

---

### Step 5: Git Commit

#### 5.1 변경사항 확인
```bash
git status
git diff --stat
```

#### 5.2 스테이징 및 커밋
```bash
git add .
git commit -m "cleanup: Sprint 3 파일 정리 완료

- 잘못된 경로 폴더 삭제 (fenomeno_projects)
- docs 폴더 재구성 (47개 → 45개)
  - 핵심 문서 8개 (루트)
  - 보고서 11개 (reports/)
  - 참고 문서 26개 (archives/)
- 데이터 무결성 확인 (M_Company 6,176개, T_Correlation 1,249개)
- 전체 테스트 통과 (108/108)

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 🔍 위험 요소 및 대책

### 위험 1: 필요한 문서 삭제
- **대책**: Git checkpoint 생성 → 즉시 복구 가능
- **검증**: 각 파일 이동 전 내용 확인

### 위험 2: 테스트 실패
- **대책**: 데이터 파일 건드리지 않음 (문서만 정리)
- **검증**: Step 4.3 테스트 실행으로 확인

### 위험 3: 경로 오류
- **대책**: 절대 경로 사용 (`C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer`)
- **검증**: `pwd` 명령으로 작업 경로 확인

---

## 📊 성공 기준

### 정량적 지표
- ✅ docs 루트 파일: 8개
- ✅ docs/reports/: 11개
- ✅ docs/archives/: 26개
- ✅ 잘못된 경로 폴더: 0개 (완전 삭제)
- ✅ 테스트 통과율: 100% (108/108)
- ✅ 데이터 레코드: M_Company 6,176개, T_Correlation 1,249개

### 정성적 지표
- ✅ docs 폴더 구조 명확 (핵심/보고서/아카이브)
- ✅ 중복 파일 제거 완료
- ✅ Git 히스토리 깔끔하게 유지
- ✅ 시스템 무결성 유지 (기능 정상 작동)

---

## 📋 실행 체크리스트

### Phase 1 준비 (Planning)
- [x] CLEANUP_ANALYSIS.md 작성 (As-Is)
- [x] CLEANUP_PLAN.md 작성 (To-Be) ← **현재 문서**
- [ ] MASTER_PLAN.md 업데이트 (Task 3.3 완료 표시)

### Phase 2 실행 (Execution)
- [ ] Step 1: Git checkpoint 생성
- [ ] Step 2.1: 20251015_Stock_Prompt_Claude 폴더 삭제
- [ ] Step 2.2: Global_Scouter 유용 문서 2개 이동 → 폴더 삭제
- [ ] Step 3.1: 핵심 문서 8개 확정
- [ ] Step 3.2: reports/ 폴더 생성 및 이동 (9개)
- [ ] Step 3.3: archives/ 폴더 생성 및 이동 (10개)
- [ ] Step 3.4: 불필요 문서 삭제 (11개)
- [ ] Step 3.5: 서브폴더 정리 (6개 폴더)

### Phase 3 검증 (Validation)
- [ ] Step 4.1: 파일 수 확인
- [ ] Step 4.2: 데이터 무결성 확인
- [ ] Step 4.3: 테스트 실행 (108 tests)

### Phase 4 완료 (Completion)
- [ ] Step 5.1: Git 변경사항 확인
- [ ] Step 5.2: Git commit
- [ ] MASTER_PLAN.md 최종 업데이트
- [ ] TodoWrite 최종 업데이트

---

**작성일**: 2025-10-18
**상태**: Phase 1 - To-Be Design 완료
**다음**: Task 3.4 - 파일 정리 실행

---

## 📖 부록: 파일 맵핑표

### docs 루트 → 최종 위치

| 현재 위치 | 최종 위치 | 조치 |
|----------|----------|------|
| API_DOCUMENTATION.md | 삭제 | 중복 |
| API_SPECIFICATION.md | 유지 | 핵심 |
| ARCHITECTURE_BLUEPRINT.md | 유지 | 핵심 |
| ARCHITECTURE_DIAGRAMS.md | archives/ | 참고 |
| ARCHITECTURE_INDEX.md | archives/ | 참고 |
| ARCHITECTURE_SUMMARY.md | archives/ | 참고 |
| BACKEND_ARCHITECTURE.md | archives/ | 참고 |
| COMPREHENSIVE_TEST_STRATEGY.md | archives/ | 참고 |
| DATA_UTILIZATION_STRATEGY.md | archives/ | 참고 |
| DEPLOYMENT_GUIDE.md | 유지 | 핵심 |
| emergency_fix_plan_20251016_v2.md | 삭제 | 임시 |
| emergency_fix_report_20251016.md | 삭제 | 임시 |
| FINAL_INTEGRATION_REPORT.md | reports/ | 보고서 |
| IMPLEMENTATION_GUIDE.md | 삭제 | 중복 |
| IMPLEMENTATION_STRATEGY.md | 삭제 | 중복 |
| MASTER_EXPANSION_PLAN.md | archives/ | 참고 |
| MASTER_PLAN.md | 유지 | 핵심 |
| RELEASE_NOTES_TEMPLATE.md | 삭제 | 템플릿 |
| SPRINT_2_COMPLETION_REPORT.md | reports/ | 보고서 |
| SPRINT_2_TEST_RESULTS.md | reports/ | 보고서 |
| SPRINT_3_COMPLETION_REPORT.md | reports/ | 보고서 |
| SPRINT_3_PHASE_0_SUMMARY.md | archives/ | 참고 |
| SPRINT_4_ANALYTICS_USAGE.md | 삭제 | 대체됨 |
| SPRINT_4_ARCHITECTURE.md | 삭제 | 대체됨 |
| SPRINT_4_WEEK_2_COMPLETION_VERIFICATION.md | reports/ | 보고서 |
| SPRINT_4_WORKFLOW_VERIFICATION.md | archives/ | 참고 |
| SPRINT5_ARCHITECTURE.md | 유지 | 핵심 |
| SPRINT5_TEST_REPORT.md | 삭제 | 통합됨 |
| SPRINT5_USAGE_GUIDE.md | 유지 | 핵심 |
| SPRINT5_WEEK2_RETROSPECTIVE.md | reports/ | 보고서 |
| SPRINT5_WEEK3_BUGFIX.md | reports/ | 보고서 |
| SPRINT5_WEEK3_COMPLETION.md | reports/ | 보고서 |
| SPRINT5_WEEK3_FINAL.md | reports/ | 보고서 |
| SYSTEM_ARCHITECTURE.md | archives/ | 참고 |
| TESTING_QUICK_START.md | 유지 | 핵심 |
| 대화.txt | 삭제 | 임시 |
| CLEANUP_ANALYSIS.md | 유지 | 핵심 (NEW) |
| CLEANUP_PLAN.md | 유지 | 핵심 (NEW) |

### 서브폴더 → 최종 위치

| 현재 위치 | 최종 위치 | 조치 |
|----------|----------|------|
| user/USER_GUIDE.md | docs/ | 루트 이동 |
| user/FEATURE_DOCUMENTATION.md | archives/ | 참고 |
| user/DATA_DICTIONARY.md | archives/ | 참고 |
| user/FAQ.md | archives/ | 참고 |
| user/README.md | archives/ | 참고 |
| workflows/AGENT_COLLABORATION_GUIDE.md | archives/ | 참고 |
| workflows/IMPLEMENTATION_ROADMAP.md | archives/ | 참고 |
| architecture/FOUNDATION_DOCUMENTATION.md | archives/ | 참고 |
| architecture/PHASE_0_ARCHITECTURE.md | archives/ | 참고 |
| bugfixes/BUGFIX_MODAL_BLOCKING.md | archives/ | 참고 |
| phase0/*.md (4개) | archives/ | 참고 |
| phase1/*.md (1개) | archives/ | 참고 |
| reports/DATA_FIX_REPORT.md | 유지 | 보고서 |
| reports/GLOBAL_EXPANSION_STATUS.md | 유지 | 보고서 |
| modules/ (빈 폴더) | 삭제 | 빈 폴더 |
