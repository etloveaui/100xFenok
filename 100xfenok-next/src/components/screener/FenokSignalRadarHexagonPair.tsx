"use client";

import {
  FenokSignalRadarHexagon,
  type FenokSignalRadarHexagonAxis,
} from "./FenokSignalRadarHexagon";

export interface FenokSignalRadarHexagonPairProps {
  leftTitle?: string;
  rightTitle?: string;
  leftAxes: FenokSignalRadarHexagonAxis[];
  rightAxes: FenokSignalRadarHexagonAxis[];
  size?: "md" | "lg";
  leftEmptyLabel?: string;
  rightEmptyLabel?: string;
}

export function FenokSignalRadarHexagonPair({
  leftTitle = "Short-term",
  rightTitle = "Long-term",
  leftAxes,
  rightAxes,
  size = "lg",
  leftEmptyLabel,
  rightEmptyLabel,
}: FenokSignalRadarHexagonPairProps) {
  return (
    <div className="flex w-full min-w-0 flex-row flex-wrap items-start justify-center gap-3 overflow-hidden sm:gap-4">
      <FenokSignalRadarHexagon title={leftTitle} axes={leftAxes} size={size} emptyLabel={leftEmptyLabel} />
      <FenokSignalRadarHexagon title={rightTitle} axes={rightAxes} size={size} emptyLabel={rightEmptyLabel} />
    </div>
  );
}
