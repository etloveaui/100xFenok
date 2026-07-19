"use client";

import dynamic from "next/dynamic";
import type { FenokSignalRadarProps } from "./FenokSignalRadarChart";

export type {
  FenokSignalRadarAxis,
  FenokSignalRadarData,
  FenokSignalRadarProps,
} from "./FenokSignalRadarChart";

// Chart.js is client-only; keep it out of the Worker/SSR bundle by loading the
// canvas implementation behind an ssr:false boundary. Current callers use size
// "md", so the placeholder matches that footprint to avoid layout jump.
const FenokSignalRadarChart = dynamic(
  () => import("./FenokSignalRadarChart").then((m) => m.FenokSignalRadar),
  {
    ssr: false,
    loading: () => (
      <div
        className="grid h-[160px] w-[160px] animate-pulse place-items-center rounded-lg border border-dashed border-[var(--c-line)] bg-[var(--c-surface-2)] text-[9px] font-bold text-[var(--c-ink-3)]"
        aria-hidden
      />
    ),
  },
);

export function FenokSignalRadar(props: FenokSignalRadarProps) {
  return <FenokSignalRadarChart {...props} />;
}
