import * as React from "react";
import { Skeleton } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import { StaleState } from "./StaleState";

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
  asOf?: string;
  onRetry?: () => void;
  /** keep LKG children visible when stale/error */
  keepContentOnStale?: boolean;
};

function useDelayedLoading(active?: boolean, delay = 120) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!active) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);
  return show;
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
  asOf,
  onRetry,
  keepContentOnStale,
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
    return (
      <div className={`bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150 ${className}`}>
        <EmptyState reason={emptyReason} nextRefresh={emptyNextRefresh} actionLabel={emptyActionLabel} onAction={onEmptyAction} />
      </div>
    );
  }
  return (
    <div className={`bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150 ${className}`}>
      {stale && <StaleState asOf={asOf} onRetry={onRetry} />}
      {(stale && keepContentOnStale) || !stale ? children : null}
      {stale && !keepContentOnStale && <div className="px-4 py-3 text-[12px] text-[#64748b]">이전 값 유지 중</div>}
    </div>
  );
}
