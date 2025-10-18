# CLAUDE.md - Stock Analyzer 프로젝트 가이드

**작성일**: 2025년 10월 18일
**목적**: Claude Code 작업 시 필수 준수사항 및 경로 명시

---

## 🎯 절대 작업 경로

```
C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer
```

**⚠️ CRITICAL**: 이 경로에서만 작업. 다른 경로 절대 사용 금지.

**잘못된 경로 (절대 사용 금지)**:
- ❌ `fenomeno_projects/Global_Scouter`
- ❌ `fenomeno_projects/20251015_Stock_Prompt_Claude`
- ❌ 기타 모든 상대 경로

---

## 📋 프로젝트 개요

**Stock Analyzer - 100xFenok Project**
- Sprint 4: Analytics 모듈 (Growth, Ranking, EPS)
- Sprint 5: CFO Analytics + CorrelationEngine
- 목표: 10,000개 기업까지 확장 가능한 시스템

---

## 🔒 사용자 절대 원칙

### 원칙 1: 테스트 철학
**"테스트란 모두 원활하게 되는지를 체크하는 것"**

- ✅ 전체 데이터셋으로 테스트 (1,249개 → 10,000개 확장)
- ❌ 데이터 축소/슬라이싱 절대 금지
- ❌ `.slice()` 사용하여 테스트 데이터 줄이기 금지
- 테스트 실패 시: 데이터를 줄이지 말고 **시스템을 고쳐서 통과시킨다**

### 원칙 2: 확장성 우선
**"10,000개까지 확장하되 중단 없이 진행"**

- 아키텍처는 로딩/성능이 느려지지 않게 설계
- 모듈이 많아져도 적절하게 동작하게 만들기
- 안되면 되게 하는 시스템을 만드는 것이 중요
- 요구사항을 줄이는 것이 아니라 시스템을 개선

### 원칙 3: 완전한 이해 후 실행
**"모든 계획, 모든 워크플로우, 모든 상황, 모든 문서 파악"**

- 작업 전 브리핑 필수
- 문제점 파악 절차 수립 (워크플로우)
- 계획 없는 즉흥 작업 금지
- SuperClaude SC 에이전트 워크플로우 준수

### 원칙 4: 절대 원칙 준수
**"어떤 상황에서건 내가 하라는 절대 원칙대로 하라"**

- 편의성/속도를 이유로 원칙 위반 금지
- 테스트 실패 → 데이터 줄이기 대신 시스템 개선
- 성능 문제 → 요구사항 축소 대신 O(n) 최적화
- 복잡도 증가 → 기능 제거 대신 아키텍처 개선

---

## 📂 디렉터리 구조

```
C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer/
├── CLAUDE.md                   # 이 파일 - 필수 가이드
├── stock_analyzer.html         # 메인 HTML
├── playwright.config.js        # Playwright 설정 (포트 8080)
├── package.json                # Node.js 의존성
│
├── modules/                    # 핵심 모듈 (25개)
│   ├── CorrelationEngine.js   # O(n) 최적화 완료 (34K)
│   ├── CFOAnalytics.js        # CFO 분석 (24K)
│   ├── EPSAnalytics.js        # EPS 분석 (17K)
│   ├── GrowthAnalytics.js     # 성장률 분석 (13K)
│   └── RankingAnalytics.js    # 순위 분석 (15K)
│
├── data/                       # JSON 데이터
│   ├── global_scouter_integrated.json  # 통합 데이터
│   ├── M_Company.json         # 6,176 companies
│   ├── T_CFO.json             # 1,264 companies
│   ├── T_Correlation.json     # 1,249 companies
│   └── [20+ other JSON files]
│
├── tests/                      # E2E 테스트 (Playwright)
│   ├── sprint4-*.spec.js      # Sprint 4 tests (52+)
│   ├── sprint5-*.spec.js      # Sprint 5 tests (108+)
│   ├── global-setup.ts        # 테스트 전역 설정
│   ├── global-teardown.ts     # 테스트 정리
│   └── README.md              # 테스트 가이드
│
├── scripts/                    # 변환/유틸리티 스크립트
│   ├── simple_csv_converter.py
│   ├── fix_csv_conversion.py
│   └── csv_pipeline.sh/bat
│
├── js/                         # 프론트엔드 JavaScript
│   ├── analytics/
│   └── DashboardManager.js
│
├── core/                       # 코어 시스템
│   ├── DataSkeleton.js
│   ├── EventSystem.js
│   └── UIFramework.js
│
└── docs/                       # 문서
    ├── PHASE2_REPORT.md
    ├── PHASE3_REPORT.md
    └── README.md
```

---

## 🔧 핵심 기술 스택

- **Frontend**: Vanilla JavaScript, Chart.js 4.4.0, Tailwind CSS
- **Testing**: Playwright (E2E), 6 browsers (chromium, firefox, webkit, mobile)
- **Data**: JSON (converted from CSV), 6,176 companies dataset
- **Performance**: O(n) optimized algorithms, <3s initialization target
- **Server**: Python http.server (port 8080)

---

## ⚡ 성능 최적화 원칙

### CorrelationEngine O(n) 최적화 (완료)
```javascript
// 5-bucket indexed structure for O(n) lookups
correlationIndex = {
    veryLow: [],    // < -0.5
    low: [],        // -0.5 to -0.1
    neutral: [],    // -0.1 to 0.1
    medium: [],     // 0.1 to 0.5
    high: []        // > 0.5
}
```

**성능 목표**:
- 1,249 companies: 현재 기준 (<3초 초기화)
- 10,000 companies: 목표 (<5초 초기화)
- findLowCorrelationPairs: O(n) bucket filtering (<2초)

---

## 🧪 테스트 실행

### 전체 테스트 실행
```bash
cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer
npx playwright test
```

### 특정 테스트 실행
```bash
npx playwright test tests/sprint5-correlation-engine.spec.js
npx playwright test tests/sprint5-cfo-analytics.spec.js
```

### 테스트 데이터 원칙
```javascript
// ❌ 절대 금지
const tickers = correlationData.slice(0, 10).map(c => c.Ticker);

// ✅ 올바른 방법
const tickers = correlationData.map(c => c.Ticker);
```

**이유**: 테스트는 실제 환경(1,249개 → 10,000개)에서 시스템이 원활하게 작동하는지 검증하는 것

---

## 📊 데이터 현황

### JSON 데이터 (변환 완료)
| 파일 | 레코드 수 | 상태 | 용도 |
|------|----------|------|------|
| M_Company.json | 6,176 | ✅ | 기업 마스터 데이터 |
| T_CFO.json | 1,264 | ✅ | CFO 분석 |
| T_Correlation.json | 1,249 | ✅ | 상관관계 분석 |
| T_EPS_C.json | - | ✅ | EPS 분석 |
| T_Growth_C.json | - | ✅ | 성장률 분석 |
| T_Rank.json | - | ✅ | 순위 분석 |

### RAW 데이터 위치 (참조용)
```
fenomeno_projects/Global_Scouter/Global_Scouter_20251003/
```
**용도**: CSV 원본 보관, 재변환 필요 시에만 참조

---

## 🔄 주간 데이터 업데이트 워크플로우

### 매주 반복 작업 프로세스

**사용자가 매주 수행:**

1. **엑셀 다운로드**
   ```
   Global_Scouter_YYMMDD.xlsx (1개 파일)
   └── 시트별 데이터 포함 (M_Company, T_EPS_C, T_Growth_C, T_Rank, T_CFO, T_Correlation 등)
   ```

2. **Python 변환 스크립트 실행**
   ```bash
   cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer
   python scripts/simple_csv_converter.py
   ```

3. **자동 처리 (스크립트가 수행)**
   - 엑셀 → CSV 쪼개기 (시트별)
   - CSV → JSON 변환
   - 개별 JSON 파일 생성:
     - `data/M_Company.json`
     - `data/T_EPS_C.json`
     - `data/T_Growth_C.json`
     - `data/T_Rank.json`
     - `data/T_CFO.json`
     - `data/T_Correlation.json`

4. **결과**
   - 기존 JSON 파일 덮어쓰기 ✅
   - 시스템 자동 반영 (HTML 리로드 시)

### 파일 명명 규칙

**중요:** 엑셀 시트명 = JSON 파일명

```
엑셀 시트          →  CSV 파일            →  JSON 파일
M_Company       →  M_Company.csv      →  M_Company.json
T_EPS_C         →  T_EPS_C.csv        →  T_EPS_C.json
T_Growth_C      →  T_Growth_C.csv     →  T_Growth_C.json
T_Rank          →  T_Rank.csv         →  T_Rank.json
T_CFO           →  T_CFO.csv          →  T_CFO.json
T_Correlation   →  T_Correlation.csv  →  T_Correlation.json
```

### 데이터 로딩 구조

**시스템이 개별 JSON 파일 직접 로딩:**

```javascript
// HTML에서 각 분석 모듈이 개별 JSON 로딩
EPSAnalytics.js        → fetch('data/T_EPS_C.json')
GrowthAnalytics.js     → fetch('data/T_Growth_C.json')
RankingAnalytics.js    → fetch('data/T_Rank.json')
CFOAnalytics.js        → fetch('data/T_CFO.json')
CorrelationEngine.js   → fetch('data/T_Correlation.json')
```

**장점:**
- 매주 업데이트 시 파일 덮어쓰기만 하면 끝
- 자동화 간단 (스크립트 1회 실행)
- 추가 통합 작업 불필요

### ⚠️ 절대 금지

**개별 JSON 파일 삭제 금지:**
- ❌ T_EPS_C.json 삭제
- ❌ T_Growth_C.json 삭제
- ❌ T_Rank.json 삭제
- ❌ T_CFO.json 삭제
- ❌ T_Correlation.json 삭제

**이유:** 매주 업데이트 워크플로우에 필수

**통합 JSON (선택):**
- `global_scouter_integrated.json`: 편의용 (선택)
- 개별 JSON이 메인 소스

---

## 🚨 일반적인 실수 방지

### 실수 1: 잘못된 경로에서 작업
```bash
# ❌ 절대 금지
cd fenomeno_projects/Global_Scouter
npm test

# ✅ 올바른 방법
cd C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer
npm test
```

### 실수 2: 테스트 데이터 축소
```javascript
// ❌ 절대 금지 - 테스트 실패 시 데이터 줄이기
const testData = allData.slice(0, 100);

// ✅ 올바른 방법 - 알고리즘 최적화로 전체 데이터 처리
const testData = allData; // 전체 1,249개 사용
// O(n²) → O(n) 최적화로 성능 개선
```

### 실수 3: 계획 없는 즉흥 작업
```yaml
# ❌ 잘못된 접근
- 바로 코딩 시작
- 에러 발생하면 임기응변
- 테스트 실패하면 데이터 줄이기

# ✅ 올바른 접근
1. 모든 상황/문서/워크플로우 파악
2. 브리핑 작성
3. 문제점 분석 절차 수립
4. SC 에이전트 워크플로우 따라 실행
5. 테스트 실패 → 시스템 개선 (데이터 축소 ❌)
```

### 실수 4: 성능 문제 시 요구사항 축소
```yaml
# ❌ 잘못된 해결
문제: "10,000개 처리 시 느림"
해결: "1,000개만 처리하도록 제한"

# ✅ 올바른 해결
문제: "10,000개 처리 시 느림"
해결:
  - O(n²) → O(n) 알고리즘 최적화
  - 인덱싱 구조 도입 (correlationIndex)
  - 캐싱 전략 적용
  - 청크 단위 처리
```

---

## 🎯 Sprint 5 Week 3 진행 상황

### ✅ 완료 항목
- CorrelationEngine O(n) 최적화 (10/18 05:56)
- CFOAnalytics 모듈 구현 (10/18 01:02)
- 데이터 변환 완료 (M_Company, T_CFO, T_Correlation)
- HTML/JS 파일 올바른 경로 복사 (10/18 12:38)

### 🔄 진행 중
- 테스트 데이터 슬라이싱 제거 (5개 위치)
- 테스트 인프라 설정 (global-setup/teardown)
- 전체 테스트 실행 (108 tests, 전체 데이터셋)

### 📊 목표
- 108/108 tests passing (100%)
- 1,249 companies 전체 데이터로 테스트
- 10,000 companies 확장 준비 완료

---

## 📝 작업 체크리스트

### 작업 시작 전 필수 확인
- [ ] 올바른 경로에서 작업 중인지 확인 (`pwd` 실행)
- [ ] 브리핑 작성 완료
- [ ] 문제점 파악 절차 수립
- [ ] SC 에이전트 워크플로우 확인

### 코드 수정 시 필수 확인
- [ ] 테스트 데이터 슬라이싱(`.slice()`) 없음
- [ ] 전체 데이터셋으로 테스트
- [ ] O(n) 최적화 적용 (성능 중요 부분)
- [ ] 10,000개 확장 고려

### 테스트 실행 시 필수 확인
- [ ] 올바른 경로에서 실행
- [ ] 전체 테스트 실행 (일부만 ❌)
- [ ] 실패 시 시스템 개선 (데이터 축소 ❌)
- [ ] 성능 메트릭 확인

### Git Commit 전 필수 확인
- [ ] 올바른 경로의 변경사항만 포함
- [ ] 잘못된 경로 파일 제거 완료
- [ ] 테스트 전체 통과
- [ ] CLAUDE.md 업데이트

---

## 📁 문서 체계 원칙

### 트리 구조 (MASTER_PLAN.md = 루트)

**모든 작업은 MASTER_PLAN.md를 중심으로 트리 구조 유지:**

```
MASTER_PLAN.md (최상위 인덱스)
└── Sprint X: [작업명]
    ├── Phase 0: As-Is Analysis [✅/🔄/⏳]
    │   └── 📄 [SPRINT_X_ANALYSIS.md]
    ├── Phase 1: To-Be Design [✅/🔄/⏳]
    │   └── 📄 [SPRINT_X_DESIGN.md]
    ├── Phase 2: Master Plan [✅/🔄/⏳]
    │   └── Task 체크리스트 (MASTER_PLAN.md 내)
    └── Phase 3: Implementation [✅/🔄/⏳]
        ├── Task X.1: [작업명] [✅/🔄/⏳]
        ├── Task X.2: [작업명] [✅/🔄/⏳]
        └── Task X.3: [작업명] [✅/🔄/⏳]
```

**상태 표시:**
- ✅ 완료
- 🔄 진행 중
- ⏳ 대기

### 문서 배치 규칙

**Sprint별 폴더 구조:**
```
docs/
├── MASTER_PLAN.md (전체 인덱스 - 항상 최신)
├── ARCHITECTURE_BLUEPRINT.md (핵심)
├── API_SPECIFICATION.md (핵심)
├── DEPLOYMENT_GUIDE.md (핵심)
├── TESTING_QUICK_START.md (핵심)
├── USER_GUIDE.md (핵심)
│
├── Sprint1_XXX/
│   ├── SPRINT1_ANALYSIS.md (Phase 0)
│   └── SPRINT1_DESIGN.md (Phase 1)
├── Sprint2_XXX/
│   ├── SPRINT2_ANALYSIS.md
│   └── SPRINT2_DESIGN.md
├── Sprint3_FileCleanup/
│   ├── CLEANUP_ANALYSIS.md
│   └── CLEANUP_PLAN.md
├── Sprint4_DataIntegration/
│   ├── DATA_INTEGRATION_ANALYSIS.md (Phase 0)
│   └── DATA_INTEGRATION_DESIGN.md (Phase 1)
│
├── reports/ (Sprint 완료 보고서만)
└── archives/ (참고 문서 보관)
```

### 즉시 정리 원칙

**작업 중 계속 정리 (파일 방치 금지):**

1. **재생성 파일**
   - 새 버전 생성 → 이전 버전 즉시 삭제
   - 예: global_scouter_integrated.json 재생성 → 기존 파일 삭제

2. **통합 완료 시**
   - 개별 파일 통합 → 개별 파일 삭제 여부 결정
   - 예: 모든 T_*.json → 통합 JSON에 포함 → 개별 파일 삭제

3. **임시 파일**
   - 테스트 결과물 (playwright-report/, test-results/) → 즉시 삭제
   - 변환 품질 리포트 (conversion_quality_*.json) → 즉시 삭제
   - 디버깅 로그, 임시 스크립트 → 즉시 삭제

4. **Phase 완료 시**
   - 해당 Phase 문서들 → Sprint 폴더로 이동
   - 불필요해진 문서 → 즉시 삭제
   - MASTER_PLAN.md 업데이트 (완료 표시)

5. **Sprint 완료 시**
   - Sprint 보고서 → reports/ 폴더로 이동
   - 참고 문서 → archives/ 폴더로 이동
   - 핵심 문서만 docs 루트에 유지

### 문서 작성 원칙

**모든 Phase별 문서는:**
- 작업 목적 명확히
- 발견사항 기록
- 다음 Phase 연결고리 제시
- MASTER_PLAN.md에서 링크 연결

**MASTER_PLAN.md 관리:**
- 모든 Sprint/Phase/Task 상태 추적
- 완료 시각, Git commit hash 기록
- 다음 작업 명확히 표시

---

## 🔗 관련 문서

- `README.md`: 프로젝트 전체 개요
- `tests/README.md`: 테스트 가이드
- `docs/MASTER_PLAN.md`: 전체 작업 트리 인덱스
- `docs/reports/`: Sprint 완료 보고서
- `docs/archives/`: 참고 문서

---

## 🎓 학습 및 참고

### SuperClaude SC 에이전트
- `@root-cause-analyst`: 근본 원인 분석
- `@performance-engineer`: 성능 최적화
- `@quality-engineer`: 테스트 및 품질 보증
- `@refactoring-expert`: 코드 리팩토링
- `@system-architect`: 시스템 아키텍처 설계

### 성능 최적화 패턴
- **Indexed Structures**: O(n²) → O(n) 최적화
- **Caching**: 반복 계산 방지
- **Chunking**: 대용량 데이터 분할 처리
- **Lazy Loading**: 필요 시점에만 로딩

---

**최종 업데이트**: 2025년 10월 18일
**작성자**: Claude Code (Sonnet 4.5)
**프로젝트**: Stock Analyzer - 100xFenok
**Sprint**: Sprint 5 Week 3

---

**⚠️ 이 문서를 반드시 읽고 준수하세요!**
