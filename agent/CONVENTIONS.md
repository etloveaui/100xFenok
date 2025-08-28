# Agent Conventions (공통 규칙)

## 파일/폴더 규칙
- 워크로그: `agent/<agent>-WORKLOG-YYYYMMDD.md`
- 계획서: `tools/fed/phases/PHASE*.md` (페이즈별)
- 개요: `tools/fed/PHASES.md`
- 자료: `tools/fed/notes/` , 보관: `tools/fed/archive/`

## 기록 규칙(필수)
- 변경 요약: 파일 경로, 핵심 diff 요약(1~3줄)
- 근거/의사결정: 대안, 선택 이유
- 테스트: 동선/케이스/예상 결과
- 롤백: 복구 절차
- 다음 단계: 체크리스트

## 개발 동선
- 프록시 실행 → 위젯/상세 수동 검증 → 상태 로그 확인 → 자동 갱신 확인
- 데이터 결측 처리 원칙: 최신 1년 관측에서 뒤에서부터 숫자 2개 선택
- 스프레드(bp): `Δ×100` 정수 표기, 월말/월초 완충 적용

## 커밋/PR(권장)
- Conventional Commits, 작은 단위, 스크린샷/동영상 첨부(시각 요소 변경 시)

