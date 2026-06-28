# CONTRACT — Screener Filter Expansion (Service Upgrade track item-a)

> **Architect/Gate**: Claude (cc). **Implementor**: Kimi (right-bottom). **Visual critic**: AGY (left-bottom).
> **Owner mandate**: service 고도화 = (a) screener filter expansion + (b) yf finance engine, 3-pane parallel, incremental per-slice push.
> **Source of truth for the track**: `docs/manuals/service-map.md` item (a) "필터 대폭 확장".
> **Machine-readable contract** — implement EXACTLY what is listed; do NOT add, optimize, or refactor beyond scope (DEC-190 lesson).

---

## 0. Measured current state (do not re-discover)

`100xfenok-next/src/app/screener/ScreenerClient.tsx` (~1,809 lines) over 1,066 stocks (`stocks_analyzer.json`, single fetch).
Already shipped: 50+ COLUMNS, 8 column presets, **15 filters**, desktop row-virtualization, pagination (PAGE_SIZE=50), mobile cards.

Existing 15 filters (DO NOT MODIFY their behavior): search, sector(single), country(single), perMax, forwardPerMax, revenueGrowthMin(FY1), epsGrowthMin(FY1), dividendYieldMin, roeFy1Min, ret3yMin, ret5yMin, profitableOnly, bandFilter, actionFilter, connectionFilter.

Data fields present on `ScreenerStock` but NOT yet filterable (units per `src/lib/screener/types.ts`):
`marketCap`($M), `pbr`, `roe`(fraction ×100), `opm`(fraction ×100), `return12m`(fraction), `price`, momentum1m/3m/6m/12m, ret1y, etc.

---

## 1. SLICE-1 scope — ADDITIVE only (5 new advanced filters)

Add these 5 filters to the advanced-filter panel. Purely additive. **No refactor** (declarative-filter model + URL-sync + multi-select are LATER slices). Do not touch existing filters, columns, presets, virtualization, pagination, mobile card render, V1/`?v1=1`, or Navbar.

| # | New filter | Field | Bound | UI label | Unit handling — MIRROR this existing filter |
|---|-----------|-------|-------|----------|---------------------------------------------|
| 1 | Market Cap min/max | `marketCap` ($M) | range | `시총 최소($B)` / `시총 최대($B)` | raw-number idiom like `perMax`; user enters $B → compare against `marketCap` with `value*1000`. Skip rows where `marketCap===null` when a bound is active. |
| 2 | PBR min/max | `pbr` | range | `PBR 최소` / `PBR 최대` | raw-number idiom like `perMax`. Skip `pbr===null` when bound active. |
| 3 | ROE(current) min | `roe` (fraction) | min | `ROE 최소(%)` | percent idiom — MIRROR `roeFy1Min` / `dividendYieldMin` exactly (user enters %, compare fraction). Skip null. |
| 4 | OPM(current) min | `opm` (fraction) | min | `OPM 최소(%)` | percent idiom — MIRROR `roeFy1Min`. Skip null. |
| 5 | 12M return min | `return12m` (fraction) | min | `12M 수익률 최소(%)` | percent idiom — MIRROR `ret3yMin`. Skip null. |

> Units: do NOT invent conversions. For percent fields copy the exact parse+compare pattern of `dividendYieldMin`/`roeFy1Min`/`ret3yMin`. For raw fields copy `perMax`. This eliminates unit bugs by construction.

## 2. Wiring checklist (every new filter needs ALL of these)

1. `useState` declarations — near existing filter state (≈ ScreenerClient.tsx L956-971). New vars: `marketCapMin`, `marketCapMax`, `pbrMin`, `pbrMax`, `roeMin`, `opmMin`, `return12mMin`.
2. Parse + `*Valid` flag inside `filtered` useMemo (≈ L1024-1042), same shape as existing `perMaxValue/perMaxValid`.
3. Predicate inside `stocks.filter(...)` (≈ L1043-1073) — skip-null-when-active, mirror existing.
4. `stateKey` string concat (L1089) — append the 7 new values so pagination resets correctly.
5. `resetFilters()` (L1247-1263) — reset all 7 new vars to `""`.
6. `hasFilters` (L1265) + `advancedFiltersActive` (L1266) + `activeAdvancedFilterCount` (L1267-1279) — include all 7.
7. UI number inputs inside `<div id="advanced-filters">` grid (≈ L1419-1520). COPY the exact markup of an existing number-input filter block (e.g. the `dividendYieldMin` input), change only label + state binding. Group placement: Market Cap + PBR after the PER/forwardPER inputs; ROE/OPM near quality; 12M near returns.

## 3. Constraints (HARD)

- `npm run build` (tsc) 0 errors; lint clean.
- No behavior change to the existing 15 filters / 50 columns / 8 presets.
- Mobile: new inputs live behind the existing `고급 필터` toggle (the `advanced-filters` contents block) — do NOT add always-visible mobile inputs (30s-cockpit / scan-not-buried guard).
- Styling: reuse existing slate / `orbitron` / `tabular-nums` classes verbatim. No new palette, no new component.
- Korean labels consistent with existing (`최소`/`최대`).
- V1 / `?v1=1` backdoor + Navbar byte-intact (do not touch those files).
- Edit ScreenerClient.tsx ONLY. No new files, no data changes, no cron.

## 4. Acceptance (cc gate + AGY visual — per-slice)

- [ ] build/tsc pass (Kimi runs `npm run build`, reports result).
- [ ] Spot-check each filter narrows correctly: PBR 최대=1.5 → only low-PBR; 시총 최소=100 → only ≥$100B; ROE 최소=20 → only roe≥0.20; 12M 최소=0 → only non-negative 12M.
- [ ] `resetFilters` clears all 7 new vars; `activeAdvancedFilterCount` increments per active new filter.
- [ ] Existing filters + presets + sort + detail panel unchanged.
- [ ] AGY: inputs render on desktop grid + behind mobile `고급 필터` toggle, no overflow, reset works, scan not buried.

## 5. Deliverable handoff (Kimi → cc)

Report back via `fh.sh send ... --right-bottom`(reply to cc): list new state var names, the line ranges touched, `npm run build` result. Do NOT commit/push — cc gates the diff against this contract, then commits path-scoped + cherry-pick pushes + watches deploy + queues AGY LIVE verify.

## 6. Next slices (NOT now — roadmap)

- Slice-2 (THIS slice, see section 7): multi-select sector/country ONLY (behavior-changing, isolated).
- Slice-3 (AGY UX recon 2026-06-28, adopted): the advanced panel is now 18 filters flat on a 5-col grid (350.5px ≈ 43% viewport desktop; mobile pushes results ~1000px down → feedback-loop break). Redesign: **(1) active-filter chips** (removable pills above results table), **(2) 4-tier grouping accordion** — Scale / Value / Growth / Quality·Signal, **(3) keep inline collapse** (NOT a heavy bottom-sheet — preserve the live result feedback loop), **(4) slice-1 label whitespace fix** (new labels `ROE 최소(%)`/`OPM 최소(%)`/`12M 수익률 최소(%)` → add space before paren to match existing `배당률 최소 (%)` etc.), then single→range conversions (perMin, forwardPerMin, dividendYieldMax) + declarative refactor + URL param sync + saved filter presets. Source recon: AGY `screener_slice3_ux_recon.md`.
- Slice-4: remaining dimensions (FY+2/3 growth, momentum 1/3/6m ranges, PER-band percentile, confidence/lowEvidence filter).
- Parallel track (b): yf finance engine [A] — income/balance/cashflow cron batch (separate contract).

---

## 7. SLICE-2 detail — multi-select 섹터/국가 (BEHAVIOR-CHANGING; gate hard)

> Convert the sector + country filters from single-select to MULTI-select. This is the ONLY change in slice-2. Do NOT touch slice-1 filters, the other 13 filters, columns, presets, virtualization, V1/`?v1=1`, Navbar. Range-bound completions + active-filter chips are slice-3.

### 7.1 Measured current state (do not re-discover)
- State: `const [sector, setSector] = useState(initialSector)`; `const [country, setCountry] = useState("")` (≈ ScreenerClient L957-958, may have shifted after slice-1).
- `initialSector` arrives from server `?sector=` deep-link (`screener/page.tsx` L24,31) — **MUST keep working**. page.tsx is UNCHANGED (prop stays a string).
- `prevInitialSector` sync re-seeds `sector` when `initialSector` changes.
- Filter predicate: `if (sector && stock.sector !== sector) return false;` + `if (country && stock.country !== country) return false;`.
- `stateKey` contains `${sector}|${country}`. resetFilters sets them. hasFilters includes `sector||country`.
- **Option lists** `sectors` and `countries` already come from `useScreenerData()` (the dropdown choices). ← NAME COLLISION RISK.

### 7.2 Required changes
1. **State rename (avoid collision)**: new state = `selectedSectors: string[]` and `selectedCountries: string[]`. Do NOT name them `sectors`/`countries` (those are the option lists from useScreenerData). Seed: `useState<string[]>(() => initialSector ? [initialSector] : [])` for selectedSectors; `useState<string[]>([])` for selectedCountries.
2. **Deep-link compat**: in the `prevInitialSector` sync, set `setSelectedSectors(initialSector ? [initialSector] : [])` when initialSector changes. Keep prevInitialSector tracking.
3. **Predicate**: `if (selectedSectors.length > 0 && !selectedSectors.includes(stock.sector)) return false;` and same for `selectedCountries`/`stock.country`. Empty array = no filter (all pass).
4. **deps array**: replace `sector, country` with `selectedSectors, selectedCountries` in the `filtered` useMemo deps.
5. **stateKey**: `${selectedSectors.join(",")}|${selectedCountries.join(",")}` in place of `${sector}|${country}`.
6. **resetFilters**: `setSelectedSectors([])`; `setSelectedCountries([])`.
7. **hasFilters**: replace `sector || country` with `selectedSectors.length || selectedCountries.length`.
8. **UI (preferred low-risk pattern)**: keep a `<select>` as an **"add" control** (placeholder option = "섹터 추가"; onChange → append value to selectedSectors if not present, then reset select to ""). Render selected items as **removable chips** (× button → remove that one) in a wrap row next to/under the control. Reuse existing `<select>` + chip styling (slate/orbitron/`rounded-full border`). Same for country. This reuses existing select markup (lower risk than a custom popover). The option list excludes already-selected values (or shows a check) to avoid dup-add.

### 7.3 Constraints (HARD)
- tsc 0; no behavior change to any other filter; mobile no-overflow; slate/orbitron styling; Korean labels; V1/Navbar untouched; edit ScreenerClient.tsx ONLY.

### 7.4 Acceptance (cc gate + AGY LIVE)
- [ ] tsc 0 (Kimi runs build).
- [ ] Multi-select: pick 2+ sectors → results = UNION of those sectors; remove one chip → updates; empty → all 1,066.
- [ ] Country multi-select same.
- [ ] **Deep-link `?sector=Energy` still pre-selects Energy** (regression guard — the key risk).
- [ ] resetFilters clears both; hasFilters reflects selection.
- [ ] Existing slice-1 + 13 filters + presets + detail panel unchanged.
- [ ] AGY LIVE: desktop + mobile (320/390) no overflow, deep-link works, scan not buried.

### 7.5 Deliverable
Edit ScreenerClient.tsx only. Report: new state names, touched line ranges, build result, and confirm the `?sector=` deep-link path. Do NOT commit/push — cc gates against this section + ships.

---

## 8. SLICE-3a — active-filter chips + slice-1 label whitespace fix (ADDITIVE, low-risk)

> Additive UX only. Do NOT change filter logic/predicates or slice-2 multi-select. The 4-tier grouping accordion = slice-3b (separate, later). Edit ScreenerClient.tsx only.

### 8.1 Active-filter chips
- Render a chip row ABOVE the results table (near the result count / `초기화` button) summarizing every ACTIVE filter as a removable pill `라벨: 값 ×`. Clicking × clears that ONE filter (call its setter to "" / [] / false).
- Cover: search, perMax, forwardPerMax, marketCapMin, marketCapMax, pbrMin, pbrMax, roeMin, opmMin, return12mMin, dividendYieldMin, roeFy1Min, ret3yMin, ret5yMin, revenueGrowthMin, epsGrowthMin, profitableOnly, bandFilter, actionFilter, connectionFilter, selectedSectors, selectedCountries. For sectors/countries: one chip per item OR a `섹터: N개` summary (your call to avoid clutter; clear empties the array).
- Korean labels with operator: e.g. `PER ≤ 20`, `시총 ≥ $100B`, `PBR 0.5~1.5` (combine when min+max both set), `ROE ≥ 20%`, `배당 ≥ 3%`, `흑자만`, `밴드: 저평가`, `섹터: Technology`. Build a descriptor array `{active, label, clear}` and map.
- Reuse existing chip styling (`rounded-full border` slate). Hide the whole row when nothing is active. Keep the existing `초기화` (clear-all) button.

### 8.2 slice-1 label whitespace fix
- New slice-1 labels miss the space before the paren vs the existing convention. Fix exactly: `ROE 최소(%)` → `ROE 최소 (%)`, `OPM 최소(%)` → `OPM 최소 (%)`, `12M 수익률 최소(%)` → `12M 수익률 최소 (%)` (match `배당률 최소 (%)`).

### 8.3 Constraints + acceptance
- tsc 0; no change to filter predicates / slice-2 / other behavior; slate styling; mobile no-overflow; ScreenerClient.tsx ONLY.
- Acceptance: active filters appear as chips above results; × on a chip clears just that filter + updates results; row hidden when none active; the 3 labels fixed; existing behavior intact; AGY LIVE visual.
- Report new render block + touched lines + build result; do NOT commit — cc gates + ships.

---

## 9. SLICE-3b — 4-tier filter grouping accordion (UI RESTRUCTURE; behavior-preserving)

> Restructure the filter panel into 4 collapsible tier groups per AGY UX recon + tier mapping. BEHAVIOR-PRESERVING: every existing filter input keeps its exact state binding, predicate, styling — only the LAYOUT/grouping changes. Do NOT change filter logic, slice-3a chips, multi-select, or add/remove any filter. ScreenerClient.tsx only.

### 9.1 Tier mapping (AGY-authoritative — `screener_filter_tier_mapping.md`)
- **Scale & Domain**: 검색(search), 섹터(selectedSectors), 국가(selectedCountries), 시총 최소($B), 시총 최대($B)
- **Value & Valuation**: PER 최대, 예상 PER 상한, PBR 최소, PBR 최대, PER 밴드, 흑자 종목만
- **Growth & Return**: 매출+1 최소, EPS+1 최소, 배당률 최소 (%), 12M 수익률 최소 (%), 3Y 수익률 최소 (%), 5Y 수익률 최소 (%)
- **Quality & Signals**: ROE 최소 (%), FY+1 ROE 최소 (%), OPM 최소 (%), 투자 신호, 연결 범위

### 9.2 Layout
- Replace the current flat grid (always-visible base row + single `고급 필터` advanced toggle) with **4 collapsible accordion groups**, one per tier, in the order above.
- Each group = a header button (tier name + that group's active-filter count) toggling an INLINE collapse of that group's inputs. Reuse the existing inline-collapse pattern (`filtersOpen`-style `hidden`/`contents`) — NOT a bottom-sheet/overlay (preserve the live result feedback loop; AGY hard guard).
- Default: Scale & Domain open (most-used); the other 3 collapsed (active-filter chips from slice-3a still show state when collapsed). Keep the first screen scannable — the flat panel was 350.5px ≈ 43% viewport.
- Preserve EVERY input's exact markup (label, state binding, styling) — only move it under the correct group wrapper.
- slice-3a active-filter chip row stays above results (unchanged). `초기화` (clear-all) stays.
- Mobile: groups stack collapsed-by-default → results no longer pushed ~1000px down (AGY's mobile FAIL fix).

### 9.3 Constraints + acceptance
- tsc 0; NO filter-logic / state / predicate change; every filter works identically; `초기화` clears all; slice-3a chips + `?sector=` deep-link intact; slate styling; mobile no-overflow; ScreenerClient.tsx only.
- Acceptance: 4 collapsible groups with the exact membership above; each filter functions identically; collapsing a group keeps its filter active (state persists, predicate unchanged); per-group active-count badges; mobile results sit near the top. AGY LIVE visual.
- Report group structure + touched line ranges + build; do NOT commit — cc gates + ships.

---

## 10. SLICE-4 — PEG ratio (computed filter + column + chip), ADDITIVE

> Additive. PEG is COMPUTED from existing fields (no new data, no build step). Lives in the Value & Valuation tier group. Edit ScreenerClient.tsx only. Do not change other filters.

### 10.1 Compute
- `PEG = forwardPeFy1 / epsGrowthFy1`, where `epsGrowthFy1` is a percent-POINT (e.g. 42 = 42%, same unit the existing `epsGrowthMin` filter compares against). Valid ONLY when `forwardPeFy1 > 0` AND `epsGrowthFy1 > 0`; otherwise `peg = null` (negative/zero growth → undefined PEG).
- Add a `peg` field to each row inside the existing `stocks` useMemo (the map that already sets `forwardPeFy1` and `epsGrowthFy1` from the action enrichment) so PEG is available like any other field. Add `peg: number | null` to ScreenerStock type.

### 10.2 Column
- Add `peg` to `ScreenerSortKey` + `COLUMNS` (label `PEG`, align right) + `renderCell` (`fmtNum(value, 2)`, null → `—`). Add `peg` to the `value` and `guru` presets (desktop + mobile). PEG < 1 = undervalued-growth (GARP).

### 10.3 Filter (in the Value & Valuation accordion group)
- `PEG 최대` number input inside the Value group. New state `pegMax`. Wire exactly like `pbrMax`: parse+`*Valid`, predicate `pegMaxValid && (stock.peg === null || stock.peg > pegMaxValue)` → false, deps, stateKey, resetFilters, hasFilters, `valueCount` (+1 when pegMax set), and the slice-3a chip descriptor (`PEG ≤ {pegMax}`).

### 10.4 Constraints + acceptance
- tsc 0; no change to other filters / predicates; null-safe (growth ≤ 0 → peg null → excluded when filter active); slate styling; the input sits in the Value group; PEG column only in value/guru presets.
- Acceptance: PEG column renders in the value preset (NVDA etc. show a finite PEG; negative-growth names show —); `PEG 최대=1` narrows to low-PEG GARP names; chip `PEG ≤ 1`; reset clears; valueCount increments; no regression. AGY LIVE.
- Report touched line ranges + build; do NOT commit — cc gates + ships.
