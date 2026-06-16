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

## 추가: 스크리너 데이터 충실성 / 모바일 가독성

### 범위
- 대상: Next 스크리너(`/screener`)의 요약 데이터, 컬럼/필터 노출, 모바일 카드 렌더링.
- 사용자 지시:
  - 스크리너는 데이터 충실성을 우선한다.
  - 우측/Antigravity 조사를 적극 활용하되, 계획과 구현은 비판 검토 후 확정한다.

### 우측 조사 반영
- `fh-20260616-091-ag-b311f41d`: 우측 감사에서 미노출/오용 데이터로 `momentum3m`, `ret3y`, `ret5y`, `dividendTtm`, FY+1 수익성 추정치, 모바일 `PerBandBar` 폭 문제를 지적.
- `fh-20260616-092-ag-2a8ff84e`: 우측이 직접 패치한 모바일 compact cell, `momentum3m`, 배당/ROE 필터 방향은 반영.
- 단, 우측의 브라우저 런타임 상세 JSON 전체 순회 방식은 제외.
  - 이유: `/screener` 초기 로딩에서 1,066개 `detail/*.json` fetch를 추가하면 root/home에서 문제 삼았던 로딩 취약성을 다시 만들 수 있다.
  - 최종 방향: 생성 스크립트가 detail JSON을 읽어 `stock_action_summary.json`에 FY+1 수익성 필드를 포함한다.

### 실측
- 스크리너 대상 종목: 1,066개.
- `stock_action_summary.json`: 207,076 bytes로 250KB 계약 한도 이내.
- FY+1 수익성 보강 coverage:
  - `profitability_estimate_snapshot_count`: 1,042개.
  - `profitability_fy1_gross_margin_count`: 964개.
  - `profitability_fy1_operating_margin_count`: 1,031개.
  - `profitability_fy1_roe_count`: 1,036개.
- NVDA 예시:
  - `forwardPeFy1`: 23.02.
  - `forwardEpsFy1`: 8.91.
  - `revenueGrowthFy1`: 82.03.
  - `epsGrowthFy1`: 82.02.
  - `grossMarginFy1`: 74.54.
  - `operatingMarginFy1`: 66.12.
  - `roeFy1`: 84.27.

### 변경 요약
- `scripts/build-phase2-closeout-indexes.mjs`
  - detail JSON cache를 추가해 생성 단계에서 티커별 상세 데이터를 1회만 읽도록 변경.
  - `profitability_estimates` 원본을 우선 사용하고, 누락 시 `income_statement_estimates`/`scale_estimates`에서 FY+1~FY+3 수익성 비율을 자동 계산.
  - `stock_action_index.json`에 `profitabilitySnapshot`을 추가하고, compact summary에는 `grossMarginFy1`, `operatingMarginFy1`, `roeFy1`만 노출.
  - summary byte 계산을 실제 UTF-8 byte 기준으로 수정.
- `100xfenok-next/src/app/screener/ScreenerClient.tsx`
  - FY+1 GPM/OPM/ROE 컬럼과 모바일 estimate preset을 추가.
  - `momentum3m` 컬럼을 노출하고, 기존 `growthRate` 라벨은 `3M 성장`으로 명확화.
  - 배당률 최소, FY+1 ROE 최소, 3Y/5Y 수익률 최소 필터를 추가.
  - 모바일 카드에서 `PER밴드`와 `actionScore`는 compact text/pill로 렌더링해 가로 overflow를 줄임.
  - FY+1 매출/EPS 성장률이 이미 percent point인 값을 다시 100배 하던 표시 오류를 수정.
  - `localStorage` preset 초기화는 hydration mismatch가 나지 않도록 mount 이후 적용.
- `100xfenok-next/src/lib/screener/types.ts`
  - FY+1 GPM/OPM/ROE 필드와 sort key 타입을 추가.
- `docs/planning/CONTRACT_stock_action_score_v0_3_20260613.md`
  - compact summary 튜플 계약과 G4 검증 항목에 FY+1 수익성 필드를 반영.

### 검증 상태
- 데이터 생성: `node scripts/build-phase2-closeout-indexes.mjs` 통과.
- JSON 계약 확인:
  - root/public `stock_action_summary.json` mirror 동일.
  - row 1,066개, summary 207,076 bytes, FY+1 수익성 필드 포함 확인.
- 정적 검사:
  - `npm run lint -- src/app/screener/ScreenerClient.tsx src/lib/screener/types.ts` 통과.
  - `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` 통과.
  - `git diff --check` 통과.
- 빌드:
  - `NEXT_BUILD_TARGET=runtime npx next build --webpack` 통과.
- 모바일 브라우저:
  - `localhost:3108/screener`에서 360px/390px viewport 확인.
  - estimate/value/momentum preset 모두 `scrollWidth == viewportWidth`.
  - estimate preset에서 NVDA FY+1 PER/EPS, 매출+1 `+82.0%`, EPS+1 `+82.0%`, FY+1 ROE/OPM/GPM 노출.
  - value preset에서 compact `PER밴드 35.4x (적정 44%)` 노출.
  - momentum preset에서 `3M 성장`과 `3M 모멘텀`이 함께 노출.
  - 스크린샷: `/tmp/100x-screener-mobile-360-estimate-final.png`, `/tmp/100x-screener-mobile-360-value-final.png`, `/tmp/100x-screener-mobile-360-momentum-final.png`, `/tmp/100x-screener-mobile-390-estimate-final.png`, `/tmp/100x-screener-mobile-390-value-final.png`, `/tmp/100x-screener-mobile-390-momentum-final.png`.

### 남은 확인
- 실제 배포 URL 반영 여부는 아직 확인하지 않음. 이번 변경은 로컬 생성/빌드/브라우저 검증까지 완료했고, commit/push/merge/deploy는 별도 승인 필요.

## 추가: Feno Stock Lens 제품 언어 계약

### 범위
- 대상: 스크리너/종목 상세의 사용자-facing 문구와 향후 Feno Stock Lens 개발 규칙.
- 사용자 지시:
  - 산출물에는 원천/벤더 이름을 브랜드처럼 내세우지 않는다.
  - 개발 중 필요한 규칙은 문서화해서 이후 작업자가 참고 가능하게 한다.

### 변경 요약
- `docs/planning/DESIGN_feno_stock_lens_20260616.md`
  - 사용자-facing 제품 언어와 내부 provenance/debug/admin 언어를 분리하는 계약을 추가.
  - 모든 필드는 먼저 인벤토리하고, 숨기거나 제외할 경우 사유를 남기는 사용 규칙을 문서화.
  - `stock_lens_full`, `stock_lens_summary`, `stock_field_usage_manifest`, deterministic interpretation, LLM layer의 개발 순서를 정리.
- `100xfenok-next/src/app/screener/ScreenerClient.tsx`
  - 화면 하단 데이터 설명에서 원천명을 기능명으로 교체.
  - 액션 필터의 `구루/13F 주목`을 `기관/고수 주목`으로 교체.
- `100xfenok-next/src/app/screener/StockDetailPanel.tsx`
  - 상세 패널의 source-branded 히스토리 문구를 `가격·배당 히스토리`로 교체.
  - 기관 보유 섹션명을 source jargon 대신 `기관 공시 보유`로 교체.
- `100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx`
  - 스크리너 상세에서 공유하는 히스토리 컴포넌트명을 기능명 기준으로 갱신.
- `scripts/build-phase2-closeout-indexes.mjs`
  - 생성되는 액션 사유와 bucket label에서 `13F` source jargon을 `기관 공시`/`기관/고수` 제품 언어로 교체.
- `100xfenok-next/src/lib/screener/deterministicRules.ts`
  - 우측이 추가한 자동 해석 엔진의 표현을 단정적 판단이 아니라 Feno 기준의 읽는 법/확인 포인트로 낮춤.

### 검증 상태
- `node scripts/build-phase2-closeout-indexes.mjs` 재실행 완료.
- `stock_action_summary.json` root/public 모두 원천명 노출 검색 결과 없음.
- `npm run lint -- src/app/screener/ScreenerClient.tsx src/app/screener/StockDetailPanel.tsx src/lib/screener/types.ts src/lib/screener/deterministicRules.ts` 통과.
- `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` 통과.
- `git diff --check` 통과.
- 넓은 앱 검색 결과, 기존 Explore/Market/Sectors/Superinvestors에는 이전 source-branded 문구가 아직 남아 있음. 이번 변경 범위는 스크리너/종목 상세 신규 표면 정리까지이며, 전체 사이트 제품 언어 정리는 별도 cleanup 필요.

## 추가: Feno Stock Lens 필드 사용현황 manifest

### 범위
- 대상: 종목 상세/스크리너 확장 전에 필요한 데이터 충실성 기반.
- 목적: 원천 JSON에 존재하는 필드를 먼저 세고, 화면/해석/메타/미사용 상태를 자동 분류해서 이후 UI와 해석 엔진이 “있는 데이터를 빠뜨리지 않게” 만드는 것.

### 변경 요약
- `scripts/generate-stock-field-usage-manifest.mjs`
  - 종목 상세, 가격·배당 히스토리, 기관 공시·고수 보유, 가격·재무 보조 데이터, Feno 통합 스코어·요약 데이터를 스캔하는 manifest 생성기를 추가.
  - ticker/date/investor keyed map은 `*`로 정규화해 per-symbol/per-date 노이즈 대신 schema-level 필드로 기록.
  - 범용 토큰(`date`, `value`, `price`, `name`, `shares`, `weight` 등)은 코드 사용 판정에서 제외해 false positive를 줄임.
  - 상태 분류는 `interpreted`, `visually_rendered`, `metadata`, `not_yet_used` 중심으로 정리.
- `data/admin/stock-field-usage-manifest.json`
  - 내부/admin용 필드 사용현황 manifest 생성.
- `100xfenok-next/public/data/admin/stock-field-usage-manifest.json`
  - 동일 manifest의 public mirror 생성. 일반 페이지가 자동 fetch하지 않는 admin/data 기반 파일.
- `docs/planning/DESIGN_feno_stock_lens_20260616.md`
  - manifest 생성 명령, 산출물 경로, 현재 필드 수/상태 분포, 동적 키 정규화 규칙을 추가.

### 생성 결과
- 명령: `node scripts/generate-stock-field-usage-manifest.mjs`
- parsed files: 2,744
- schema-level fields: 883
- manifest size: 490,439 bytes
- status counts:
  - `not_yet_used`: 520
  - `visually_rendered`: 219
  - `metadata`: 143
  - `interpreted`: 1

### 검증 상태
- `node --check scripts/generate-stock-field-usage-manifest.mjs` 통과.
- `node scripts/generate-stock-field-usage-manifest.mjs` 통과.
- 우측 비판 반영: output bloat, generic-key false positive, status taxonomy over-conflation 대응 완료.

## 추가: Data Lab 종목 필드 감사 UI

### 범위
- 대상: `/admin/data-lab`에 임베드되는 정적 Data Lab.
- 목적: 방금 생성한 `stock-field-usage-manifest.json`을 실제로 확인 가능한 admin 화면에 연결.

### 변경 요약
- `100xfenok-next/public/admin/data-lab/index.html`
  - `종목 필드 사용현황` 섹션을 추가.
- `100xfenok-next/public/admin/data-lab/app/dashboard.js`
  - `/data/admin/stock-field-usage-manifest.json` fetch를 추가.
  - 상태 필터, 데이터셋 필터, 페이지 이동, Debug toggle API를 노출.
- `100xfenok-next/public/admin/data-lab/app/renderer.js`
  - 요약 카드, 데이터셋별 카운트, 상태 탭, 데이터셋 필터, 40개 단위 페이지 렌더링을 추가.
  - `not_yet_used` 520개 필드는 기본 DOM에 전체 덤프하지 않고, 사용자가 해당 상태를 선택할 때만 페이지 단위로 렌더.
  - `internalSource`는 기본 비공개, Debug toggle에서만 표시.
- `admin/data-lab/*`
  - public Data Lab과 동일한 `index.html`, `dashboard.js`, `renderer.js`로 legacy mirror 동기화.

### 검증 상태
- `node --check` 통과:
  - `admin/data-lab/app/dashboard.js`
  - `admin/data-lab/app/renderer.js`
  - `100xfenok-next/public/admin/data-lab/app/dashboard.js`
  - `100xfenok-next/public/admin/data-lab/app/renderer.js`
- 로컬 HTTP 확인:
  - `http://127.0.0.1:4178/admin/data-lab/index.html` 200
  - `http://127.0.0.1:4178/data/admin/stock-field-usage-manifest.json` 200
- Node VM renderer smoke 통과:
  - 총 883필드/미사용 520필드 표시 확인.
  - 기본 모드에서는 내부 source path 비노출 확인.
  - Debug 모드에서만 내부 source path 표시 확인.
- Playwright/브라우저 자동화는 이 worktree에 dependency가 없어 [not verified].

## 추가: Explore 수익률 리더보드 기준일/summary 자동화 보정

### 확인 결과
- `/explore`의 `수익률 리더보드` 카드는 `data/slickcharts/discovery-summary.json`을 읽는다.
- 기존 화면 상단 기준일은 활성 탭과 무관하게 `movers.gainers.date`를 우선 표시했다.
- 로컬 실측 기준 summary의 무버 원천은 `2026-06-08`, 수익률 원천 `slick_index`는 `2026-06-14`, 배당/종목 analyzer 원천은 `2026-06-12`였다.
- `discovery-summary.json`은 `stocks_analyzer`, `slick_index`, `universe`가 갱신되어도 자동 재생성 체인에 묶여 있지 않았다.

### 변경 요약
- `scripts/build-slickcharts-discovery.mjs`
  - `source_files.stocks_analyzer` 메타를 추가.
  - `returns.asOf`, `dividends.asOf`를 생성해서 탭별 기준일 표시가 가능하게 함.
- `100xfenok-next/src/app/explore/SlickchartsDiscoveryCard.tsx`
  - 상단 작은 날짜 배지를 활성 탭 기준으로 변경.
  - `무버 2026-06-08`, `수익률 2026-06-14`, `배당 2026-06-12`처럼 원천별 기준일이 다르게 보이도록 조정.
  - 공개 footer에서 외부 소스 브랜드명을 제거하고 제품 중립 문구로 정리.
- `100xfenok-next/src/app/explore/page.tsx`, `ExploreHotTopics.tsx`, `ActionCandidatesCard.tsx`
  - 탐색 페이지 하단/카드 footer의 외부 소스명 노출을 제품 언어로 정리.
- `.github/workflows/build-stocks-analyzer.yml`
  - analyzer/slick index 재생성 뒤 `node scripts/build-slickcharts-discovery.mjs`를 실행.
  - root/public `discovery-summary.json`을 commit 대상에 포함.
- `.github/workflows/slickcharts-daily.yml`, `slickcharts-history.yml`, `slickcharts-monthly.yml`, `slickcharts-weekly.yml`
  - 관련 원천 갱신 뒤 Explore discovery summary를 같이 재생성하도록 연결.

### 검증 상태
- `node scripts/build-slickcharts-discovery.mjs` 통과.
- `jq empty data/slickcharts/discovery-summary.json 100xfenok-next/public/data/slickcharts/discovery-summary.json` 통과.
- root/public `discovery-summary.json` parity `cmp_exit=0`.
- `node --check scripts/build-slickcharts-discovery.mjs` 통과.
- `npm run lint -- src/app/explore/SlickchartsDiscoveryCard.tsx` 통과.
- `npm run lint -- src/app/explore/SlickchartsDiscoveryCard.tsx src/app/explore/page.tsx src/app/explore/ExploreHotTopics.tsx src/app/explore/ActionCandidatesCard.tsx` 통과.
- `npx tsc -p tsconfig.json --noEmit --pretty false --incremental false` 통과.
- `/explore` 소스 공개 표면의 외부 소스명 검색 0건:
  - `Global Scouter|SlickCharts|SEC 13F|Yahoo|야후|YF|computed stock_action_summary`
- 로컬 dev 서버 확인:
  - `http://127.0.0.1:4180/explore/` 200.
  - `/data/slickcharts/discovery-summary.json` 기준 `returns.asOf=2026-06-14`, `dividends.asOf=2026-06-12`, `movers.gainers.date=2026-06-08`.
- `git diff --check` 통과.
- GitHub Actions run log는 아직 확인하지 않아, 무버 daily workflow가 2026-06-08 이후 왜 갱신 커밋을 만들지 않았는지는 [not verified].

## 추가: SlickCharts Daily 무버 갱신 정지 원인 확인 및 mortgage 누적 경로 수정

### 확인 결과
- `SlickCharts Daily` workflow는 `2026-06-09`부터 `2026-06-15`까지 매일 실행됐지만 모두 failure였다.
- 실패 step은 매일 동일하게 `Run Mortgage scraper`였다.
- `gainers-scraper.py`, `losers-scraper.py`는 실패 run 안에서도 먼저 성공했다.
  - 예: `2026-06-15` run에서 gainers 342개, losers 161개 작성 후 mortgage 단계에서 실패.
- workflow가 mortgage 단계에서 종료되면서 `Sync public mirror`와 `Commit and push changes`까지 도달하지 못했고, 그래서 무버 원천 변경분도 6/8 이후 커밋되지 않았다.
- 실패 로그:
  - `TypeError: prune_old_entries() takes 1 positional argument but 2 were given`
  - 위치: `scripts/scrapers/mortgage-scraper.py`

### 변경 요약
- `scripts/scrapers/mortgage-scraper.py`
  - `prune_old_entries(existing_history, args.retention_days)` 직접 호출 제거.
  - `build_cumulative_payload(rates, existing_history, data_key="rates", source="slickcharts", retention_days=args.retention_days)` 형태로 공용 cumulative API와 맞춤.
  - 미사용 `prune_old_entries` import 제거.

### 검증 상태
- `gh run list --workflow "SlickCharts Daily" --limit 10`로 6/9~6/15 failure, 6/8 success 확인.
- `gh run view 27544123896 --log-failed`로 mortgage TypeError 확인.
- `python -m py_compile` 통과:
  - `gainers-scraper.py`, `losers-scraper.py`, `treasury-scraper.py`, `currency-scraper.py`, `mortgage-scraper.py`, `scraper_utils.py`
- fixture smoke 통과:
  - mock mortgage HTML 6개 rate로 cumulative output 1 entry 생성.
- live smoke 통과:
  - `python scripts/scrapers/mortgage-scraper.py --cumulative --output /tmp/mortgage-live-smoke.json --pretty`
  - 결과: `2026-06-16`, count 6.
- `SlickCharts Daily` workflow state는 GitHub API 기준 `active`.
- `2026-06-16` scheduled run은 2026-06-16 08:48 UTC 기준 Actions 목록에 아직 보이지 않아 [not verified].
