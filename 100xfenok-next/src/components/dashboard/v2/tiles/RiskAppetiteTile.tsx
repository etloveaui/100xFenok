"use client";

import TileShell from "../TileShell";
import type { V2Freshness } from "../types";
import type { DashboardSnapshot } from "@/lib/dashboard/types";

/**
 * V2 Risk Appetite — AUDIT P1 fix: reshape from V1's "Put/Call + redundant
 * Crypto/VIX/PutCall rows" to **3 unique positioning metrics**:
 *   - Put / Call (live from dashboard)
 *   - Margin Debt (illustrative until backend wires Fed Z.1 series)
 *   - Short Interest (illustrative until backend wires NYSE Short Interest)
 *
 * Removes duplicates with the dedicated Crypto/VIX/F&G tiles, restoring
 * unique value to this tile per the audit.
 */
export default function RiskAppetiteTile({
  dashboard,
  freshness,
  muted,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
}) {
  return (
    <TileShell
      kicker="Positioning"
      title="포지셔닝 성향"
      freshness={freshness}
      span="wide"
      muted={muted}
    >
      <div className="hp-ra">
        <div className="hp-ra__cell">
          <div className="hp-kicker">Put / Call</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 28,
              marginTop: 8,
              color: "var(--hp-ink)",
            }}
          >
            {dashboard.putCallValue.toFixed(2)}
          </div>
          <div className="hp-bk__desc">{dashboard.putCallLabel}</div>
        </div>
        <div className="hp-ra__cell">
          <div className="hp-kicker">Margin Debt</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 28,
              marginTop: 8,
              color: "var(--hp-ink)",
            }}
          >
            $783B
          </div>
          <div className="hp-bk__desc">전월 대비 ▲ +2.1% · FINRA</div>
        </div>
        <div className="hp-ra__cell">
          <div className="hp-kicker">Short Interest</div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 900,
              fontSize: 28,
              marginTop: 8,
              color: "var(--hp-ink)",
            }}
          >
            4.2%
          </div>
          <div className="hp-bk__desc">S&amp;P 500 · 2주 트렌드 ▼</div>
        </div>
      </div>
    </TileShell>
  );
}
