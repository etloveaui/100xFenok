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
  enabled = true,
): PopoverPosition | null {
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
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
        actual = fits("bottom")
          ? "bottom"
          : fits("top")
            ? "top"
            : "bottom";
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
  }, [triggerRef, popoverRef, placement, enabled]);

  return position;
}
