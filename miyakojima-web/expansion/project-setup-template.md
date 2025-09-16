# 🚀 신규 프로젝트 30초 세팅 템플릿

## 🎯 목적
미야코지마 웹에서 완성된 auto-compact 대응 시스템을 다른 프로젝트에 즉시 적용하는 템플릿

## ⚡ 30초 설정 프로세스

### 1단계: 파일 복사 (10초)
```bash
# 4개 핵심 파일 복사
cp SESSION_STATE.md [NEW_PROJECT]/
cp CORE_DNA.md [NEW_PROJECT]/
cp MCP_MATRIX.md [NEW_PROJECT]/
cp RECOVERY_GUIDE.md [NEW_PROJECT]/

# automation 폴더 전체 복사
cp -r automation/ [NEW_PROJECT]/

# expansion 폴더 전체 복사
cp -r expansion/ [NEW_PROJECT]/
```

### 2단계: PROJECT_DNA.md 생성 (10초)
```bash
# 템플릿에서 새 프로젝트용 생성
cp PROJECT_DNA_template.md [NEW_PROJECT]/PROJECT_DNA.md
# 프로젝트 정보 수정 (자동화 스크립트 활용)
```

### 3단계: CLAUDE.md 커스터마이징 (10초)
```bash
# 템플릿에서 새 프로젝트용 생성
cp CLAUDE_template.md [NEW_PROJECT]/CLAUDE.md
# 프로젝트별 특화 정보 주입
```

## 📋 템플릿 파일 목록

### 필수 시스템 파일들
1. **SESSION_STATE_template.md** - 세션 상태 추적 템플릿
2. **CORE_DNA_template.md** - 절대 규칙 템플릿 (거의 동일)
3. **PROJECT_DNA_template.md** - 프로젝트별 맞춤형 정보
4. **CLAUDE_template.md** - 프로젝트별 CLAUDE.md 헌법

### 자동화 시스템 (공통)
- **automation/** 폴더 전체 - MCP 오케스트레이션, 체크포인트, 복원 시스템

### 확장 시스템 (공통)
- **expansion/** 폴더 전체 - 다른 프로젝트 확장용

## 🎯 적용 가능한 프로젝트 유형

### ✅ 완벽 적용 가능
- **웹 앱 프로젝트** - React, Vue, Vanilla JS 등
- **API 서버 프로젝트** - Node.js, Python, Java 등
- **모바일 앱 프로젝트** - React Native, Flutter 등
- **데스크톱 앱 프로젝트** - Electron, Tauri 등

### 🔧 부분 적용 + 커스터마이징
- **임베디드 프로젝트** - MCP 도구 선택 조정 필요
- **AI/ML 프로젝트** - 특화된 MCP 도구 추가 필요
- **게임 개발 프로젝트** - 게임 엔진별 특화 설정

### ❌ 적용 불가
- **문서 작업 전용** - 너무 단순해서 시스템 오버헤드
- **일회성 스크립트** - 지속적인 세션이 없는 작업

## 🔧 프로젝트 유형별 커스터마이징 가이드

### React 프로젝트
```markdown
# PROJECT_DNA.md 수정 포인트
- 기술 스택: React, TypeScript, Vite
- 주요 MCP 도구: Context7 (React 문서), Magic (UI 컴포넌트)
- 특화 파일 패턴: src/components/, src/hooks/
```

### Node.js API 서버
```markdown
# PROJECT_DNA.md 수정 포인트
- 기술 스택: Node.js, Express, MongoDB/PostgreSQL
- 주요 MCP 도구: Context7 (Express 문서), Sequential (API 설계)
- 특화 파일 패턴: routes/, models/, middleware/
```

### Python AI 프로젝트
```markdown
# PROJECT_DNA.md 수정 포인트
- 기술 스택: Python, TensorFlow/PyTorch, Jupyter
- 주요 MCP 도구: Context7 (ML 문서), Sequential (모델 설계)
- 특화 파일 패턴: notebooks/, models/, data/
```

## 📊 성공 지표

### 설정 완료 체크리스트
- [ ] 4개 핵심 파일 복사 완료
- [ ] PROJECT_DNA.md 프로젝트 정보 수정 완료
- [ ] CLAUDE.md 프로젝트별 헌법 설정 완료
- [ ] automation/ 폴더 작동 확인
- [ ] 첫 번째 auto-compact 대응 테스트 성공

### 30초 설정 성공 기준
1. **파일 복사**: 10초 이내 완료
2. **정보 수정**: 10초 이내 완료
3. **시스템 검증**: 10초 이내 완료
4. **전체 시간**: 30초 이내 완료

## 🚀 확장 효과 예상

### 1개월 후 예상 상황
- **10개 프로젝트**에 시스템 적용
- **auto-compact 문제 99% 해결**
- **프로젝트 간 전환 시간 90% 단축**
- **작업 연속성 100% 보장**

### 6개월 후 예상 상황
- **50개+ 프로젝트** 생태계 구축
- **완전 자동화된** 프로젝트 관리
- **AI 어시스턴트와의 완벽한 협업** 시스템
- **무제한 확장 가능한** 스마트 개발 환경

---

## 🎯 다음 단계: universal-system/ 구축

이 템플릿이 완성되면 universal-system/ 폴더에서 전체 아키텍처를 구성하여 진정한 "무제한 확장 시스템"을 완성합니다.

**목표**: 어떤 프로젝트든 30초 내에 완벽한 AI 협업 환경 구축! 🚀