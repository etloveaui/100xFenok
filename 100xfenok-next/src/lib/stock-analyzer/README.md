# Stock Analyzer Contracts (Skeleton)

이 디렉터리는 #257 Week3 Phase6-1 선행 작업용 계약 초안을 둡니다.

## 현재 상태 (스켈레톤)
- `types.ts`는 다음 4개 단위를 최소 인터페이스로 정의합니다.
- Dashboard: 상태/컨트롤러 계약
- Chart: 시리즈/차트 모델 계약
- DataProvider: 데이터 로딩 소스 계약
- Filter: 필터 상태/파이프라인 계약
- 구현체(로직, fetch, 계산, React hook)는 아직 포함하지 않습니다.

## 다음 단계 구현 범위 (Phase6-2+)
- DataProvider 구현: 기존 정적 JSON 입력원을 Provider로 분리
- Dashboard state 구현: 전역 상태(`window.*`) 의존 제거
- Filter pipeline 구현: `FilterManager`, `AdvancedFilter*` 로직 단계적 이관
- Chart adapter 구현: Chart.js lifecycle을 React 컴포넌트 경계로 분리
- 회귀 검증: 기존 `stock_analyzer.html` 결과와 주요 KPI 동등성 확인

## 비범위
- 이번 단계에서 `public/tools/stock_analyzer/*` 대규모 리라이트 금지
- 이번 단계에서 UI/스타일 변경 금지
