"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import TransitionLink from "@/components/TransitionLink";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/client/body-scroll-lock";
import { ROUTES } from "@/lib/routes";
import type { ScreenerStock } from "@/lib/screener/types";
import StockDetailPanel from "./StockDetailPanel";

/**
 * Master-detail owner of the screener row detail. Desktop (>=921px) is a
 * right-side sheet overlaying the results, phone is a full-screen sheet, so
 * the list never moves under the pointer. Same StockDetailPanel content.
 */
export default function ScreenerDetailSheet({
  stock,
  detailId,
  canvasPlusPreview,
  returnTo,
  onBeforeNavigate,
  onClose,
}: {
  stock: ScreenerStock;
  detailId: string;
  canvasPlusPreview: boolean;
  returnTo?: string | null;
  onBeforeNavigate?: () => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Gated on `mounted`: the portal (and therefore panelRef/closeRef) only exists
  // after that first commit, so this effect must re-run once it flips.
  useEffect(() => {
    if (!mounted) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll(detailId);
    closeRef.current?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
      unlockBodyScroll(detailId);
      restoreFocusRef.current?.focus();
    };
  }, [mounted, detailId, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="cp-screener-detail-sheet" data-screener-detail-sheet="true">
      <button
        type="button"
        className="cp-screener-detail-sheet__backdrop"
        aria-label={`${stock.ticker} 상세 닫기`}
        onClick={onClose}
      />
      <div
        id={detailId}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${stock.ticker} 종목 상세`}
        className="cp-screener-detail-sheet__panel"
      >
        <div className="cp-screener-detail-sheet__head">
          <span className="cp-screener-detail-sheet__identity">
            <strong>{stock.ticker}</strong>
            <span>{stock.name ?? "이름 미제공"}</span>
          </span>
          <TransitionLink
            href={ROUTES.stock(stock.ticker, returnTo)}
            onClick={onBeforeNavigate}
            className="cp-screener-detail-sheet__stock-link"
          >
            종목 상세
          </TransitionLink>
          <button
            ref={closeRef}
            type="button"
            className="cp-screener-detail-sheet__close"
            aria-label={`${stock.ticker} 상세 닫기`}
            onClick={onClose}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="cp-screener-detail-sheet__body">
          <StockDetailPanel
            ticker={stock.ticker}
            stock={stock}
            canvasPlusPreview={canvasPlusPreview}
            returnTo={returnTo}
            onBeforeNavigate={onBeforeNavigate}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
