import type { HTMLAttributes, ReactNode } from "react";

import { StaleState } from "@/components/ui/StaleState";

import { cpClassNames } from "./internal";
import CpEmptyState from "./CpEmptyState";

export type CpSectionCardVariant = "default" | "edge";

export type CpSectionCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
  footnote?: ReactNode;
  variant?: CpSectionCardVariant;
  children: ReactNode;
  /** shared five-state contract: body replaced by CpEmptyState, header/footnote kept for timestamps */
  empty?: boolean;
  emptyMessage?: ReactNode;
  emptyNextRefresh?: ReactNode;
  emptyAction?: ReactNode;
  /** stale/error: shared StaleState strip (LKG + 기준 시각 + 재시도, no banner), children kept */
  stale?: boolean;
  error?: boolean;
  asOf?: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export default function CpSectionCard({
  title,
  meta,
  eyebrow,
  footnote,
  variant = "default",
  className,
  children,
  empty,
  emptyMessage = "표시할 데이터가 없습니다",
  emptyNextRefresh,
  emptyAction,
  stale,
  error,
  asOf,
  detail,
  onRetry,
  retryLabel,
  ...props
}: CpSectionCardProps) {
  const degraded = stale || error;
  return (
    <section
      className={cpClassNames("cpw5-section", className)}
      data-variant={variant}
      data-cp-section-card
      {...props}
    >
      {eyebrow ? <p className="cpw5-section__eyebrow">{eyebrow}</p> : null}
      <div className="cpw5-section__head">
        <h3>{title}</h3>
        {meta ? <span>{meta}</span> : null}
      </div>
      {degraded ? <StaleState asOf={asOf} detail={detail} onRetry={onRetry} retryLabel={retryLabel} /> : null}
      <div className="cpw5-section__body">
        {empty ? (
          <CpEmptyState message={emptyMessage} nextRefresh={emptyNextRefresh} action={emptyAction} />
        ) : (
          children
        )}
      </div>
      {footnote ? <p className="cpw5-section__footnote">{footnote}</p> : null}
    </section>
  );
}
