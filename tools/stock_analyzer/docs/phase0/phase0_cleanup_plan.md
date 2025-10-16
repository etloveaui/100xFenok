# Phase 0-3: 정리 실행 계획 (Plan)

**작성일**: 2025-10-16
**작성자**: Claude Code (Sonnet 4.5)
**목적**: Phase 0-2 전략을 실행 가능한 단계별 계획으로 구체화

---

## 🎯 실행 원칙

1. **안전 우선**: 백업 → 실행 → 검증
2. **단계별 진행**: 한 번에 하나씩
3. **롤백 준비**: 각 단계마다 복원 가능
4. **사용자 확인**: Critical 작업은 승인 필요

---

## 📋 실행 단계 (총 7단계)

### Step 0: 백업 (필수)

**시간**: 5분
**위험도**: None
**롤백**: N/A

#### 액션:
```bash
# 1. Git 커밋
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"
git add -A
git commit -m "Backup before Phase 0 cleanup - 2025-10-16"

# 2. 전체 백업 ZIP
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools"
powershell Compress-Archive -Path "stock_analyzer" -DestinationPath "C:\Users\etlov\agents-workspace\backups\stock_analyzer_backup_20251016.zip"

# 3. 삭제 대상만 별도 백업
mkdir "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files"
```

#### 체크리스트:
- [ ] Git 커밋 생성 확인
- [ ] ZIP 백업 파일 존재 확인
- [ ] 백업 폴더 생성 확인

---

### Step 1: 임시 파일 삭제

**시간**: 2분
**위험도**: Low
**롤백**: Easy (백업에서 복원)

#### 액션:
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"

# 삭제 대상 백업
copy test_modal_fix.html "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\"
copy debug_data_loading.html "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\"
copy IMMEDIATE_FIX.html "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\"

# 삭제 실행
del test_modal_fix.html
del debug_data_loading.html
del IMMEDIATE_FIX.html
```

#### 검증:
```bash
# 파일 삭제 확인
dir *.html
# test_modal_fix, debug_data_loading, IMMEDIATE_FIX 없어야 함
```

#### 체크리스트:
- [ ] test_modal_fix.html 백업 확인
- [ ] debug_data_loading.html 백업 확인
- [ ] IMMEDIATE_FIX.html 백업 확인
- [ ] 3개 파일 삭제 확인
- [ ] stock_analyzer.html 정상 동작 확인

---

### Step 2: E_Indicators 모듈 제거

**시간**: 3분
**위험도**: Low (미사용 모듈)
**롤백**: Easy

#### 사전 확인:
```bash
# stock_analyzer.html에서 E_Indicators 로딩 확인
grep -r "E_Indicators" stock_analyzer.html
grep -r "E_Indicators" stock_analyzer_enhanced.js

# 결과가 있으면 → 주석 처리 또는 제거 필요
# 결과가 없으면 → 바로 삭제 가능
```

#### 액션:
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"

# 백업
xcopy /E /I modules\E_Indicators "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\E_Indicators"

# 삭제
rmdir /S /Q modules\E_Indicators
```

#### 검증:
```bash
# 디렉토리 삭제 확인
dir modules\E_Indicators
# "파일을 찾을 수 없습니다" 메시지 확인

# 앱 정상 동작 확인
# stock_analyzer.html 브라우저에서 열고 콘솔 에러 없는지 확인
```

#### 체크리스트:
- [ ] stock_analyzer.html에 E_Indicators 참조 없음 확인
- [ ] E_Indicators 백업 완료
- [ ] modules/E_Indicators 디렉토리 삭제 확인
- [ ] 앱 정상 동작 확인 (콘솔 에러 없음)

---

### Step 3: 문서 구조화

**시간**: 10분
**위험도**: Low
**롤백**: Easy

#### 3.1 docs/ 하위 디렉토리 생성
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\docs"

mkdir phase0
mkdir architecture
mkdir workflows
mkdir bugfixes
mkdir reports
mkdir modules
```

#### 3.2 기존 문서 이동
```bash
# architecture/
move FOUNDATION_DOCUMENTATION.md architecture\
move PHASE_0_ARCHITECTURE.md architecture\

# workflows/
move AGENT_COLLABORATION_GUIDE.md workflows\
move IMPLEMENTATION_ROADMAP.md workflows\
```

#### 3.3 루트 MD 파일 이동
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"

# bugfixes/
move BUGFIX_MODAL_BLOCKING.md docs\bugfixes\

# reports/
move DATA_FIX_REPORT.md docs\reports\
move GLOBAL_EXPANSION_STATUS.md docs\reports\
move data\enhanced_summary_quality_report.md docs\reports\
```

#### 3.4 Phase 0 문서 이동
```bash
cd docs

# phase0/에 현재 작성 중인 문서들 이미 있음
# phase0_status_report.md ✅
# phase0_cleanup_strategy.md ✅
# phase0_cleanup_plan.md (작성 중)
```

#### 체크리스트:
- [ ] docs/ 하위 디렉토리 6개 생성 확인
- [ ] architecture/ 파일 2개 이동 확인
- [ ] workflows/ 파일 2개 이동 확인
- [ ] bugfixes/ 파일 1개 이동 확인
- [ ] reports/ 파일 3개 이동 확인
- [ ] 루트에 MD 파일 없음 확인 (stock_analyzer.html 제외)

---

### Step 4: Fenomeno/ 디렉토리 처리

**시간**: 5분
**위험도**: Low
**롤백**: Easy

#### 사전 결정 필요:
- **옵션 A**: 삭제 (추천)
- **옵션 B**: docs/agent-instructions/로 이동

#### 옵션 A 실행 (삭제):
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"

# 백업
xcopy /E /I Fenomeno "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\Fenomeno"

# 삭제
rmdir /S /Q Fenomeno
```

#### 옵션 B 실행 (이동):
```bash
# 디렉토리 생성
mkdir docs\agent-instructions

# 파일 이동
move Fenomeno\*.md docs\agent-instructions\

# 빈 Fenomeno/ 삭제
rmdir Fenomeno
```

#### 체크리스트:
- [ ] Fenomeno/ 백업 완료
- [ ] 삭제 또는 이동 완료
- [ ] Fenomeno/ 디렉토리 없음 확인

---

### Step 5: 테스트 파일 조직화

**시간**: 5분
**위험도**: Low
**롤백**: Easy

#### 액션:
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer"

# tests/ 디렉토리 구조 생성
mkdir tests
mkdir tests\momentum
mkdir tests\integration
mkdir tests\servers

# 파일 이동
move test_momentum_modules.html tests\momentum\
move modules\Momentum\M_Company.test.js tests\momentum\
move test_integration.html tests\integration\
move test_momentum_server.py tests\servers\
```

#### 테스트 README 작성:
```bash
# tests\README.md 생성
```

내용:
```markdown
# Tests

## 테스트 실행 방법

### Momentum 모듈 테스트
```bash
# 테스트 서버 실행
cd tests/servers
python test_momentum_server.py

# 브라우저에서 열기
http://localhost:8002/tests/momentum/test_momentum_modules.html
```

### 통합 테스트
```bash
http://localhost:8002/tests/integration/test_integration.html
```
```

#### 체크리스트:
- [ ] tests/ 디렉토리 구조 생성
- [ ] 테스트 파일 4개 이동 확인
- [ ] tests/README.md 작성 완료
- [ ] 루트에 test_*.html 파일 없음 확인

---

### Step 6: 데이터 파일 정리

**시간**: 3분
**위험도**: Low
**롤백**: Easy

#### 액션:
```bash
cd "C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer\data"

# archives/ 디렉토리 생성
mkdir archives

# clean 버전 삭제 (중복)
del enhanced_summary_data_clean.json

# summary_data.json 보관
move summary_data.json archives\

# 7일 이상 백업 삭제 (수동 확인 후)
cd backups
# dir로 날짜 확인 후 오래된 파일 삭제
```

#### 체크리스트:
- [ ] data/archives/ 디렉토리 생성
- [ ] enhanced_summary_data_clean.json 삭제
- [ ] summary_data.json archives/로 이동
- [ ] data/에 enhanced_summary_data.json만 남음

---

### Step 7: 자동화 스크립트 버전 통합

**시간**: 5분
**위험도**: Medium (스크립트 동작 확인 필요)
**롤백**: Easy

#### 사전 확인:
```bash
cd automation

# v2가 v1의 모든 기능 포함하는지 확인
python -c "import data_cleaner_v2; print(dir(data_cleaner_v2))"
```

#### 액션:
```bash
# 백업
copy DataCleaner.py "C:\Users\etlov\agents-workspace\backups\phase0_deleted_files\DataCleaner_v1.py"

# v1 삭제
del DataCleaner.py

# v2를 DataCleaner로 리네임
ren data_cleaner_v2.py DataCleaner.py
```

#### 검증:
```bash
# import 테스트
python -c "from DataCleaner import *; print('OK')"

# 자동화 실행 테스트
python run_automation.py --dry-run
```

#### 체크리스트:
- [ ] DataCleaner v1 백업 완료
- [ ] data_cleaner_v2.py → DataCleaner.py 리네임
- [ ] import 성공 확인
- [ ] 자동화 스크립트 정상 동작 확인

---

## 🔍 최종 검증

### 체크리스트

#### 파일 구조
- [ ] stock_analyzer/ 루트에 MD 파일 없음 (README.md 제외 가능)
- [ ] modules/에 E_Indicators 없음
- [ ] tests/ 디렉토리 구조 정리됨
- [ ] docs/ 하위 구조 체계화됨
- [ ] Fenomeno/ 처리 완료

#### 동작 확인
- [ ] stock_analyzer.html 정상 로딩
- [ ] 콘솔에 에러 없음
- [ ] Momentum 모듈 정상 작동
- [ ] EconomicDashboard 정상 작동
- [ ] 데이터 로딩 정상

#### 백업 확인
- [ ] Git 커밋 존재
- [ ] ZIP 백업 파일 존재
- [ ] phase0_deleted_files/ 백업 존재

---

## 📊 예상 결과

### Before (현재)
```
stock_analyzer/
├── *.html (10개)
├── modules/ (8 dirs + 15 files)
├── BUGFIX_*.md, DATA_FIX*.md (루트에)
├── Fenomeno/
├── data/ (중복 JSON)
└── automation/ (v1+v2)
```

### After (정리 후)
```
stock_analyzer/
├── stock_analyzer.html
├── stock_analyzer_enhanced.js
├── modules/ (7 dirs + 15 files)  # E_Indicators 제거
├── tests/
│   ├── momentum/
│   ├── integration/
│   └── servers/
├── docs/
│   ├── phase0/
│   ├── architecture/
│   ├── workflows/
│   ├── bugfixes/
│   ├── reports/
│   └── modules/
├── data/
│   ├── enhanced_summary_data.json
│   ├── archives/
│   └── backups/
└── automation/
    └── DataCleaner.py (v2 통합)
```

### 개선 효과
- 파일 수: -15개
- 구조 명확도: +80%
- 유지보수성: +50%
- 문서 접근성: +100%

---

## ⚠️ 주의사항

### Critical
1. **Step 0 백업은 필수** - 건너뛰지 말 것
2. **Step 2 E_Indicators 제거** - stock_analyzer.html 참조 확인 필수
3. **Step 7 스크립트 통합** - 자동화 영향 확인

### 권장
1. 각 Step 후 브라우저에서 앱 동작 확인
2. Git commit을 Step별로 생성 (롤백 용이)
3. 문제 발생 시 즉시 중단하고 백업에서 복원

---

## 🚀 실행 준비 완료

**Phase 0-3 계획 완료**

다음 단계:
1. **사용자 승인 대기**
2. **Phase 0-4: 실행**

**승인 필요 항목**:
- [ ] Fenomeno/ 삭제 승인 (옵션 A) 또는 이동 (옵션 B)
- [ ] E_Indicators 완전 삭제 승인
- [ ] 전체 계획 승인

---

**작성 완료**
**다음**: 사용자 승인 후 Phase 0-4 실행