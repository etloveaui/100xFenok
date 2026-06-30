# Fenok Per-Signal Help Popover — Component Spec

> Scope: v0.1 educational popup for the 4 Fenok signals shown in the screener and `/stock` detail tiers.  
> Status: design approved by cc; ready for implementation plan.

## 1. Goal

Give users a concise, plain-Korean explanation of each Fenok signal score without leaving the screener or stock page. The popup must:

- Explain what a signal measures in one sentence.
- Map the 0–100 score to a four-band descriptive scale.
- Carry the standard Fenok disclaimer (“Fenok 파생 신호 · 매수 권유 아님”).
- Be keyboard accessible and mobile friendly.
- Scale from the current 4 signals to the expected v0.2 set of 6–10 signals through a config-driven registry.

## 2. Non-goals

- Not a deep-dive research panel (keep it under ~240 px wide).
- Not a real-time data display (no charts, no historical series).
- Not a buy/sell recommendation surface.

## 3. Signal set (v0.1)

| key | label | interpretation (Korean) | direction values |
|-----|-------|-------------------------|------------------|
| `profitability` | 수익성 | 기업의 이익 창출 능력과 자본 효율성 | strong / constructive / neutral / weak / stressed |
| `growth` | 성장 | 향후 매출·이익 성장 잠재력 | strong / constructive / neutral / weak / stressed |
| `technicalFlow` | 기술·자금 | 가격 모멘텀과 자금 흐름의 기술적 상태 | strong / constructive / neutral / weak / stressed |
| `upsideDownside` | Fenok Edge | 상대적 상방/하방 기대의 파생 프록시 | upside_bias / downside_bias / balanced |

> Fenok Edge copy is intentionally descriptive. It does **not** claim “상방 우위” as an investment conclusion.

## 4. Four-band scale (default)

| Score range | Label | Tone token |
|-------------|-------|------------|
| 81–100 | 강함 | `--c-up` / `--c-up-soft` |
| 61–80 | 양호 | `--c-up` / `--c-up-soft` |
| 41–60 | 중립 | `--c-warn` / `--c-warn-soft` |
| 0–40 | 약함 | `--c-down` / `--c-down-soft` |

Signal-specific overrides are allowed in the registry (e.g. Fenok Edge labels bands “상방 우세 / 상방 양호 / 균형 / 하방 우세”; inverted risk axes can expose display-safe bands such as “위험 낮음” or “압력 낮음”).

## 5. Interaction model

**Anchored popover card (click/tap activated).**

- A small circular “?” icon button appears next to the signal label.
- Clicking/tapping the icon opens a compact card anchored to the icon.
- Hover is **not** the primary trigger (mobile unreliable), but the icon itself shows a hover state.
- The popover closes on: `Escape`, click outside, focus leaving the popover, or clicking the trigger again.
- Focus returns to the trigger on close.

## 6. Component API

```ts
// src/components/screener/FenokSignalHelpPopover.tsx
export type FenokSignalHelpKey =
  | "profitability"
  | "growth"
  | "technicalFlow"
  | "upsideDownside";

export interface FenokSignalHelpPopoverProps {
  signal: FenokSignalHelpKey;
  trigger?: "icon" | "label";   // default: "icon"
  placement?: "auto" | "top" | "bottom" | "left" | "right"; // default: "auto"
  score?: number | null;
  direction?: string | null;
}
```

### Usage examples

```tsx
// /stock detail card signal row
<FenokSignalHelpPopover signal="profitability" score={72} direction="constructive" />

// Screener expanded row
<FenokSignalHelpPopover signal="upsideDownside" score={45} direction="balanced" />
```

## 7. Content schema

Each signal registry entry supplies:

```ts
interface FenokSignalHelpEntry {
  key: FenokSignalHelpKey;
  label: string;                    // e.g. "수익성"
  interpretation: string;           // one-sentence description
  bands: Array<{
    min: number;                    // inclusive
    max: number;                    // inclusive
    label: string;                  // e.g. "강함"
    tone: "up" | "warn" | "down" | "neutral";
  }>;
}
```

Direction labels are provided by the shared `directionKo` helper (`src/lib/fenok-signals/direction-ko.ts`) so Korean copy has a single source of truth.

### Popover content template

1. **Header:** `{label}` + current `score` + `{directionKo(direction)}`.
2. **Body:** `interpretation` paragraph.
3. **Scale table:** four rows, each row tinted with the band tone token.
4. **Footer:** `Fenok 파생 신호 · 매수 권유 아님`.

## 8. Positioning behavior

Use a minimal client-side positioning hook (no external popover library).

```ts
function usePopoverPosition(
  triggerRef: RefObject<HTMLElement>,
  popoverRef: RefObject<HTMLElement>,
  placement: "auto" | "top" | "bottom" | "left" | "right",
  enabled?: boolean,
): { top: number; left: number; actualPlacement: string }
```

Rules:

1. Measure trigger and popover rects in a `useLayoutEffect` only after open/portal mount (`enabled=true`).
2. Compute viewport-relative coordinates because the popover is `position: fixed` in a portal.
3. Prefer the requested `placement`; flip to the opposite side if it would overflow.
4. Nudge `left` so the card stays within `8px` viewport padding.
5. Recompute on `resize` and `scroll`.
6. Render via `createPortal` to `document.body` to escape stacking contexts.

## 9. Accessibility

- Trigger is a `<button type="button">` with `aria-label="{label} 신호 설명 열기"`.
- Trigger has `aria-expanded={isOpen}` and `aria-controls={popoverId}`.
- Popover has `role="dialog"` and `aria-labelledby={titleId}` (treated as a non-modal disclosure popover, so no `aria-modal`).
- `Escape` closes the popover and returns focus to the trigger.
- `Tab` closes the popover so focus can move to the next focusable element naturally.
- Click outside closes the popover.

## 10. Styling & token compliance

- Use only project CSS variables (`--c-*`). No named Tailwind colors (`slate-`, `emerald-`, etc.) in files that ship to W2 Worker targets.
- Trigger: `size-4` circle, border `var(--c-line)`, text `var(--c-ink-3)`, hover/focus `var(--c-brand)` ring.
- Popover: `bg-[var(--c-panel)]`, border `var(--c-line)`, shadow `var(--sh-md)`, `rounded-lg`.
- Scale rows: background `var(--c-{tone}-soft)` and text `var(--c-{tone})`.
- Max width: `w-60` (240 px) for icon trigger, `w-72` (288 px) for label trigger.

## 11. Files

| File | Purpose |
|------|---------|
| `src/components/screener/FenokSignalHelpPopover.tsx` | Popover component + trigger button. |
| `src/hooks/usePopoverPosition.ts` | Positioning hook (reusable for other anchored popovers). |
| `src/lib/fenok-signals/signal-help-config.ts` | Registry of v0.1 signal help entries. |
| `src/lib/fenok-signals/direction-ko.ts` | Shared Korean direction label helpers (reuse existing `directionKo` logic). |
| `src/app/stock/[ticker]/FenokSignalLensCard.tsx` | Wire popover into each signal row. |
| `src/app/screener/StockDetailPanel.tsx` | Wire popover into screener expanded-row signal chips. |

## 12. v0.2 extension path

Adding a new signal in v0.2 is a registry change:

1. Add the key to `FenokSignalHelpKey`.
2. Add a `FenokSignalHelpEntry` in `signal-help-config.ts`.
3. Provide the new score/direction keys in `FenokSignalsSummaryRecord` (provider-side).

No markup changes in `FenokSignalLensCard` or `StockDetailPanel` if the signal rows are already rendered from the same registry.

## 13. Open questions

None for v0.1. v0.2 will need cc confirmation of:

- Exact long-term axis names and field keys.
- Whether Fenok Edge splits into separate `upside` / `downside` axes or stays a single axis with richer direction labels.
