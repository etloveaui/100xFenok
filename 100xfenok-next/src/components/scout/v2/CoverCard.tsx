"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import CoverArt from "./CoverArt";
import PickChip from "./PickChip";
import type { Issue } from "./types";

export default function CoverCard({
  issue,
  variant = "row",
  onClick,
}: {
  issue: Issue;
  variant?: "row" | "hero";
  onClick: (issue: Issue) => void;
}) {
  const isHero = variant === "hero";
  return (
    <article
      className={v2cx("as-cover-card", isHero && "as-cover-card--hero")}
      onClick={() => onClick(issue)}
      role="link"
      tabIndex={0}
      data-alpha-scout-card={isHero ? "featured" : "archive"}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(issue);
        }
      }}
    >
      <CoverArt issue={issue} size={isHero ? "lg" : "sm"} />
      <div className="as-cover-card__body">
        <div className="as-cover-card__meta">
          <span className="as-cover-card__issue">ISSUE #{issue.id}</span>
          <span className="as-cover-card__date">{issue.dateLabel}</span>
          {issue.tag ? (
            <span className="as-cover-card__tag">{issue.tag}</span>
          ) : null}
        </div>
        <span className="kicker as-cover-card__kicker">{issue.kicker}</span>
        <h3 className="as-cover-card__headline">{issue.headline}</h3>
        {isHero ? (
          <p className="as-cover-card__dek">{issue.dek}</p>
        ) : null}
        {isHero ? (
          <div className="as-cover-card__picks">
            {issue.picks.map((pick) => (
              <PickChip key={pick.ticker} pick={pick} />
            ))}
          </div>
        ) : null}
        {!isHero ? (
          <div className="as-cover-card__tags">
            {issue.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="as-cover-card__tagchip">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <span className="as-cover-card__cta">
          {isHero ? "이번 호 읽기 →" : "읽기 →"}
        </span>
      </div>
    </article>
  );
}
