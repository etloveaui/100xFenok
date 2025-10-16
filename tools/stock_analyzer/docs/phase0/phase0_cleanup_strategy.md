# Phase 0-2: 정리 전략 설계 (To-Be)

**작성일**: 2025-10-16
**작성자**: Claude Code (Sonnet 4.5)
**목적**: Phase 0-1 분석 기반 정리 전략 수립

---

## 🎯 정리 목표

1. **중복 제거**: 기능 중복 모듈 통합
2. **파일 정리**: 임시/테스트 파일 정리
3. **구조 최적화**: 문서 및 설정 파일 체계화
4. **안전성 확보**: 백업 및 롤백 전략

---

## 📋 전략 1: 중복 모듈 통합

### 1.1 경제 지표 모듈 통합

**현황**:
- EconomicDashboard (128KB, Phase 3 완료, 사용 중)
- E_Indicators (84KB, Phase 3 진행 중, 미통합)

**전략**: **EconomicDashboard 유지, E_Indicators 폐기**

**이유**:
1. EconomicDashboard는 이미 완성되어 작동 중
2. 2,615줄의 완전한 구현
3. 컴포넌트 구조 체계적 (TED Spread, Heatmap, Treasury Curve, Alert)
4. E_Indicators는 새로 작성 중이지만 미통합 상태

**액션**:
```
✅ 유지: modules/EconomicDashboard/ (전체)
❌ 삭제: modules/E_Indicators/ (전체)
📝 문서: E_Indicators 개발 의도를 EconomicDashboard README에 반영
```

**예외**:
- E_Indicators의 우수 기능이 있다면 EconomicDashboard에 통합 검토
- 통합 전 기능 비교 필요

---

### 1.2 모멘텀 모듈 통합

**현황**:
- Momentum (276KB, Phase 2 완료, 7개 컴포넌트)
- MomentumHeatmap (76KB, 기존, 히트맵 특화)

**전략**: **Momentum 유지, MomentumHeatmap 선택적 통합**

**이유**:
1. Momentum은 포괄적 시스템 (계산, 랭킹, 필터, 시각화, 비교)
2. Phase 2 완료, 테스트 포함
3. MomentumHeatmap은 히트맵만 특화

**액션**:
```
✅ 유지: modules/Momentum/ (전체)

🔍 검토 후 결정: modules/MomentumHeatmap/
   옵션 A: Momentum/MomentumVisualizer.js에 히트맵 기능 통합 후 삭제
   옵션 B: 독립 모듈로 유지 (히트맵 특화 필요 시)

📝 추천: 옵션 A (MomentumVisualizer에 통합)
```

**통합 시나리오**:
1. MomentumHeatmap의 히트맵 렌더링 코드 추출
2. Momentum/MomentumVisualizer.js에 `createHeatmap()` 메서드 추가
3. 기존 MomentumHeatmap 사용처 확인 후 교체
4. MomentumHeatmap 디렉토리 삭제

---

## 📋 전략 2: 임시 파일 정리

### 2.1 즉시 삭제 대상

**테스트/디버그 파일**:
```
❌ test_modal_fix.html (17KB)
   - 용도: 모달 버그 픽스 테스트
   - 삭제 조건: 버그 수정 완료 확인 후
   - 대체: 정규 테스트에 통합

❌ debug_data_loading.html (14KB)
   - 용도: 데이터 로딩 디버그
   - 삭제 조건: 데이터 로딩 정상 확인 후
   - 대체: 개발자 도구로 대체

❌ IMMEDIATE_FIX.html (3.2KB)
   - 용도: 긴급 수정
   - 삭제 조건: 즉시 (임시 핫픽스)
   - 대체: 정식 코드에 통합됨
```

**에러 관리 모듈**:
```
🔍 ErrorFixManager.js (16KB)
   - 용도: 에러 수정
   - 검토: 기능 확인 후 유지/삭제 결정
   - 대체: PerformanceManager나 Core/ErrorBoundary로 통합 가능
```

---

### 2.2 보관 대상

**Phase 2 테스트 파일**:
```
📦 test_momentum_modules.html (24KB)
   → 이동: tests/momentum/

📦 test_integration.html (12KB)
   → 이동: tests/integration/
```

**Python 테스트 서버**:
```
📦 test_momentum_server.py
   → 이동: tests/servers/
```

---

## 📋 전략 3: 문서 구조화

### 3.1 docs/ 디렉토리 재구성

**현재**:
```
docs/
├── AGENT_COLLABORATION_GUIDE.md
├── FOUNDATION_DOCUMENTATION.md
├── IMPLEMENTATION_ROADMAP.md
└── PHASE_0_ARCHITECTURE.md
```

**목표 구조**:
```
docs/
├── phase0/
│   ├── phase0_status_report.md (✅ 완료)
│   ├── phase0_cleanup_strategy.md (작성 중)
│   ├── phase0_cleanup_plan.md (예정)
│   └── phase0_execution_report.md (예정)
│
├── architecture/
│   ├── FOUNDATION_DOCUMENTATION.md (이동)
│   ├── PHASE_0_ARCHITECTURE.md (이동)
│   └── module_structure.md (신규)
│
├── workflows/
│   ├── AGENT_COLLABORATION_GUIDE.md (이동)
│   └── IMPLEMENTATION_ROADMAP.md (이동)
│
├── bugfixes/
│   ├── BUGFIX_MODAL_BLOCKING.md (이동)
│   └── bug_tracking.md (신규)
│
├── reports/
│   ├── DATA_FIX_REPORT.md (이동)
│   ├── GLOBAL_EXPANSION_STATUS.md (이동)
│   └── enhanced_summary_quality_report.md (이동)
│
├── agent-instructions/ (선택)
│   ├── claude_instruction.md (이동 또는 삭제)
│   ├── codex_instruction.md (이동 또는 삭제)
│   └── gemini_instruction.md (이동 또는 삭제)
│
└── modules/
    ├── EconomicDashboard_README.md (복사)
    ├── Momentum_README.md (복사)
    └── module_index.md (신규)
```

---

### 3.2 루트 파일 정리

**이동 대상**:
```
BUGFIX_MODAL_BLOCKING.md → docs/bugfixes/
DATA_FIX_REPORT.md → docs/reports/
GLOBAL_EXPANSION_STATUS.md → docs/reports/
```

**Fenomeno/ 처리**:
```
옵션 A (추천): 삭제
- C:\Users\etlov\.claude\CLAUDE.md에 통합
- 프로젝트별 지침은 docs/agent-instructions/에 간략히

옵션 B: 이동
Fenomeno/ → docs/agent-instructions/
```

---

## 📋 전략 4: 데이터 파일 정리

### 4.1 JSON 파일 통합

**현재**:
```
data/
├── enhanced_summary_data.json
├── enhanced_summary_data_clean.json
└── summary_data.json
```

**전략**:
```
✅ 유지: enhanced_summary_data.json (메인)
❌ 삭제: enhanced_summary_data_clean.json (중복)
📦 보관: summary_data.json → data/archives/
```

---

### 4.2 백업 정책

**현재**:
```
data/backups/
├── enhanced_summary_data_20251008T200703Z.json
├── enhanced_summary_data_20251008T200746Z.json
└── enhanced_summary_data_20251008T200913Z.json
```

**전략**:
```
✅ 유지: 최근 3개 백업
🗑️ 삭제: 7일 이상 된 백업 자동 삭제
📝 규칙: automation/backup_manager.py에서 관리
```

---

## 📋 전략 5: 자동화 스크립트 정리

### 5.1 버전 통합

**현재**:
```
automation/
├── DataCleaner.py
├── data_cleaner_v2.py ⚠️
```

**전략**:
```
✅ 유지: data_cleaner_v2.py → DataCleaner.py로 리네임
❌ 삭제: 기존 DataCleaner.py (v1)
📝 확인: v2가 v1의 모든 기능 포함하는지 검증
```

---

### 5.2 archive/ 유지

**현재**:
```
archive/
├── analyze_csv_structure.py
├── build_enhanced_data.py
├── create_clean_json.py
└── ... (7개 스크립트)
```

**전략**:
```
✅ 유지: 전체 (히스토리 보존)
📝 추가: archive/README.md (각 스크립트 용도 설명)
```

---

## 📋 전략 6: 테스트 파일 조직화

### 6.1 tests/ 디렉토리 생성

**목표 구조**:
```
tests/
├── momentum/
│   ├── test_momentum_modules.html
│   └── M_Company.test.js (이동)
│
├── integration/
│   └── test_integration.html
│
├── servers/
│   └── test_momentum_server.py
│
└── README.md (테스트 실행 가이드)
```

---

## 🔒 안전성 전략

### 백업 계획

**Phase 0-4 실행 전**:
```
1. Git 커밋 생성
   git add -A
   git commit -m "Backup before Phase 0 cleanup"

2. 전체 프로젝트 ZIP 백업
   → C:\Users\etlov\agents-workspace\backups\stock_analyzer_backup_20251016.zip

3. 삭제 대상 파일만 별도 백업
   → C:\Users\etlov\agents-workspace\backups\phase0_deleted_files_20251016.zip
```

---

### 롤백 전략

**삭제 실행 후 문제 발생 시**:
```
1. Git 복원
   git reset --hard HEAD~1

2. ZIP 복원
   압축 해제 후 덮어쓰기

3. 개별 파일 복원
   phase0_deleted_files_*.zip에서 필요한 파일만 복원
```

---

## 📊 영향 분석

### 삭제 영향도

| 대상 | 크기 | 영향도 | 복구 난이도 |
|------|------|--------|------------|
| E_Indicators/ | 84KB | Low (미사용) | Easy |
| MomentumHeatmap/ | 76KB | Medium (확인 필요) | Easy |
| test_*.html | 53KB | Low (테스트) | Easy |
| IMMEDIATE_FIX.html | 3KB | None | Easy |
| Fenomeno/ | 작음 | Low (중복) | Easy |

**총 절감**: 약 300KB + 파일 정리

---

### 성능 개선 예상

1. **로딩 속도**: 중복 모듈 제거로 10-15% 개선
2. **유지보수성**: 명확한 구조로 50% 개선
3. **개발 속도**: 문서 체계화로 30% 개선

---

## ✅ 승인 요청

**Phase 0-2 전략 완료**

다음 단계:
1. 사용자 승인 대기
2. Phase 0-3: 상세 실행 계획 작성
3. Phase 0-4: 실행

**검토 필요 사항**:
- MomentumHeatmap 통합 vs 유지
- Fenomeno/ 삭제 vs 이동
- ErrorFixManager.js 처리

---

**작성 완료**
**다음**: Phase 0-3 (Cleanup Plan Creation)