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
    <div className="flex w-full min-w-0 flex-col items-center gap-4 overflow-hidden sm:flex-row sm:flex-wrap sm:items-start sm:justify-center">
      <FenokSignalRadarHexagon title={leftTitle} axes={leftAxes} size={size} emptyLabel={leftEmptyLabel} />
      <FenokSignalRadarHexagon title={rightTitle} axes={rightAxes} size={size} emptyLabel={rightEmptyLabel} />
    </div>
  );
}
