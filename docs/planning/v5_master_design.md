# 100x Fenok v5 — 마스터 설계 (병렬 종합)

> 작성: Claude(종합) + 울트라코드 워크플로(7에이전트) + Codex(구현·feasibility) + AGY(가드레일) + MiMo(감사, 일부 교정됨)
> 범위: `?v5=1` 격리 · `.fnk-shell.v5-home` 스코프 · 라이트 전용 · V1 기본 무손상 · 백엔드/파이프라인 무변경
> 날짜: 2026-06-25

---

## 0. 종합자 검증 메모 (에이전트 충돌 해결)

- **MiMo가 "US 13F 데이터 전부 비어있다([])"고 보고 → 오류(false-negative).** Claude가 직접 `by_ticker.json` 확인: NVDA 35 · AAPL 27 · MU 23 · TSLA 22 holders 존재. Codex도 `holder_details`가 이미 SuperinvestorsClient/StockDetailPanel에서 렌더 중임을 확인. → **13F 연결(핵심 two-hop)은 실제로 구축 가능.** MiMo만 믿었으면 핵심 기능을 잘못 막을 뻔했음.
- **지수 멤버십**: entity graph는 boolean flag만. 단 실데이터는 `public/data/slickcharts/{sp500,nasdaq100,dowjones}.json` + `membership-changes.json`에 있음(rank/weight 포함) → 작은 ticker→index loader 추가하면 surface 가능.
- 결론: 4개 연결 엣지(ETF·EDGAR·13F·섹터) **모두 지금 구축 가능**, 지수 멤버십은 small loader 1개 추가면 됨.

---

## 1. P0 버그 — 수정·검증 완료 (Codex, 미배포)

| 버그(사장님 보고) | 수정 | 검증 |
|---|---|---|
| ETF 필터 우측 잘림 | 사이드 컬럼 ETF 필터를 1 minmax 열 + `min-width:0`로 스코프 | 모바일 390px: 필터 width 336, childOverflow=0 |
| 하단 좌측 빈 공간 | 메인 컬럼에 macro+connected 재배치, 우측=watchlist+ETF | desktop main/side 1686/1190 (황무지 제거) |
| 워크벤치 네비가 v5 떨굼 | `fenok_design_version=v5` 쿠키(?v5=1일 때만) + page.tsx가 cookies()로 읽음 | /?v5=1 → / 이동해도 v5 유지, 플래그 없으면 V1 |

`npm run build` PASS · V1 기본 무손상 · 커밋/배포 안 함.

---

## 2. 연결형 UX 아키텍처 — entity graph를 "타고 다니는" 척추

### 핵심 한 줄
**엔티티는 종착지가 아니라 분기점(junction).** 홈이 리프 페이지로 떠넘기지 않고 *그래프를 걷게* 한다. 이미 메모리에 로드된 `relations[]`(현재는 숫자 5개로 뭉개고 버림)를 척추로 재활용 — 새 데이터 아님, **projection + promotion**.

세 가지 성질:
1. **양방향** — 내게 들어오는 엣지도 보여줌("NVDA에 9개 ETF가 올라타 있다", "TSM을 12 구루가 들고 있다"). 드로어가 막다른 길 안 됨.
2. **클릭할 이유=숫자** — 모든 엣지에 숫자(보유 기관수·QoQ·ETF수·비중·등락%) → 클릭이 도박이 아니라 결정.
3. **빵부스러기 경로** — `지수 Tech ▸ NVDA ▸ Coatue ▸ TSM` 누적(세션 스코프, 백엔드 X) → 깊이 걸어도 안 길잃음.

### 세 가지 진입 (3개 설계안 융합)
같은 `ConnectedView`를 세 경로로:
- **(A) 오늘의 흐름으로 빠져들기** — 착지 시 오늘 최대 등락 종목(13F 엣지 있는 것)을 자동 선택, 4 클릭 hop(왜/누가/ETF/공시)으로 서사화. 입력 0으로 걷기 시작.
- **(B) 인라인 peek, 절대 안 튕김** — 콕핏 행의 `[peek ▾]` → 행 아래 인라인 아코디언 드로어(레짐 히어로는 고정). 13F는 한 단계 더 인라인(종목→보유기관→그 기관의 다른 보유=two-hop 페이오프). 이동은 `[전체 보기 →]` 명시 클릭에만.
- **(C) 아무거나에서 시작** — `TickerTypeahead` + 공유 `<TickerChip>`가 어디서든(히트맵·마켓나우·13F행·ETF·섹터) 티커를 감쌈. 클릭 = ConnectedView.

### 두 셸, 한 컴포넌트
같은 `ConnectedView`를 `variant`로: **DRAWER**(빠른 hop, `?node=` URL 동기화) / **PAGE**(`/stock/[ticker]` 깊은 작업, 현재 묻혀있는 compact를 가격 헤더 아래 1급 섹션으로 승격). **깊이가 그래프 거리를 인코딩**: 홈 평면 → 드로어 반톤 down → 중첩 드로어 sunken톤.

### 상호작용 계약
홈에서 0~3단계(착지→peek→two-hop→빵부스러기)는 전부 인라인, 4단계(전체/상세)만 페이지 이동. 모든 드로어 하단에 역방향 엣지 → peek가 막다른 길 안 됨.

---

## 3. 라이트-깊이 디자인 (flat white 탈출)

현재 v5 = "flat white 아마추어"(흰 패널·1px 보더·3% 그림자 한 평면). 해법 = **톤 계층 + 2단 그림자(접촉+앰비언트)**, 스코프·가산형.

토큰 핵심(레버리지 = 기존 alias 재바인딩 → 마크업 0 수정):
```
page #f4f6fb → sunken #eef1f7 → card #fff → card-2 #fbfcfe   (3 평면)
shadow-rest / raised / hover / inset (라이트 튜닝 2단)
accent: blue #1B73D3·navy #010079·gold #c19a2b (텍스트/3px 키라인/≤10% wash만)
--c-panel/--sh-sm/--sh-md 재바인딩 → 기존 .panel/.v5-reading 전부 깊이 자동 상속
```
5개 깊이 법칙: ①세 평면(타일 그리드는 sunken 우물 속) ②반톤 step(box-in-box 회피) ③카드당 키라인 1개(엣지타입별 색=시각적 척추) ④색은 데이터·크롬은 회색 ⑤화면당 골드 1개(게이지 바늘 + 핵심신호 1).

---

## 4. AGY 가드레일 (난잡 방지 — 반드시 적용)

- **"엔티티만 링크, 숫자는 텍스트"** — 티커·기관명만 클릭 가능, 가격·%·지표는 솔리드 텍스트. (Clickable Excel 방지)
- **카드당 링크 ≤3** · 250ms peek 지연(팝오버 폭격 방지) · 모바일은 탭 토글.
- **Market Now 콕핏 면제** — 핵심 시세바는 어떤 오버레이도 못 덮음(30초 파악 유지).
- **하단 미세 그림자 + 헤어라인** — flat white admin grid 방지.
- 단일 최대 리스크: *"프리미엄 30초 콕핏을 하이퍼링크 DB 관리툴로 만드는 것."* → 이걸 1순위로 죽임.

---

## 5. 단계별 구축 순서

| Phase | 출시 | 크기 |
|---|---|---|
| **1 — 기반+셸** | 토큰 재바인딩(전 카드 깊이 무료 상속) + P0 3종(✅이미 됨) + `<ConnectedView>` 공유 추출 + 빵부스러기 context | 최대(추출이 핵심 리팩터) |
| **2 — 홈 콕핏 코어** | `V5ConnectionConsole`(숫자타일→그래프 콘솔), 인메모리 projection + `[peek ▾]` 드로어 + 13F two-hop(종목→기관→그 기관의 다른 보유) | 중 |
| **3 — 리드 스토리** | `오늘의 흐름` 리드카드 + 4 hop + buying_pressure ticker-index 패스(유일한 신규 데이터 작업, graceful-degrade) | 중 |
| **4 — 척추 완성** | 티커페이지 ConnectedView 승격 + ETF 역패널 + 분기점 역엣지 + `<TickerChip>` 보편화 | 중 |
| 보류(가짜 X) | 지수 멤버십(slickcharts loader 추가 후 surface) · 보유자별 QoQ(데이터 없음, 종목단위로 대체) | — |

핵심 파일: `HomeV5Client.tsx`(패널 교체) · `StockDetailClient.tsx`(StockConnectionCard→공유 ConnectedView) · `stock-index.ts`(loader 추가) · `home-v5.css`(토큰+드로어) · `TickerTypeahead.tsx`(+TickerChip).

---

## 한 줄
홈이 "숫자 디렉토리"를 멈추고 **오늘의 리드 스토리로 빠져들어 한 hop도 안 튕기고 그래프를 걷는 깊이있는 라이트 콘솔**이 된다 — 모든 hop이 v5가 이미 로드해놓고 버리던 이유있는 엣지.
