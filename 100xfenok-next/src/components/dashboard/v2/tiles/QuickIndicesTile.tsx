"use client";

import TileShell from "../TileShell";
import type { V2Freshness } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";

type Cell = {
  k: string;
  delta: number;
  context: string;
  isRate?: boolean;
  sourceKey?: string;
  note?: string;
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
  traceMode,
  freshnessMap,
}: {
  dashboard: DashboardSnapshot;
  freshness: V2Freshness;
  muted: boolean;
  traceMode?: TraceableMode;
  freshnessMap?: DashboardFreshnessMap;
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
      sourceKey: "ticker:SPY",
      note: "Yahoo Finance daily quote",
    },
    {
      k: "QQQ",
      delta: qqq?.change ?? 0,
      context: qqq?.price ? `$${qqq.price.toFixed(2)}` : "기본 데이터",
      sourceKey: "ticker:QQQ",
      note: "Yahoo Finance daily quote",
    },
    {
      k: "10Y",
      delta: 0.04,
      context: `yield · ${dashboard.tenYearYield.toFixed(2)}%`,
      isRate: true,
      sourceKey: "dailyBanking",
      note: "FRED DGS10 일일 yield (10Y Treasury)",
    },
    {
      k: "HY OAS",
      delta: -0.02,
      context: `spread · ${dashboard.hySpread.toFixed(2)}%`,
      isRate: true,
      sourceKey: "dailyBanking",
      note: "FRED BAMLH0A0HYM2 (HY OAS)",
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
              <TraceableNumber
                mode={traceMode}
                meta={
                  traceMode && freshnessMap && cell.sourceKey
                    ? metaFromFreshness(
                        freshnessMap[cell.sourceKey],
                        cell.delta,
                        { sourceKey: cell.sourceKey, note: cell.note },
                      )
                    : undefined
                }
              >
                {cell.delta >= 0 ? "+" : ""}
                {cell.delta.toFixed(2)}
                {cell.isRate ? " bp" : "%"}
              </TraceableNumber>
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
