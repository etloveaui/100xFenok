import type { HTMLAttributes, ReactNode } from "react";

import { cpBoundPercent, cpClassNames } from "./internal";

export type CpBandVisualProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  currentLabel: ReactNode;
  currentValue: ReactNode;
  position: number;
  lowLabel: ReactNode;
  midLabel: ReactNode;
  highLabel: ReactNode;
  summary?: ReactNode;
};

export default function CpBandVisual({
  label,
  currentLabel,
  currentValue,
  position,
  lowLabel,
  midLabel,
  highLabel,
  summary,
  className,
  ...props
}: CpBandVisualProps) {
  const bounded = cpBoundPercent(position);

  return (
    <div className={cpClassNames("cpw5-band", className)} data-cp-band-visual {...props}>
      <div className="cpw5-band__header">
        <span className="cpw5-band__label">{label}</span>
        <span className="cpw5-band__current-tag">
          <span className="l">{currentLabel}</span>
          <span className="v">{currentValue}</span>
        </span>
      </div>
      <div className="cpw5-band__track-wrap">
        <div className="cpw5-band__flag" style={{ left: `${bounded}%` }}>
          {currentLabel} {currentValue}
        </div>
        <div className="cpw5-band__leader" style={{ left: `${bounded}%` }} aria-hidden="true" />
        <div className="cpw5-band__track" aria-hidden="true" />
      </div>
      <div className="cpw5-band__labels">
        <span>{lowLabel}</span>
        <span>{midLabel}</span>
        <span>{highLabel}</span>
      </div>
      {summary ? <p className="cpw5-band__summary">{summary}</p> : null}
    </div>
  );
}
