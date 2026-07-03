import type { HTMLAttributes, ReactNode } from "react";

import { cpBoundPercent, cpClassNames, type CpTone } from "./internal";

export type CpGaugeCardProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  max?: number;
  displayValue?: ReactNode;
  unitLabel?: ReactNode;
  sub?: ReactNode;
  tone?: CpTone;
  size?: number;
};

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CpGaugeCard({
  value,
  max = 100,
  displayValue,
  unitLabel,
  sub,
  tone = "neutral",
  size = 200,
  className,
  ...props
}: CpGaugeCardProps) {
  const percent = cpBoundPercent(max > 0 ? (value / max) * 100 : 0);
  const dashOffset = CIRCUMFERENCE * (1 - percent / 100);

  return (
    <div className={cpClassNames("cpw5-gauge", className)} data-cp-gauge-card {...props}>
      <div className="cpw5-gauge__wrap" style={{ width: `min(${size}px, 100%)` }}>
        <svg viewBox="0 0 100 100" role="img" aria-label={typeof displayValue === "string" ? displayValue : "gauge"}>
          <circle className="cpw5-gauge__track" cx="50" cy="50" r={RADIUS} />
          <circle
            className="cpw5-gauge__progress"
            data-tone={tone}
            cx="50"
            cy="50"
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <div className="cpw5-gauge__value">
          <strong>{displayValue ?? value}</strong>
          {unitLabel ? <span>{unitLabel}</span> : null}
        </div>
      </div>
      {sub ? <p className="cpw5-gauge__sub">{sub}</p> : null}
    </div>
  );
}
