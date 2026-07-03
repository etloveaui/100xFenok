import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpMetricTileSize = "default" | "large";

export type CpMetricTileProps = HTMLAttributes<HTMLElement> & {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: CpTone;
  size?: CpMetricTileSize;
};

export function CpMetricTile({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
  size = "default",
  className,
  ...props
}: CpMetricTileProps) {
  return (
    <article
      className={cpClassNames("cpw5-tile", className)}
      data-tone={tone}
      data-size={size}
      data-cp-metric-tile
      {...props}
    >
      <p className="cpw5-tile__label">{label}</p>
      <p className="cpw5-tile__value">
        {value}
        {unit != null ? <span className="cpw5-tile__unit">{unit}</span> : null}
      </p>
      {sub ? <p className="cpw5-tile__sub">{sub}</p> : null}
    </article>
  );
}

export type CpMetricTileGridProps = HTMLAttributes<HTMLDivElement> & {
  size?: CpMetricTileSize;
};

export function CpMetricTileGrid({ size = "default", className, children, ...props }: CpMetricTileGridProps) {
  return (
    <div className={cpClassNames("cpw5-tile-row", className)} data-size={size} {...props}>
      {children}
    </div>
  );
}

export default CpMetricTile;
