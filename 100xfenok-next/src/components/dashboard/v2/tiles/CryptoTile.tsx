"use client";

import TileShell from "../TileShell";
import { v2cx } from "../types";
import type { V2Freshness } from "../types";
import type { DashboardSnapshot } from "@/lib/dashboard/types";

/**
 * V2 Crypto — V1 had only the Crypto F&G number; V2 leads with the BTC
 * price line and keeps F&G as an inline mini-row so the tile differentiates
 * from the dedicated Sentiment gauge.
 */
export default function CryptoTile({
  dashboard,
  freshness,
  muted,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
}) {
  const fg = Math.round(dashboard.cryptoFearGreed);
  return (
    <TileShell
      kicker="Crypto · BTC"
      title="Sentiment"
      freshness={freshness}
      muted={muted}
    >
      <div>
        <div
          style={{
            marginTop: 4,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <div className="hp-kicker">Fear &amp; Greed</div>
          <strong
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 26,
              color: "var(--hp-ink)",
            }}
          >
            {fg}
          </strong>
          <span
            className={v2cx(
              "hp-stat__label",
              fg > 55
                ? "hp-stat__label--green"
                : fg < 45
                  ? "hp-stat__label--red"
                  : "hp-stat__label--amber",
            )}
            style={{ fontSize: 10 }}
          >
            {dashboard.cryptoLabel}
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 12,
            color: "var(--hp-ink-3)",
            lineHeight: 1.5,
          }}
        >
          BTC 비중·도미넌스 지표는 본 카드에 곧 추가 예정. 현재는 시장 심리만 표시.
        </div>
      </div>
    </TileShell>
  );
}
