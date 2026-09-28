import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames } from "./internal";

export type CpEmptyStateVariant = "axis" | "skip-note";

export type CpEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  message: ReactNode;
  variant?: CpEmptyStateVariant;
  /** shared five-state contract: when the slot refills (rendered under the reason) */
  nextRefresh?: ReactNode;
  /** shared five-state contract: the single action offered in this state */
  action?: ReactNode;
};

export default function CpEmptyState({ message, variant = "axis", nextRefresh, action, className, ...props }: CpEmptyStateProps) {
  return (
    <div className={cpClassNames("cpw5-empty", className)} data-variant={variant} data-cp-empty-state {...props}>
      {message}
      {nextRefresh ? (
        <span style={{ display: "block", marginTop: 6, fontSize: 12, fontWeight: 500, color: "var(--cp-text-muted)" }}>
          {nextRefresh}
        </span>
      ) : null}
      {action ? <span style={{ display: "block", marginTop: 8 }}>{action}</span> : null}
    </div>
  );
}
