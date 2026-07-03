import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpStatChipItem = {
  id?: string | number;
  value: ReactNode;
  label: ReactNode;
  tone?: CpTone;
};

export type CpStatChipRowProps = HTMLAttributes<HTMLDivElement> & {
  items: readonly CpStatChipItem[];
};

export default function CpStatChipRow({ items, className, ...props }: CpStatChipRowProps) {
  return (
    <div className={cpClassNames("cpw5-chip-row", className)} data-cp-stat-chip-row {...props}>
      {items.map((item, index) => (
        <span key={item.id ?? index} className="cpw5-chip" data-tone={item.tone ?? "neutral"}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
