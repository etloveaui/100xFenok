"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useLinkStatus } from "next/link";

/**
 * Click-to-feedback for client navigation.
 *
 * `useLinkStatus` reports whether the enclosing `<Link>` has a navigation in
 * flight. Every `TransitionLink` renders a `LinkPendingSignal`, which folds
 * that per-link state into one module-level counter; the persistent shell
 * reads the counter to draw its top progress bar and mark the content busy.
 * The signal renders nothing, so it never changes a link's layout.
 */

let pendingLinks = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isNavigationPending(): boolean {
  return pendingLinks > 0;
}

function serverSnapshot(): boolean {
  return false;
}

export function LinkPendingSignal(): null {
  const { pending } = useLinkStatus();
  useEffect(() => {
    if (!pending) return;
    pendingLinks += 1;
    emit();
    return () => {
      pendingLinks = Math.max(0, pendingLinks - 1);
      emit();
    };
  }, [pending]);
  return null;
}

/** True while any `TransitionLink` navigation is in flight. */
export function useNavigationPending(): boolean {
  return useSyncExternalStore(subscribe, isNavigationPending, serverSnapshot);
}

/**
 * Per-item marker for shell navigation links (rail, tab bar, More sheet).
 * `data-pending` lets CSS highlight the clicked item before the route commits.
 */
export function NavItemPending() {
  const { pending } = useLinkStatus();
  return <span className="nav-pending" aria-hidden="true" data-pending={pending ? "" : undefined} />;
}
