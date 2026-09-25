"use client";

import Link from "next/link";
import { type ComponentProps } from "react";
import { LinkPendingSignal } from "@/components/shell/navigation-progress";

type TransitionLinkProps = ComponentProps<typeof Link>;

/**
 * next/link plus navigation feedback.
 *
 * Previously this intercepted clicks and drove a `document.startViewTransition`
 * cross-fade, but the transition callback resolved synchronously right after
 * `router.push` — before the App-Router navigation had committed — so the View
 * Transition captured the *old* page as both its old and new snapshot and held
 * the previous home on screen for the duration of the fade. Navigation is plain
 * next/link again; the only addition is `LinkPendingSignal`, which renders
 * nothing and reports the link's pending state to the shell progress bar.
 */
export default function TransitionLink({ children, ...props }: TransitionLinkProps) {
  return (
    <Link {...props}>
      {children}
      <LinkPendingSignal />
    </Link>
  );
}
