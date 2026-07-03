import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpTimelineEventState = "done" | "pending" | "highlight";

export type CpTimelineEvent = {
  id?: string | number;
  dateLabel?: ReactNode;
  state: CpTimelineEventState;
  tone?: CpTone;
};

export type CpTimelineRow = {
  id?: string | number;
  typeLabel: ReactNode;
  events: readonly CpTimelineEvent[];
};

export type CpTimelineLegendItem = {
  id?: string | number;
  label: ReactNode;
  tone: CpTone;
};

export type CpTimelineStripProps = HTMLAttributes<HTMLDivElement> & {
  rows: readonly CpTimelineRow[];
  legendItems?: readonly CpTimelineLegendItem[];
};

export default function CpTimelineStrip({ rows, legendItems, className, ...props }: CpTimelineStripProps) {
  return (
    <div className={cpClassNames("cpw5-timeline", className)} data-cp-timeline-strip {...props}>
      {rows.map((row, rowIndex) => (
        <div className="cpw5-timeline__row" key={row.id ?? rowIndex}>
          <span className="cpw5-timeline__row-label">{row.typeLabel}</span>
          <div className="cpw5-timeline__lane">
            {row.events.map((event, eventIndex) => (
              <span
                key={event.id ?? eventIndex}
                className="cpw5-timeline__dot"
                data-state={event.state}
                data-tone={event.tone ?? "neutral"}
              >
                {event.dateLabel ? <span className="cpw5-timeline__dot-label">{event.dateLabel}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ))}
      {legendItems && legendItems.length > 0 ? (
        <div className="cpw5-timeline__legend">
          {legendItems.map((item, index) => (
            <span key={item.id ?? index}>
              <i className="dot" data-tone={item.tone} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
