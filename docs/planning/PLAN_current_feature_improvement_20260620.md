# PLAN: Current-Feature Improvement Wave (measured survey → priority)

> **Status**: 🔄 DRAFT — owner-requested measured survey done; awaiting owner approval before any implementation.
> **Owner mandate**: do ALL candidates, but survey + measure first, then plan. No new pages (/portfolio deprioritized), no route-contract meta-doc pass — improve EXISTING live surfaces.
> **Method**: dual independent read-only survey — Claude (4 parallel subagents) + Codex (cx-80) — integrated here. Divergence = signal.
> **Decision anchor**: this plan → owner approval → per-slice CONTRACT → Codex impl → Claude reproduction gate → push. 완료 선언 = owner.

---

## Cross-cutting finding (both sides agree)

**Core stock/ETF *current* surfaces are data-rich (88–100% on price/valuation/estimate fields); filings and auxiliary sources are NOT yet broad** (filings = NVDA 1-file pilot; StockAnalysis stock/financials 40/1066; SlickCharts stock intersection 418/1066). So for the rich surfaces the problem is **expression / interpretation / exposure**, not data scarcity, and most fixes there are **S-tier and $0**. Filings/aux need actual data breadth work (still mostly $0 via free SEC API, but integration effort, not a UI tweak). [corrected per Codex fh-107]

---

## Surface 1 — Stock filings (공시)

**Measured**: index.json = 1 ticker (NVDA); 1 filing (10-K 2026-02-25); summary 1/1, translation 0/1; sections item_1a+item_7, item_1 missing (partial). App makes **0 direct SEC API calls**. No manifest generator (only `qa:edgar-summaries` validator). Free external asset exists but unwired: `feno-edgar` skill → `Asset_Allocator/scripts/edgar/edgar_client.py` `fetch_submissions()` (data.sec.gov, no key, 2req/s) + ~21GB EDGAR cache (~5,769 issuers).

**Gaps**: NVDA-only demo; no real filing list/timeline (10-K/10-Q/8-K by form/date); non-covered tickers dead-end (tab hidden); 번역 0; no auto-generate pipeline.

**Divergence**: Claude rated the "all-ticker timeline" **S** (edgar_client.py already has `fetch_submissions`/`resolve_cik`); Codex rated it **M** (needs build-pipeline wiring into Next). Both agree **$0**.

**Slices**:
- F1 (**M for production**, S only for a single-ticker raw-SEC prototype, $0) — all-ticker filing timeline: build-time cron writes `by-ticker/{ticker}.json` rows from SEC submissions (form/date/accession/doc URL), `summaryPath=null` where no summary. UI already supports summary-optional rows → renders 원문-only + "요약 준비중". Gate the 공시 tab open for any stock (StockDetailClient.tsx:884). Production integration (Next build artifact wiring, ticker→CIK coverage, manifest generator, QA, tab-open logic) = M; feno-edgar lowers acquisition risk but does not remove the integration work. [Codex fh-107]
- F2 (M, $-LLM) — summary auto-gen pipeline (feno-edgar extract → free LLM → artifact + manifest → qa gate). Free pool only.
- F3 (L, $$-LLM) — full-text translation. Lowest ROI, last.

---

## Surface 2 — ETF segments + detail

**Measured**: universe 5,280 / screener 5,347 (joined renderable 5,347). Field coverage: price 100%, aum 91.4%, volume 90.6%, holdings 96.3%, expense 97.5%, dividend 77.9%, performance 85.4% (tr1y 68%, cagr5y 35%). Detail: covered 5,265 (98.47%), primary 4,579 (full), YF fallback 686, **missing 82 (all external_quote_type_mismatch)**. Segment counts: leveraged ~692, single-stock ~283, inverse ~259/268 (regex drift), new 100 (capped), **digital 20**.

**Both sides flagged the same bug**:
- **🔴 Digital capped 20/78** — source `list_bitcoin_etfs.json` has 78 rows, all 78 renderable, but snapshot API slices `limit=20`. 58 dropped; pill reads "디지털 20" (wrong). One number fix.
- Codex also caught **provider surfaces capped 20** (BlackRock 485, ProShares 167 → only 20 shown).

**Other gaps**: segment pill counts come from 3 different bases, don't respect active dropdowns (badge "692" vs list of 0–3); 단일종목 label lossy (filter = single-stock AND leveraged); detail_status copy ("자동으로 추가됩니다") wrong for the 82 persistent source-gap ETFs; surface_only vs universe_only meaning invisible.

**Slices**:
- E1 (S, $0) — lift **digital** cap 20→78 (etf-snapshot/route.ts limit); UI auto-grows count+set. **True S; fixes a data-loss bug.**
- E1b (M, $0) — **provider** surfaces (BlackRock 485 / ProShares 167): do NOT blind-lift to full (snapshot payload/perf grows). Show "shown/total" now (S part), add load-more / full provider view later (M part). [split per Codex fh-107]
- E2 (S, $0) — honest detail_status copy for source-gap ETFs (drop false backfill promise; lean on existing ExternalSourceLinks); show shown/total (e.g. "20/78").
- E3 (S, $0) — rename 단일종목 → 단일종목 레버리지 (match actual filter).
- E4 (M, $0) — live segment badges that respect active dropdowns; surface_only vs universe_only distinction in callout.
- E5 (L, $0) — promote stored `classification` object as primary (regex fallback) to fix count/label drift; data-ops backfill of 82 missing / 686 YF fallback.

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
| **P1** | F1 all-ticker filing timeline | NVDA-demo → real utility; free SEC API | S–M | $0 |
| **P1** | S2 landed; S3 estimate interpretation next | turns dense numbers into reads; fixes YF +1y-only mismatch | S+M | $0 |
| **P1** | E2/E3 honest detail copy + label fix | correctness/clarity | S | $0 |
| **P2** | M1 + M2 nav contrast + bidirectional cue | high UX leverage, tiny | S | $0 |
| **P2** | X1 + X2 kind-aware fallback copy + hints | cleanup | S | $0 |
| **P3** | E4/M3/M4/S4 (badges, nav-IA decision, surface chips, drill verdict) | depends on owner IA call | M | $0 |
| **P4** | F2/F3/E5/S5 (summary gen, translation, data-ops backfill, mobile trend) | larger / some LLM cost | M–L | mixed |

**Owner decisions embedded**: (a) M3 nav-IA — sectors into market subnav (Codex) vs regime/events into global nav (Claude); (b) F2 summary auto-gen uses free pool only (this week spark/gemini OK), paid still gated; (c) start point — recommend P0 pair (E1 + S1) first as both are S/$0 and hit a real bug + the owner's stated complaint.

---

*Created 2026-06-20. Dual survey: Claude 4-agent + Codex cx-80. SSOT for this wave. Slices become per-slice CONTRACTs on owner approval.*
