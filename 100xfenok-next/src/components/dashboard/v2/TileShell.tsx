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
  /** V3 — pin toggle in header */
  pinned?: boolean;
  onPin?: () => void;
  /** V3 — pulsing red dot on the pin chip when an alert fired */
  hasAlert?: boolean;
  /** V3 — gold flash + ring while an alert is "active" */
  flash?: boolean;
  /** V3 — DOM id for AlertInbox scroll-into-view */
  tileId?: string;
};

/**
 * V2 bento tile primitive — Claude Design `HpTile` port.
 *
 * V3 evolution (DEC-199):
 * - Optional `pinned/onPin/hasAlert/flash/tileId` props enable the
 *   Watch & Alert layer without changing V2 callers (all defaults safe).
 */
export default function TileShell({
  kicker,
  title,
  freshness,
  span,
  muted,
  action,
  children,
  pinned,
  onPin,
  hasAlert,
  flash,
  tileId,
}: TileShellProps) {
  return (
    <article
      id={tileId}
      className={v2cx(
        "hp-tile",
        span === "hero" && "hp-tile--hero",
        span === "wide" && "hp-tile--wide",
        span === "wide3" && "hp-tile--wide3",
        muted && "hp-tile--muted",
        flash && "hp-tile--flash",
      )}
    >
      <div className="hp-tile__head">
        <div style={{ minWidth: 0 }}>
          <div className="hp-kicker">{kicker}</div>
          <h3 className="hp-tile__title">{title}</h3>
        </div>
        <div className="hp-tile__head-actions">
          {freshness ? <FreshnessBadge meta={freshness} /> : null}
          {onPin ? (
            <button
              type="button"
              className={v2cx("hp-pin-toggle", pinned && "is-pinned")}
              onClick={onPin}
              aria-pressed={pinned}
              aria-label={pinned ? "핀 해제" : "핀 고정"}
            >
              <svg
                width={10}
                height={10}
                viewBox="0 0 24 24"
                fill={pinned ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 2v6l3 3v3H9v-3l3-3V2z" />
                <path d="M12 14v8" />
              </svg>
              {hasAlert ? <span className="hp-pin-toggle__alert" aria-hidden="true" /> : null}
            </button>
          ) : null}
        </div>
      </div>
      <div className="hp-tile__body">{children}</div>
      {action ? <div className="hp-tile__action">{action}</div> : null}
    </article>
  );
}
