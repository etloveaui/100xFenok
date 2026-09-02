import * as React from "react";

type Freshness = "fresh" | "stale" | "delayed" | "fixed";

type EvidenceRailProps = {
  freshness: Freshness;
  source: string;
  asOf: string;
  coverage: string;
  onEvidence?: () => void;
  className?: string;
};

const dotColor: Record<Freshness, string> = {
  fresh: "#1aa86f",
  stale: "#f2a93b",
  delayed: "#e84a5a",
  fixed: "#94a3b8",
};

const label: Record<Freshness, string> = {
  fresh: "신선",
  stale: "대기",
  delayed: "지연",
  fixed: "고정",
};

export function EvidenceRail({ freshness, source, asOf, coverage, onEvidence, className = "" }: EvidenceRailProps) {
  return (
    <div
      className={`flex items-center gap-[14px] h-[30px] px-4 border-t border-[#f1f5f9] bg-[#fafbfc] text-[11px] text-[#64748b] ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: dotColor[freshness] }} />
        <b className="text-[#334155] font-semibold">{label[freshness]}</b>
      </span>
      <span>
        출처 <b className="text-[#334155] font-semibold">{source}</b>
      </span>
      <span>
        기준 <b className="tabular-nums text-[#334155] font-semibold">{asOf}</b>
      </span>
      <span>
        커버리지 <b className="tabular-nums text-[#334155] font-semibold">{coverage}</b>
      </span>
      {onEvidence && (
        <button onClick={onEvidence} className="ml-auto font-semibold text-[#1B73D3] hover:text-[#155fae] transition-colors duration-150">
          증거 보기
        </button>
      )}
    </div>
  );
}
