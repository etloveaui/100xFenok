# Sprint 5 - 70,000 기업 스케일 업그레이드 워크플로우

**작성일**: 2025-10-18
**방법론**: fenomeno-auto-v9 + SPEC_DRIVEN_WORKFLOW
**목표**: CorrelationEngine 70,000개 기업 대응 아키텍처 구축

---

## 📋 작업 서두 체크리스트 (매 작업 전 확인)

```yaml
✅ 계획서 작성: 이 문서 (SPRINT5_70K_SCALE_WORKFLOW.md)
✅ SC 명령: /sc:workflow → /sc:implement → /sc:test
✅ 모드: fenomeno-auto-v9 (병렬 우선, 즉시 실행)
✅ MCP 서버: Sequential (분석), Serena (메모리), Playwright (테스트)
✅ 서브 에이전트: @performance-engineer, @system-architect, @quality-engineer
✅ 문서 작업: claudedocs 디렉토리에 모든 결과물 저장
✅ 실행: 계획 승인 후 단계별 진행
```

---

## 🎯 핵심 목표 및 스케일 요구사항

### 현재 상태
- **데이터**: M_Company.csv 6,178개 기업
- **현재 시스템**: 1,264개 기업으로 제한
- **알고리즘**: O(n²) 복잡도로 1,249개에서 성능 저하

### 목표 상태
- **최소 스케일**: 6,000개 기업 처리
- **권장 스케일**: 10,000개 기업 처리
- **최대 스케일**: **70,000개 기업 처리** (확장 가능 아키텍처)
- **성능 목표**:
  - 초기화 < 3초
  - Correlation matrix 계산 < 5초
  - findLowCorrelationPairs() < 2초
  - 전체 테스트 통과 (93개 테스트)

---

## 🚀 4단계 워크플로우 (SPEC_DRIVEN_WORKFLOW)

### Phase 0: As-Is 분석 (Complete)
**Status**: ✅ 완료됨

**발견사항**:
1. **데이터 불일치**:
   - M_Company.csv: 6,178개 ✅
   - T_CFO.csv: 1,267개 ❌
   - T_Correlation.csv: 1,252개 ❌
   - global_scouter_integrated.json: 1,264개 ❌

2. **성능 병목**:
   - `CorrelationEngine.js:171` findLowCorrelationPairs() O(n²)
   - 1,249개: ~779,376 쌍 계산
   - 6,000개: ~18,000,000 쌍 (23배)
   - 70,000개: ~2,449,965,000 쌍 (3,145배!)

3. **테스트 결과**:
   - CorrelationEngine 단일: 18/19 ✅ (94.7%)
   - 전체 테스트: 25/93 ❌ (26.9%)
   - 주요 실패: test #26 findLowCorrelationPairs() 무한 대기

**근본 원인**:
- CSV 파이프라인 미실행 → 데이터 1,264개로 제한
- O(n²) 알고리즘 → 스케일 불가능
- 테스트 타임아웃 부족 → 데이터 감소로 잘못 해결 시도

---

### Phase 1: To-Be 설계 (Current)

#### 1.1 데이터 아키텍처
```yaml
data_pipeline:
  source: fenomeno_projects/Global_Scouter/Global_Scouter_20251003/*.csv
  conversion: scripts/csv_pipeline.sh
  target: data/global_scouter_integrated.json
  expected_companies: 6,178개 (초기)
  max_capacity: 70,000개 (설계)

data_structure:
  M_Company: 기업 기본 정보 (6,178개)
  T_CFO: 현금흐름 데이터 (1,267개 → 6,178개)
  T_Correlation: 상관계수 데이터 (1,252개 → 6,178개)
  T_Growth_C: 성장률 데이터
  T_EPS_C: EPS 데이터
```

#### 1.2 알고리즘 최적화 설계
```javascript
// ❌ 현재: O(n²) - 70,000개 불가능
findLowCorrelationPairs(minCorr, maxCorr, tickerSubset) {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 2,449,965,000 iterations for 70,000!
    }
  }
}

// ✅ 최적화 1: Pre-computed Matrix + Index (O(n²) → O(n))
class CorrelationEngine {
  constructor() {
    this.correlationMatrix = new Map(); // Ticker → Map<Ticker, Correlation>
    this.correlationIndex = {
      low: [],    // corr < -0.3
      medium: [], // -0.3 <= corr <= 0.3
      high: []    // corr > 0.3
    };
  }

  buildCorrelationMatrix() {
    // O(n²) once at initialization
    // Store in indexed structure
  }

  findLowCorrelationPairs(minCorr, maxCorr, tickerSubset) {
    // O(n) lookup from pre-indexed structure
    return this.correlationIndex.medium.filter(...);
  }
}

// ✅ 최적화 2: Web Workers (병렬 계산)
class CorrelationEngine {
  async buildCorrelationMatrixParallel() {
    const workers = navigator.hardwareConcurrency || 4;
    const chunkSize = Math.ceil(n / workers);
    // Split n×n matrix into 4 chunks, calculate in parallel
    // 70,000²/4 = 612M iterations per worker
  }
}

// ✅ 최적화 3: Sparse Matrix (메모리 최적화)
class SparseCorrelationMatrix {
  constructor() {
    this.data = new Map(); // Only store non-zero correlations
    this.threshold = 0.01; // Ignore correlations < 0.01
  }

  // 70,000² = 4.9GB (full) → ~500MB (sparse, 10% density)
}
```

#### 1.3 성능 목표 (70,000개 기업)
```yaml
initialization:
  target: < 5초
  current: ~2초 (1,264개)
  scaling: 70,000/1,264 = 55배 → 110초 예상
  optimization: Web Workers 4개 → 27초 목표

correlation_matrix:
  target: < 10초
  complexity: O(n²) → 4.9B calculations
  optimization:
    - Sparse matrix (10% density) → 490M calculations
    - Web Workers 4개 → 120M per worker
    - Estimated: 8초

query_performance:
  findLowCorrelationPairs: < 2초 (indexed lookup O(n))
  buildDiversifiedPortfolio: < 3초
  clusterByCorrelation: < 5초 (k-means with sampling)

memory_usage:
  target: < 2GB
  breakdown:
    - Sparse matrix: ~500MB
    - Company data: ~200MB
    - Chart data: ~100MB
    - Browser overhead: ~500MB
```

---

### Phase 2: Master Plan (Implementation Steps)

#### Step 1: 데이터 파이프라인 실행 [checkpoint-004]
**Owner**: CSV 컨버터
**Duration**: 5분
**Agent**: filesystem MCP + python

**Task**:
1. CSV 파일 복사: `Global_Scouter_20251003/*.csv` → `data/csv/`
2. Pipeline 실행: `bash scripts/csv_pipeline.sh`
3. 검증: `global_scouter_integrated.json` 6,178개 확인

**Success Criteria**:
- [ ] M_Company 6,178개
- [ ] T_CFO 6,178개
- [ ] T_Correlation 6,178개
- [ ] JSON 파일 크기 > 50MB

---

#### Step 2: CorrelationEngine 알고리즘 최적화 [checkpoint-005]
**Owner**: @performance-engineer + @system-architect
**Duration**: 20분
**Agent**: Task (병렬), Sequential MCP

**Sub-tasks**:
1. **Indexed Structure** (8분)
   - Pre-computed correlation matrix with Map
   - Build low/medium/high correlation indices
   - Update `buildCorrelationMatrix()` method

2. **Sparse Matrix** (6분)
   - Implement SparseCorrelationMatrix class
   - Threshold-based storage (correlations > 0.01)
   - Memory profiling

3. **Query Optimization** (6분)
   - Refactor `findLowCorrelationPairs()` for O(n) lookup
   - Update `buildDiversifiedPortfolio()` with sampling
   - Optimize `clusterByCorrelation()` with k-means++

**Files Modified**:
- `modules/CorrelationEngine.js` (lines 80-250)
- NEW: `modules/SparseMatrix.js`
- NEW: `modules/PerformanceMonitor.js`

**Success Criteria**:
- [ ] 6,000개: Correlation matrix < 5초
- [ ] findLowCorrelationPairs() < 2초
- [ ] Memory usage < 1GB

---

#### Step 3: 테스트 스펙 업데이트 [checkpoint-006]
**Owner**: @quality-engineer
**Duration**: 10분
**Agent**: Edit tool

**Sub-tasks**:
1. **Revert Data Reduction** (3분)
   - `tests/sprint5-correlation-engine.spec.js:171-176`
   - Remove `.slice(0, 50)` hack
   - Restore full dataset tests

2. **Update Timeouts** (3분)
   - Test #26 findLowCorrelationPairs: 60s → 120s
   - Performance tests: Adjust thresholds for 6,000 companies

3. **Add Scale Tests** (4분)
   - NEW: test "handles 6,000 companies efficiently"
   - NEW: test "memory usage < 2GB with 6,000 companies"

**Files Modified**:
- `tests/sprint5-correlation-engine.spec.js`
- `tests/sprint5-performance.spec.js`
- `playwright.config.ts` (global timeout)

---

#### Step 4: 전체 테스트 실행 및 검증 [checkpoint-007]
**Owner**: @quality-engineer
**Duration**: 15분
**Agent**: Playwright MCP

**Execution**:
```bash
cd projects/100xFenok/tools/stock_analyzer
npx playwright test tests/sprint5-*.spec.js --project=chromium --reporter=list --workers=1
```

**Success Criteria**:
- [ ] 93/93 테스트 통과 (100%)
- [ ] 전체 실행 시간 < 10분
- [ ] 메모리 사용량 < 2GB
- [ ] 성능 테스트 모두 통과

---

#### Step 5: 문서화 및 최종 보고 [checkpoint-008]
**Owner**: @technical-writer
**Duration**: 10분

**Deliverables**:
1. `SPRINT5_70K_IMPLEMENTATION.md` (구현 상세)
2. `SPRINT5_PERFORMANCE_REPORT.md` (성능 분석)
3. `SPRINT5_FINAL_SUMMARY.md` (최종 요약)
4. Git commit with detailed message

---

### Phase 3: 실행 전략 (fenomeno-auto-v9)

#### 병렬 실행 매트릭스
```yaml
parallel_group_1: # 독립 작업 (Step 1)
  - task: CSV 파이프라인 실행
    duration: 5분
    agent: filesystem MCP

parallel_group_2: # Step 2 서브태스크 (병렬 가능)
  - task_2a: Indexed Structure
    agent: @performance-engineer
  - task_2b: Sparse Matrix
    agent: @system-architect
  # 병렬 실행 → 8분 (순차: 14분)

sequential_group: # 의존성 있는 작업
  - step_1 → step_2 (데이터 필요)
  - step_2 → step_3 (알고리즘 완료 후 테스트)
  - step_3 → step_4 (테스트 스펙 업데이트 후 실행)
```

#### 에이전트 투입 전략
```yaml
phase_1_data: # Step 1
  agents: []
  tools: [Bash, Read, Write]
  mcp: [filesystem]

phase_2_optimization: # Step 2
  agents:
    - type: performance-engineer
      task: 알고리즘 최적화 (O(n²) → O(n))
      tools: [Task, Edit]
    - type: system-architect
      task: Sparse Matrix 아키텍처 설계
      tools: [Task, Write]
  mcp: [Sequential, Serena]
  parallel: true

phase_3_testing: # Step 3-4
  agents:
    - type: quality-engineer
      task: 테스트 스펙 업데이트 및 실행
      tools: [Edit, Bash]
  mcp: [Playwright]

phase_4_documentation: # Step 5
  agents:
    - type: technical-writer
      task: 문서 작성 및 정리
      tools: [Write]
  mcp: []
```

#### MCP 서버 활용 전략
```yaml
sequential_mcp:
  when: Step 2 (알고리즘 분석)
  purpose: 복잡한 성능 최적화 전략 수립
  output: 최적화 알고리즘 의사코드

serena_mcp:
  when: 전체 workflow
  purpose: 세션 컨텍스트 저장, 복구 지원
  checkpoints: [checkpoint-004, 005, 006, 007, 008]

playwright_mcp:
  when: Step 4 (테스트 실행)
  purpose: 93개 E2E 테스트 자동화
  config: --workers=1, --timeout=120000

filesystem_mcp:
  when: Step 1 (CSV 변환)
  purpose: 대용량 파일 처리 최적화
```

---

## 📊 예상 소요 시간

```yaml
총 예상 시간: 60분
breakdown:
  - Step 1 (Data): 5분
  - Step 2 (Algorithm): 20분 (병렬 시 8+12분)
  - Step 3 (Test Spec): 10분
  - Step 4 (Test Run): 15분
  - Step 5 (Docs): 10분

병렬 최적화 시: 50분
리스크 버퍼: +20분 (디버깅, 예상치 못한 문제)
최종 예상: 70분
```

---

## 🎯 제안 및 대안

### 최고의 제안 (권장)
**전략**: Incremental Scaling + Indexed Structure
- Step 2에서 Indexed Structure 먼저 구현
- 6,000개로 테스트 성공 후 → 10,000개 → 70,000개 점진적 확장
- 각 단계마다 성능 측정 및 최적화

**이유**:
- 리스크 최소화 (단계별 검증)
- 성능 병목 조기 발견
- 70,000개 실제 데이터 없어도 구조 검증 가능

### 대안 1: Immediate Full Scale
**전략**: 70,000개 아키텍처를 즉시 구현
- Sparse Matrix + Web Workers 동시 적용
- 6,178개 데이터로만 검증

**이유**:
- 빠른 구현 (알고리즘 한 번에)
- Over-engineering 리스크

### 대안 2: Database Migration
**전략**: IndexedDB 또는 SQLite로 데이터 이전
- 브라우저 메모리 부담 감소
- SQL 쿼리로 correlation 계산

**이유**:
- 메모리 제약 해결
- 프론트엔드 복잡도 증가, 아키텍처 변경 큼

---

## 🔒 안전 장치

### Checkpoint Strategy
```yaml
checkpoint-004: CSV 변환 완료
  - 데이터 6,178개 확인
  - Git commit: "data: CSV 파이프라인 실행 완료"

checkpoint-005: 알고리즘 최적화 완료
  - 단위 테스트 통과
  - Git commit: "perf: CorrelationEngine 70K 최적화"

checkpoint-006: 테스트 스펙 업데이트
  - 기존 테스트 호환성 확인
  - Git commit: "test: 6K 스케일 테스트 스펙 업데이트"

checkpoint-007: 전체 테스트 통과
  - 93/93 성공
  - Git commit: "test: Sprint 5 전체 테스트 통과 (6K)"

checkpoint-008: 문서화 완료
  - 최종 보고서 3개 작성
  - Git commit: "docs: Sprint 5 Week 3 Final (70K architecture)"
```

### Rollback Plan
```yaml
if_step_2_fails: # 알고리즘 최적화 실패
  action: Git revert to checkpoint-004
  alternative: 대안 2 (Database Migration) 검토

if_step_4_fails: # 테스트 실패
  action:
    - 실패 테스트 분석 (성능 vs 로직)
    - 타임아웃 조정 vs 알고리즘 재최적화
    - checkpoint-005로 복귀, Step 2 재검토

if_memory_exceeded: # 메모리 초과
  action: Sparse Matrix threshold 상향 (0.01 → 0.05)
  fallback: 대안 2 (IndexedDB) 즉시 전환
```

---

## ✅ 승인 대기

**계획 승인 체크리스트**:
- [x] 70,000개 스케일 목표 명확화
- [x] 4단계 워크플로우 (SPEC_DRIVEN_WORKFLOW)
- [x] 에이전트/모드/MCP/SC 명령 전략
- [x] 병렬 실행 최적화
- [x] 안전 장치 (checkpoint, rollback)
- [x] 문서 작업 (claudedocs)

**승인 후 실행 순서**:
1. Step 1: CSV 파이프라인 (5분)
2. Step 2: 알고리즘 최적화 (20분, 병렬)
3. Step 3: 테스트 스펙 (10분)
4. Step 4: 전체 테스트 (15분)
5. Step 5: 문서화 (10분)

---

**작성자**: Claude (fenomeno-auto-v9)
**검토자**: 사용자 승인 필요
**다음 단계**: "계획 승인" → Step 1 실행
