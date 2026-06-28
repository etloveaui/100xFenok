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
}

export function FenokSignalRadarHexagonPair({
  leftTitle = "Short-term",
  rightTitle = "Long-term",
  leftAxes,
  rightAxes,
  size = "lg",
}: FenokSignalRadarHexagonPairProps) {
  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start sm:justify-center">
      <FenokSignalRadarHexagon title={leftTitle} axes={leftAxes} size={size} />
      <FenokSignalRadarHexagon title={rightTitle} axes={rightAxes} size={size} />
    </div>
  );
}
