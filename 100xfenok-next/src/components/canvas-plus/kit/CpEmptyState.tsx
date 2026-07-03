import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames } from "./internal";

export type CpEmptyStateVariant = "axis" | "skip-note";

export type CpEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  message: ReactNode;
  variant?: CpEmptyStateVariant;
};

export default function CpEmptyState({ message, variant = "axis", className, ...props }: CpEmptyStateProps) {
  return (
    <div className={cpClassNames("cpw5-empty", className)} data-variant={variant} data-cp-empty-state {...props}>
      {message}
    </div>
  );
}
