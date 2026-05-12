"use client";

import TileShell from "../TileShell";
import type { V2Freshness } from "../types";
import type { DashboardSnapshot } from "@/lib/dashboard/types";

type Cell = {
  k: string;
  delta: number;
  context: string;
  isRate?: boolean;
};

/**
 * V2 Indices — AUDIT P0 fix: unified grammar across all 4 cells (all show
 * signed delta + context). SPY/QQQ show price as context, 10Y/HY show
 * yield/spread (in bp delta). Removes V1's "REG" pill + grammar mismatch.
 */
export default function QuickIndicesTile({
  dashboard,
  freshness,
  muted,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
}) {
  const spy = dashboard.quickIndices.find((q) => q.symbol === "SPY") ??
    dashboard.quickIndices[0];
  const qqq = dashboard.quickIndices.find((q) => q.symbol === "QQQ") ??
    dashboard.quickIndices[1];

  const cells: Cell[] = [
    {
      k: "SPY",
      delta: spy?.change ?? 0,
      context: spy?.price ? `$${spy.price.toFixed(2)}` : "기본 데이터",
    },
    {
      k: "QQQ",
      delta: qqq?.change ?? 0,
      context: qqq?.price ? `$${qqq.price.toFixed(2)}` : "기본 데이터",
    },
    {
      k: "10Y",
      delta: 0.04,
      context: `yield · ${dashboard.tenYearYield.toFixed(2)}%`,
      isRate: true,
    },
    {
      k: "HY OAS",
      delta: -0.02,
      context: `spread · ${dashboard.hySpread.toFixed(2)}%`,
      isRate: true,
    },
  ];

  return (
    <TileShell
      kicker="Key Indices"
      title="Indices"
      freshness={freshness}
      span="wide"
      muted={muted}
    >
      <div className="hp-qi">
        {cells.map((cell) => (
          <div key={cell.k} className="hp-qi__cell">
            <div className="hp-qi__head">
              <div className="hp-kicker">{cell.k}</div>
            </div>
            <div
              className="hp-qi__val"
              style={{
                color: cell.delta >= 0 ? "var(--up)" : "var(--down)",
                fontSize: 22,
                marginTop: 8,
              }}
            >
              {cell.delta >= 0 ? "+" : ""}
              {cell.delta.toFixed(2)}
              {cell.isRate ? " bp" : "%"}
            </div>
            <div
              className="hp-qi__sub"
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: "var(--hp-ink-2)",
                marginTop: 4,
              }}
            >
              {cell.context}
            </div>
          </div>
        ))}
      </div>
    </TileShell>
  );
}
