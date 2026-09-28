"use client";

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/client/body-scroll-lock";

export type ScreenerFilterSheetSection = "filters" | "sort" | "presets";

const SHEET_LOCK_ID = "screener-filter-sheet";

/**
 * Mobile filter sheet for /screener (fh-029). Same portal/a11y shell as
 * ScreenerDetailSheet (focus trap that includes select, Escape close, focus
 * return, body scroll lock); the content and all filter state stay in
 * ScreenerClient — the sheet owns only the chrome, the section order and the
 * scroll-to-section. z-index 55: above the tab bar (40) and the 더보기 sheet
 * (50), below the detail sheet (60).
 */
export default function ScreenerFilterSheet({
  section,
  resultCount,
  onReset,
  onClose,
  children,
}: {
  section: ScreenerFilterSheetSection;
  resultCount: number;
  onReset: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Effect Event (React 19.2): the parent re-renders on every filter
  // keystroke, and re-running the effect below would steal focus back to the
  // close button mid-typing, so the close handler is created as an Effect
  // Event and stays out of the dependency list without going stale.
  const closeSheet = useEffectEvent(() => {
    onClose();
  });

  useEffect(() => { setMounted(true); }, []);

  // Gated on `mounted`: the portal (and therefore panelRef/closeRef) only
  // exists after that first commit, so this effect must re-run once it flips.
  useEffect(() => {
    if (!mounted) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll(SHEET_LOCK_ID);
    closeRef.current?.focus();
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-sheet-section="${section}"]`)
      ?.scrollIntoView({ block: "start" });
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((node) => node.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
      unlockBodyScroll(SHEET_LOCK_ID);
      restoreFocusRef.current?.focus();
    };
  }, [mounted, section]);

  if (!mounted) return null;

  return createPortal(
    <div className="cp-screener-filter-sheet" data-screener-filter-sheet="true">
      <button
        type="button"
        className="cp-screener-filter-sheet__backdrop"
        aria-label="필터 닫기"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="스크리너 필터"
        className="cp-screener-filter-sheet__panel"
      >
        <div className="cp-screener-filter-sheet__head">
          <span>필터</span>
          <button
            ref={closeRef}
            type="button"
            className="cp-screener-filter-sheet__close"
            aria-label="필터 닫기"
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="cp-screener-filter-sheet__body">{children}</div>
        <div className="cp-screener-filter-sheet__footer">
          <button
            type="button"
            className="cp-button cp-screener-filter-sheet__reset"
            data-variant="ghost"
            data-density="compact"
            onClick={onReset}
          >
            초기화
          </button>
          <button
            type="button"
            className="cp-button cp-screener-filter-sheet__apply"
            data-variant="primary"
            data-density="compact"
            onClick={onClose}
          >
            {resultCount.toLocaleString("ko-KR")}개 결과 보기
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
