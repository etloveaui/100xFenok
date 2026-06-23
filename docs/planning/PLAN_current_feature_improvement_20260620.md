# PLAN: Current-Feature Improvement Wave (measured survey → priority)

> **Status**: ✅ owner-independent UI/ETF/screener wave shipped; F2 top-200 first pass reached 182/202. Foreign-filer 6-K / 20-F / 40-F extractor + best-per-ticker batch path is now implemented and gated; the remaining F2 data step is generating the 20 foreign-filer summary artifacts before top-300/top-400 breadth. Data Spine/feno-value cleanup is the adjacent contract-layer continuation, not a separate product detour.
> **Owner mandate**: do ALL candidates, but survey + measure first, then plan. No new pages (/portfolio deprioritized), no route-contract meta-doc pass — improve EXISTING live surfaces.
> **Method**: dual independent read-only survey — Claude (4 parallel subagents) + Codex (cx-80) — integrated here. Divergence = signal.
> **Decision anchor**: this plan → owner approval → per-slice CONTRACT → Codex impl → Claude reproduction gate → push. 완료 선언 = owner.

---

## Cross-cutting finding (both sides agree)

**Core stock/ETF *current* surfaces are data-rich (88–100% on price/valuation/estimate fields); most UI/data-expression slices are now shipped.** The remaining high-value gap is filings coverage quality, not another ETF/stock UI polish pass: F2 top-200 first pass covers 182/202 manifests, and the uncovered 20 are foreign filers whose useful earnings/annual-report path is 6-K / 20-F / 40-F rather than 8-K Item 2.02. So the next product/data move is **extend the extractor contract to foreign-filer forms first**, then resume breadth (top-300/top-400) or Data Spine provider cleanup.

---

## Surface 1 — Stock filings (공시)

**Measured**: F1/F2 has moved past the original 50-ticker pilot. The current EDGAR summary universe is 202 manifests (top-150 US by market cap + 50 new 151-200 + BE/RKLB force-includes), with 182/202 covered by evidence-grounded Korean summaries. Global gates passed on the latest top-200 pass (`qa:edgar-summaries` + `qa:edgar-translations`; 2,424 filings / 7,379 bullets / 796 translations). The 20 uncovered names are foreign filers (ARM/ASML/AZN/BHP/BMO/BNS/CM/CNI/CNQ/MFC/NVO/RIO/RY/SPOT/SU/TD/TRI/TRP/TSM/WPM) that do not follow the 8-K Item 2.02 earnings path; they need a separate 6-K / 20-F / 40-F extractor path. App runtime still makes **0 direct SEC API calls**; generated artifacts are produced offline and served through DataPack/public mirrors.

**Gaps**: the old "generate more 8-K Item 2.02" path has hit a structural ceiling for these 20 names. The foreign-filer handling path is now designed and code-gated, but the top-200 coverage count stays 182/202 until those 20 summary artifacts are generated and mirrored. Do **not** spend the next tranche on top-300/top-400 breadth until that data run is complete. Current generation policy remains free-first/provider-agnostic: free model or self-gen evidence task first, paid fallback only behind explicit owner gate and cost metadata.

**Divergence**: Claude rated the "all-ticker timeline" **S** (edgar_client.py already has `fetch_submissions`/`resolve_cik`); Codex rated it **M** (needs build-pipeline wiring into Next). Both agree **$0**.

**Slices**:
- F1 (**M for production**, $0) — ✅ filing timeline and by-ticker manifest landed, then expanded through top-200 tranche support. Continue only as a support layer for extractor outputs; no new UI surface needed for the next slice.
- F2 (M/L, $-LLM but free-first) — ✅ extractor/batch path landed for 6-K / 20-F / 40-F; 🔄 data run remains. Implemented: form-aware sections (`20-F` item_3d/item_5, `40-F` risk/MD&A, `6-K` substantive foreign_report), 6-K Exhibit 99.1 reuse, best-per-ticker batch planning, QA section contract, and Korean UI section labels. Remaining acceptance: generate the 20 foreign-filer Korean summary artifacts, pass numeric/evidence QA, keep source/public mirrors in parity, and preserve $0/free-first cost metadata.
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
- S4 (M, $0) — bring ThreeSecondSummary-style verdict into screener drill (yfAvailable 100%).
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
- X1 (S) — kind-aware copy (filing→"한글 요약 아직 없음", etf→"보유 구성·상세 연결 전", stock→generic).
- X2 (S) — per-link hint (Yahoo=시세·차트, StockAnalysis=재무·밸류, SEC원문=원공시).
- X3 (M) — optional statusLine/asOf prop reusing values call sites already compute.

---

## Integrated priority (both surveys merged)

| Rank | Slice | Why | Effort | Cost |
|------|-------|-----|--------|------|
| **P0** | E1 digital 20→78 | both flagged; **data-loss bug**, wrong count (provider cap = separate E1b/M) | S | $0 |
| **P0** | S1 metric glossary/help | **owner's literal complaint**; UI has zero today | S | $0 |
| **P1** | F2 foreign-filer 6-K / 20-F / 40-F data run | extractor/batch path is ready; generating the 20 artifacts closes the 182/202 coverage ceiling before top-300/top-400 breadth | M | free-first |
| **P1** | S2 landed; S3 estimate interpretation next | turns dense numbers into reads; fixes YF +1y-only mismatch | S+M | $0 |
| **P1** | E2/E3 honest detail copy + label fix | correctness/clarity | S | $0 |
| **P2** | M1 + M2 nav contrast + bidirectional cue | high UX leverage, tiny | S | $0 |
| **P2** | X1 + X2 kind-aware fallback copy + hints | cleanup | S | $0 |
| **P3** | E4/M3/M4/S4 (badges, nav-IA decision, surface chips, drill verdict) | depends on owner IA call | M | $0 |
| **P4** | Data Spine/feno-value provider cleanup | same integration program, but contract-layer follow-up after the current filings coverage hole | M–L | mostly $0 |

**Owner decisions embedded**: (a) M3 nav-IA resolved as A+B and shipped; (b) F2 summary auto-gen stays free-first/provider-agnostic, paid still gated; (c) next start point is foreign-filer form support because it closes a measured top-200 coverage ceiling, not because it is a new side project.

**P2 reliability gate added 2026-06-23**: product-state QA now covers
`/explore`, `/screener`, `/stock/NVDA`, `/stock/ZZZZ`, `/market-valuation`, and
`/sectors` on desktop/mobile/fold. Gate requires no blocking console/data
failure, no horizontal overflow, at least one public DataState marker per route,
and zero serious/critical a11y findings. `/explore` uses a compact as-of badge;
diagnostic coverage cards stay out of public routes.

**P2 closeout tightening added 2026-06-23**: local production QA now uses
`npm run start:qa -- -p 3106`, which sets a dedicated QA-only rate-limit env in
addition to the localhost check. Public copy guard now blocks accidental
`/admin/data-lab` links from product routes and keeps coverage/diagnostic
language in Admin. Turbopack dynamic `public/data` filesystem warnings are
tracked as a P3 infrastructure cleanup unless they turn into a build failure.

**Current remaining work after the autonomous wave**: (1) run the now-gated foreign-filer summary batch for the 20 uncovered top-200 names; (2) continue Data Spine cleanup on remaining non-quote admin/GAS HTML paths and feno-value direct provider paths, while the static stock-analyzer product consumers are now routed through `StaticStockAnalyzerDataProvider`; (3) translation generation and top-300/top-400 breadth only after the foreign-filer data run is measured clean; (4) ETF history dispatch only when future reports show fetchable gaps, since current required gaps are inception-limited recent launches.

---

*Created 2026-06-20. Dual survey: Claude 4-agent + Codex cx-80. SSOT for this wave. Slices become per-slice CONTRACTs on owner approval.*
