# PLAN — Product Spine (P17): One Trunk, Foundation-First

> Status: **ACTIVE — owner standing approval 2026-06-25** (A=Product Spine, B=Route/Key SSOT first; relayed fh-097, "승인했으면 그런줄 알아").
> Architect/owner-of-this-doc: **Claude** (doc-monopoly). Implementor: **Codex**. Research/scout: **Kimi**. UX critique: **AGY**.
> This doc is the **umbrella trunk** that sequences existing tracks; it does NOT duplicate them. Pointers below.

---

## 0. Why this doc exists

The owner's complaint: "계속 일하는데 변화가 커 보이지 않는다 / 너무 basic / 백엔드는 안 본다 / 기본 서비스가 서비스다워야 확장한다." Measured root cause (4 parallel read-only research streams, 2026-06-25):

> The product is **not** missing features. It is missing a **load-bearing foundation layer** — a single source of truth for routes/keys, an enforced design-token system, and backend data-automation guards. Localized edits break far-away surfaces because the connective layer is fragmented. That fragmentation is why every increment feels small and why it "looks basic."

The fix is to build the trunk first, then everything else hangs off it safely. **Portfolio = last** (owner mandate).

---

## 1. Reconciled ground truth (measured, not assumed)

Two P2 research agents contradicted each other; resolved by direct measurement (`grep`/`package.json`/file reads):

| Claim | Verdict | Evidence |
|---|---|---|
| tabular-nums adoption | **Partial — 26 files use it**; gaps in screener / stock-detail / chart labels | `grep -rl tabular-nums src` = 26 |
| Command palette | **Stranded** — `CommandPaletteV2` exists but imported only by `NavbarV2`/`NavbarV3`, **NOT** wired into current `AppShell`; `cmdk` **not installed** → effectively absent in shipped shell | `find *CommandPalette*`; importer grep; `cmdk ✗` in package.json |
| Design tokens | `@theme inline` block **exists** (globals.css:111) BUT values are **hex + light-first** (`--background:#f8fafc`), no OKLCH, no dark block | grep `oklch` = none in styles; globals.css:17 |
| Token system reach | Spacing scale `--s1..--s10` defined but used in only ~7/91 TSX (per PLAN_design_system_remodel) | existing P16 audit |
| Chart library | **Chart.js-only** (`chart.js`+`react-chartjs-2`+`chartjs-chart-treemap`); `lightweight-charts`/`recharts` **not installed** | package.json |
| Service map | Exists as **draft** (`docs/manuals/service-map.md` + `FORGE_feno_data_market_ia`) but execution drifted: 3 parallel nav comps, orphan pages, `섹터` in 2 nav trees | service-IA audit |
| Entity key model | **Solid** — `entity-key-policy.mjs` (`ticker:`/`etf:`/`sector:`/`filing:`/`sec13f:`) validated | scripts/lib/entity-key-policy.mjs |
| Route/nav key layer | **Fragmented** — only 2 route consts in `product-nav.ts`; rest hardcoded; ticker-normalize duped 3× | key-model audit |
| Data automation | ~16 cron fetchers (FRED/yf/EDGAR/13F/sentiment/slickcharts…); **guard gaps**: no secret pre-check, no schema/Zod guard, no inter-workflow dep, no link-validation | pipeline audit |
| 13F vs earnings (MU) | 13F is **quarterly** (`build-stocks-analyzer.yml` merges feno-edgar investor files) → today's MU earnings does NOT move 13F. Earnings-reactive = yf/scouter daily + EDGAR 8-K + earnings calendar (separate track) | pipeline audit |

---

## 2. The Trunk (sequence)

```
P1  Route + Key SSOT          ← SLICE 1 (this doc, §3). Anti-breakage foundation.
P2  Design System enforcement ← PLAN_design_system_remodel_20260625.md (+ append drop-in spec, §4)
P3  Backend Robustness guards ← §5 (new; no doc owned it before)
P4  IA cleanup                ← FORGE_feno_data_market_ia_20260612.md + service-map.md (§6)
────────────────────────────────────────────────────────────────────
Portfolio surface             = LAST (owner mandate)
C  Earnings-reactive pipeline = deferred follow-up design track, NOT a blocker
```

Each phase ships as thin, independently-verifiable slices; the SSOT (P1) keeps later slices from drifting.

---

## 3. SLICE 1 — Route + Key SSOT  (Codex implements, Claude QA-gates)

**Goal**: kill the "localized edit breaks far-away surface" failure class. Pure refactor — **zero user-visible behavior change**.

### 3a. Central route registry — `src/lib/routes.ts`
Single typed source for every route. All components/JSON consume it; no inline route literals.
```ts
export const ROUTES = {
  explore: "/explore",
  market: "/market-valuation",
  sectors: "/sectors",
  etfs: "/etfs",
  screener: "/screener",
  superinvestors: "/superinvestors",
  portfolio: "/portfolio",
  macroChart: "/macro-chart",
  multichart: "/multichart",
  stock: (t: string) => `/stock/${t}`,
  etf: (t: string) => `/etfs/${t}`,
  posts: "/posts",
  radar: "/radar",
} as const;
```
`product-nav.ts` constants (`EXPLORE_ROUTE`, `CHART_ROUTE`, …) re-export from `ROUTES` (keep names, swap source).

### 3b. Ticker normalization SSOT
Collapse the **3 duplicated normalizers** (`entity-key-policy.mjs`, `StockDetailPanel.normalizeTicker`, ad-hoc `encodeURIComponent` paths) into ONE exported module. All consumers import it. Define explicit functions: `normalizeForEntityKey`, `normalizeForFilePath`, `normalizeForDisplay` (so the 3 legitimate uses are named, not divergent).

> **Build↔runtime parity (NON-NEGOTIABLE).** There are two module worlds: build/data scripts (Node `.mjs`, `scripts/lib/entity-key-policy.mjs`) and Next runtime (`.ts`). A TS runtime SSOT module for Next consumers is fine, BUT it must be provably in lockstep with the `.mjs` build normalizer — otherwise entity-graph keys (generated by `.mjs`) and runtime lookups (`.ts`) drift, re-creating the key-model audit's **#1 critical break** (ticker-normalization divergence → silent 404 / wrong-data). "source inspiration" is NOT sufficient. Required: a **parity test** (`scripts/check-ticker-normalize-parity.mjs`) running a fixed test-vector set (incl. dotted/class-share tickers like `BRK.B`, lowercase, edge symbols) through BOTH the `.mjs` and the `.ts` normalizer and asserting identical output. Drift = build FAIL.

### 3c. Build-time validation (the guard that makes it stick)
A script (e.g. `scripts/check-route-key-contract.mjs`) that FAILS build/CI on:
1. any `ROUTES` entry whose route has no matching `src/app/**/page.tsx`;
2. any `macro-series.json` `source_path` (and other declared data paths) pointing to a non-existent file;
3. any **product navigation** route literal in TSX outside the registry — drift detector. SCOPE (per Codex fh-106): enforce only product/app routes (the ones whose rename breaks nav/sitemap/cross-links); **explicitly allowlist** system paths (`/api/*`, `/data/*`, static assets, `/admin/*` embed/system, `robots`, declared legacy non-product routes). Allowlist must be explicit + commented (why each is exempt) — **no silent catch-all**; a real product route landing in the allowlist is exactly the bug class this guard prevents.

### 3d. QA CONTRACT — Slice 1 (Claude-owned acceptance; Codex implements to this)
PASS requires ALL:
- [ ] `src/lib/routes.ts` exists; exports typed `ROUTES` covering all 8 primary + stock/etf/posts/multichart/radar.
- [ ] `product-nav.ts` route consts re-export from `ROUTES` (no independent literals).
- [ ] Ticker normalize: single SSOT module; 3 prior dupes removed/re-export from it; grep shows 0 independent `toUpperCase().trim()` ticker normalizers outside SSOT.
- [ ] **Ticker build↔runtime parity**: `scripts/check-ticker-normalize-parity.mjs` runs a fixed test-vector set through both the `.mjs` build normalizer and the `.ts` runtime SSOT; asserts identical output; exits non-zero on any divergence (wired into build/CI).
- [ ] **Literal-drift scope** (§3c-3): guard enforces product routes only, with an explicit, commented allowlist for system paths — no silent catch-all.
- [ ] `scripts/check-route-key-contract.mjs` present; asserts 3c-(1)(2)(3); exits non-zero on violation.
- [ ] `npm run build` passes; new `npm run qa:routes` passes; **existing `npm run qa:macro-chart` stays 9/9**.
- [ ] **Behavior parity**: all routes resolve identically pre/post (LIVE smoke 10/10 routes 200 unchanged). This is invisible to users — any visible change = contract FAIL.
- [ ] Scoped commit (nested repo `source/100xFenok`), pathspec only; no `git add -A`.

### 3e. P17-1 read-only inventory (Codex, can start NOW — pre-implementation)
- Enumerate **every route string literal** across components + JSON (the migration list).
- Enumerate **every ticker-normalize call site** (the 3 dupes + all consumers).
- Output the inventory; implementation follows against §3d.

### 3f. Parity test vectors + surfaced bugs (from Kimi blast-radius, fh-120)
`check-ticker-normalize-parity.mjs` MUST cover these (full 17-vector table + 7 sync-critical build↔runtime pairs + 13-route blast ranking in Kimi fh-120). Build side = `scripts/lib/entity-key-policy.mjs` (`normalizeEntitySymbol`); runtime = `src/lib/ticker.ts` (`normalizeForEntityKey` / `normalizeForRouteTicker` / `normalizeForFilePath` / `isValidRouteTicker`).
**Critical divergence assertions:**
1. `$AAPL` → runtime strips `$`, build **rejects** as invalid — assert the documented split behavior, not silent agreement.
2. `^GSPC` index → route strips `^`→`GSPC`, build invalid — assert no false entity-graph match.
3. `BRK.B` vs `BRK-B` → MUST stay **distinct** (no silent dot↔dash collapse).
4. Korean `삼성전자` → route strips to `""`, must be **invalid** entity key (not accepted).
5. Leading zeros `005930.KS` / `000001.SZ` → identical both sides.
6. Single-stock ETFs `CONL` / `NVDL` → `etf:CONL` + `/etfs/CONL` 1:1.
7. Empty / null / whitespace → both empty, validity false.

**Existing bugs Kimi surfaced (FIX or ticket — do NOT silently inherit):**
- SEC `BRK-B` vs route `BRK.B` → edgar by-ticker index miss (`brk.b.json` lowercase file vs uppercase index).
- `TickerTypeahead.tsx:196` hardcodes `/stock/${encodeURIComponent(t)}` while `:165` uses `ROUTES.stock()` → migrate `:196` to the helper (drift the guard should catch).
- QA route arrays in `.qa-playwright.js` / `.qa-a11y.js` / `.qa-live-check.mjs` are hardcoded → should derive from `ROUTES` (Kimi §5).

---

## 4. P2 — Design System enforcement  (→ PLAN_design_system_remodel_20260625.md)

The full drop-in spec (Agent A) is to be **appended to PLAN_design_system_remodel**, corrected by §1 ground truth. Key points:
- **Migrate-in-place, not greenfield**: globals.css already has `@theme inline`; swap hex→OKLCH, light→**dark-first** via swap-source-keep-name (existing `--c-up/--c-down/--brand-*` re-pointed at new ramp, no component edits).
- **tabular-nums**: extend the existing 26-file adoption to the gap surfaces (screener / stock-detail / chart axis labels). Not greenfield.
- **⌘K decision (OPEN)**: revive `CommandPaletteV2` into `AppShell` **vs** adopt `cmdk` fresh. Recommend evaluate revive first (no new dep) — owner/Claude call.
- **Charts (OPEN)**: keep Chart.js for summaries; **Lightweight Charts = NEW dep** for price/time-series (magnet crosshair, synced) — explicit owner decision, not assumed.
- 5 sub-slices (S1 token foundation → S2 dark+numerics → S3 surface/motion/spacing → S4 ⌘K → S5 chart theme), each with a one-line QA acceptance tied to existing `qa:*` scripts.

**Screen priority (AGY fh-126)** — transform order for max perceived-quality / effort:
1. `/explore` (landing first-impression — bento alignment + hierarchy)
2. `/stock/[ticker]` (analytical credibility — tabular-nums + verdict surface)
3. `/screener` (proves table layout + column responsiveness under new system)

**Dark-first visual guardrails (AGY fh-126) — corrects the generic "border-first" advice:**
- **Grid Prison**: on DARK, 1px light borders around every card/cell = noise / "amateur legacy terminal" (worst on `/screener` grids + `/explore` cards). Guardrail: drop ~90% of outer borders; separate surfaces by **elevation contrast** (canvas ~`oklch L0.15` vs surface ~`L0.22`) + subtle large-radius soft shadow. → reconciles Agent-A "border-first" (good on light) vs AGY "elevation-first on dark".
- **Semantic Neon Shock**: pure desaturated light-mode red/green on dark = blinding glare, ruins legibility. Guardrail: desaturate semantic colors; prefer text-only highlight / compact semantic dot over solid bg badge.
- **Spacing Suffocation**: dark shrinks perceived space; tight padding feels choked (worst on `/stock` tabular). Guardrail: expand gaps + internal padding +20–30%, clear visual grouping.
- Note: AGY referenced a "FenoVerdictCard" — treat as an AGY suggestion; verify existence/scope before adopting (owner rule: AGY critique, we verify).

**P2 sub-slices (concrete, sequenced — each independently shippable + QA-gated; rollout by AGY screen priority):**

| Slice | Scope | QA acceptance (gate) |
|---|---|---|
| **P2-S1** Token foundation | OKLCH ramp + semantic `@theme` into globals.css; re-point existing `--c-*`/`--brand-*` to ramp (swap-source-keep-name, no component edits); dark default + light opt-in | `build` passes; existing routes render unchanged (behavior parity); token-coverage check. Depends on Kimi inventory. |
| **P2-S2** Dark flip + numerics | default → dark; `tabular-nums` to gap surfaces (screener / stock-detail / chart axis labels) | numeric columns don't reflow on value change; dark default; light still works |
| **P2-S3** Surface/spacing/motion | AGY dark guardrails: drop ~90% borders → **elevation contrast** (`L0.15`/`L0.22`)+soft shadow; desaturate semantics; +20–30% dense-zone padding; M3 motion + `prefers-reduced-motion` | `grep` arbitrary `-[Npx]` = 0; a11y reduced-motion pass; `/screener`+`/explore` not grid-prison |
| **P2-S4** ⌘K into AppShell (D3) | port `CommandPaletteV2` into `AppShell` + keyboard nav (j/k / arrows / focus ring) + ticker-jump via `ROUTES.stock()` | ⌘K opens on product pages; ticker→`/stock/[t]`; keyboard nav works |
| **P2-S5** Chart theme (D4) | shared theme (no vert gridlines, grey-first, magnet crosshair); price→Lightweight Charts, summaries→Chart.js | `qa:macro-chart` visual contract; no vert gridlines; crosshair sync |

Screen rollout: `/explore` → `/stock/[ticker]` → `/screener` (apply S1–S5 progressively, these three first).

### 4a. P2-S1 token foundation — implementable spec (Kimi inventory fh-141 + Agent-A ramp)

**SCALE (Kimi fh-141, verified large)**: migration surface = 935 hex + 308 rgb + **3,339 Tailwind named utils** + 792 CSS decls + 680 off-grid spacings (37 files) + 7 tabular-gap files.

> **OWNER HARD DESTINATION (2026-06-25)**: do the FULL migration NOW, properly — **no long-tail deferral** ("deferred work never gets done"). So P2 = **complete** design-system migration in verified waves (§4b), NOT core-only-then-defer. Condition = "제대로": correct semantic mapping per touchpoint, behavior-parity where intended, no reckless mass find-replace. S1 below is the invisible foundation; W1–W5 (§4b) carry the rest to completion.

**S1 scope (INVISIBLE, behavior-parity):**
- Add OKLCH token layer: LIGHT theme = current hex values (appearance unchanged); DARK theme = **Agent-A ramp** (`neutral-50 #121212 = oklch(0.205 0 0)` … `neutral-950 = oklch(0.985 0 0)`), defined under `[data-theme="dark"]` but **NOT activated**.
- Semantic `@theme` aliases: background/foreground/card/popover/muted/accent/border/input/ring/destructive/gain/loss/flat/warn/chart-1..5/sidebar-*.
- Re-point existing vars (Kimi Table-4 **names**: `--c-bg/-surface/-ink*/-line/-brand*/-up*/-down*/-warn*/-neutral` + shadcn `--background/--foreground/--card/--muted/--border/--gain/--loss`) to the semantic tokens, **preserving current light values**.
- ⚠️ **DO NOT use Kimi Table-4 raw OKLCH values** — out-of-gamut (`L>100%`, e.g. `oklch(100.32%…)`) + neutral-hue artifacts. Keep light hex for S1; use Agent-A computed values for the dark ramp.

**S1 QA acceptance**: `npm run build` passes; existing routes render IDENTICALLY in current theme (behavior-parity, visual diff = 0); token-coverage check (no orphaned `--c-*`); light stays default (dark defined, not active).

**S2 (next, VISIBLE)**: flip default → dark (Agent-A ramp) + `tabular-nums` to Kimi's 7 gap files + AGY dark guardrails (elevation > borders, desaturated semantics, +25% dense padding). **This is where the owner SEES the change.**

### 4b. P2 full-migration wave plan (owner HARD DESTINATION: complete now, no deferral)

Each wave: Codex impl → **Claude gate** (build + behavior/visual) → Kimi/AGY verify. Per-file exact mapping = Kimi (read-only); per-screen visual acceptance = AGY.

| Wave | Surface | Approach | Gate |
|---|---|---|---|
| **W0** | Token foundation (S1) | OKLCH layer + re-point vars (in progress) | build + visual diff = 0 |
| **W1** | CSS files (`design-v2`/`footer`/`overview-widgets`/`market-structure`) hex→token + 680 off-grid spacings→grid tokens | mechanical, grep-verifiable | grep no hex/rgb in those files + build |
| **W2** | High-risk components (`ledgerChartPanels`, `marketStructurePanelComponents`, `stockDetailPanel`) | semantic-judgment mapping (chart/regime colors) | per-file visual + build |
| **W3** | **3,339 Tailwind named utils** | **custom Tailwind plugin** mapping color-name→OKLCH token (handles all at once, prevents drift) — NOT 3,339 manual edits | build + visual on top screens |
| **W4** | Dark flip (S2) + `tabular-nums` (7 gap files) + AGY guardrails (elevation>borders, desaturate semantics, +25% dense padding) | the VISIBLE transformation | dark correct on /explore,/stock,/screener + a11y |
| **W5** | Lint gate: CI fails on new `#hex`/`rgb()` in `src/**` (explicit allowlist) | lock so it can't regress | CI gate active |

"제대로" enforcement: no wave closes until its gate passes; W3 plugin approach (not blind find-replace) keeps the 3,339 correct in one controlled move.

---

## 5. P3 — Backend Robustness guards (data automation must NOT break)

From the pipeline audit — add as CI/preflight guards (Codex impl, Claude contract):
1. **Secret pre-check** — fail fast + alert if `FRED_API_KEY` / `CLOUDFLARE_API_TOKEN` missing/expired (currently silent-degrade).
2. **Schema guard (Zod/Ajv)** on JSON inputs before 13F/yf/EDGAR builds (currently underused).
3. **Inter-workflow dependency** — declare yf→13F ordering (currently implicit timing only).
4. **Link-validation** — every `source_path`/route reference resolves to a real file (shared with §3c).
5. **Freshness/circuit signal** — N consecutive fetch failures → alert + serve last-known-good (Stooq/yf/StockAnalysis).
Priority: secret pre-check + schema guard first (highest break-risk).

---

## 6. P4 — IA cleanup  (→ FORGE_feno_data_market_ia + service-map.md)

- Consolidate **3 nav components → AppShell only** (retire DataNav/NavbarV3). This also un-strands `CommandPaletteV2` (§4).
- Fix `섹터` in 2 nav trees (DEC-246: market nav = 밸류에이션/국면/이벤트, 3-tab).
- Restore entry to orphaned high-value tools (stock-analyzer / multichart / alpha-scout) or retire dead ones (winddown×3, vr, ib).
- Complete stock-detail convergence (`/stock/[ticker]` consistent backHref + reachability).

---

## 7. Operating model (4-pane warroom)

| Pane | Who | Owns |
|---|---|---|
| left-top `%1622` | Codex | implementation · pipeline hardening · git · deploy |
| right-top `%1623` | Claude | architecture · IA/route-key SSOT design · **this doc + QA contracts** · regression/push-readiness gate |
| right-bottom `%1647` | Kimi | read-only research · route/key/data evidence · slice scouting (may swarm read-only) |
| left-bottom `%1648` | AGY | visual/UX/trend critique only — **facts/code verified by Codex/Claude** |

- **Doc-monopoly**: planning docs = Claude only (no concurrent edits → no protected-path collision).
- **Handoff discipline**: 4-pane aliases (`left-top`/`right-top`/`left-bottom`/`right-bottom`); filter shared mailbox by pane pair `%1622`↔`%1623`.
- **Approval**: owner standing approval covers approved slices end-to-end (docs/commit/push/deploy/live-QA) per fh-067; no force/destructive/secrets actions.
- **Continuity**: Claude context fill → `/clear` + handoff prep snapshot (proven 2026-06-25).

---

## 8. Decision log / open items

| # | Item | State |
|---|---|---|
| D1 | Trunk order P1→P4, portfolio last | ✅ owner approved (fh-097) |
| D2 | Slice 1 = Route/Key SSOT | ✅ approved; QA contract §3d |
| D3 | ⌘K: revive CommandPaletteV2 into AppShell vs adopt cmdk | 🟡 PROVISIONAL = **revive** (verified working palette exists, 0 new dep) — owner may override at P2-S4 |
| D4 | Lightweight Charts new dep for price views | 🟡 PROVISIONAL = **add for price only**, Chart.js stays for summaries — owner may override at P2-S5 |
| D5 | C = earnings-reactive pipeline (MU etc.) | ⏳ deferred follow-up, not blocker |
| **D6** | P2 scope: full migration now vs core-then-defer | 🔒 **HARD DESTINATION = FULL migration now, no long-tail deferral** (owner 2026-06-25). Condition: "제대로" — correct mapping + verification, not reckless find-replace. Wave plan §4b. |

---

*Source: 4 parallel research streams + direct measurement, 2026-06-25. Supersedes nothing; sequences PLAN_design_system_remodel, FORGE_feno_data_market_ia, PLAN_data_spine_service_layer, service-map.md.*
