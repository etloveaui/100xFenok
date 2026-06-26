"use client";

import Link from "next/link";
import { type ComponentProps } from "react";

type TransitionLinkProps = ComponentProps<typeof Link>;

/**
 * Thin wrapper over next/link.
 *
 * Previously this intercepted clicks and drove a `document.startViewTransition`
 * cross-fade, but the transition callback resolved synchronously right after
 * `router.push` — before the App-Router navigation had committed — so the View
 * Transition captured the *old* page as both its old and new snapshot and held
 * the previous home on screen for the duration of the fade. That produced the
 * "previous home flashes during navigation" defect. We now defer to standard
 * Next navigation + the route-level `loading.tsx` Suspense fallback, which has
 * no held-snapshot flash. (A correct VT would require resolving the callback on
 * the committed pathname change; left out until that is worth the complexity.)
 */
export default function TransitionLink(props: TransitionLinkProps) {
  return <Link {...props} />;
}
