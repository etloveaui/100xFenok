# codex-WORKLOG-20260616

## 범위
- 대상: 100x legacy home(`/market` -> `/100x/100x-main.html`) 로딩 안정화.
- 목적: 데이터 파일 지연/부분 실패/깨진 메타데이터가 있어도 홈 화면이 무한 로딩이나 빈 화면으로 무너지지 않게 한다.
- 배포: 코드/문서 push까지. 라이브 배포나 main 병합은 별도 승인 필요.

## 변경 요약
- `100x/100x-main.html`
  - `fetchJsonWithRetry`를 추가해 JSON fetch에 timeout, 짧은 backoff retry, retry 시 cache reload를 적용.
  - 리포트 인덱스/메타데이터를 검증·정규화하고, 누락 필드는 안전한 기본값으로 렌더링.
  - `Promise.all` 일괄 실패를 `Promise.allSettled` 기반 부분 성공 렌더링으로 전환.
  - 실패 상태 패널과 재시도 버튼을 추가해 사용자가 새로고침 없이 다시 불러올 수 있게 함.
  - 비동기 응답 경합을 막기 위해 initialize/archive run id guard를 추가.
- `100xfenok-next/public/100x/100x-main.html`
  - Next 정적 public 사본을 SSOT와 동일하게 동기화.
- `100xfenok-next/sync-static-overrides.mjs`
  - `public/100x/100x-main.html`에 뒤늦게 패치하던 legacy override 블록 제거.
  - 이유: 이제 원본 `100x/100x-main.html`이 고쳐졌으므로 `sync-static` 후에도 같은 로직이 유지된다.

## 근거/의사결정
- 문제의 본질은 디자인보다 데이터 로딩 안정성이다. 홈에서 index fetch 또는 metadata fetch가 하나라도 실패하면 전체 렌더가 깨질 수 있었다.
- `100xfenok-next/public/100x/100x-main.html`만 수정하면 `npm run sync-static` 실행 시 `100x/100x-main.html`에서 덮어써진다.
- 따라서 SSOT인 `100x/100x-main.html`을 먼저 고치고, public 사본은 sync 결과로 동일성을 유지하는 방식을 선택했다.
- 기존 `sync-static-overrides.mjs`의 100x-main patch는 같은 문제를 public 단계에서 부분 보정하던 임시 장치였으므로 제거했다.

## 테스트 결과
- 동기화
  - `npm run sync-static`: 통과.
  - `cmp -s 100x/100x-main.html 100xfenok-next/public/100x/100x-main.html`: `cmp_exit:0`.
- 정적 검사
  - 두 HTML의 inline script를 `new Function(...)`으로 syntax check: 통과.
  - `git diff --check -- 100x/100x-main.html 100xfenok-next/public/100x/100x-main.html 100xfenok-next/sync-static-overrides.mjs`: 통과.
- 브라우저 스모크
  - `/market` 정상 데이터: 모바일/데스크탑 모두 loader 잔존 없음, page error 없음, 가로 overflow 없음.
  - `/market` index 503: 모바일/데스크탑 모두 실패 패널과 재시도 버튼 표시, 무한 로딩 없음.
  - `/market` metadata 부분 실패: 모바일/데스크탑 모두 부분 성공 리포트 표시, 안내 패널 표시, 무한 로딩 없음.
  - 강제 503 케이스에서는 브라우저 console resource error가 발생하지만 UI는 의도한 fallback으로 유지됨.
- 빌드
  - `NEXT_BUILD_TARGET=runtime npx next build --webpack`: 통과.
  - Next build 내부 TypeScript 단계 완료 확인.

## 롤백
- 코드 롤백: 이번 code commit을 revert하면 기존 홈 로딩 로직과 `sync-static-overrides.mjs` 보정 블록 상태로 되돌릴 수 있다.
- 문서 롤백: 이번 docs commit만 revert하면 작업 기록만 제거된다.
- 주의: public 사본만 되돌리면 다음 `sync-static`에서 다시 SSOT에 맞춰 덮어써질 수 있다. 롤백도 `100x/100x-main.html` 기준으로 해야 한다.

## 다음 단계
- [ ] main 병합 또는 라이브 배포 여부를 별도 승인받아 진행.
- [ ] 배포 후 실제 `/market`에서 정상 데이터/일시 실패 상태를 한 번 더 확인.
- [ ] home 외 다른 legacy 정적 페이지도 `sync-static-overrides`에 남아 있는 임시 패치가 SSOT로 승격 가능한지 점검.
- [ ] 스크리너 모바일 깨짐/가독성 점검으로 이어가기.

## 추가: 데이터 충실성 / 모바일 차트 / root 홈 로딩

### 범위
- 대상: Next root 홈(`/`), 스크리너/종목 상세의 재무 차트와 수익성 추정치.
- 사용자 확인 포인트:
  - 모바일 종목 상세에서 PER/매출/EPS 차트 정렬이 어긋나 보임.
  - 수익성 카드의 `매출총이익률` FY+1/FY+2/FY+3이 비어 보임.
  - 실제 불편했던 로딩은 `/market` legacy가 아니라 root 홈의 Market Regime 영역.

### 실측
- detail JSON 총량: `data/global-scouter/stocks/detail/*.json` 1,066개, `100xfenok-next/public/data/global-scouter/stocks/detail/*.json` 1,066개.
- `profitability_estimates.gross_margin`은 비어 있지만 `income_statement_estimates.gross_profit / revenue`로 계산 가능한 값:
  - 964개 티커.
  - 2,866개 FY 값.
  - NVDA 예: FY+1 74.5447%, FY+2 72.9863%, FY+3 71.5532%.
- 추가 계산 가능 누락:
  - `net_margin`: 3개 티커 / 5개 FY 값.
  - `roe`: 7개 티커 / 11개 FY 값.
  - `roa`: 24개 티커 / 34개 FY 값.
  - `operating_margin`: 추가 계산 가능 누락 없음.

### 변경 요약
- `100xfenok-next/src/app/screener/StockDetailPanel.tsx`
  - `deriveProfitabilityEstimates`를 추가해 기존 추정값을 우선 사용하고, 누락값은 원천 추정치에서 자동 계산.
  - `Sparkline`과 `PerBandChart`의 SVG 좌표계를 `300px viewBox`와 동일 좌우 패딩으로 통일.
  - PER 밴드 값 라벨은 현재값과 마지막 추정치 중심으로 줄여 모바일 겹침을 완화.
- `100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx`
  - 수익성 카드가 `profitability_estimates` 원본만 보지 않고 자동 보강된 추정치를 사용.
  - 매출총이익률뿐 아니라 순이익률/ROE/ROA의 계산 가능 누락도 같은 경로로 보강.
- `100xfenok-next/src/hooks/useDashboardData.ts`
  - root 홈 데이터 빌드 중 예외가 나도 `loading` skeleton에 갇히지 않도록 fallback source 전체를 실패 상태로 전환.
- `100xfenok-next/src/lib/dashboard/freshness-labels.ts`
  - freshness timestamp가 예외적으로 문자열이 아니어도 라벨 렌더가 TypeError로 죽지 않게 방어.
- `100xfenok-next/src/lib/server/admin-live-tools.ts`
  - CCH/live-tool의 `feno-data` 상세 응답도 수익성 추정치 자동 보강을 사용.
  - overview 하이라이트에 `grossMarginFy1`을 추가하고, 기존 `operatingMarginFy1`/`roeFy1`도 보강 경로를 타도록 변경.

### 검증 상태
- 데이터 감사: Node 스크립트로 전체 1,066개 detail JSON 계산 가능 누락 수 확인.
- 의존성: 사용자 승인 후 `npm ci` 완료. `npm audit` 기준 14개 취약점 경고(1 low, 7 moderate, 6 high)는 확인만 했고 자동 수정은 하지 않음.
- 정적 검사: `npm run lint -- src/app/screener/StockDetailPanel.tsx 'src/app/stock/[ticker]/StockDetailClient.tsx' src/hooks/useDashboardData.ts src/lib/dashboard/freshness-labels.ts src/lib/server/admin-live-tools.ts` 통과.
- 타입 검사: `npm run build:version` 후 `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` 통과.
- 빌드: `NEXT_BUILD_TARGET=runtime npx next build --webpack` 통과.
- 런타임 HTTP: `next start -p 3107` 후 `/` 200, `/stock/NVDA/` 200, `/data/global-scouter/stocks/detail/NVDA.json` 200 확인.
- 모바일 브라우저: `playwright-core` + 시스템 Chrome으로 390x844 viewport 확인.
  - root 홈: `MARKET REGIME` 실제 콘텐츠 렌더, skeleton 없음, page/console error 없음.
  - NVDA 통계 탭: `매출총이익률` 및 `추정 FY+1 74.5%` 노출, SVG chart `viewBox` 확인, page/console error 없음.
  - 스크린샷: `/tmp/100x-home-mobile-data-fidelity.png`, `/tmp/100x-nvda-statistics-mobile-data-fidelity.png`.
