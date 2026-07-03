import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpDivergingSegment = {
  id?: string | number;
  label: ReactNode;
  percent: number;
  tone: CpTone;
};

export type CpDivergingBarNet = {
  label: ReactNode;
  value: ReactNode;
  direction?: "up" | "down";
  sub?: ReactNode;
};

export type CpDivergingBarProps = HTMLAttributes<HTMLDivElement> & {
  segments: readonly CpDivergingSegment[];
  legend?: boolean;
  net?: CpDivergingBarNet;
};

export default function CpDivergingBar({
  segments,
  legend = true,
  net,
  className,
  ...props
}: CpDivergingBarProps) {
  return (
    <div className={cpClassNames("cpw5-diverging", className)} data-cp-diverging-bar {...props}>
      <div className="cpw5-diverging__row">
        <div className="cpw5-diverging__bar">
          {segments.map((segment, index) => (
            <span
              key={segment.id ?? index}
              className="cpw5-diverging__seg"
              data-tone={segment.tone}
              style={{ flexBasis: `${Math.max(0, segment.percent)}%` }}
            >
              {segment.label}
            </span>
          ))}
        </div>
        {net ? (
          <div className="cpw5-diverging__net" data-direction={net.direction ?? "neutral"}>
            <span className="l">{net.label}</span>
            <strong className="v">{net.value}</strong>
            {net.sub ? <span className="r">{net.sub}</span> : null}
          </div>
        ) : null}
      </div>
      {legend ? (
        <div className="cpw5-diverging__legend">
          {segments.map((segment, index) => (
            <span key={segment.id ?? index}>
              <i className="dot" data-tone={segment.tone} />
              {segment.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
