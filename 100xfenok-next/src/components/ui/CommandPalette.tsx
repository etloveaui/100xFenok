"use client";
import * as React from "react";
import { ROUTES } from "@/lib/routes";

export type CommandPaletteItem = {
  id: string;
  label: string;
  sub?: string;
  section: "종목" | "화면" | "동작";
  href?: string;
  stockTicker?: string;
  kbd?: string;
  action?: () => void;
};

const PaletteContent = React.lazy(() => import("./CommandPaletteContent"));
const OPEN_EVENT = "fnk:command-palette";
const G_SEQUENCE_WINDOW_MS = 600;

/** Opens the palette from the top bar without importing its search UI. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function eventTargetInDialog(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (target && typeof target.closest === "function" && target.closest('[role="dialog"], dialog, [aria-modal="true"]')) return true;
  return Boolean(document.querySelector('[role="dialog"], dialog[open]'));
}

export function CommandPalette({ items, onSelect }: {
  items?: CommandPaletteItem[];
  onSelect?: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [resetKey, setResetKey] = React.useState(0);
  const gArmedAt = React.useRef(0);

  const openPalette = React.useCallback((help: boolean) => {
    setLoaded(true);
    setOpen(true);
    setShowHelp(help);
    setResetKey(value => value + 1);
    gArmedAt.current = 0;
  }, []);

  React.useEffect(() => {
    const onOpen = () => openPalette(false);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [openPalette]);

  // Keep navigation shortcuts available before the palette's first download.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.key === "Process" || e.keyCode === 229) {
        gArmedAt.current = 0;
        return;
      }
      const target = e.target as HTMLElement | null;
      const isEditable = e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement
        || (target?.isContentEditable ?? false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setLoaded(true);
        setOpen(value => !value);
        return;
      }
      if (open || isEditable || eventTargetInDialog(e)) { gArmedAt.current = 0; return; }
      if (e.key === "?" || e.key === "/") {
        e.preventDefault();
        openPalette(e.key === "?");
        return;
      }
      const now = Date.now();
      if (e.key === "g") { gArmedAt.current = now; return; }
      if (now - gArmedAt.current <= G_SEQUENCE_WINDOW_MS && (e.key === "s" || e.key === "h")) {
        gArmedAt.current = 0;
        e.preventDefault();
        window.location.href = e.key === "s" ? ROUTES.screener : ROUTES.sectors;
        return;
      }
      gArmedAt.current = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  return loaded ? (
    <React.Suspense fallback={null}>
      <PaletteContent key={resetKey} items={items} onSelect={onSelect} open={open} setOpen={setOpen}
        showHelp={showHelp} setShowHelp={setShowHelp} />
    </React.Suspense>
  ) : null;
}
