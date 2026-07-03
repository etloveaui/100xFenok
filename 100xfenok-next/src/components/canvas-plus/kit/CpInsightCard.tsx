import type { HTMLAttributes, ReactNode } from "react";

import { cpClassNames, type CpTone } from "./internal";

export type CpInsightBulletTone = "fact" | "risk" | "claim" | "note";

export type CpInsightBullet = {
  id?: string | number;
  tone: CpInsightBulletTone;
  tagLabel: ReactNode;
  text: ReactNode;
};

export type CpInsightCardProps = HTMLAttributes<HTMLElement> & {
  badgeLabel: ReactNode;
  badgeTone?: CpTone;
  dateLabel: ReactNode;
  headline: ReactNode;
  bullets: readonly CpInsightBullet[];
  expandHref?: string;
  expandLabel?: ReactNode;
};

/**
 * Filing-feed style insight card (W5 kit recipe). Distinct from the legacy
 * `src/components/canvas-plus/CpInsightCard.tsx` metric-rows card — that one
 * stays untouched; this kit variant follows the `.cpw4-filing-feed-card` recipe.
 */
export default function CpInsightCard({
  badgeLabel,
  badgeTone = "neutral",
  dateLabel,
  headline,
  bullets,
  expandHref,
  expandLabel,
  className,
  ...props
}: CpInsightCardProps) {
  return (
    <article className={cpClassNames("cpw5-insight-card", className)} data-cp-insight-card {...props}>
      <div className="cpw5-insight-card__head">
        <span className="cpw5-insight-card__badge" data-tone={badgeTone}>
          {badgeLabel}
        </span>
        <span className="cpw5-insight-card__date">{dateLabel}</span>
      </div>
      <h4 className="cpw5-insight-card__headline">{headline}</h4>
      <div className="cpw5-insight-card__bullets">
        {bullets.map((bullet, index) => (
          <p className="cpw5-insight-card__bullet" key={bullet.id ?? index}>
            <span className="tag" data-tone={bullet.tone}>
              {bullet.tagLabel}
            </span>
            <span>{bullet.text}</span>
          </p>
        ))}
      </div>
      {expandHref ? (
        <a className="cpw5-insight-card__expand" href={expandHref}>
          {expandLabel ?? "원문 근거 보기"}
        </a>
      ) : null}
    </article>
  );
}
