# Mobile UX Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move 100xFenok public surfaces from "desktop shrink" to mobile-first retail finance UX in Phase 1 (tab bar, tables-to-cards, touch targets, zoom removal).

**Architecture:** Keep AppShell as the single mobile chrome. Introduce a lightweight "More" overflow sheet for the bottom tab bar. Add mobile card views behind a `isMobile` breakpoint hook instead of rewriting desktop tables. Defer shared responsive-table primitive to Phase 2.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS, existing CSS modules (`app-shell.css`), Playwright QA scripts.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/components/shell/AppShell.tsx` | Tab list data + mobile tab rendering; add "More" sheet. |
| `src/styles/app-shell.css` | Tab bar grid/font rules, zoom rule, stock-tabs scroll affordance. |
| `src/hooks/useMediaQuery.ts` | (create) Reusable breakpoint hook for mobile card branching. |
| `src/app/screener/ScreenerClient.tsx` | Redesign `MobileStockCard`, expand toggle, PER band fluid width. |
| `src/app/portfolio/PortfolioClient.tsx` | Add `MobileHoldingCard` and use it on narrow screens. |
| `src/app/stock/[ticker]/StockDetailClient.tsx` | De-duplicate tab markup if feasible; add scroll hint. |
| `src/app/superinvestors/SuperinvestorsClient.tsx` | Wrap scrollable tables with region + scroll hint. |
| `.qa-playwright.js` / `.qa-a11y.js` | Add mobile routes for regression. |

---

## Task 1: Add `useMediaQuery` hook for mobile branching

**Files:**
- Create: `src/hooks/useMediaQuery.ts`

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);
  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
```

- [ ] **Step 2: Verify import path resolves**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMediaQuery.ts
git commit -m "feat(ui): add useMediaQuery / useIsMobile hooks"
```

---

## Task 2: Reduce AppShell mobile tab bar to 5 items + More sheet

**Files:**
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/styles/app-shell.css`

### 2.1 Update type and tab data

- [ ] **Step 1: Extend `ShellPage` and `NAV`**

In `src/components/shell/AppShell.tsx` replace:

```ts
export type ShellPage =
  | "explore"
  | "market"
  | "sectors"
  | "etfs"
  | "screener"
  | "superinvestors"
  | "portfolio";
```

with:

```ts
export type ShellPage =
  | "explore"
  | "market"
  | "sectors"
  | "etfs"
  | "screener"
  | "superinvestors"
  | "portfolio"
  | "more";
```

Add a "More" icon entry to `NAV` (reuse three-dots or menu icon). `href` can be `"#more"` since it opens a sheet rather than navigating.

```ts
{
  id: "more",
  label: "더보기",
  href: "#more",
  icon: (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="10" cy="4.5" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="15.5" r="1.5" fill="currentColor" />
    </svg>
  ),
},
```

- [ ] **Step 2: Replace `TAB_IDS`**

Replace:

```ts
const TAB_IDS: ShellPage[] = ["explore", "market", "sectors", "etfs", "screener", "superinvestors", "portfolio"];
```

with:

```ts
const PRIMARY_TAB_IDS: ShellPage[] = ["explore", "market", "screener", "portfolio", "more"];
const MORE_TAB_IDS: ShellPage[] = ["sectors", "etfs", "superinvestors"];
```

- [ ] **Step 3: Add state and render More sheet**

Near the top of the component add:

```ts
const [moreOpen, setMoreOpen] = useState(false);
```

Replace the existing `<nav className="tabbar">` block:

```tsx
<nav className="tabbar">
  {TAB_IDS.map((id) => {
    const n = NAV.find((x) => x.id === id)!;
    return (
      <TransitionLink key={id} href={n.href} className={`tab ${active && id === active ? "on" : ""}`}>
        {n.icon} {n.label}
      </TransitionLink>
    );
  })}
</nav>
```

with:

```tsx
<nav className="tabbar">
  {PRIMARY_TAB_IDS.map((id) => {
    const n = NAV.find((x) => x.id === id)!;
    if (id === "more") {
      return (
        <button
          key={id}
          type="button"
          aria-expanded={moreOpen}
          aria-controls="mobile-more-sheet"
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((v) => !v)}
          className={`tab ${moreOpen ? "on" : ""}`}
        >
          {n.icon}
          {n.label}
        </button>
      );
    }
    return (
      <TransitionLink
        key={id}
        href={n.href}
        className={`tab ${active && id === active ? "on" : ""}`}
        aria-current={active && id === active ? "page" : undefined}
      >
        {n.icon}
        {n.label}
      </TransitionLink>
    );
  })}
</nav>
{moreOpen ? (
  <div id="mobile-more-sheet" className="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="더보기 메뉴">
    <div className="mobile-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
    <div className="mobile-more-panel">
      <div className="mobile-more-header">
        <span className="text-sm font-black text-[var(--c-ink)]">더보기</span>
        <button type="button" onClick={() => setMoreOpen(false)} className="mobile-more-close" aria-label="닫기">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav className="mobile-more-list">
        {MORE_TAB_IDS.map((id) => {
          const n = NAV.find((x) => x.id === id)!;
          return (
            <TransitionLink
              key={id}
              href={n.href}
              className={`mobile-more-item ${active && id === active ? "on" : ""}`}
              onClick={() => setMoreOpen(false)}
            >
              <span className="mobile-more-icon">{n.icon}</span>
              <span className="mobile-more-label">{n.label}</span>
            </TransitionLink>
          );
        })}
      </nav>
    </div>
  </div>
) : null}
```

- [ ] **Step 4: Update CSS for 5-column tab bar and More sheet**

In `src/styles/app-shell.css`:

Replace:

```css
.fnk-shell .tabbar{display:grid; position:fixed; bottom:0; left:0; right:0; z-index:40; grid-template-columns:repeat(7,minmax(0,1fr)); background:rgba(255,255,255,.94); backdrop-filter:blur(16px) saturate(1.4); border-top:1px solid var(--c-line); padding-bottom:var(--safe-b)}
.fnk-shell .tab{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-width:0; height:var(--tabbar-h); background:none; border:0; color:var(--c-ink-3); font-size:10px; font-weight:600; cursor:pointer}
.fnk-shell .tab svg{width:22px; height:22px}
.fnk-shell .tab.on{color:var(--c-brand)}
```

with:

```css
.fnk-shell .tabbar{display:grid; position:fixed; bottom:0; left:0; right:0; z-index:40; grid-template-columns:repeat(5,minmax(0,1fr)); background:rgba(255,255,255,.94); backdrop-filter:blur(16px) saturate(1.4); border-top:1px solid var(--c-line); padding-bottom:var(--safe-b)}
.fnk-shell .tab{display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; min-width:0; height:var(--tabbar-h); background:none; border:0; color:var(--c-ink-3); font-size:11px; font-weight:600; cursor:pointer; padding:0 2px}
.fnk-shell .tab svg{width:22px; height:22px}
.fnk-shell .tab.on{color:var(--c-brand)}
.fnk-shell .tab:focus-visible{outline:2px solid var(--c-brand); outline-offset:-4px}

/* mobile more sheet */
.fnk-shell .mobile-more-sheet{position:fixed; inset:0; z-index:50; display:flex; flex-direction:column; justify-content:flex-end}
.fnk-shell .mobile-more-backdrop{position:absolute; inset:0; background:rgba(0,0,0,.35)}
.fnk-shell .mobile-more-panel{position:relative; background:var(--c-panel); border-radius:20px 20px 0 0; padding:var(--s4) var(--s4) calc(var(--s4) + var(--safe-b)); box-shadow:var(--sh-pop)}
.fnk-shell .mobile-more-header{display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--s3)}
.fnk-shell .mobile-more-close{width:36px; height:36px; display:grid; place-items:center; border-radius:10px; color:var(--c-ink-2)}
.fnk-shell .mobile-more-close svg{width:20px; height:20px}
.fnk-shell .mobile-more-list{display:grid; gap:2px}
.fnk-shell .mobile-more-item{display:flex; align-items:center; gap:var(--s3); padding:12px var(--s3); border-radius:12px; color:var(--c-ink); font-size:15px; font-weight:600}
.fnk-shell .mobile-more-item:hover{background:var(--c-surface-2)}
.fnk-shell .mobile-more-item.on{background:var(--c-brand-soft); color:var(--c-brand)}
.fnk-shell .mobile-more-icon{width:24px; height:24px; color:var(--c-ink-3)}
.fnk-shell .mobile-more-item.on .mobile-more-icon{color:var(--c-brand)}
```

Delete the 360px media query block:

```css
@media(max-width:360px){
  .fnk-shell .tab{font-size:9px}
  .fnk-shell .tab svg{width:20px; height:20px}
}
```

- [ ] **Step 5: Verify build**

Run:

```bash
npx tsc --noEmit --pretty false
npm run build
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/AppShell.tsx src/styles/app-shell.css
git commit -m "feat(ui): collapse mobile tab bar to 5 items with More sheet"
```

---

## Task 3: Remove desktop `zoom: 1.25`

**Files:**
- Modify: `src/styles/app-shell.css`

- [ ] **Step 1: Delete the zoom block**

Remove:

```css
@media (min-width:1280px){
  .fnk-shell{zoom:1.25}
}
```

- [ ] **Step 2: Compensate desktop density**

Bump desktop content font size and spacing slightly by adding inside the existing desktop media query or at root scope:

```css
@media (min-width:1280px){
  .fnk-shell .content{font-size:17px}
  .fnk-shell .panel-h h2{font-size:16px}
}
```

These values are intentionally conservative; refine after visual QA.

- [ ] **Step 3: Verify desktop feel**

Run local dev and compare `/screener` and `/stock/NVDA` at 1280px and 1440px before/after.

- [ ] **Step 4: Commit**

```bash
git add src/styles/app-shell.css
git commit -m "fix(ui): remove non-standard zoom:1.25 and compensate with tokens"
```

---

## Task 4: Screener mobile card view cleanup

**Files:**
- Modify: `src/app/screener/ScreenerClient.tsx`

### 4.1 Make expand toggle a proper touch target

- [ ] **Step 1: Update `MobileStockCard` header button**

Replace:

```tsx
<button
  type="button"
  aria-expanded={expanded}
  aria-controls={detailId}
  aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
  onClick={onToggle}
  className="flex w-full min-w-0 items-start gap-3 px-3 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
>
  <span className="mt-1 w-4 shrink-0 text-center text-xs font-black text-slate-400" aria-hidden="true">
    {expanded ? "-" : "+"}
  </span>
```

with:

```tsx
<button
  type="button"
  aria-expanded={expanded}
  aria-controls={detailId}
  aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
  onClick={onToggle}
  className="flex w-full min-w-0 items-start gap-2 px-3 py-3 text-left transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
>
  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-slate-500" aria-hidden="true">
    {expanded ? "−" : "+"}
  </span>
```

### 4.2 Simplify metric grid and labels

- [ ] **Step 2: Reduce metric cells and bump label size**

Change the metric grid from:

```tsx
<div className="grid grid-cols-2 gap-2 px-3 pb-3">
  {metrics.map((metricKey) => (
    <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
  ))}
</div>
```

to:

```tsx
<div className="grid grid-cols-2 gap-2 px-3 pb-3 sm:grid-cols-3">
  {metrics.slice(0, 4).map((metricKey) => (
    <MobileMetric key={metricKey} stock={stock} metricKey={metricKey} preset={preset} />
  ))}
</div>
```

- [ ] **Step 3: Update `MobileMetric` label size**

In `MobileMetric`, replace:

```tsx
<span className="block truncate text-[10px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">
```

with:

```tsx
<span className="block truncate text-[11px] font-black uppercase tracking-[0.06em] text-[var(--c-ink-2)]">
```

### 4.3 Fix PER band overflow

- [ ] **Step 4: Find PER band rendering and make it fluid**

Search for the PER band graph container in `ScreenerClient.tsx` and replace any `min-w-[176px]` wrapper with `w-full min-w-0`. Keep the inner bar relative to container width.

Example pattern:

```tsx
<div className="w-full min-w-0">
  {/* existing band SVG/bar */}
</div>
```

- [ ] **Step 5: Run screener-specific checks**

```bash
npx tsc --noEmit --pretty false
npm run qa:copy
```

Expected: no errors; copy lint passes.

- [ ] **Step 6: Commit**

```bash
git add src/app/screener/ScreenerClient.tsx
git commit -m "fix(ui): improve screener mobile card touch targets and density"
```

---

## Task 5: Portfolio mobile card view

**Files:**
- Modify: `src/app/portfolio/PortfolioClient.tsx`

### 5.1 Create mobile holding card

- [ ] **Step 1: Add `MobileHoldingCard` component above `HoldingsTable`**

```tsx
function MobileHoldingCard({
  row,
  onDelete,
}: {
  row: HoldingRow;
  onDelete?: (ticker: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <TransitionLink
            href={`/stock/${encodeURIComponent(row.ticker)}`}
            className="text-base font-black text-brand-interactive hover:underline"
          >
            {row.ticker}
          </TransitionLink>
          <p className="mt-0.5 text-sm font-bold text-slate-700">{row.name}</p>
        </div>
        {onDelete ? (
          <button
            type="button"
            onClick={() => onDelete(row.ticker)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            aria-label={`${row.ticker} 삭제`}
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-400">수량</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.shares}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-400">평단</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{fmt$(row.avg_cost)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-400">현재가</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.price != null ? fmt$(row.price) : "—"}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase text-slate-400">평가액</p>
          <p className="orbitron mt-1 font-black tabular-nums text-slate-900">{row.marketValue != null ? fmt$(row.marketValue) : "—"}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        <span className={`orbitron font-black tabular-nums ${row.gain != null ? gainColor(row.gain) : "text-slate-400"}`}>
          {row.gain != null ? fmt$(row.gain) : "—"}
        </span>
        <span className={`orbitron font-black tabular-nums ${row.gainPct != null ? gainColor(row.gainPct) : "text-slate-400"}`}>
          {row.gainPct != null ? fmtPct(row.gainPct) : "—"}
        </span>
        <span className="orbitron text-xs font-bold text-slate-500">
          {row.weight != null ? `${(row.weight * 100).toFixed(1)}%` : "—"}
        </span>
      </div>
    </div>
  );
}
```

### 5.2 Branch holdings display by viewport

- [ ] **Step 2: Import `useIsMobile` and replace holdings table wrapper**

At top of file add:

```ts
import { useIsMobile } from "@/hooks/useMediaQuery";
```

Inside the main portfolio component, before the JSX add:

```ts
const isMobile = useIsMobile();
```

Replace the holdings table section:

```tsx
<div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
  <h2 className="text-sm font-black tracking-tight text-slate-900">보유 종목</h2>
  <div className="mt-3 -mx-1 overflow-x-auto px-1">
    <HoldingsTable rows={holdingRows} onDelete={handleDeleteHolding} />
  </div>
  {missingCount > 0 && (
    <p className="mt-2 text-[10px] font-semibold text-slate-500">
      시세 없는 {missingCount}종목은 합계에서 제외
    </p>
  )}
</div>
```

with:

```tsx
<div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
  <h2 className="text-sm font-black tracking-tight text-slate-900">보유 종목</h2>
  {isMobile ? (
    <div className="mt-3 grid gap-3">
      {holdingRows.map((r) => (
        <MobileHoldingCard key={r.ticker} row={r} onDelete={handleDeleteHolding} />
      ))}
    </div>
  ) : (
    <div className="mt-3 -mx-1 overflow-x-auto px-1">
      <HoldingsTable rows={holdingRows} onDelete={handleDeleteHolding} />
    </div>
  )}
  {missingCount > 0 && (
    <p className="mt-2 text-[10px] font-semibold text-slate-500">
      시세 없는 {missingCount}종목은 합계에서 제외
    </p>
  )}
</div>
```

### 5.3 Stack add-holding form on mobile

- [ ] **Step 3: Update add form container**

Replace:

```tsx
<div className="mt-2 flex flex-wrap items-end gap-2">
```

with:

```tsx
<div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
```

Add `w-full sm:w-24` to each ticker/shares/cost input className.

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit --pretty false
npm run qa:copy
```

- [ ] **Step 5: Commit**

```bash
git add src/app/portfolio/PortfolioClient.tsx src/hooks/useMediaQuery.ts
git commit -m "feat(ui): add mobile card view for portfolio holdings"
```

---

## Task 6: Stock detail tab scroll affordance

**Files:**
- Modify: `src/styles/app-shell.css`
- Modify: `src/app/stock/[ticker]/StockDetailClient.tsx` (optional de-dupe)

### 6.1 Add scroll fade to stock tabs

- [ ] **Step 1: Update `.stock-tabs` CSS**

Replace:

```css
.fnk-shell .stock-tabs{display:flex; align-items:flex-end; gap:var(--s1); padding:var(--s4) var(--panel-pad) 0; overflow-x:auto; scrollbar-width:none}
.fnk-shell .stock-tabs::-webkit-scrollbar{display:none}
```

with:

```css
.fnk-shell .stock-tabs{position:relative; display:flex; align-items:flex-end; gap:var(--s1); padding:var(--s4) var(--panel-pad) 0; overflow-x:auto; scrollbar-width:none}
.fnk-shell .stock-tabs::-webkit-scrollbar{display:none}
.fnk-shell .stock-tabs::after{content:""; position:absolute; top:0; right:0; bottom:0; width:28px; background:linear-gradient(to right, rgba(255,255,255,0), var(--c-panel)); pointer-events:none; opacity:0; transition:opacity .2s}
.fnk-shell .stock-tabs.can-scroll::after{opacity:1}
```

### 6.2 Add scroll-state class via JS

- [ ] **Step 2: Add scroll detection to stock tabs**

In `StockDetailClient.tsx`, find both `.stock-tabs` render sites and wrap with a small component or inline handler. If tab markup is duplicated, prefer extracting to `StockTabs` component in `src/app/stock/[ticker]/StockTabs.tsx` if it exists, otherwise add inline.

Minimal inline approach:

```tsx
function ScrollableStockTabs({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCanScroll(el.scrollWidth > el.clientWidth + 2);
    update();
    el.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div ref={ref} className={`stock-tabs ${canScroll ? "can-scroll" : ""}`} role="tablist">
      {children}
    </div>
  );
}
```

Replace both `<div className="stock-tabs" role="tablist" ...>` usages with `<ScrollableStockTabs>`.

- [ ] **Step 3: Verify build**

```bash
npx tsc --noEmit --pretty false
```

- [ ] **Step 4: Commit**

```bash
git add src/styles/app-shell.css src/app/stock/[ticker]/StockDetailClient.tsx
git commit -m "feat(ui): add scroll affordance to stock detail tabs"
```

---

## Task 7: Superinvestors table scroll affordance

**Files:**
- Modify: `src/app/superinvestors/SuperinvestorsClient.tsx`

- [ ] **Step 1: Wrap scrollable tables**

Find all table wrappers with `overflow-x-auto` and `min-w-[...]`. Wrap each with:

```tsx
<div className="relative -mx-1 overflow-x-auto px-1" role="region" aria-label="보유 내역 스크롤 영역" tabIndex={0}>
  <div className="absolute right-0 top-0 bottom-4 w-6 bg-gradient-to-l from-white to-transparent pointer-events-none" />
  {/* existing table */}
</div>
```

Use a small helper to avoid duplication:

```tsx
function ScrollTableRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative -mx-1 overflow-x-auto px-1" role="region" aria-label={label} tabIndex={0}>
      <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent pointer-events-none" aria-hidden="true" />
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit --pretty false
npm run qa:copy
```

- [ ] **Step 3: Commit**

```bash
git add src/app/superinvestors/SuperinvestorsClient.tsx
git commit -m "feat(ui): add scroll hints to superinvestors tables"
```

---

## Task 8: Touch target pass

**Files:**
- Modify: `src/components/shell/AppShell.tsx`
- Modify: `src/app/screener/ScreenerClient.tsx`
- Modify: `src/app/portfolio/PortfolioClient.tsx`

### 8.1 AppShell top-bar icon buttons

- [ ] **Step 1: Ensure `.ic-btn` in topbar is 44×44**

In `src/styles/app-shell.css`, replace:

```css
.fnk-shell .ic-btn{width:38px; height:38px; border-radius:10px; ...}
```

with:

```css
.fnk-shell .ic-btn{width:44px; height:44px; border-radius:10px; ...}
```

The appbar `.ic-btn` already sets 44px; desktop topbar should match.

### 8.2 Screener filter checkboxes

- [ ] **Step 2: Bump checkbox size**

Find filter checkbox inputs in `ScreenerClient.tsx` and ensure className includes `min-w-5 min-h-5`:

```tsx
<input type="checkbox" className="h-4 w-4 min-h-5 min-w-5 rounded border-slate-300 ..." />
```

### 8.3 Portfolio delete button already handled

Mobile card uses 36×36px button from Task 5. Desktop table text delete remains acceptable for mouse users.

- [ ] **Step 4: Commit**

```bash
git add src/styles/app-shell.css src/app/screener/ScreenerClient.tsx
git commit -m "fix(ui): bump top-bar and screener touch targets"
```

---

## Task 9: QA and regression

**Files:**
- Modify: `.qa-playwright.js` route list (optional)

### 9.1 Static gates

- [ ] **Step 1: Run static gates**

```bash
cd 100xfenok-next
npx tsc --noEmit --pretty false
npm run build
npm run qa:copy
npm run qa:seo-surface
npm run qa:data-graph
```

Expected: all pass.

### 9.2 Mobile smoke

- [ ] **Step 2: Run Playwright mobile smoke**

```bash
QA_VIEWPORTS=mobile QA_ROUTES=/,/screener,/portfolio,/stock/NVDA,/etfs/SPY node .qa-playwright.js
```

Expected: status 200, no horizontal page overflow, no console errors.

### 9.3 Accessibility

- [ ] **Step 3: Run a11y smoke on changed routes**

```bash
QA_A11Y_VIEWPORTS=mobile QA_A11Y_ROUTES=/,/screener,/portfolio,/stock/NVDA node .qa-a11y.js
```

Expected: no critical tap-target or contrast failures.

### 9.4 Commit QA baseline

- [ ] **Step 4: Commit any QA baseline updates**

```bash
git add -A
git commit -m "chore(qa): add mobile smoke routes for ui cleanup"
```

---

## Task 10: Update planning docs

**Files:**
- Modify: `docs/planning/PLAN_public_surface_cleanup_20260623.md`

- [ ] **Step 1: Add Phase 6 entry**

Append a short section:

```markdown
### Phase 6 - Mobile UX Cleanup (2026-06-24)

- Collapse AppShell mobile tab bar from 7 to 5 items + More sheet.
- Remove desktop `zoom:1.25`; compensate with token bumps.
- Add mobile card views for `/screener` and `/portfolio`.
- Add scroll affordance to stock detail tabs and superinvestors tables.
- Touch target pass (top-bar icons, screener expand toggle, checkboxes).

Quality gates:
- `npx tsc --noEmit`
- `npm run build`
- `npm run qa:copy`
- `npm run qa:seo-surface`
- `npm run qa:data-graph`
- Playwright mobile smoke on `/`, `/screener`, `/portfolio`, `/stock/NVDA`, `/etfs/SPY`
- a11y mobile smoke on changed routes
```

- [ ] **Step 2: Commit**

```bash
git add docs/planning/PLAN_public_surface_cleanup_20260623.md
git commit -m "docs: add Phase 6 mobile ux cleanup to public surface plan"
```

---

## Spec coverage self-review

| Spec requirement | Implementing task |
| --- | --- |
| Collapse mobile tab bar to 5 + More | Task 2 |
| Remove `zoom:1.25` | Task 3 |
| Screener mobile card cleanup | Task 4 |
| Portfolio mobile card view | Task 5 |
| Stock detail tab scroll affordance | Task 6 |
| Superinvestors scroll affordance | Task 7 |
| Touch target pass | Task 8 |
| QA gates | Task 9 |
| Docs update | Task 10 |

No placeholders or TBDs remain in this plan.

## Implementation Corrections

Status: implemented; QA closeout pending.

Kimi audit anchor: `fh-20260624-037-km-7d2e4eec`.

Accepted corrections:

- Do not add `more` to shared `NAV`; the desktop rail renders `NAV` directly, so More is a mobile-only item.
- More active state must turn on for hidden routes (`sectors`, `etfs`, `superinvestors`) as well as when the sheet is open.
- `PortfolioClient` has no `row.name`; mobile holding cards use the existing holding fields only.
- `src/hooks/useMediaQuery.ts` was not created because CSS breakpoints and existing responsive classes handle this implementation slice without new runtime branching.
- Stock tabs are de-duplicated inside `StockDetailClient`; the existing `StockTabs.tsx` is a content module and should not receive shell tab UI.
- `PerBandBar` overflow is treated as a desktop table concern; mobile cards already render a compact text path.
- Mobile QA defaults now include `/portfolio`, `/superinvestors`, and `/etfs/SPY`.
