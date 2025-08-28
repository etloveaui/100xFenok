# 100x FenoK – Agent Worklog (KOR)

## 개요
- 목적: FED Monitor(위젯/상세) 안정화 및 확장 준비, 개발 문서 정리
- 기간: 2025-08-28 ~

## 이번 변경 요약
- 위젯 인코딩/단위 보정
  - 화살표(상/하/보합) HTML 엔티티로 안전화
  - bp 표기 계산 보정(Δ×100)
- 상세 페이지 생성/보강
  - tools/fed/fed-rates-detail.html 스캐폴딩 + 값 표시 로직 개선(결측"." 백필, 1년치에서 최신 숫자 탐색)
  - 초기화 트리거 안정화(DOMContentLoaded/Load/timeout)
  - 돌아가기 버튼 제거(요청 반영)
  - 문서 스켈레톤(<!DOCTYPE html> 등)로 안정화
- 로컬 CORS 프록시(개발용)
  - scripts/dev/fred-proxy.js 추가
  - 로컬에서 자동 사용(127.0.0.1일 때 프록시로 라우팅)
- 네비/레이블
  - Workshop → Lab (nav.html)
  - Multichart 영문화 반영
- 계획 문서
  - tools/fed/PHASES.md 생성(Phase/체크리스트/데이터스펙/테스트 동선)

## 테스트 방법(로컬)
- 프록시: `node scripts/dev/fred-proxy.js`
- 위젯: `/?path=tools/fed/fed-monitor-widget.html`
- 상세: `/?path=tools/fed/fed-rates-detail.html`
- 확인 포인트
  - 숫자/화살표/스프레드 표기
  - 월말/월초 라벨(추가 예정)
  - 365일 스파크라인(차트 로딩)

## 다음 단계(요약)
- Phase 1
  - 상태 규칙 v2 반영(RED/ORANGE 포함) UI
  - TGA(WDTGAL) 카드/스파크라인 추가
  - 톤/간격/폰트 정렬(사이트 일관화)
  - AGENTS.md 업데이트(구조/프록시/테스트 가이드)
- Phase 2
  - 지급준비금(WRBWFRBL) 카드/차트
  - 스프레드 라인차트 + 임계선
- Phase 3
  - Insights 문서/네비 구축(문서: posts/insights/... 경로 후보)

## 제한/주의
- 정적 배포(CORS): 운영 시 서버리스 프록시 필요
- 주간 시계열(TGA/지급준비금)은 최신 유효값 백필 필요

## 참고 파일
- tools/fed/fed-monitor-widget.html
- tools/fed/fed-rates-detail.html
- scripts/dev/fred-proxy.js
- tools/fed/PHASES.md

