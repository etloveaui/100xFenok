# Phase 1 — 핵심 알림/안정화 (FED Monitor)

## 목표
- IORB < SOFR 여부를 즉시 식별하고 경보(RED)·주의(ORANGE)를 시각화
- 월말/월초 스파이크에 대한 완충 라벨 반영(오탐 감소)
- 상세 페이지에 TGA(Treasury General Account) 카드 추가(주간)
- 사이트 톤과 일관되게 UI 정돈(폰트/색/여백)

## 산출물
- 위젯 UI/로직 업데이트: `tools/fed/fed-monitor-widget.html`
- 상세 모니터 페이지 업데이트: `tools/fed/fed-rates-detail.html`
- 공통 유틸(내장): 최신 유효값 선택, 스프레드/상태 계산, 월말 라벨러
- 작업 로그 갱신: `agent/codex-WORKLOG-YYYYMMDD.md`

## 상태 규칙 v2 (확정)
- GREEN: 정상 순서(IORB > EFFR > SOFR), 스프레드 > 15bp
- YELLOW: 정상 순서, 스프레드 ≤ 15bp
- ORANGE: 스프레드 ≤ 5bp 또는 월말/월초 완충 구간
- RED: IORB ≤ SOFR(역전)
- 월말/월초 완충: 말일 전후 2영업일 + 다음달 초 2영업일 라벨링

## 구현 체크리스트
- 데이터 처리
  - [ ] 최신값 선택 시 결측(".") 스킵(최근 1년 범위에서 뒤에서부터 숫자 2개)
  - [ ] IORB−SOFR 스프레드(bp) 계산(Δ×100, 반올림 규칙 통일)
  - [ ] 월말/월초 판정 유틸(영업일 기준, 로컬 단순판정 → 차후 영업일 캘린더로 개선)
- 위젯(UI)
  - [ ] INVERSION 배지(RED): `SOFR > IORB` 시 상단 고정 배지 + 점멸 LED
  - [ ] SPREAD 강조: `n bp`를 대형 숫자로 노출(정상 시)
  - [ ] 색/폰트/간격 정돈: 사이트 톤과 통일(Orbitron/Noto, 경계/음영 최소)
- 상세(UI)
  - [ ] 상단 상태 배너(RED/ORANGE/YELLOW/GREEN 텍스트·아이콘)
  - [ ] 4개 카드(현행) + TGA 카드 추가(주간, 최신 유효값 백필, 업데이트일자 표기)
  - [ ] 월말/월초 구간 라벨
- 안정성/오류 처리
  - [ ] 네트워크·결측 시 배지(“DATA PENDING”/“ERROR”)
  - [ ] 5분 자동 갱신, 초기화 트리거(DOMContentLoaded/Load/Timeout) 점검

## 수용 기준(Acceptance)
- (위젯) SOFR > IORB 상태에서 2초 내 RED 배지 표출, bp 수치가 0 이상 정수로 표시
- (상세) 모든 카드에 숫자/화살표 표출, TGA는 최신 유효값/업데이트일자 표기
- (공통) 월말/월초 구간에 ORANGE 또는 보조 라벨 표시(오탐 경보 감소)
- (성능) 초기 렌더링 1초 내 컨텐츠 뼈대 표시, 3초 내 데이터 반영(로컬 프록시 기준)

## 테스트
- 로컬 프록시: `node scripts/dev/fred-proxy.js`
- 위젯: `/?path=tools/fed/fed-monitor-widget.html`
- 상세: `/?path=tools/fed/fed-rates-detail.html`
- 케이스: 정상/수렴(≤15bp)/심수렴(≤5bp)/역전(>0bp 반대로) — 날짜 변경 모의(쿼리 기간 조정)

## 리스크/대응
- FRED CORS: 정적 배포 시 서버리스 프록시 필요(Cloudflare Worker 등)
- 주간 시계열 공백: 최신 유효값 백필로 보완, 업데이트일자 병기
- 월말 판단 오탐: 1차 단순판정 → Phase 2에서 캘린더 기반으로 보정

