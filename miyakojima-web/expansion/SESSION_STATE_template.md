# 🧠 SESSION STATE - 자동 복원용

## 📍 현재 위치
- **프로젝트**: [PROJECT_NAME]
- **단계**: [CURRENT_STAGE] [COMPLETION]% 완료
- **날짜**: [CURRENT_DATE]
- **버전**: [PROJECT_VERSION]

## ✅ 완료된 작업
[COMPLETED_TASKS_LIST]

## 🔄 현재 진행 중
[IN_PROGRESS_TASKS]

## 🚨 남은 작업 - 즉시 실행 필요
[PENDING_TASKS_LIST]

## 📋 핵심 사용자 규칙 (절대 준수)
1. **문서 필수** → 테스트 필수 → push 필수 → 버전 업데이트 필수
2. **SPEC-KIT 방법론** 적용 필수 (constitution.md, spec-template.md 등)
3. **MCP agent mode opus** 계획작업 필수
4. **작업 후 정리/삭제** 시 사용자 승인 필수
5. **[PROJECT_SPECIFIC_RULE]**

## 🎯 다음 세션 즉시 할 일 (우선순위 순)
1. **SESSION_STATE.md + CORE_DNA.md 읽기** (필수)
2. **[PROJECT_SPECIFIC_NEXT_ACTION]**
3. **TodoWrite 확인** - 진행 상황 파악
4. **[PRIORITY_TASK]**

## 🔧 시스템 구축 상태
✅ SESSION_STATE.md: 자동 복원용
✅ CORE_DNA.md: 절대 규칙 보존
✅ CLAUDE.md: SPEC-KIT 기반 재구성
✅ MCP_MATRIX.md: 상황별 도구 자동 선택
✅ RECOVERY_GUIDE.md: 30초 복원 가이드
✅ **완전한 auto-compact 대응 시스템 완성**
✅ **다른 프로젝트 즉시 확장 가능한 구조 완성**

## 🔧 현재 파일 상태
[CURRENT_FILES_STATUS]

---

## 📝 템플릿 사용법

### 신규 프로젝트 적용 시 수정할 부분:

1. **[PROJECT_NAME]** → 실제 프로젝트명
2. **[CURRENT_STAGE]** → 현재 작업 단계 (예: "1단계", "MVP 개발", "베타 테스팅")
3. **[COMPLETION]** → 완료율 (예: "67", "25", "90")
4. **[CURRENT_DATE]** → 현재 날짜
5. **[PROJECT_VERSION]** → 프로젝트 버전 (예: "v1.0.0", "v2.1.5-beta")

6. **[COMPLETED_TASKS_LIST]** → 완료된 작업 목록 (예: "- API 설계 완료\n- 데이터베이스 스키마 구축")
7. **[IN_PROGRESS_TASKS]** → 진행 중인 작업
8. **[PENDING_TASKS_LIST]** → 남은 작업 목록

9. **[PROJECT_SPECIFIC_RULE]** → 프로젝트별 특수 규칙
10. **[PROJECT_SPECIFIC_NEXT_ACTION]** → 프로젝트별 다음 액션
11. **[PRIORITY_TASK]** → 최우선 작업
12. **[CURRENT_FILES_STATUS]** → 현재 파일 상태

### 프로젝트 유형별 예시:

#### React 웹앱 프로젝트:
```markdown
- **프로젝트**: awesome-react-app
- **단계**: 컴포넌트 개발 단계 45% 완료
- **PROJECT_SPECIFIC_RULE**: **컴포넌트 테스트 필수** - 모든 컴포넌트 Storybook + Jest 테스트
- **PROJECT_SPECIFIC_NEXT_ACTION**: **Storybook 설정 완료**
```

#### Node.js API 서버:
```markdown
- **프로젝트**: secure-api-server
- **단계**: API 엔드포인트 개발 60% 완료
- **PROJECT_SPECIFIC_RULE**: **보안 검증 필수** - 모든 API Postman + 보안 테스트
- **PROJECT_SPECIFIC_NEXT_ACTION**: **인증 미들웨어 완성**
```

#### Python AI 프로젝트:
```markdown
- **프로젝트**: smart-ml-model
- **단계**: 모델 훈련 30% 완료
- **PROJECT_SPECIFIC_RULE**: **데이터 검증 필수** - 모든 데이터셋 품질 검사 + 시각화
- **PROJECT_SPECIFIC_NEXT_ACTION**: **Feature Engineering 완료**
```