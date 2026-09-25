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
  /**
   * How `loading` looks. "skeleton" (default) lays the generic skeleton over the
   * still-mounted, hidden children; "placeholder" is for children that already
   * render their own placeholder layout (e.g. "—" values) — they stay visible
   * and dimmed, so the panel keeps its exact size when data arrives.
   */
  loadingMode?: "skeleton" | "placeholder";
};

const PANEL_BOX = "bg-[#ffffff] border border-[#e2e8f0] rounded-[8px] overflow-hidden transition-colors duration-150";

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
  loadingMode = "skeleton",
}: PanelProps) {
  const showSkeleton = useDelayedLoading(loading);
  if (loading && loadingMode === "placeholder") {
    return (
      <div className={`${PANEL_BOX} ${className}`} aria-busy="true" data-panel-loading="placeholder">
        {children}
      </div>
    );
  }
  if (loading) {
    // Children stay in the layout (hidden) under the skeleton, so the panel is
    // max(children, skeleton) tall from the first paint. Before, it rendered the
    // children, swapped to a fixed skeleton at 120ms and swapped back on data —
    // two layout shifts per panel. The skeleton itself still only becomes
    // visible after the 120ms delay.
    return (
      <div className={`${PANEL_BOX} ${className}`} aria-busy="true" data-panel-loading="skeleton">
        <div className="grid">
          <div className="invisible [grid-area:1/1]" aria-hidden="true" inert>
            {children}
          </div>
          <div
            className="[grid-area:1/1] transition-opacity duration-150"
            style={{ opacity: showSkeleton ? 1 : 0 }}
          >
            <Skeleton />
          </div>
        </div>
      </div>
    );
  }
  if (empty) {
    const { rails } = splitTrailingRails(children);
    return (
      <div className={`${PANEL_BOX} ${className}`}>
        <EmptyState reason={emptyReason} nextRefresh={emptyNextRefresh} actionLabel={emptyActionLabel} onAction={onEmptyAction} />
        {rails}
      </div>
    );
  }
  return (
    <div className={`${PANEL_BOX} ${className}`}>
      {(stale || error) && <StaleState asOf={asOf} detail={error ? errorDetail : undefined} onRetry={onRetry} retryLabel={retryLabel} />}
      {((stale || error) && keepContentOnStale) || (!stale && !error) ? children : null}
      {(stale || error) && !keepContentOnStale && <div className="px-4 py-3 text-[12px] text-[#64748b]">이전 값 유지 중</div>}
    </div>
  );
}
