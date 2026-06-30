"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePopoverPosition } from "@/hooks/usePopoverPosition";
import {
  type FenokSignalHelpKey,
  getDisplaySignalHelpBands,
  getDisplaySignalInterpretation,
  getDisplaySignalLabel,
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
  invertedDisplay?: boolean;
}

export default function FenokSignalHelpPopover({
  signal,
  score,
  direction,
  placement = "auto",
  invertedDisplay = false,
}: FenokSignalHelpPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(triggerRef, popoverRef, placement, isOpen);
  const titleId = useId();
  const popoverId = useId();
  const titleLabel = getDisplaySignalLabel(signal, invertedDisplay);
  const scoreValue = isFiniteNumber(score) ? Math.round(score) : null;
  const bands = getDisplaySignalHelpBands(signal, invertedDisplay);
  const interpretation = getDisplaySignalInterpretation(signal, invertedDisplay);

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

  const headerDirection = directionKo(direction, "");

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
          {titleLabel}
        </strong>
        <span className="text-[10px] font-bold text-[var(--c-ink-3)]">
          {scoreValue ?? "—"}
          {headerDirection ? ` · ${headerDirection}` : null}
        </span>
      </div>
      <p className="mb-2 text-[11px] font-semibold leading-snug text-[var(--c-ink-2)]">
        {interpretation}
      </p>
      <div className="mb-2 space-y-1">
        {bands.map((band) => {
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
        Fenok 파생 신호 · 매수 권유 아님
      </p>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${titleLabel} 신호 설명 열기`}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        onClick={toggle}
        className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] text-xs font-black leading-none text-[var(--c-ink-3)] shadow-sm transition hover:border-[var(--brand-interactive)] hover:text-[var(--brand-interactive)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-interactive)]/40"
      >
        ?
      </button>
      {mounted && isOpen && createPortal(popover, document.body)}
    </>
  );
}
