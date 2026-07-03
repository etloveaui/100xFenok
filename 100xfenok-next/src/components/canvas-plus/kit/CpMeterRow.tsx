import type { HTMLAttributes, ReactNode } from "react";

import { cpBoundPercent, cpClassNames, type CpTone } from "./internal";

export type CpMeterRowVariant = "boxed" | "axis";
export type CpMeterRowTone = CpTone | "strong" | "watch";

export type CpMeterRowProps = HTMLAttributes<HTMLDivElement> & {
  variant?: CpMeterRowVariant;
  label: ReactNode;
  value: ReactNode;
  percent: number;
  tone?: CpMeterRowTone;
  /** Tone word shown at the end of the axis variant (e.g. "강함", "주의"). */
  toneWord?: ReactNode;
};

export default function CpMeterRow({
  variant = "boxed",
  label,
  value,
  percent,
  tone = "neutral",
  toneWord,
  className,
  ...props
}: CpMeterRowProps) {
  const bounded = cpBoundPercent(percent);

  if (variant === "axis") {
    return (
      <div className={cpClassNames("cpw5-meter", className)} data-variant="axis" data-tone={tone} {...props}>
        <span className="cpw5-meter__axis-name">{label}</span>
        <div className="cpw5-meter__axis-track" aria-hidden="true">
          <span className="cpw5-meter__axis-fill" style={{ width: `${bounded}%` }} />
        </div>
        <span className="cpw5-meter__axis-value">{value}</span>
        <span className="cpw5-meter__axis-tone">{toneWord}</span>
      </div>
    );
  }

  return (
    <div className={cpClassNames("cpw5-meter", className)} data-variant="boxed" data-tone={tone} {...props}>
      <div className="cpw5-meter__head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="cpw5-meter__track" aria-hidden="true">
        <span style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}
