# CLAUDE.md - Stock Analyzer 핵심 가이드

**작성일**: 2025년 10월 19일
**최종 업데이트**: 2025년 10월 19일
**목적**: Claude Code 작업 시 필수 준수사항

---

## 🚀 QUICK REFERENCE

### 필수 파일 읽기 트리거

**매 세션 시작 시 필수**:
1. ✅ **CLAUDE.md** (이 파일) - 핵심 원칙
2. ✅ **docs/CLAUDE_PROTOCOLS.md** - 세션 시작 프로토콜 실행
3. ✅ **docs/Sprint*_*/SPRINT*_MASTER_PLAN.md** - 현재 작업 파악

**파일 작업 전 필수**:
- ✅ **docs/CLAUDE_PROTOCOLS.md** - 파일 작업 검증 프로토콜

**프로젝트 참조 필요 시**:
- ✅ **docs/PROJECT_REFERENCE.md** - 디렉터리 구조, 데이터, 워크플로우

---

## 🎯 절대 작업 경로

```
C:\Users\etlov\agents-workspace\projects\100xFenok\tools\stock_analyzer
```

**⚠️ CRITICAL**: 이 경로에서만 작업. 다른 경로 절대 사용 금지.

**잘못된 경로 (절대 사용 금지)**:
- ❌ `fenomeno_projects/`
- ❌ `fenomeno_knowledge/`
- ❌ 기타 모든 상대 경로

---

## 📋 프로젝트 개요

**Stock Analyzer - 100xFenok Project**
- Sprint 4: 5개 모듈 완료 (93/93 tests, 100%)
- Sprint 5: 2개 모듈 구현 완료 ⚠️ **테스팅 미완** (20/85, 24%)
- Sprint 6: 2개 모듈 계획 (EconomicIndicators, ETFAnalytics)
- 목표: 10,000개 기업까지 확장 가능한 시스템

---

## 🔒 사용자 절대 원칙 (4개)

### 원칙 1: 테스트 철학
**"테스트란 모두 원활하게 되는지를 체크하는 것"**

- ✅ 전체 데이터셋으로 테스트 (1,249개 → 10,000개 확장)
- ❌ 데이터 축소/슬라이싱 절대 금지 (`.slice()` 사용 금지)
- ❌ 테스트 실패 시 데이터 줄이기 금지
- ✅ 테스트 실패 → **시스템을 고쳐서 통과시킨다**

### 원칙 2: 확장성 우선
**"10,000개까지 확장하되 중단 없이 진행"**

- ✅ 아키텍처는 로딩/성능이 느려지지 않게 설계
- ✅ 모듈이 많아져도 적절하게 동작하게 만들기
- ✅ 안되면 되게 하는 시스템을 만드는 것
- ❌ 요구사항을 줄이는 것이 아니라 시스템을 개선

### 원칙 3: 완전한 이해 후 실행
**"모든 계획, 모든 워크플로우, 모든 상황, 모든 문서 파악"**

- ✅ 작업 전 브리핑 필수
- ✅ 문제점 파악 절차 수립 (워크플로우)
- ❌ 계획 없는 즉흥 작업 금지
- ✅ SuperClaude SC 에이전트 워크플로우 준수

### 원칙 4: 절대 원칙 준수
**"어떤 상황에서건 내가 하라는 절대 원칙대로 하라"**

- ❌ 편의성/속도를 이유로 원칙 위반 금지
- ✅ 테스트 실패 → 데이터 줄이기 대신 시스템 개선
- ✅ 성능 문제 → 요구사항 축소 대신 O(n) 최적화
- ✅ 복잡도 증가 → 기능 제거 대신 아키텍처 개선

---

## 🔍 Phase 0 원칙 (5개)

**⚠️ CRITICAL**: 신규 프로젝트 또는 대규모 데이터 작업 시작 전 필수 확인

### 원칙 1: 전체 데이터 완전 파악
**"샘플만 보고 전체 추정 금지"**

- ✅ 모든 데이터 소스 상세 분석 (전수 조사)
- ✅ 베이스 데이터 vs 계산 결과물 구분
- ✅ 필수 vs 선택 데이터 분류
- ❌ 일부 샘플만 보고 전체 구조 추정
- ❌ 데이터 관계 불명확한 상태에서 개발 시작

### 원칙 2: 변환 파이프라인 검증
**"원본 → 중간 → 최종 정확성 보장"**

- ✅ 원본 데이터 (xlsb, xlsx) → CSV 변환 검증
- ✅ 여러 버전/주차 샘플 테스트
- ✅ 자동 검증 로직 (레코드 수, 필드 수, 인코딩)
- ❌ 한 번만 변환하고 검증 안 함

### 원칙 3: 명문화 최우선
**"완전한 레퍼런스 작성 = 미래 시간 절약"**

- ✅ 전체 데이터 구조 완전 문서화
- ✅ 향후 참조 가능한 상세 문서
- ✅ 의사결정 근거 기록
- ❌ 머릿속 이해만으로 진행

### 원칙 4: 성급한 개발 금지
**"Phase 0 생략 = 미래 2배 시간 낭비"**

- ✅ 데이터 완전 이해 후 개발 시작
- ✅ Phase 0 → Phase 1 → Phase 2 순차 진행
- ❌ 데이터 일부만 파악하고 바로 코딩
- ❌ "개발하면서 알아가자" 접근

**Phase 0 필수 조건** (하나라도 해당 시):
1. 신규 프로젝트 시작
2. 데이터 소스 > 5개
3. 데이터 관계 불명확
4. 변환 파이프라인 미검증
5. 전체 데이터 구조 미파악

### 원칙 5: 계획 먼저, 문서 먼저
**"계획 업데이트 → 개발 → 회고 사이클"**

- ✅ 새로운 발견 → 즉시 계획 재검토
- ✅ MASTER_PLAN 먼저 업데이트
- ✅ 문서 업데이트 후 개발 진행
- ❌ 개발 먼저 하고 나중에 문서
- ❌ 계획 무시하고 즉흥 작업

---

## 🚀 작업 시작 전 필수 체크리스트

**⚠️ CRITICAL**: 모든 Task 시작 전 반드시 4단계 확인!

### Step 1: Sub-agent 투입 가능성 확인 ✅

| 작업 유형 | 추천 에이전트 | 투입 조건 |
|----------|-------------|----------|
| **아키텍처 설계** | @system-architect | 새 모듈, 구조 설계 |
| **성능 최적화** | @performance-engineer | O(n²) → O(n), 병목 해결 |
| **근본 원인 분석** | @root-cause-analyst | 버그, 실패 원인 추적 |
| **테스트 작성** | @quality-engineer | 단위/E2E 테스트 |
| **코드 리팩토링** | @refactoring-expert | 코드 정리, 기술 부채 |
| **문서 작성** | @technical-writer | API 문서, 가이드 |

**투입 기준**:
- 복잡도 > 0.7 → Task 에이전트 필수
- 3개 이상 파일 수정 → 전문 에이전트
- 성능 critical → @performance-engineer

### Step 2: Mode 선택 ✅

| Mode | 활성화 조건 | 효과 |
|------|----------|------|
| **--task-manage** | 3단계 이상 작업 | 체계적 관리, TodoWrite 자동 |
| **--orchestrate** | 병렬 가능 작업 | 도구 최적화, 병렬 실행 |
| **--think-hard** | 복잡한 분석 | 깊은 사고, ~10K tokens |
| **--delegate** | >7 dirs OR >50 files | Sub-agent 병렬 처리 |

### Step 3: MCP 서버 활용 ✅

| MCP 서버 | 사용 시점 | 장점 |
|---------|---------|------|
| **Sequential** | 구조적 분석, 다단계 추론 | 체계적 사고, 증거 기반 |
| **Playwright** | 브라우저 테스트 | 실제 브라우저 E2E |
| **Context7** | 패턴/문서 참조 | 공식 문서, 베스트 프랙티스 |

### Step 4: 병렬 실행 가능성 평가 ✅

**병렬 가능 조건**:
- 작업 간 의존성 없음
- 파일 충돌 없음
- 독립적인 검증 가능

---

## 🚨 금지 사항 요약

### 경로 관련
- ❌ fenomeno_projects/, fenomeno_knowledge/ 작업
- ❌ 상대 경로 사용
- ✅ 절대 경로만 사용

### 테스트 관련
- ❌ `.slice()` 사용하여 테스트 데이터 줄이기
- ❌ 테스트 실패 시 데이터 축소
- ❌ 테스트 skip, disable
- ✅ 전체 데이터셋으로 검증
- ✅ 시스템 개선으로 통과

### 파일 작업 관련
- ❌ 폴더 전체 삭제 (rm -rf)
- ❌ 사용자 확인 없이 삭제
- ❌ 백업 없이 대량 삭제
- ✅ 파일별 선택 삭제
- ✅ 사용자 명시적 확인

### 개발 관련
- ❌ Phase 0 생략
- ❌ 계획 없는 즉흥 작업
- ❌ 문서 분석만 하고 생성 안 함
- ❌ MASTER_PLAN 업데이트 누락
- ✅ 계획 → 문서 → 개발 순서
- ✅ 작업 완료 즉시 MASTER_PLAN 업데이트

---

## 📚 관련 문서 (필수 읽기)

### 세션 시작 시 필수
1. **CLAUDE.md** (이 파일)
2. **docs/CLAUDE_PROTOCOLS.md**
   - 세션 시작 프로토콜 (5 steps)
   - 파일 작업 검증 프로토콜 (3 steps)
   - MASTER_PLAN 업데이트 프로토콜
3. **현재 Sprint MASTER_PLAN.md**
   - docs/Sprint4_DataIntegration/SPRINT4_MASTER_PLAN.md
   - docs/Sprint5_*/SPRINT5_MASTER_PLAN.md (있으면)
   - docs/Sprint6_EconomicETF/SPRINT6_MASTER_PLAN.md

### 작업 중 참조
- **docs/PROJECT_REFERENCE.md** - 프로젝트 구조, 데이터, 워크플로우
- **docs/Sprint*_DataIntegration/FULL_DATA_ANALYSIS_AND_ROADMAP.md** - 전체 로드맵

---

## ⚡ 작업 체크리스트 (간단)

### 세션 시작 시
- [ ] pwd 확인 (올바른 경로?)
- [ ] CLAUDE.md 읽기
- [ ] CLAUDE_PROTOCOLS.md → 세션 시작 프로토콜 실행
- [ ] MASTER_PLAN 현재 상태 파악
- [ ] Git status 확인
- [ ] 브리핑 작성

### 파일 작업 시
- [ ] CLAUDE_PROTOCOLS.md → 파일 작업 검증 프로토콜 실행
- [ ] 경로 검증 (pwd)
- [ ] 내용 확인 (ls -la)
- [ ] 사용자 확인 요청

### Task 작업 시
- [ ] MASTER_PLAN Read (시작 전)
- [ ] TodoWrite 생성/업데이트
- [ ] MASTER_PLAN Edit (완료 후)
- [ ] 임시 파일 정리

### Git Commit 전
- [ ] 테스트 전체 통과
- [ ] 문서 업데이트 완료
- [ ] 잘못된 경로 파일 제거
- [ ] CLAUDE.md/PROTOCOLS 준수 확인

---

## 🎓 SuperClaude SC 에이전트

- `@root-cause-analyst`: 근본 원인 분석
- `@performance-engineer`: 성능 최적화
- `@quality-engineer`: 테스트 및 품질 보증
- `@system-architect`: 시스템 아키텍처 설계
- `@technical-writer`: API 문서, 가이드

---

**최종 업데이트**: 2025년 10월 19일
**작성자**: Claude Code (Sonnet 4.5)
**프로젝트**: Stock Analyzer - 100xFenok
**Sprint**: Sprint 5 (테스팅 미완) → Sprint 6 준비

---

**⚠️ 매 세션 시작 시 이 문서 + CLAUDE_PROTOCOLS.md 필수 읽기!**
