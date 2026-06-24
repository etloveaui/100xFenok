# PLAN: Current-Feature Improvement Wave (measured survey → priority)

> **Status**: ✅ owner-independent UI/ETF/screener wave shipped; F2 top-200 filing coverage is now 202/202. The foreign-filer 6-K / 20-F / 40-F extractor + best-per-ticker path has generated the 20 previously uncovered summary artifacts with source/public mirror parity, then enriched the 16 6-K artifacts with grounded headline figures. Data Spine residual cleanup has contracted quote.v1 and Treasury TGA; P9 has wired graph-backed portfolio/screener/stock actions. The macro-monitor FDIC browser fallback, non-quote GAS sentiment writers, legacy chart prototype live provider paths, and native `/macro-chart` first-party route contract are closed through P12. Remaining direct-provider work is feno-value exceptions outside this repo plus later macro-chart depth slices.
> **Owner mandate**: do ALL candidates, but survey + measure first, then plan. No new pages (/portfolio deprioritized), no route-contract meta-doc pass — improve EXISTING live surfaces.
> **Method**: dual independent read-only survey — Claude (4 parallel subagents) + Codex (cx-80) — integrated here. Divergence = signal.
> **Decision anchor**: this plan → owner approval → per-slice CONTRACT → Codex impl → Claude reproduction gate → push. 완료 선언 = owner.

---

## Cross-cutting finding (both sides agree)

**Core stock/ETF *current* surfaces are data-rich (88–100% on price/valuation/estimate fields); most UI/data-expression slices are now shipped.** The previous filings coverage ceiling is closed: F2 now covers 202/202 manifests after the foreign-filer 6-K / 20-F / 40-F data run. The next product/data move is therefore **resume post-F2 work**: translation only after evidence-clean summaries, top-300/top-400 breadth later, and Data Spine residual quote/treasury mirror work as the contract-layer continuation.

---

## Surface 1 — Stock filings (공시)

**Measured**: F1/F2 has moved past the original 50-ticker pilot. The current EDGAR summary universe is 202 manifests (top-150 US by market cap + 50 new 151-200 + BE/RKLB force-includes), with 202/202 covered by evidence-grounded Korean summaries. Global gates passed after the foreign-filer run (`qa:edgar-summaries`: 2,424 filings / 7,513 bullets / 4,636 evidence rows; `qa:copy`: 61 files). The 20 formerly uncovered names (ARM/ASML/AZN/BHP/BMO/BNS/CM/CNI/CNQ/MFC/NVO/RIO/RY/SPOT/SU/TD/TRI/TRP/TSM/WPM) now each have one ready 6-K / 20-F artifact. The 16 6-K summaries were enriched with headline figures where evidence digests support them; TSM/BNS/BHP were peer-verified as substantive examples. BNS used an alternate substantive 6-K (`0001193125-26-240503`) after the best-per-ticker candidate failed the evidence-body gate. App runtime still makes **0 direct SEC API calls**; generated artifacts are produced offline and served through DataPack/public mirrors.

**Gaps**: the old "generate more 8-K Item 2.02" path hit a structural ceiling for the 20 foreign filers, but that ceiling is now closed through the form-aware self/session path. Do **not** treat F2 as a blocker for top-300/top-400 anymore; the remaining filing work is translation breadth and future coverage expansion. Current generation policy remains free-first/provider-agnostic: self-gen evidence task first, paid fallback only behind explicit owner gate and cost metadata.

**Divergence**: Claude rated the "all-ticker timeline" **S** (edgar_client.py already has `fetch_submissions`/`resolve_cik`); Codex rated it **M** (needs build-pipeline wiring into Next). Both agree **$0**.

**Slices**:
- F1 (**M for production**, $0) — ✅ filing timeline and by-ticker manifest landed, then expanded through top-200 tranche support. Continue only as a support layer for extractor outputs; no new UI surface needed for the next slice.
- F2 (M/L, $0 self/session path used) — ✅ extractor/batch path landed, ✅ data run complete for 6-K / 20-F / 40-F, and ✅ 6-K headline enrichment complete for the 16 applicable artifacts. Implemented: form-aware sections (`20-F` item_3d/item_5, `40-F` risk/MD&A, `6-K` substantive foreign_report), 6-K Exhibit 99.1 reuse, best-per-ticker batch planning, QA section contract, Korean UI section labels, and 20 source/public mirrored artifacts. Acceptance passed: numeric/evidence QA, source/public parity, $0 self/session cost metadata, and peer read-through on enriched 6-K examples.
- F3 (L, $$-LLM) — translation generation follows only after F2 summaries are evidence-clean. The translation contract exists; do not bulk-generate foreign translations until F2 form handling passes.

---

## Surface 2 — ETF segments + detail

**Measured**: universe 5,280 / screener 5,347 (joined renderable 5,347). Field coverage: price 100%, aum 91.4%, volume 90.6%, holdings 96.3%, expense 97.5%, dividend 77.9%, performance 85.4% (tr1y 68%, cagr5y 35%). Detail: covered 5,265 (98.47%), primary 4,579 (full), YF fallback 686, **missing 82 (all external_quote_type_mismatch)**. Current merged classification counts after E5 lock: leveraged 704, single-stock 239, inverse 283; new 100 (capped), **digital 20**.

**Both sides flagged the same bug**:
- **🔴 Digital capped 20/78** — source `list_bitcoin_etfs.json` has 78 rows, all 78 renderable, but snapshot API slices `limit=20`. 58 dropped; pill reads "디지털 20" (wrong). One number fix.
- Codex also caught **provider surfaces capped 20** (BlackRock 485, ProShares 167 → only 20 shown).

**Other gaps**: segment pill counts come from 3 different bases, don't respect active dropdowns (badge "692" vs list of 0–3); 단일종목 label lossy (filter = single-stock AND leveraged); detail_status copy ("자동으로 추가됩니다") wrong for the 82 persistent source-gap ETFs; surface_only vs universe_only meaning invisible.

**Slices**:
- E1 (S, $0) — lift **digital** cap 20→78 (etf-snapshot/route.ts limit); UI auto-grows count+set. **True S; fixes a data-loss bug.**
- E1b (M, $0) — ✅ landed: **provider** surfaces (BlackRock 485 / ProShares 167) keep the initial ETF snapshot capped at 20 rows each, show shown/total, and expose a user-triggered "전체 목록 불러오기" action that lazy-loads the full provider list from the existing `/api/data/stockanalysis/surfaces/{surface}/` route. Gate: snapshot unchanged at 20/485 and 20/167, click-before surface requests 0, click-after BlackRock 485/485 rendered, desktop/mobile overflow false. [split per Codex fh-107; Claude gate fh-074]
- E2 (S, $0) — honest detail_status copy for source-gap ETFs (drop false backfill promise; lean on existing ExternalSourceLinks); show shown/total (e.g. "20/78").
- E3 (S, $0) — rename 단일종목 → 단일종목 레버리지 (match actual filter).
- E4 (M, $0) — live segment badges that respect active dropdowns; surface_only vs universe_only distinction in callout.
- E5a (M, $0) — ✅ landed: promote stored `classification` signal / high-confidence plain classification as primary, keep regex as fallback when stored classification is absent or low-confidence no-signal, expose merged `counts.classification`, and make QA assert exact parity to source screener classification counts when the merged universe is screener-backed. Gate kept merged counts stable at leveraged 704 / single-stock 239 / inverse 283.
- E5b/E5c (L, $0 + owner-gated live fetch only when fetchable gaps exist) — ✅ no-network plan/report/QA landed, then E5c split the 11 remaining 3Y/5Y history gaps into fetchable vs inception-limited using ETF inception dates. Current state: `history_gap=0`, `inception_limited_history_gap=11`, `total_history_gap=11`, `etfs_planned=0`, and `recommended_dispatch.status=not_recommended`. The 11 gaps are recent-launch ETFs (oldest FEAT/FIVY 2024-12-16), so no live fetch is currently useful; dispatch becomes relevant only when a future report shows `fetchable_required_history > 0`.

---

## Surface 3 — Screener + stock data density

**Measured**: universe 1,066; detail 1,066/1,066. FY+1~3 coverage in global-scouter detail: revenue all-3 1020/1066 (96%), EPS all-3 1031 (97%), op-margin 1019 (96%), ROE 1019 (96%), PER 999 (94%), FCF 932 (87%), GPM 88% (only field <90%). eps_consensus weekly 100% (confidence high 924 / lowEvidence 23). **No reusable screener/stock metric glossary component** (isolated title/abbr helps exist elsewhere, but FY+1/2/3·OPM·GPM etc. have no shared definition surface). [scoped per Codex fh-107]

**Key divergence/enrichment**: Claude found global-scouter detail is FY+1~3 rich; Codex found the **stock detail estimates tab is YF-based and has +1y only (+2/+3 = 0)** — so the rich FY+1~3 lives in global-scouter detail but the YF tab only surfaces +1y. The real gap is a **source mismatch**, not missing data.

**Gaps**: no metric glossary (the literal "FY+1/2/3가 뭐냐" complaint); interpretation asymmetric (rich ThreeSecondSummary/ScoreCard on full page only, single badge in screener drill); estimate completeness ("3/3" vs "2/3") invisible (silent "—", esp GPM); interpretStockMetrics ignores per_bands/revision/confidence already loaded.

**Slices**:
- S1 (S, $0) — `<MetricHelp>` + METRIC_GLOSSARY (FY+1/2/3, OPM/GPM/ROE/EV-EBITDA/PEG defined once) wired into screener headers + mobile labels + detail card labels. **Directly kills the owner complaint.**
- S2 (S, $0) — ✅ landed `d27daa263`: surface estimate completeness from already-loaded FY+1~3 null-count. Complete `3/3` stays quiet; only gaps (`2/3`, `1/3`, `0/3`) show in screener FY cells, stock statistics metrics, compact financial table, and screener detail charts. Local gate: eslint/tsc/a11y PASS; screener density 2100 full badges -> 54 gap badges, `3/3` badges 0. Live verification pending deploy.
- S3 (M, $0) — ✅ landed: deterministic FY+1~3 interpretation snippets. `interpretStockMetrics` now emits compact estimate summary + read lines for PE trend fy1→fy3, 3yr growth consistency, EPS weekly revision direction, PER band position, and confidence from existing global-scouter/action fields (no fetch, no LLM). Screener estimate preset shows compact summary; screener drill panel shows read lines. Gate: eslint/tsc/a11y PASS; peer raw recompute PASS on NVDA (`PER 23.02→13.26`, growth 3/3 positive).
- S4 (M, $0) — ✅ landed 2026-06-24: screener drill now carries a ThreeSecondSummary-style deterministic verdict card (`ScreenerThreeSecondVerdictCard`) built from already-loaded global-scouter/YF detail fields.
- S5 (L, $0) — grouped FY+1→+3 mobile mini-trend sections.

---

## Surface 4 — Market nav / events / sectors

**Measured**: shared nav 3 tabs (밸류에이션/국면/이벤트), self-active via aria-current. Events = 4 tabs (어닝/기업이벤트/IPO/급등락) + one inline /sectors teaser. Sectors owns IndustryMapPanel (industries 145, tech constituents 500, semis 69). Global DataNav has only 시장(=valuation) + 섹터; regime/events have NO global entry and DataNav is not rendered on market pages.

**Gaps**: active pill ≈ hover (only soft fill + faint ring differ) — easy to misread; market subnav omits sectors so IA feels broken (Codex); regime/events undiscoverable globally; industry→sectors rests on one inline teaser, no reverse cue.

**Divergence → RESOLVED by owner 2026-06-20: do BOTH A + B** (they don't conflict, both S/$0):
- A (Codex): **add 섹터 to the market section nav** → 4 tabs 밸류에이션/국면/이벤트/섹터 with active state.
- B (Claude): **add 국면/이벤트 to global DataNav** + render it on market pages; strengthen active-pill contrast; bidirectional industry↔sectors cue.
- Owner: "A+B 해서 하고." So M3 = ship both.

**Slices**:
- M1 (S, $0) — stronger active-pill contrast (filled brand bg + white text) at app-shell.css:273. Highest value/lowest risk.
- M2 (S, $0) — bidirectional industry↔sectors cue (reverse teaser on sectors panel).
- M3 (S/M, $0) — resolve the nav-IA divergence: either sectors→market subnav (Codex) OR regime/events→global DataNav on market pages (Claude). **owner picks.**
- M4 (M, $0) — per-surface freshness/failure/count chips for the 16 event surfaces.

---

## Surface 5 — External fallback links

**Measured**: ExternalSourceLinks props = ticker/kind/secUrl/className/compact; **fixed copy for all kinds** (:50-53). 11 wiring sites, all no-data/degraded states, kind drives link TARGETS correctly but visible copy never changes by kind. Local-data status visible only 2/11.

**Gaps**: same sentence for stock-missing / etf-partial / filing-no-summary; no local-data status/as-of line; filing without secUrl shows Yahoo/StockAnalysis but no SEC 원문; links carry no "what you'll find" hint.

**Slices** (both sides agree, all S, $0):
- X1 (S) — ✅ landed 2026-06-24: kind-aware fallback copy for stock / ETF / filing states.
- X2 (S) — ✅ landed 2026-06-24: per-link hints distinguish Yahoo 시세·차트, StockAnalysis 재무·밸류/보유·비용, SEC 원공시, and internal detail routes.
- X3 (M) — optional statusLine/asOf prop reusing values call sites already compute.

---

## P2.5 — Data entity graph / service connection layer

**Owner signal 2026-06-24**: freshness/accuracy is only the first layer. The next layer should connect datasets so stock, ETF, filing, 13F, sector, and market facts can be composed into services instead of staying as isolated A/B/C/D/E/F/G files.

**Implemented first base**: `data/computed/entity_graph.json` + public mirror. The graph uses canonical keys (`ticker:<SYMBOL>`, `etf:<SYMBOL>`, `sector:<CANONICAL>`, `filing:<SYMBOL>`, `sec13f:<SYMBOL>`) and stores source links, true-ish `source_as_of`, confidence, routes, service flags, and relations. Current measured coverage: 1,066 stocks, 5,280 ETFs, 10 sectors, 7 ETF categories, 200 filing nodes, 1,051 13F nodes, 1,066/1,066 stock market-facts links, 200 filing links, 456 stock↔13F intersections, 5,208 ETF market-facts links.

**Gate**: `qa:data-graph` verifies root/public mirror parity, required `source_as_of`, key shape, duplicate ids, minimum coverage, and broken relation targets. It intentionally caught ETF classification `underlying` values that were company names or prose, so the graph now preserves `underlying_raw` but only creates `tracks_underlying` when a real `ticker:*` node exists.

**Next slices**:
- G1 (landed) — build graph artifact + QA + deploy/data workflow hooks.
- G1b (landed 2026-06-24) — generate lightweight `entity_graph_stock_index.json` root/public mirror and expose it in product surfaces instead of fetching the 6.5 MB full graph client-side. `/screener` now has a `연결 데이터` view plus 공시/13F/지수 filters; `/stock/[ticker]` shows a public data-connection card with market facts, filings, 13F, index flags and source dates.
- G2 (landed 2026-06-24) — add alias resolution for ETF single-stock underlyings (`NVIDIA` → `NVDA`, `TESLA` → `TSLA`, etc.) with confidence/source and no silent ticker invention. The stock-services sidecar now carries `resolution_source`, `matched_alias`, and non-direct `resolution_note`; ambiguous alias collisions stop resolving through first-wins fallback; unresolved single-stock ETFs are emitted as diagnostics; `qa:data-graph` fails closed if link-level provenance drifts.
- G3 (landed 2026-06-24) — expose additional graph-backed compare/export affordances in screener/stock/ETF/portfolio surfaces. Shipped: screener single-stock ETF sidecar columns + compare shortcut, stock-detail ETF CSV + compare action, ETF detail underlying-stock/same-underlying compare links, `/etfs/compare` CSV export, ETF holdings CSV export, portfolio JSON backup download, and portfolio connection CSV export.
- G4 (thin slice landed 2026-06-24) — add Admin/Data Lab service-layer status from existing generated artifacts. Public surfaces keep only short `DataState` status; diagnostics and coverage language stay Admin-only. Notification hooks remain deferred/approval-gated.
- G5 — quota/cost policy for external enrichers: Yahoo/yfinance as unofficial fallback, EDGAR canonical for 13F, official ETF holdings preferred over scraper-only sources. No new paid provider, credential path, or live quota probe was added in the 2026-06-24 service-layer wave; refresh external quota references before relying on them.
- G6 (landed 2026-06-24) — promote canonical key policy into a shared registry, add link-level single-stock ETF provenance (`etf_key`, `target_key`, `classification_source`, `raw_underlying`), and strengthen `qa:data-graph` so graph/service links fail closed when keys or provenance drift.
- Macro-chart candidate (P1 + P1a.5 + P2 + P3a + P14 + P15-0 + P15-A/B/C/D landed 2026-06-24) — do not extend direct browser provider calls. Native Data Spine `/macro-chart` now has a 30-series catalog, transform/alignment engine, presets, CSV export, searchable picker, and macro workbench affordances. `/multichart` is restored as the existing stock/ETF/index compare route through the owner-owned Stooq Worker proxy, with 24h browser localStorage cache and no repo data accumulation. P11 closes the first service contract: mobile-first chart height/picker layout, share URL state for `series`/`transform`/`range`/hidden-series visibility, explicit 8-series cap copy, search debounce, picker loading/error affordances, CSV smoke, and `qa:macro-chart` share-URL round-trip QA. P12 adds browser-local saved analysis presets, keyed axis URL state, auto/left/right axis controls, storage/corruption guards, and Explore macro playbook entry points. P13/P3a adds dependency-free 3M/6M/3Y windows, zoom range stepping, PNG export, formula-derived spread/ratio series with URL/localStorage/CSV coverage, and shared Chart.js hover crosshair rendering. P14 adds curated analysis lenses, analysis summary, connected product-surface links, mobile formula/status chips, public catalog lens/surface fields, and the current TimeScale decision: keep CategoryScale + ISO labels unless a future opt-in engine mode is designed and regression-covered. P15 promotes those links into a real macro context contract: shared `macro` keys persist across chart URLs and saved presets, Explore lens links include the context, and `/screener`, `/etfs`, and `/stock/[ticker]` render a context card plus preselected filters/presets when entered from the macro workbench. Product navigation keeps Multichart/ETF/Sector/Screener/Investor discovery under Explore instead of separate header entries. True brush/wheel/pinch zoom remains deferred.

---

## Integrated priority (both surveys merged)

| Rank | Slice | Why | Effort | Cost |
|------|-------|-----|--------|------|
| **P0** | E1 digital 20→78 | both flagged; **data-loss bug**, wrong count (provider cap = separate E1b/M) | S | $0 |
| **P0** | S1 metric glossary/help | **owner's literal complaint**; UI has zero today | S | $0 |
| **P1** | F2 foreign-filer 6-K / 20-F / 40-F data run | ✅ complete; the 20 artifacts closed the 182/202 coverage ceiling before top-300/top-400 breadth | M | $0 self/session |
| **P1** | S2 landed; S3 estimate interpretation next | turns dense numbers into reads; fixes YF +1y-only mismatch | S+M | $0 |
| **P1** | E2/E3 honest detail copy + label fix | correctness/clarity | S | $0 |
| **P2** | M1 + M2 nav contrast + bidirectional cue | high UX leverage, tiny | S | $0 |
| **P2** | ✅ X1 + X2 kind-aware fallback copy + hints | cleanup closed | S | $0 |
| **P3** | E4/M4 plus future surface chips; ✅ S4 drill verdict landed | owner IA/nav work mostly closed; only residual surface polish remains | M | $0 |
| **P4** | Data Spine/feno-value provider cleanup | same integration program, but contract-layer follow-up after the current filings coverage hole | M–L | mostly $0 |

**Owner decisions embedded**: (a) M3 nav-IA resolved as A+B and shipped; (b) F2 summary auto-gen stays free-first/provider-agnostic, paid still gated; (c) foreign-filer form support closed the measured top-200 coverage ceiling and is no longer the current blocker.

**P2 reliability gate added 2026-06-23**: product-state QA now covers
`/explore`, `/screener`, `/stock/NVDA`, `/stock/ZZZZ`, `/market-valuation`, and
`/sectors` on desktop/mobile/fold. Gate requires no blocking console/data
failure, no horizontal overflow, at least one public DataState marker per route,
and zero serious/critical a11y findings. `/explore` uses a compact as-of badge;
diagnostic coverage cards stay out of public routes.

**P10 mobile UX contract hardening added 2026-06-24**: `qa:mobile-ux`
locks the implemented mobile cleanup contract on `/screener`, `/portfolio`,
`/stock/NVDA`, and `/superinvestors?tab=insights`: five-tab mobile shell, no
page-level horizontal overflow, screener checkbox/expand touch targets plus
collapsed-card density, portfolio edit/delete action target size, stock tab
scroll affordance, and superinvestor Insights scroll-region affordance.

**P11 macro-chart service contract added 2026-06-24**: `qa:macro-chart`
locks `/macro-chart` as a first-party Data Spine chart route:
desktop/mobile chart visibility, no horizontal overflow, `range` + hidden-series
URL round-trip, visible 8-series cap behavior, mobile picker open/closed state,
CSV export, and service route continuity. This keeps the chart work service-grade instead
of another prototype iframe.

**P12 macro-chart workbench contract added 2026-06-24**: `qa:macro-chart`
now also locks keyed axis URL updates, auto-axis rollback, browser-local preset
save/apply, corrupted saved hidden state handling, and Explore playbook links
into curated `/macro-chart` routes.

**P13 macro-chart depth contract added 2026-06-24**: `qa:macro-chart`
now also locks range zoom buttons, formula URL/preset persistence, formula CSV
headers, and PNG download signature/size. Targeted mobile UX QA covers
`/explore` and `/macro-chart`; `qa:market-charts` covers shared chart-engine
crosshair regression risk.

**P14 macro intelligence workbench contract added 2026-06-24**:
`qa:macro-chart` now also locks static macro catalog lenses/connection surfaces,
analysis lens deep links, connected surface links, analysis summary visibility,
mobile formula/status chips, full-CSV copy, and the controlled
`MarketChartFrame` range contract. TimeScale is intentionally deferred; the
current service keeps dependency-free ISO label month windows.

**P15-0/P9-G multichart restoration contract added 2026-06-24**:
`qa:macro-chart` now inverts the old `/multichart` redirect assertion. The route
must render the restored stock-compare frame, allow only the owner-owned Stooq
Worker proxy as the external data path, block direct Stooq/Alpha/Yahoo browser
requests, show the legacy compare controls/results, and keep Explore as the
single header/shell entry for chart/tool discovery.

**P15-A/B/C/D macro context contract added 2026-06-24**:
`qa:macro-chart` now also locks service-level macro context continuity. The gate
checks shared `macro` URL state, saved-preset context persistence, macro insight
cards, Explore playbook context links, and real connected-surface deep links into
`/screener`, `/etfs`, and `/stock/[ticker]`.

**P2 closeout tightening added 2026-06-23**: local production QA now uses
`npm run start:qa -- -p 3106`, which sets a dedicated QA-only rate-limit env in
addition to the localhost check. Public copy guard now blocks accidental
`/admin/data-lab` links from product routes and keeps coverage/diagnostic
language in Admin. Turbopack dynamic `public/data` filesystem warnings are
tracked as a P3 infrastructure cleanup unless they turn into a build failure.

**Current remaining work after the autonomous wave**: (1) Data Spine residual has closed the quote/Treasury contract slice, macro-monitor FDIC browser fallback, non-quote GAS sentiment writers, legacy chart prototype live provider paths, and the native `/macro-chart` P14 workbench contract; continue with feno-value direct-provider exception handling outside this repo plus true brush/wheel/pinch zoom only if the dependency/runtime tradeoff is explicit; (2) keep expanding P9 graph-backed service affordances only where existing DataPack payloads support them; (3) translation generation and top-300/top-400 breadth are now unblocked by F2 but should remain separately scoped; (4) ETF history dispatch only when future reports show fetchable gaps, since current required gaps are inception-limited recent launches.

---

*Created 2026-06-20. Dual survey: Claude 4-agent + Codex cx-80. SSOT for this wave. Slices become per-slice CONTRACTs on owner approval.*
