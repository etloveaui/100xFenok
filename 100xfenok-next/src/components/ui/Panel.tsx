import * as React from "react";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { StaleState } from "./StaleState";
import { EvidenceRail } from "./EvidenceRail";

type PanelProps = {
  children: React.ReactNode;
  className?: string;
  loading?: boolean;
  empty?: boolean;
  emptyReason?: string;
  emptyNextRefresh?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  stale?: boolean;
  /** fetch/source failure: same honest LKG treatment as stale (기준 시각 + 재시도, no banner) */
  error?: boolean;
  errorDetail?: string;
  asOf?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** keep LKG children visible when stale/error */
  keepContentOnStale?: boolean;
};

export function useDelayedLoading(active?: boolean, delay = 120) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);
  return show;
}

function splitTrailingRails(children: React.ReactNode) {
  const items = React.Children.toArray(children).filter(
    (child) => child !== null && child !== undefined && typeof child !== "boolean",
  );
  const rails: React.ReactNode[] = [];
  let tail: unknown = items[items.length - 1];
  while (React.isValidElement(tail) && tail.type === EvidenceRail) {
    rails.unshift(items.pop());
    tail = items[items.length - 1];
  }
  return { body: items, rails };
}

export function Panel({
  children,
  className = "",
  loading,
  empty,
  emptyReason,
  emptyNextRefresh,
  emptyActionLabel,
  onEmptyAction,
  stale,
  error,
  errorDetail,
  asOf,
  onRetry,
  retryLabel,
  keepContentOnStale = true,
}: PanelProps) {
  const showSkeleton = useDelayedLoading(loading);
  if (showSkeleton) {
    return (
      <div
        className={`bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150 ${className}`}
        aria-busy="true"
      >
        <Skeleton />
      </div>
    );
  }
  if (empty) {
    const { body, rails } = splitTrailingRails(children);
    return (
      <div className={`bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150 ${className}`}>
        {body}
        <EmptyState reason={emptyReason} nextRefresh={emptyNextRefresh} actionLabel={emptyActionLabel} onAction={onEmptyAction} />
        {rails}
      </div>
    );
  }
  return (
    <div className={`bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150 ${className}`}>
      {(stale || error) && <StaleState asOf={asOf} detail={error ? errorDetail : undefined} onRetry={onRetry} retryLabel={retryLabel} />}
      {((stale || error) && keepContentOnStale) || (!stale && !error) ? children : null}
      {(stale || error) && !keepContentOnStale && <div className="px-4 py-3 text-[12px] text-[#64748b]">이전 값 유지 중</div>}
    </div>
  );
}
