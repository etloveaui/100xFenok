import type { ReactNode } from "react";

/**
 * Loading copy drawn as shimmer bars, one per wrapped line. The template text
 * lays out exactly like the real copy, so the loading state keeps the loaded
 * height at every width, but it is never painted (visibility: hidden), so it
 * cannot stand in for the page's real LCP element.
 */
export default function EtfTextSkeleton({ children }: { children: ReactNode }) {
  return (
    <span className="etf-text-skeleton" aria-hidden="true">
      <span className="etf-text-skeleton-ink">{children}</span>
    </span>
  );
}
