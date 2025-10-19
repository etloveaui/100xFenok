# CLAUDE_PROTOCOLS.md - 재발방지 자동화 시스템

**작성일**: 2025년 10월 19일
**목적**: 반복적 실수 방지를 위한 강제 체크리스트 시스템
**트리거**: 세션 시작, 파일 작업, Task 시작/완료

---

## 🔒 세션 시작 프로토콜 (자동 실행)

**⚠️ CRITICAL**: 모든 세션 시작 시 반드시 실행!

```yaml
SESSION_START_CHECKLIST:

  Step 1: 경로 확인 (필수)
    - pwd 실행 및 출력
    - 예상: C:/Users/etlov/agents-workspace/projects/100xFenok/stock_analyzer
    - 불일치 시: 즉시 중단, 올바른 경로로 이동

  Step 2: CLAUDE.md 읽기 (필수)
    - Read: C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer/CLAUDE.md
    - 핵심 원칙 재확인
    - 변경사항 파악

  Step 3: CLAUDE_PROTOCOLS.md 읽기 (필수)
    - Read: docs/CLAUDE_PROTOCOLS.md (이 파일)
    - 프로토콜 재확인

  Step 4: MASTER_PLAN 상태 파악 (필수)
    - Read: docs/Sprint[X]_*/SPRINT[X]_MASTER_PLAN.md (첫 100 lines)
    - 현재 진행 중인 Task 확인
    - 다음 Task 확인
    - 완료 기준 확인

  Step 5: Git 상태 확인 (필수)
    - git status 실행
    - 변경된 파일 확인
    - Untracked 파일 확인
    - Commits ahead 확인

  Step 6: 브리핑 작성 (필수)
    - 현재 상황 요약
    - 다음 작업 목록
    - 예상 소요 시간
    - 사용자에게 보고
```

**자동화 규칙**:
- 세션 시작 시 자동으로 Step 1-6 순차 실행
- 하나라도 실패 시 즉시 중단
- 브리핑 없이 작업 시작 금지

---

## 📁 파일 작업 검증 프로토콜 (3단계)

**⚠️ CRITICAL**: 파일/폴더 생성/수정/삭제 전 반드시 실행!

```yaml
FILE_OPERATION_PROTOCOL:

  Step 1: 경로 검증 (필수)
    명령어:
      - pwd (현재 위치 확인)
      - 절대 경로 확인
      - 프로젝트 폴더 내부 확인

    확인사항:
      - ✅ C:/Users/etlov/agents-workspace/projects/100xFenok/tools/stock_analyzer
      - ❌ fenomeno_knowledge
      - ❌ fenomeno_projects
      - ❌ 기타 모든 경로

  Step 2: 내용 검증 (필수)
    명령어:
      - ls -la [대상 폴더]
      - wc -l [대상 파일] (파일 삭제 시)
      - du -sh [대상 폴더] (폴더 삭제 시)

    확인사항:
      - 파일 개수
      - 파일 크기
      - 백업 파일 여부
      - 중요 파일 존재 여부

  Step 3: 사용자 확인 (필수)
    출력 형식:
      "📋 파일 작업 확인
      경로: [절대 경로]
      작업: [생성/수정/삭제]
      대상: [파일/폴더명]
      개수: X개 파일
      크기: XXX MB

      계속하시겠습니까? (Y/N)"

    대기:
      - 사용자 명시적 확인 필요
      - Y 입력 후 진행
      - N 입력 시 즉시 중단
```

**금지 사항**:
- ❌ 폴더 전체 삭제 (rm -rf 금지)
- ❌ 파일별 확인 없이 일괄 삭제
- ❌ 사용자 확인 없이 진행
- ✅ 파일별 선택 삭제만 허용

---

## 📝 MASTER_PLAN 업데이트 프로토콜

**⚠️ CRITICAL**: 모든 Task 시작/완료 시 반드시 실행!

```yaml
MASTER_PLAN_UPDATE_PROTOCOL:

  Before Work (작업 시작 전):
    1. Read MASTER_PLAN.md
       - 현재 Task 상태 확인 (⏳/🔄/✅)
       - 완료 기준 재확인
       - 다음 Task 파악

    2. TodoWrite 생성
       - 현재 Task를 in_progress로 표시
       - 세부 작업 항목 나열
       - 예상 소요 시간 기록

    3. 작업 시작

  During Work (작업 진행 중):
    - TodoWrite 실시간 업데이트
    - 중간 체크포인트 기록 (30분마다)
    - 발견사항 즉시 메모

  After Work (작업 완료 후):
    1. MASTER_PLAN.md 즉시 업데이트
       - Task 상태: ⏳ → ✅
       - 완료 시각 기록
       - Git commit hash 기록
       - 완료 기준 체크박스 표시

    2. 관련 문서 생성/업데이트
       - API 문서 (필요 시)
       - 회고 문서 (Module 완료 시)
       - 분석 문서 (필요 시)

    3. TodoWrite 완료 표시
       - 현재 Task를 completed로 변경
       - 다음 Task를 in_progress로 변경

    4. 임시 파일 즉시 정리
       - playwright-report/ 삭제
       - test-results/ 삭제
       - temp_*.txt 삭제
```

**자동화 규칙**:
- Task 시작 = MASTER_PLAN Read 필수
- Task 완료 = MASTER_PLAN Edit 필수
- 중간에 MASTER_PLAN 업데이트 안 하면 경고

---

## ✅ 재발방지 체크리스트

**매 작업 시작 전 자가 점검:**

```markdown
## 재발방지 체크리스트

### 세션 시작 시
- [ ] pwd 확인 (올바른 경로?)
- [ ] CLAUDE.md 읽기 완료
- [ ] CLAUDE_PROTOCOLS.md 읽기 완료
- [ ] MASTER_PLAN 현재 상태 파악
- [ ] Git status 확인
- [ ] 브리핑 작성 완료

### 파일 작업 시
- [ ] 경로 검증 (pwd)
- [ ] 내용 확인 (ls -la)
- [ ] 사용자 확인 요청
- [ ] 파일별 선택 작업 (폴더 전체 ❌)

### Task 작업 시
- [ ] MASTER_PLAN Read (시작 전)
- [ ] TodoWrite 생성/업데이트
- [ ] MASTER_PLAN Edit (완료 후)
- [ ] 임시 파일 정리

### 문서 작업 시
- [ ] Read before Edit
- [ ] 분석만 하지 말고 실제 문서 생성
- [ ] Git commit 전 검증
```

---

## 🚨 위반 사례 및 대응

### Case 1: 잘못된 경로에서 파일 생성
```yaml
문제: fenomeno_knowledge/에 프로젝트 파일 생성
원인: 세션 시작 시 pwd 확인 안 함
대응:
  - 즉시 중단
  - pwd 실행
  - 올바른 경로로 이동
  - 작업 재시작
```

### Case 2: 폴더 전체 삭제
```yaml
문제: docs/ 폴더 전체 삭제
원인: 내용 확인 없이 rm -rf 실행
대응:
  - 즉시 중단
  - ls -la로 내용 확인
  - 사용자 확인 요청
  - 파일별 선택 삭제
```

### Case 3: MASTER_PLAN 업데이트 누락
```yaml
문제: Task 완료 후 MASTER_PLAN 미업데이트
원인: 작업 완료 후 업데이트 프로토콜 누락
대응:
  - 즉시 MASTER_PLAN Read
  - Task 상태 업데이트
  - Git commit hash 기록
  - 완료 기준 체크
```

### Case 4: 문서 분석만 하고 생성 안 함
```yaml
문제: 브리핑만 하고 실제 문서 작업 안 함
원인: "분석만 하지 말고 문서작업까지" 원칙 무시
대응:
  - 분석 완료 후 즉시 문서 생성
  - Write/Edit 도구 사용
  - Git commit으로 검증
```

### Case 5: 테스트 실패 시 데이터 축소
```yaml
문제: 테스트 실패 → .slice() 사용하여 데이터 줄이기
원인: "테스트 철학" 원칙 위반
대응:
  - 즉시 중단
  - .slice() 제거
  - 시스템 개선 (O(n) 최적화, 알고리즘 개선)
  - 전체 데이터셋으로 재테스트
```

---

## ⚙️ 강제 실행 규칙

**위반 시 자동 중단**:
1. 세션 시작 시 pwd 확인 안 함 → 즉시 중단
2. 파일 작업 시 사용자 확인 없음 → 즉시 중단
3. MASTER_PLAN 읽지 않고 Task 시작 → 즉시 중단
4. 문서 분석만 하고 생성 안 함 → 경고 후 중단
5. 테스트 데이터 축소 (.slice()) → 즉시 중단

**자가 모니터링**:
- 매 30분마다 체크리스트 재확인
- 위반 발생 시 즉시 자가 경고
- 반복 위반 시 세션 재시작

---

## 📋 프로토콜 요약

### 언제 이 파일을 읽어야 하는가?

**필수 읽기**:
1. ✅ **세션 시작 시** - SESSION_START_CHECKLIST 실행
2. ✅ **파일 작업 전** - FILE_OPERATION_PROTOCOL 실행
3. ✅ **Task 시작 전** - MASTER_PLAN_UPDATE_PROTOCOL (Before Work)
4. ✅ **Task 완료 후** - MASTER_PLAN_UPDATE_PROTOCOL (After Work)

**참조 읽기**:
- 위반 사례 발생 시 - 해당 Case 참조
- 프로토콜 불명확 시 - 전체 재확인

---

**최종 업데이트**: 2025년 10월 19일
**작성자**: Claude Code (Sonnet 4.5)
**프로젝트**: Stock Analyzer - 100xFenok

---

**⚠️ 이 프로토콜을 매 세션 시작 시 반드시 실행하세요!**
