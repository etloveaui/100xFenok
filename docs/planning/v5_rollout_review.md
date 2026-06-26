# v5 Default-Promotion — Rollout Review (REVIEW ONLY, not executed)

> **Status**: review/analysis only. **No code change is made by this document.** Promotion requires explicit owner approval after the gate below is met.
> **Owner decision (2026-06-26)**: review the rollout of making v5 the default home (currently `?v5=1`-gated, V1 = default).
> **Architect**: Claude (right-top). **Critique**: AGY (left-bottom) — `docs/agent-work/v5_rollout_critique_report.md`.
> **Constraint (HARD)**: V1 must stay reachable + byte-intact. Free/internal first; no backend change.

---

## 1. Current isolation mechanism (measured)

`src/lib/design/version.ts` resolves the home variant in this priority:

```
1. ENV_OVERRIDE   NEXT_PUBLIC_DESIGN_V5/V4/V3/V2 === "1"
2. URL flag       ?v5=1 > ?v4=1 > ?v3=1 > ?v2=1
3. cookie         fenok_design_version === "v5"  (only v5 is persisted)
4. default        "v1"
```

`src/app/page.tsx` branches: `version==="v5" → <HomeV5Client/>` … else `<HomeV1Client/>`.

**Key finding**: there is currently **no `?v1=1` flag**. V1 is reachable only as the no-flag default. The moment the default flips to v5, V1 loses its access path unless a `v1` flag/cookie is added first. This is the central risk to the HARD constraint.

---

## 2. What promotion would change

Minimal, reversible diff (NOT applied here):

1. `version.ts`: add `?v1=1` flag + `persistedVersion === "v1"` → return `"v1"` at **top** priority (above env/v5), so an explicit v1 request always wins.
2. `version.ts`: change the final `return "v1"` → `return "v5"` (default flip).
3. `page.tsx`: unchanged (already branches on version).

This keeps `HomeV1Client.tsx` byte-intact (0 edits) and makes `/?v1=1` + `fenok_design_version=v1` a permanent, bookmarkable fallback.

---

## 3. AGY critique — ranked risks (independent review)

Full report: `docs/agent-work/v5_rollout_critique_report.md`.

| # | Risk | Severity |
|---|------|----------|
| 1 | **30s cockpit latency** — V5's vertical stack (MarketNow rail, reading hero gauge, pulse tiles, LeadStory + 6 cards) breaks the V1 single-screen Bento overview muscle memory | High |
| 2 | **TickerChip density + color-mix runtime** on mobile webkit → scroll lag + misclick into stock pages | Medium |
| 3 | **Drawer/trail state volatility** — `activeTileId` + traversal trail are local React state, not URL-synced → browser back exits home / loses context | Low |

Blockers (must fix before default): B-1 async render flicker (`loadStockConnectionIndex` in `useEffect`, no SSR/skeleton), B-2 touch targets < 44×44, B-3 two-hop 250ms debounce flicker.

---

## 4. Rollout gate (AGY + Claude synthesis)

Promotion is BLOCKED until all are true:

- [ ] **Fallback route**: `/?v1=1` + `fenok_design_version=v1` render V1 Bento; integration test green. (prerequisite #1 — do first)
- [ ] **Mobile LCP** ≤ 1.8s on webkit/chrome (V5 home).
- [ ] **A11y**: Lighthouse accessibility ≥ 90 on V5 home.
- [ ] **Touch**: mobile touch targets ≥ 44×44px, ≥ 8px spacing (B-2); TickerChip hit-area verified.
- [ ] **Drawer history**: drawer open + traversal trail sync to `window.history` so back-button does partial rollback, not home-exit (B-3/Risk-3).
- [ ] **Render stability**: connection console SSR-inject or skeleton, no "확인 중" flicker on entry (B-1).

---

## 5. Migration strategy

AGY recommends gradual over hard cutover:

1. **Gradual cookie %**: 25% random → monitor bounce/metrics 2wk → 50% → 100%.
2. **Opt-out banner** on first v5 render: "새로운 연결 대시보드 · [이전 V1 홈으로]" → sets `fenok_design_version=v1` (30d).
3. **Permanent fallback**: `/?v1=1` bookmarkable.

Claude note: the cookie-% bucketing needs a deterministic client assignment (no backend) — feasible via a first-visit cookie seeded from a hashed timestamp; keep it edge/client-only to honor the no-backend constraint.

---

## 6. Legacy v2/v3/v4

Still wired in `page.tsx`/`version.ts`. AGY: deprecate, but **not simultaneously** with the v5 flip (rollback side-effect analysis). Two-step: flip default → prove v5 100% stable → then remove v2/v3/v4 clients + flags in a separate cleanup PR.

---

## 7. Recommendation + open owner decision

- **Recommended sequence**: (1) land the `?v1=1` fallback + top-priority v1 resolution **first** (safe, reversible, satisfies HARD constraint), gate-test it; (2) clear the 6 gate items; (3) only then flip default, gradual 25%→100%; (4) separate v2/v3/v4 cleanup.
- **Not started**: nothing in §2/§5 is implemented. Awaiting owner go/no-go.
- **Open**: hard cutover vs gradual %, banner copy, whether to keep v2/v3/v4 reachable during transition.
