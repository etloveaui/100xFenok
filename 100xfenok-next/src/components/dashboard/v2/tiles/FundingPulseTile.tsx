"use client";

import TileShell from "../TileShell";
import { v2cx } from "../types";
import type { V2Freshness } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import {
  formatPercent,
  formatSignedBillions,
} from "@/lib/dashboard/formatters";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

/**
 * V2 Funding Pulse — AUDIT fix: short title "Funding" (no wrap), weekday
 * labels under each bar, dashed top divider for clarity.
 */
export default function FundingPulseTile({
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
  return (
    <TileShell kicker="Liquidity" title="Funding" freshness={freshness} muted={muted}>
      <div>
        <div className="hp-liq__val" style={{ fontSize: 28 }}>
          <TraceableNumber
            mode={traceMode}
            meta={
              traceMode && freshnessMap
                ? metaFromFreshness(
                    freshnessMap.weeklyBanking,
                    dashboard.liquidityFlow,
                    {
                      sourceKey: "weeklyBanking",
                      note: "FRED H.8 (banking) weekly 합성. 7d 순유동성 = 자산 변화 - 부채 변화.",
                    },
                  )
                : undefined
            }
          >
            {formatSignedBillions(dashboard.liquidityFlow)}
          </TraceableNumber>
        </div>
        <div style={{ fontSize: 11, color: "var(--hp-ink-3)", marginTop: 2 }}>
          7d 순유동성 · 예대율 {formatPercent(dashboard.loanDepositRatio, 1)}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 4,
            height: 50,
            marginTop: 10,
            padding: "6px 6px 0",
            borderTop: "1px dashed var(--hp-stroke)",
          }}
        >
          {dashboard.liquidityBars.map((bar, idx) => (
            <div
              key={`${bar.delta}-${idx}`}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <span
                className={v2cx(
                  "hp-liq__bar",
                  bar.delta >= 0 ? "hp-liq__bar--up" : "hp-liq__bar--down",
                )}
                style={{
                  width: "100%",
                  height: `${Math.max(bar.height * 0.6, 2)}%`,
                  minHeight: 2,
                }}
              />
              <span
                style={{
                  fontSize: 8,
                  color: "var(--hp-ink-3)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {DAYS[idx % DAYS.length]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </TileShell>
  );
}
