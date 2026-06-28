# Fenok Per-Signal Help Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a click-anchored educational popover for each Fenok signal, wired into both the `/stock` detail card and the screener expanded row, using only tokenized CSS and no new runtime dependencies.

**Architecture:** A config-driven signal registry (`signal-help-config.ts`) feeds a reusable anchored popover component. Positioning is handled by a tiny client hook (`usePopoverPosition`) that flips and nudges to stay in the viewport. The popover is rendered through a React portal so it escapes stacking contexts.

**Tech Stack:** Next.js 16 (client components), React 19, TypeScript, Tailwind CSS v4, project CSS variables (`--c-*`, `--brand-interactive`).

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/lib/fenok-signals/signal-help-config.ts` | Signal registry: label, interpretation, 4-band scale, direction labels, tone helpers. |
| `src/lib/fenok-signals/direction-ko.ts` | Shared raw-direction → Korean label helper. |
| `src/hooks/usePopoverPosition.ts` | Measure trigger/popover rects and compute `top`/`left` with flip/nudge logic. |
| `src/components/screener/FenokSignalHelpPopover.tsx` | Trigger button + portal popover card. |
| `src/app/stock/[ticker]/FenokSignalLensCard.tsx` | Add help icon to each signal row. |
| `src/app/screener/StockDetailPanel.tsx` | Add help icon to each signal chip. |

---

## Task 1: Create the signal registry

**Files:**
- Create: `src/lib/fenok-signals/signal-help-config.ts`

- [ ] **Step 1: Write the registry**

```ts
export type FenokSignalHelpKey =
  | "profitability"
  | "growth"
  | "technicalFlow"
  | "upsideDownside";

export type FenokSignalTone = "up" | "warn" | "down" | "neutral";

export interface FenokSignalHelpBand {
  min: number;
  max: number;
  label: string;
  tone: FenokSignalTone;
}

export interface FenokSignalHelpEntry {
  key: FenokSignalHelpKey;
  label: string;
  interpretation: string;
  bands: FenokSignalHelpBand[];
}

const DEFAULT_BANDS: FenokSignalHelpBand[] = [
  { min: 81, max: 100, label: "강함", tone: "up" },
  { min: 61, max: 80, label: "우호", tone: "up" },
  { min: 41, max: 60, label: "중립", tone: "warn" },
  { min: 0, max: 40, label: "위약", tone: "down" },
];

function makeDefaultEntry(
  key: Exclude<FenokSignalHelpKey, "upsideDownside">,
  label: string,
  interpretation: string,
): FenokSignalHelpEntry {
  return { key, label, interpretation, bands: DEFAULT_BANDS };
}

export const FENOK_SIGNAL_HELP_REGISTRY: Record<
  FenokSignalHelpKey,
  FenokSignalHelpEntry
> = {
  profitability: makeDefaultEntry(
    "profitability",
    "수익성",
    "기업의 이익 창출 능력과 자본 효율성을 종합한 Fenok 파생 신호예요.",
  ),
  growth: makeDefaultEntry(
    "growth",
    "성장",
    "향후 매출·이익 성장 잠재력을 종합한 Fenok 파생 신호예요.",
  ),
  technicalFlow: makeDefaultEntry(
    "technicalFlow",
    "기술·자금",
    "가격 모멘텀과 자금 흐름의 기술적 상태를 종합한 Fenok 파생 신호예요.",
  ),
  upsideDownside: {
    key: "upsideDownside",
    label: "Fenok Edge",
    interpretation:
      "Fenok 파생 신호로 산출한 상대적 상방/하방 기대치예요.",
    bands: [
      { min: 81, max: 100, label: "상방 우세", tone: "up" },
      { min: 61, max: 80, label: "상방 우호", tone: "up" },
      { min: 41, max: 60, label: "균형", tone: "warn" },
      { min: 0, max: 40, label: "하방 우세", tone: "down" },
    ],
  },
};

export function getSignalHelpEntry(key: FenokSignalHelpKey): FenokSignalHelpEntry {
  return FENOK_SIGNAL_HELP_REGISTRY[key];
}

export function lookupBand(
  entry: FenokSignalHelpEntry,
  score: number | null | undefined,
): FenokSignalHelpBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  return (
    entry.bands.find((band) => clamped >= band.min && clamped <= band.max) ??
    null
  );
}

export function toneClass(tone: FenokSignalTone): string {
  switch (tone) {
    case "up":
      return "bg-[var(--c-up-soft)] text-[var(--c-up)]";
    case "warn":
      return "bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
    case "down":
      return "bg-[var(--c-down-soft)] text-[var(--c-down)]";
    case "neutral":
      return "bg-[var(--c-surface-2)] text-[var(--c-ink-3)]";
  }
}
```

- [ ] **Step 2: Verify type check**

Run: `cd 100xfenok-next && npx tsc --noEmit`
Expected: no errors from the new file.

---

## Task 2: Create the shared direction-label helper

**Files:**
- Create: `src/lib/fenok-signals/direction-ko.ts`

- [ ] **Step 1: Write the helper**

```ts
const DIRECTION_LABELS: Record<string, string> = {
  strong: "강함",
  constructive: "우호",
  neutral: "중립",
  weak: "약함",
  stressed: "압박",
  positive: "상",
  negative: "하",
  upside_bias: "상방 편중",
  downside_bias: "하방 편중",
  balanced: "균형",
  unavailable: "미확인",
};

export function directionKo(
  value: string | null | undefined,
  fallback = "미확인",
): string {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return DIRECTION_LABELS[normalized] ?? fallback;
}
```

- [ ] **Step 2: Verify type check**

Run: `cd 100xfenok-next && npx tsc --noEmit`
Expected: no errors.

---

## Task 3: Create the positioning hook

**Files:**
- Create: `src/hooks/usePopoverPosition.ts`

- [ ] **Step 1: Write the hook**

```ts
"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

type Placement = "auto" | "top" | "bottom" | "left" | "right";
type FixedPlacement = Exclude<Placement, "auto">;

const GAP = 8;
const VIEWPORT_PAD = 8;

interface PopoverPosition {
  top: number;
  left: number;
  actualPlacement: Placement;
}

export function usePopoverPosition(
  triggerRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  placement: Placement,
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return;

    function compute() {
      if (!trigger || !popover) return;
      const triggerRect = trigger.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let actual: Placement = placement === "auto" ? "bottom" : placement;

      const fits = (p: FixedPlacement): boolean => {
        if (p === "bottom") {
          return (
            triggerRect.bottom + GAP + popoverRect.height <=
            viewportHeight - VIEWPORT_PAD
          );
        }
        if (p === "top") {
          return triggerRect.top - GAP - popoverRect.height >= VIEWPORT_PAD;
        }
        if (p === "right") {
          return (
            triggerRect.right + GAP + popoverRect.width <=
            viewportWidth - VIEWPORT_PAD
          );
        }
        if (p === "left") {
          return triggerRect.left - GAP - popoverRect.width >= VIEWPORT_PAD;
        }
        return false;
      };

      if (placement === "auto") {
        actual = fits("bottom") ? "bottom" : fits("top") ? "top" : "bottom";
      } else if (!fits(actual)) {
        const opposite: Record<FixedPlacement, FixedPlacement> = {
          top: "bottom",
          bottom: "top",
          left: "right",
          right: "left",
        };
        actual = opposite[actual];
      }

      let top = 0;
      let left = 0;

      if (actual === "bottom") {
        top = triggerRect.bottom + GAP;
        left = triggerRect.left;
      } else if (actual === "top") {
        top = triggerRect.top - popoverRect.height - GAP;
        left = triggerRect.left;
      } else if (actual === "right") {
        top = triggerRect.top;
        left = triggerRect.right + GAP;
      } else if (actual === "left") {
        top = triggerRect.top;
        left = triggerRect.left - popoverRect.width - GAP;
      }

      if (left + popoverRect.width > viewportWidth - VIEWPORT_PAD) {
        left = viewportWidth - popoverRect.width - VIEWPORT_PAD;
      }
      if (left < VIEWPORT_PAD) {
        left = VIEWPORT_PAD;
      }

      setPosition({ top, left, actualPlacement: actual });
    }

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [triggerRef, popoverRef, placement]);

  return position;
}
```

- [ ] **Step 2: Verify type check**

Run: `cd 100xfenok-next && npx tsc --noEmit`
Expected: no errors.

---

## Task 4: Create the popover component

**Files:**
- Create: `src/components/screener/FenokSignalHelpPopover.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/hooks/usePopoverPosition";
import {
  type FenokSignalHelpKey,
  getSignalHelpEntry,
  toneClass,
} from "@/lib/fenok-signals/signal-help-config";
import { directionKo } from "@/lib/fenok-signals/direction-ko";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface FenokSignalHelpPopoverProps {
  signal: FenokSignalHelpKey;
  score?: number | null;
  direction?: string | null;
  placement?: "auto" | "top" | "bottom" | "left" | "right";
}

export default function FenokSignalHelpPopover({
  signal,
  score,
  direction,
  placement = "auto",
}: FenokSignalHelpPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(triggerRef, popoverRef, placement);
  const titleId = useId();
  const popoverId = useId();
  const entry = getSignalHelpEntry(signal);
  const scoreValue = isFiniteNumber(score) ? Math.round(score) : null;

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === "Tab") {
        setIsOpen(false);
      }
    }

    function handleClickOutside(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  function toggle() {
    setIsOpen((prev) => !prev);
  }

  const headerDirection = directionKo(direction, "미확인");

  const popover = (
    <div
      ref={popoverRef}
      id={popoverId}
      role="dialog"
      aria-labelledby={titleId}
      className={cx(
        "fixed z-50 w-60 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3 shadow-[var(--sh-md)]",
        position ? "opacity-100" : "opacity-0",
      )}
      style={
        position
          ? { top: position.top, left: position.left }
          : { top: 0, left: 0 }
      }
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong
          id={titleId}
          className="text-xs font-black text-[var(--c-ink)]"
        >
          {entry.label}
        </strong>
        <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
          {scoreValue ?? "—"} · {headerDirection}
        </span>
      </div>
      <p className="mb-2 text-[11px] font-semibold leading-snug text-[var(--c-ink-2)]">
        {entry.interpretation}
      </p>
      <div className="mb-2 space-y-1">
        {entry.bands.map((band) => {
          const active =
            scoreValue !== null &&
            scoreValue >= band.min &&
            scoreValue <= band.max;
          return (
            <div
              key={band.label}
              className={cx(
                "flex items-center justify-between rounded px-1.5 py-1 text-[10px] font-bold",
                toneClass(band.tone),
                active && "ring-1 ring-[var(--c-line)]",
              )}
            >
              <span>
                {band.min}–{band.max}
              </span>
              <span>{band.label}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[9px] font-bold text-[var(--c-ink-4)]">
        Fenok 파생 신호 · 매수권유 아님
      </p>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${entry.label} 신호 설명 열기`}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={toggle}
        className="inline-flex size-4 items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] text-[10px] font-black leading-none text-[var(--c-ink-3)] shadow-sm transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-interactive)]/40"
      >
        ?
      </button>
      {mounted && isOpen && createPortal(popover, document.body)}
    </>
  );
}
```

- [ ] **Step 2: Verify type check**

Run: `cd 100xfenok-next && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify token check**

Run: `cd 100xfenok-next && npm run qa:tokens`
Expected: no named Tailwind colors introduced.

---

## Task 5: Wire popover into the `/stock` detail card

**Files:**
- Modify: `src/app/stock/[ticker]/FenokSignalLensCard.tsx`

- [ ] **Step 1: Add the import and help-key mapping**

Add at the top:

```ts
import FenokSignalHelpPopover from "@/components/screener/FenokSignalHelpPopover";
import type { FenokSignalHelpKey } from "@/lib/fenok-signals/signal-help-config";
```

Update `SignalConfig` interface:

```ts
interface SignalConfig {
  key: SignalKey;
  label: string;
  scoreKey: keyof FenokSignalsSummaryRecord;
  directionKey: keyof FenokSignalsSummaryRecord;
  interpretation: string;
  helpKey: FenokSignalHelpKey;
}
```

Add `helpKey` to each `SIGNALS` entry:

```ts
const SIGNALS: SignalConfig[] = [
  {
    key: "profitability",
    label: "수익성",
    scoreKey: "profitabilityScore",
    directionKey: "profitabilityDirection",
    interpretation: "기업의 이익 창출 능력과 자본 효율성",
    helpKey: "profitability",
  },
  {
    key: "growth",
    label: "성장",
    scoreKey: "growthScore",
    directionKey: "growthDirection",
    interpretation: "향후 매출·이익 성장 잠재력",
    helpKey: "growth",
  },
  {
    key: "technicalFlow",
    label: "기술·자금",
    scoreKey: "technicalFlowScore",
    directionKey: "technicalFlowDirection",
    interpretation: "가격 모멘텀과 자금 흐름의 기술적 상태",
    helpKey: "technicalFlow",
  },
  {
    key: "upsideDownside",
    label: "Fenok Edge",
    scoreKey: "upsideDownsideScore",
    directionKey: "upsideDownsideDirection",
    interpretation: "상대적 상방/하방 기대의 파생 프록시",
    helpKey: "upsideDownside",
  },
];
```

- [ ] **Step 2: Tighten Fenok Edge direction copy**

In the local `directionKo` function, change the `upsideDownside` branch from:

```ts
if (value === "upside_bias") return "상방 우위";
if (value === "downside_bias") return "하방 압력";
```

to:

```ts
if (value === "upside_bias") return "상방 편중";
if (value === "downside_bias") return "하방 편중";
```

This keeps the full-detail tier consistent with the new popover registry and avoids presenting “상방 우위” as an investment conclusion.

- [ ] **Step 3: Insert the help icon next to each signal label**

In the row rendering block, change the label block from:

```tsx
<span className="text-xs font-black text-[var(--c-ink)]">{chip.label}</span>
<span className="truncate text-[10px] font-semibold text-[var(--c-ink-3)]">
  {chip.interpretation}
</span>
```

to:

```tsx
<span className="text-xs font-black text-[var(--c-ink)]">{chip.label}</span>
<FenokSignalHelpPopover
  signal={chip.helpKey}
  score={chip.score}
  direction={chip.direction}
/>
<span className="truncate text-[10px] font-semibold text-[var(--c-ink-3)]">
  {chip.interpretation}
</span>
```

- [ ] **Step 4: Verify checks**

Run: `cd 100xfenok-next && npx tsc --noEmit && npm run qa:tokens`
Expected: both pass.

---

## Task 6: Wire popover into the screener expanded row

**Files:**
- Modify: `src/app/screener/StockDetailPanel.tsx`

- [ ] **Step 1: Add import and label → help-key map**

Add at the top:

```ts
import FenokSignalHelpPopover from "@/components/screener/FenokSignalHelpPopover";
import type { FenokSignalHelpKey } from "@/lib/fenok-signals/signal-help-config";
```

Add a small map below imports:

```ts
const LABEL_TO_HELP_KEY: Record<string, FenokSignalHelpKey> = {
  수익성: "profitability",
  성장: "growth",
  "기술·자금": "technicalFlow",
  "Fenok Edge": "upsideDownside",
};
```

- [ ] **Step 2: Add the help icon inside each chip**

Change the chip rendering block from:

```tsx
<span aria-hidden="true">{item.label}</span>
{score ?? "—"}
```

to:

```tsx
<span aria-hidden="true">{item.label}</span>
<FenokSignalHelpPopover
  signal={LABEL_TO_HELP_KEY[item.label] ?? "profitability"}
  score={score}
  direction={item.direction}
/>
{score ?? "—"}
```

- [ ] **Step 3: Verify checks**

Run: `cd 100xfenok-next && npx tsc --noEmit && npm run qa:tokens`
Expected: both pass.

---

## Task 7: Manual QA checklist

- [ ] `npm run dev` starts without errors.
- [ ] Open `/stock/AAPL` (or any ticker with Fenok data) and click the “?” icon next to each signal row.
- [ ] Confirm the popover shows: label, score/direction, interpretation, 4-band scale, disclaimer.
- [ ] Press `Escape` — popover closes and focus returns to the “?” button.
- [ ] Click outside the popover — it closes.
- [ ] Open `/screener`, expand a row, and click the “?” icon on a signal chip.
- [ ] Confirm the same popover content appears and is positioned inside the viewport.
- [ ] Test on a mobile viewport: tap opens, tap outside closes.
- [ ] Run `npm run build:runtime` (or at least `npx tsc --noEmit && npm run qa:tokens`) before considering the task complete.

---

## Spec coverage check

| Spec requirement | Task that implements it |
|------------------|------------------------|
| Config-driven signal registry (scales to 6–10 signals) | Task 1 |
| Plain-Korean interpretation + 4-band scale | Task 1 + Task 4 |
| Fenok Edge descriptive copy, no “우위” claim | Task 1 (band labels are descriptive, not prescriptive) |
| Anchored popover card, click/tap activated | Task 3 + Task 4 |
| Escape / click-outside / focus return | Task 4 |
| `aria-expanded`, `aria-controls`, `role="dialog"` | Task 4 |
| No named Tailwind colors, only `--c-*` tokens | All styling in Tasks 1, 4, 5, 6 |
| Wired into `/stock` detail card | Task 5 |
| Wired into screener expanded row | Task 6 |
