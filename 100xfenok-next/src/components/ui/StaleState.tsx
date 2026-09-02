import * as React from "react";
import { Pill } from "./Pill";

type StaleStateProps = {
  asOf?: string;
  onRetry?: () => void;
  className?: string;
};

export function StaleState({ asOf, onRetry, className = "" }: StaleStateProps) {
  return (
    <div className={`flex items-center justify-between h-8 px-4 bg-[#fffbeb] border-b border-[#fde68a] text-[12px] ${className}`}>
      <span className="text-[#64748b]">
        {asOf ? <Pill tone="warn">{asOf} 기준 · 갱신 지연</Pill> : <span>갱신 지연 · 이전 값 유지</span>}
      </span>
      {onRetry && (
        <button onClick={onRetry} className="font-semibold text-[#1B73D3] hover:text-[#155fae] transition-colors duration-150">
          지금 재시도
        </button>
      )}
    </div>
  );
}
