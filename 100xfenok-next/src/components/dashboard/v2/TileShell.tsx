"use client";

import type { ReactNode } from "react";
import { v2cx } from "./types";
import FreshnessBadge from "./FreshnessBadge";
import type { V2Freshness } from "./types";

type TileSpan = "hero" | "wide" | "wide3" | null;

type TileShellProps = {
  kicker: string;
  title: string;
  freshness?: V2Freshness;
  span?: TileSpan;
  muted?: boolean;
  action?: ReactNode;
  children: ReactNode;
};

/**
 * V2 bento tile primitive — Claude Design `HpTile` port.
 * - Kicker + Title (3-tier hierarchy: eyebrow / title / meta in body)
 * - Freshness chip stacks above title (single column, no head collision)
 * - Title forced nowrap + ellipsis (resolves P0 "Risk Appetite" clip)
 * - Optional `span` controls bento grid placement
 * - `muted` applies opacity + saturation for offline/partial states
 */
export default function TileShell({
  kicker,
  title,
  freshness,
  span,
  muted,
  action,
  children,
}: TileShellProps) {
  return (
    <article
      className={v2cx(
        "hp-tile",
        span === "hero" && "hp-tile--hero",
        span === "wide" && "hp-tile--wide",
        span === "wide3" && "hp-tile--wide3",
        muted && "hp-tile--muted",
      )}
    >
      <div className="hp-tile__head">
        <div style={{ minWidth: 0 }}>
          <div className="hp-kicker">{kicker}</div>
          <h3 className="hp-tile__title">{title}</h3>
        </div>
        {freshness ? <FreshnessBadge meta={freshness} /> : null}
      </div>
      <div className="hp-tile__body">{children}</div>
      {action ? <div className="hp-tile__action">{action}</div> : null}
    </article>
  );
}
