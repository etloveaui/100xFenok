import * as React from "react";
import type { EvidenceStage, EvidenceStageTone } from "@/lib/evidence/provenance";

export type EvidenceRailFreshness = "fresh" | "stale" | "delayed" | "fixed" | "pending" | "error" | "partial";

export type { EvidenceStage, EvidenceStageTone };

type EvidenceRailProps = {
  freshness: EvidenceRailFreshness;
  source: string;
  asOf: string;
  coverage: string;
  next?: string;
  onEvidence?: () => void;
  className?: string;
  /** retry action; rendered whenever provided on a non-fresh state */
  onRetry?: () => void;
  /** last-known-good timestamp; rendered for error / stale-with-LKG states */
  lkgAsOf?: string;
  /** label prefix for the last-known-good timestamp */
  lkgLabel?: string;
  /** delay (ms) before the mobile pending skeleton appears; avoids flash on fast loads */
  skeletonDelayMs?: number;
  /** provenance stages; when provided, "증거 보기" opens the inline drawer */
  stages?: EvidenceStage[];
  /** header-chip variant: compact evidence entry for a PanelHeader right slot */
  variant?: "rail" | "chip";
};

const dotColor: Record<EvidenceRailFreshness, string> = {
  fresh: "#1aa86f",
  stale: "#f2a93b",
  delayed: "#e84a5a",
  fixed: "#94a3b8",
  pending: "#f2a93b",
  error: "#e84a5a",
  partial: "#f2a93b",
};

const label: Record<EvidenceRailFreshness, string> = {
  fresh: "신선",
  stale: "대기",
  delayed: "지연",
  fixed: "고정",
  pending: "확인 중",
  error: "오류",
  partial: "부분",
};

const stageDot: Record<EvidenceStageTone, string> = {
  ok: "#1aa86f",
  warn: "#f2a93b",
  bad: "#e84a5a",
  muted: "#94a3b8",
};

function useDelayedRailSkeleton(active: boolean, delayMs: number) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return show;
}

export function EvidenceRail({
  freshness,
  source,
  asOf,
  coverage,
  next,
  onEvidence,
  className = "",
  onRetry,
  lkgAsOf,
  lkgLabel = "이전 값",
  skeletonDelayMs = 120,
  stages,
  variant = "rail",
}: EvidenceRailProps) {
  const showLkg = (freshness === "error" || freshness === "stale") && !!lkgAsOf;
  const showRetry = !!onRetry && freshness !== "fresh";
  const showMobileSkeleton = useDelayedRailSkeleton(freshness === "pending", skeletonDelayMs);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const hasDrawer = Array.isArray(stages) && stages.length > 0;

  if (variant === "chip") {
    const chipInner = (
      <>
        <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: dotColor[freshness] }} />
        <b className="text-[#334155] font-semibold">{label[freshness]}</b>
        <span className="tabular-nums">{asOf}</span>
      </>
    );
    const chipClass =
      "inline-flex items-center gap-1.5 rounded-full border border-[#e2e8f0] bg-white px-2.5 py-1 text-[11px] text-[#64748b] whitespace-nowrap";
    if (!onEvidence) {
      return <span className={chipClass}>{chipInner}</span>;
    }
    return (
      <button onClick={onEvidence} className={chipClass} aria-label={`증거: ${source} ${asOf}`}>
        {chipInner}
      </button>
    );
  }

  const handleEvidence = () => {
    if (hasDrawer) {
      setDrawerOpen((v) => !v);
      return;
    }
    onEvidence?.();
  };

  return (
    <div className={className}>
      <div
        className="flex items-center gap-[14px] h-[30px] px-4 border-t border-[#f1f5f9] bg-[#fafbfc] text-[11px] text-[#64748b] overflow-hidden whitespace-nowrap"
      >
        <span className="inline-flex items-center gap-1 shrink-0">
          <span className="inline-block w-[6px] h-[6px] rounded-full" style={{ background: dotColor[freshness] }} />
          <b className="text-[#334155] font-semibold">{label[freshness]}</b>
        </span>
        {showMobileSkeleton ? (
          <span aria-hidden="true" className="h-[10px] flex-1 rounded bg-[#f1f5f9] animate-pulse md:hidden" />
        ) : (
          <>
            <span className="shrink-0 max-md:hidden">
              출처 <b className="text-[#334155] font-semibold">{source}</b>
            </span>
            <span className="shrink-0"><span className="max-md:hidden">기준 </span><b className="tabular-nums text-[#334155] font-semibold">{asOf}</b></span>
            {showLkg && (
              <span className="shrink-0">{lkgLabel} <b className="tabular-nums text-[#334155] font-semibold">{lkgAsOf}</b></span>
            )}
            <span className="max-md:hidden">
              커버리지 <b className="tabular-nums text-[#334155] font-semibold">{coverage}</b>
            </span>
            {next && (<span className="shrink-0">다음 <b className="tabular-nums text-[#334155] font-semibold">{next}</b></span>)}
          </>
        )}
        {showRetry && (
          <button
            onClick={onRetry}
            className={`${hasDrawer || onEvidence ? "" : "ml-auto "}shrink-0 font-semibold text-[#1B73D3] hover:text-[#155fae] transition-colors duration-150`}
          >
            지금 재시도
          </button>
        )}
        {(hasDrawer || onEvidence) && (
          <button onClick={handleEvidence} className="ml-auto shrink-0 font-semibold text-[#1B73D3] hover:text-[#155fae] transition-colors duration-150">
            증거 보기
          </button>
        )}
      </div>
      {hasDrawer && drawerOpen && (
        <div className="border-t border-[#f1f5f9] bg-white px-4 py-2">
          {stages!.map((stage) => (
            <div key={stage.stage} className="flex items-baseline gap-3 border-b border-[#f1f5f9] py-1.5 text-[11px] last:border-b-0">
              <span className="inline-flex w-[52px] shrink-0 items-center gap-1.5 font-semibold text-[#64748b]">
                <span
                  className="inline-block w-[6px] h-[6px] rounded-full"
                  style={{ background: stageDot[stage.tone ?? "muted"] }}
                />
                {stage.stage}
              </span>
              <span className="min-w-0 flex-1 truncate text-[#334155]">{stage.detail}</span>
              {stage.at && <span className="shrink-0 tabular-nums text-[#64748b]">{stage.at}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
