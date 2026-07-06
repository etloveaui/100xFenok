"use client";

import dynamic from "next/dynamic";
import type { FenokSignalRadarHexagonProps } from "./FenokSignalRadarHexagonChart";

export type {
  FenokSignalRadarHexagonAxis,
  FenokSignalRadarHexagonProps,
} from "./FenokSignalRadarHexagonChart";

// Chart.js is client-only; load the canvas implementation behind an ssr:false
// boundary so it stays out of the Worker/SSR bundle. The placeholder mirrors the
// responsive footprint of the chart container to avoid layout jump.
const FenokSignalRadarHexagonChart = dynamic(
  () => import("./FenokSignalRadarHexagonChart").then((m) => m.FenokSignalRadarHexagon),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-w-0 max-w-full flex-col items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-4)]">
          &nbsp;
        </span>
        <div
          className="h-[min(38vw,180px)] w-[min(38vw,180px)] min-h-[128px] min-w-[128px] max-w-full animate-pulse rounded-lg border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] sm:h-[200px] sm:w-[200px] md:h-[280px] md:w-[280px]"
          aria-hidden
        />
      </div>
    ),
  },
);

export function FenokSignalRadarHexagon(props: FenokSignalRadarHexagonProps) {
  return <FenokSignalRadarHexagonChart {...props} />;
}
