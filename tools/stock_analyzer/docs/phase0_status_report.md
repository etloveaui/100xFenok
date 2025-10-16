# Phase 0-1: 현재 파일 구조 분석 보고서 (As-Is)

**작성일**: 2025-10-16
**작성자**: Claude Code (Sonnet 4.5)
**목적**: Phase 0 환경 정리를 위한 현황 파악

---

## 📊 전체 개요

### 프로젝트 위치
```
작업 프로젝트: C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer
데이터 소스: C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter
참조 문서: C:\Users\etlov\agents-workspace\fenomeno_knowledge
```

### 배포 정보
- **Git 리포**: https://github.com/etloveaui/100xFenok.git
- **사이트**: https://etloveaui.github.io/100xFenok/
- **앱 URL**: https://etloveaui.github.io/100xFenok/?path=tools/stock_analyzer/stock_analyzer.html
- **현재 상태**: 🔴 **버그 있음** (사용자 확인)

---

## 📂 디렉토리 구조 분석

### 1. 메인 HTML 파일들

| 파일명 | 크기 | 날짜 | 용도 | 상태 |
|--------|------|------|------|------|
| `stock_analyzer.html` | 62KB | 10/16 | 메인 애플리케이션 | ✅ 사용 중 |
| `stock_analyzer_enhanced.js` | 186KB | 10/16 | 메인 JS 로직 | ✅ 사용 중 |
| `test_momentum_modules.html` | 24KB | 10/16 | Phase 2 테스트 | 🟡 테스트용 |
| `test_integration.html` | 12KB | 10/16 | Phase 2 통합 테스트 | 🟡 테스트용 |
| `test_modal_fix.html` | 17KB | 10/09 | 버그 픽스 테스트 | ⚠️ 임시 |
| `debug_data_loading.html` | 14KB | 10/09 | 디버그용 | ⚠️ 임시 |
| `IMMEDIATE_FIX.html` | 3.2KB | 10/09 | 긴급 수정용 | ⚠️ 임시 |

**분석**:
- 메인 파일: 2개 (stock_analyzer.html + .js)
- 테스트 파일: 2개 (Phase 2 관련)
- 임시 파일: 3개 (디버그/수정용) → **정리 필요**

---

### 2. modules/ 디렉토리 (핵심 모듈)

#### 2.1 크기별 분류

| 모듈 | 크기 | 날짜 | 타입 | 중복 가능성 |
|------|------|------|------|-------------|
| **Momentum** | 276KB | Phase 2 신규 | 모멘텀 분석 | ⚠️ MomentumHeatmap과 중복? |
| **EconomicDashboard** | 128KB | Phase 3 완료 | 경제 지표 | ⚠️ E_Indicators와 중복? |
| **Core** | 128KB | 기존 | 핵심 시스템 | ✅ 필수 |
| **E_Indicators** | 84KB | Phase 3 진행 중 | 경제 지표 | ⚠️ EconomicDashboard과 중복? |
| **MomentumHeatmap** | 76KB | 기존 | 모멘텀 히트맵 | ⚠️ Momentum과 중복? |
| **DeepCompare** | 64KB | 기존 | 기업 비교 | ✅ 사용 중 |
| **PortfolioBuilder** | 56KB | 기존 | 포트폴리오 | ✅ 사용 중 |
| **SmartAnalytics** | 13KB | 기존 | 분석 도구 | ✅ 사용 중 |

#### 2.2 단일 파일 모듈

| 파일 | 크기 | 기능 | 상태 |
|------|------|------|------|
| PortfolioManager.js | 40KB | 포트폴리오 관리 | ✅ 사용 중 |
| AdvancedSearchManager.js | 32KB | 고급 검색 | ✅ 사용 중 |
| AdvancedFilter.js | 32KB | 고급 필터 | ✅ 사용 중 |
| AdvancedChartManager.js | 28KB | 차트 관리 | ✅ 사용 중 |
| ResponsiveManager.js | 24KB | 반응형 | ✅ 사용 중 |
| FilterManager.js | 24KB | 필터 | ✅ 사용 중 |
| AdvancedFilterEnhancer.js | 24KB | 필터 강화 | ✅ 사용 중 |
| DataCleanupManager.js | 20KB | 데이터 정리 | ✅ 사용 중 |
| DashboardManager.js | 20KB | 대시보드 | ✅ 사용 중 |
| ChartManager.js | 20KB | 차트 | ✅ 사용 중 |
| LoadingManager.js | 20KB | 로딩 | ✅ 사용 중 |
| PerformanceManager.js | 16KB | 성능 | ✅ 사용 중 |
| ErrorFixManager.js | 16KB | 에러 수정 | ⚠️ 임시? |
| PaginationManager.js | 12KB | 페이지네이션 | ✅ 사용 중 |
| ColumnManager.js | 12KB | 컬럼 관리 | ✅ 사용 중 |

**총 단일 파일 모듈**: 15개

---

### 3. 🚨 중복 분석 (Critical)

#### 3.1 경제 지표 모듈 중복

**EconomicDashboard (128KB, Phase 3 완료)**
```
modules/EconomicDashboard/
├── EconomicDashboard.js (533줄)
├── components/
│   ├── TEDSpreadChart.js (331줄)
│   ├── HighYieldHeatmap.js (365줄)
│   ├── TreasuryRateCurve.js (402줄)
│   └── EconomicAlertCenter.js (384줄)
└── styles/
    └── economic-dashboard.css (600줄)

총 2,615줄, Phase 3 완료, 웹 네이티브 모듈
기능: TED Spread, High-Yield Heatmap, Treasury Curve, Alert Center
```

**E_Indicators (84KB, Phase 3 진행 중)**
```
modules/E_Indicators/
├── E_Indicators.js (완료)
├── EconomicDataProcessor.js (완료)
└── E_Indicators.test.js (완료)

Phase 3 진행 중, 새로 작성
기능: 경제 사이클 분류, 복합 지수, 국가별 랭킹
```

**중복 평가**:
- ⚠️ **70% 기능 중복** (경제 지표 대시보드)
- EconomicDashboard: 이미 완성, 사용 중
- E_Indicators: 새로 작성, 미통합
- **결론**: 통합 또는 역할 분리 필요

#### 3.2 모멘텀 모듈 중복

**Momentum (276KB, Phase 2 완료)**
```
modules/Momentum/
├── M_Company.js (15.6KB)
├── MomentumCalculator.js (8.2KB)
├── RankingEngine.js (7.5KB)
├── FilterEngine.js (9.3KB)
├── MomentumVisualizer.js (11.8KB)
├── CompanyDetailView.js (12.4KB)
├── CompanyComparison.js (10.9KB)
├── M_Company.test.js (28.7KB)
└── README.md (14.2KB)

Phase 2 완료, 7개 컴포넌트, 테스트 포함
기능: 모멘텀 계산, 랭킹, 필터, 시각화, 기업 상세/비교
```

**MomentumHeatmap (76KB, 기존)**
```
modules/MomentumHeatmap/
├── MomentumHeatmap.js
├── components/
└── styles/

기존 모듈, 히트맵 시각화 특화
기능: 모멘텀 히트맵 대시보드
```

**중복 평가**:
- ⚠️ **50% 기능 중복** (모멘텀 시각화)
- Momentum: 포괄적, Phase 2 완료
- MomentumHeatmap: 히트맵 특화
- **결론**: MomentumHeatmap을 Momentum의 Visualizer로 통합 가능

---

### 4. 데이터 관련 파일

#### 4.1 data/ 디렉토리
```
data/
├── enhanced_summary_data.json (주 데이터)
├── enhanced_summary_data_clean.json
├── summary_data.json (기존)
├── column_config.json
├── enhanced_column_config.json
├── backups/ (3개 백업)
└── screener_indices/ (momentum, quality, value)
```

**분석**:
- ✅ 데이터 구조 정리됨
- ✅ 백업 시스템 작동 중
- ⚠️ JSON 파일 중복 (enhanced vs clean)

#### 4.2 config/ 디렉토리
```
config/
├── csv_config.json
├── data_config.json
├── field_mappings.json
└── validation_rules.json
```

**분석**: ✅ 설정 파일 정리됨

---

### 5. 자동화 스크립트

#### 5.1 automation/ 디렉토리
```
automation/
├── AutoUpdater.py
├── backup_manager.py
├── DataCleaner.py
├── data_cleaner_v2.py (⚠️ v2 존재)
├── data_validator.py
├── enhanced_data_processor.py
├── quality_report.py
├── run_automation.py
├── run_weekly_update.py
├── SchemaValidator.py
└── WeeklyDataProcessor.py
```

**분석**:
- ⚠️ data_cleaner_v2.py 존재 (v1 제거?)
- ✅ 주간 업데이트 자동화 있음
- ✅ 품질 보고 시스템 있음

#### 5.2 archive/ 디렉토리
```
archive/
├── analyze_csv_structure.py
├── build_enhanced_data.py
├── create_clean_json.py
├── create_proper_data.py
├── fix_json_data.py
├── fix_percentage_data.py
├── verify_data_quality.py
└── README.md
```

**분석**: ✅ 구 스크립트 보관됨 (정리 양호)

---

### 6. 문서 파일

#### 6.1 프로젝트 루트 MD 파일
```
stock_analyzer/
├── BUGFIX_MODAL_BLOCKING.md (버그 픽스 기록)
├── DATA_FIX_REPORT.md (데이터 수정 기록)
├── GLOBAL_EXPANSION_STATUS.md (확장 현황)
└── docs/
    ├── AGENT_COLLABORATION_GUIDE.md
    ├── FOUNDATION_DOCUMENTATION.md
    ├── IMPLEMENTATION_ROADMAP.md
    └── PHASE_0_ARCHITECTURE.md
```

**분석**:
- ✅ docs/ 폴더 존재 (Phase 0 문서 저장 가능)
- ⚠️ 루트의 MD 파일들 docs/로 이동 검토

#### 6.2 Fenomeno/ 디렉토리
```
Fenomeno/
├── Claude_.md
├── Claude_instruction.md
├── Codex_instruction.md
└── Gem_instruction.md
```

**분석**: ⚠️ 에이전트별 지침, 통합 검토 필요

---

### 7. 테스트 및 배포

#### 7.1 deployment/ 디렉토리
```
deployment/
├── AutoRollback.js
├── CanaryDeployment.js
├── DeploymentDashboard.js
├── HealthMonitor.js
└── SmartDeploymentSystem.js
```

**분석**: ✅ 배포 시스템 구축됨

#### 7.2 core/ 디렉토리
```
core/
├── DataSkeleton.js
├── EventSystem.js
├── UIFramework.js
├── LegacyBridge.js
├── ModuleRegistry.js
└── interfaces/
    └── DataInterface.js
```

**분석**: ✅ 핵심 아키텍처 정리됨

---

## 🔍 데이터 파이프라인 분석

### Global_Scouter (데이터 소스)

#### 파일 현황
```
C:\Users\etlov\agents-workspace\fenomeno_projects\Global_Scouter\

✅ Global_Scouter_20251003.xlsb (86MB, 최신)
✅ xlsb_to_csv.py (3.6KB, 컨버터)
✅ converter.py (2.6KB)
✅ validator.py (2.1KB)
✅ interactions.py (4.1KB)
✅ xlsb_to_csv_사용설명서.md
```

#### 컨버터 기능
```python
# xlsb_to_csv.py
- XLSB → CSV 변환
- 특정 시트 또는 전체 시트
- 라이브러리: pandas, pyxlsb, openpyxl

사용법:
python xlsb_to_csv.py input.xlsb output.csv -s all
```

**현황**:
- ✅ 컨버터 존재
- ⚠️ XLSB → JSON 직접 변환 미확인
- ⚠️ stock_analyzer와의 연동 확인 필요

---

## 🐛 확인된 문제점

### 1. 모듈 중복 (Critical)
- EconomicDashboard ↔ E_Indicators (70% 중복)
- Momentum ↔ MomentumHeatmap (50% 중복)

### 2. 임시 파일 (Medium)
- test_modal_fix.html
- debug_data_loading.html
- IMMEDIATE_FIX.html
- ErrorFixManager.js

### 3. 데이터 파이프라인 (High)
- XLSB → JSON 직접 변환 미확인
- automation/ 스크립트 활용도 불명
- 주간 업데이트 자동화 검증 필요

### 4. 문서 분산 (Low)
- 루트 MD 파일들 docs/로 통합 검토
- Fenomeno/ 지침 통합 검토

### 5. 버전 관리 (Medium)
- data_cleaner_v2.py 존재 (v1 처리?)
- enhanced vs clean JSON 중복

---

## 📋 정리 대상 후보

### 즉시 삭제 가능
```
❌ test_modal_fix.html (버그 픽스 완료 시)
❌ debug_data_loading.html (디버그 완료 시)
❌ IMMEDIATE_FIX.html (긴급 수정 완료 시)
```

### 통합 검토 필요
```
⚠️ EconomicDashboard + E_Indicators → 통합 전략
⚠️ Momentum + MomentumHeatmap → 통합 전략
⚠️ enhanced_summary_data.json + clean → 하나로
⚠️ DataCleaner.py + data_cleaner_v2.py → v2로 통일
```

### 이동 검토
```
→ BUGFIX_MODAL_BLOCKING.md → docs/bugfixes/
→ DATA_FIX_REPORT.md → docs/reports/
→ GLOBAL_EXPANSION_STATUS.md → docs/
→ Fenomeno/*.md → docs/agent-instructions/ or 삭제
```

---

## ✅ 다음 단계 (Phase 0-2)

1. **중복 모듈 통합 전략 수립**
   - EconomicDashboard vs E_Indicators
   - Momentum vs MomentumHeatmap

2. **데이터 파이프라인 검증**
   - XLSB → JSON 변환 테스트
   - automation/ 스크립트 실행 테스트

3. **정리 계획 작성**
   - 삭제 대상 명확화
   - 이동 대상 구조화
   - 백업 전략 수립

---

**Phase 0-1 분석 완료**
**다음**: Phase 0-2 (Cleanup Strategy Design)