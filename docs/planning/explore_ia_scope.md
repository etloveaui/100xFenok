# Explore / Service IA Unification — Scope (post-v5-default)

> **Architect**: Claude (right-top). **Implementor**: Codex (left-top). **Critic**: AGY.
> **Trigger**: owner mandate (2026-06-26) after v5 default promotion — "unified Explore/service IA, remove legacy-entry confusion".
> **Input**: Explore agent structural measurement (this session). Light-only, V1 backdoor (`?v1=1`) intact.

---

## 0. Key finding (changes the scope)

**v5 default promotion already removed most "legacy-entry confusion."** The legacy `Navbar` (시장/분석/전략 dropdowns, 15+ entries) renders **only on v1–v4 homes**. v5 home uses `AppShell` (8 rail entries). So now that v5 is default, normal users see only AppShell; `Navbar` appears solely on the `?v1=1` backdoor. The remaining work is **internal AppShell IA consistency**, not killing a competing nav.

## 1. Current entry structure (measured)

- **AppShell** (`components/shell/AppShell.tsx:39-135`) — rail+mobile, 8 entries: 워크벤치`/explore` · 시장`/market-valuation` · 섹터`/sectors` · ETF`/etfs` · 스크리너`/screener` · 투자자`/superinvestors` · 포트폴리오`/portfolio` · 차트`/macro-chart`. Mobile primary = explore/market/chart/screener/more.
- **Explore = hub**: 5 cards link out (`/sectors`, `/screener`, `/macro-chart`, `/market-valuation`, `/etfs`). Reverse links back to Explore exist only from `/macro-chart` (backHref).
- **MarketQuickLinks** (`components/market/MarketQuickLinks.tsx:15-52`) — 국면`/regime` · 매크로`/macro-chart` · 이벤트`/market/events` · 구조`/market-valuation/structure`, shown on `/etfs` + explore surfaces.
- **Navbar** (`components/Navbar.tsx:31-48`) — legacy, v1–v4 only.

## 2. Cleanup candidates (v5 AppShell scope)

| ID | Issue | Evidence | Tier |
|----|-------|----------|------|
| C1 | `/market` (legacy) vs `/market-valuation` coexist — `routes.ts` has `market:/market-valuation` AND `marketLegacy:/market`; `app/market/page.tsx` mixes redirect + embed | routes.ts:9, market/page.tsx:20-26 | Critical |
| C2 | active-state mismatch: `/regime` shows active="market", `/multichart` shows active="chart" — look like subroutes but are independent | regime/page.tsx:14, multichart/page.tsx:14 | Critical |
| C3 | entry duplication: market data reachable 5–7 ways (rail 시장 + QuickLinks 국면/매크로/이벤트/구조 + Explore card) | MarketQuickLinks:15-52 | High |
| H1 | no reverse breadcrumb: only `/macro-chart` returns to `/explore`; sectors/screener/etc. have no path back to the hub | (absence) | High |
| H2 | legacy HTML embeds outside AppShell: `/alpha-scout`, `/radar`, `/ib`, `/infinite-buying` | alpha-scout/page.tsx:2, radar/page.tsx:2 | High |
| N1 | label drift Navbar "분석" vs AppShell — low impact now (Navbar = v1 only) | Navbar.tsx:37-47 | Nice |
| N2 | v2/v3/v4 home clients still wired — deprecate after v5 100% (per rollout_review §6, separate track) | page.tsx:22-30 | Nice/defer |

## 3. Recommended slices

- **Slice 1 (Critical, small, safe)**: C1 `/market` legacy consolidation (redirect `/market` → `/market-valuation`, drop the dual route in routes.ts where safe; keep `/market/events` + `/market-valuation/structure` subpaths working) + C2 active-state/breadcrumb truthfulness (decide regime/multichart as independent vs subroute, fix `active`/`backHref` to match reality).
- **Slice 2 (High)**: C3 entry-dedup — define one role per surface (rail = top-level destinations; QuickLinks = contextual macro lenses only; Explore cards = the hub). H1 add reverse breadcrumb so the hub is a real hub.
- **Slice 3 (optional/heavier)**: H2 legacy-embed surfaces — bring alpha-scout/radar/ib under AppShell chrome or mark them as clearly separate. Larger, touches embeds.

## 4. AGY guards

- v5 30s-cockpit must not regress; entry simplification reduces choices, never adds modal/popover noise.
- Entity-only links principle still holds for any new cross-links.
- V1 (`?v1=1`) and its Navbar stay byte-intact; IA changes target v5/AppShell only.

## 5. Open owner decisions

- How far this round: Slice 1 only / Slice 1+2 / all three?
- C1: fully remove `/market` legacy route, or keep a 301-style redirect for old bookmarks?
- C2: is `/regime` a child of 시장 (breadcrumb under market) or a peer top-level?

## 6. Verification (Claude gate, per slice)

build + qa:tokens + qa:routes · chrome-devtools LIVE (rail/mobile reachability, no dead links, V1 backdoor intact) · scoped commit → worktree push → LIVE re-verify.
