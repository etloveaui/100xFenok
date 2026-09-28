import * as React from "react";
import { Pill } from "./Pill";

type StaleStateProps = {
  asOf?: string;
  /** extra context shown beside the strip (e.g. source error, next retry slot) */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
};

export function StaleState({ asOf, detail, onRetry, retryLabel = "지금 재시도", className = "" }: StaleStateProps) {
  return (
    <div className={`stale-state flex items-center justify-between h-8 px-4 bg-[#fffbeb] border-b border-[#fde68a] text-[12px] ${className}`}>
      <span className="text-[#64748b]">
        {asOf ? <Pill tone="warn">{asOf} 기준 · 갱신 지연</Pill> : <span>갱신 지연 · 이전 값 유지</span>}
        {detail && <span className="ml-2">{detail}</span>}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="stale-state__retry font-semibold text-[#1B73D3] hover:text-[#155fae] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive">
          {retryLabel}
        </button>
      )}
    </div>
  );
}
