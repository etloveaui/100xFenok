import type { HTMLAttributes, ReactNode } from "react";

import CpBadge from "./CpBadge";

type CpInsightCardTone = "positive" | "negative" | "warning" | "neutral";

function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type CpInsightRow = {
  label: ReactNode;
  value: ReactNode;
  tone?: CpInsightCardTone;
};

type CpInsightCardProps = HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  meta: ReactNode;
  badge: ReactNode;
  tone?: CpInsightCardTone;
  rows: readonly CpInsightRow[];
};

export default function CpInsightCard({
  title,
  meta,
  badge,
  tone = "neutral",
  rows,
  className,
  ...props
}: CpInsightCardProps) {
  return (
    <article className={cpClassNames("cp-insight-card", className)} data-cp-insight-card {...props}>
      <header className="cp-insight-card__header">
        <div>
          <h2>{title}</h2>
          <p>{meta}</p>
        </div>
        <CpBadge tone={tone}>{badge}</CpBadge>
      </header>
      <div className="cp-insight-card__rows">
        {rows.map((row) => (
          <div key={String(row.label)} className="cp-metric-row">
            <span>{row.label}</span>
            <strong className="cp-number" data-tone={row.tone ?? "neutral"}>{row.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}
