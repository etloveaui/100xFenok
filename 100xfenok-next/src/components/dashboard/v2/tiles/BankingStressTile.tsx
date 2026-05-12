"use client";

import TileShell from "../TileShell";
import type { V2Freshness } from "../types";
import type { DashboardFreshnessMap, DashboardSnapshot } from "@/lib/dashboard/types";
import TraceableNumber, {
  metaFromFreshness,
  type TraceableMode,
} from "@/components/dashboard/v4/TraceableNumber";

const TONE_COLOR = {
  stable: {
    bg: "rgba(16,185,129,0.10)",
    fg: "var(--up)",
    border: "rgba(16,185,129,0.28)",
  },
  watch: {
    bg: "rgba(245,158,11,0.10)",
    fg: "#b45309",
    border: "rgba(245,158,11,0.28)",
  },
  stress: {
    bg: "rgba(244,63,94,0.10)",
    fg: "var(--down)",
    border: "rgba(244,63,94,0.28)",
  },
} as const;

/**
 * V2 Banking + Stress — AUDIT fix: clear "Banking" title (no clip),
 * tone-tinted background per status, Stress shown as 0.28 / 1.00 with
 * historical average reference.
 */
export default function BankingStressTile({
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
  const tone = TONE_COLOR[dashboard.bankingTone] ?? TONE_COLOR.watch;
  const dotClass =
    dashboard.bankingTone === "stable"
      ? "hp-bk__dot--stable"
      : dashboard.bankingTone === "watch"
        ? "hp-bk__dot--watch"
        : "hp-bk__dot--stress";

  return (
    <TileShell
      kicker="Banking · Funding Stress"
      title="Banking"
      freshness={freshness}
      span="wide"
      muted={muted}
      action={
        <button type="button" className="hp-btn hp-btn--pill">
          지표 상세 →
        </button>
      }
    >
      <div className="hp-bk">
        <div
          className="hp-bk__cell"
          style={{ background: tone.bg, borderColor: tone.border }}
        >
          <div className="hp-kicker">Banking</div>
          <div className="hp-bk__cell-head" style={{ marginTop: 8 }}>
            <span className={`hp-bk__dot ${dotClass}`} aria-hidden="true" />
            <strong className="hp-bk__name" style={{ color: tone.fg }}>
              {dashboard.bankingLabel}
            </strong>
          </div>
          <div className="hp-bk__desc">{dashboard.bankingSummary}</div>
        </div>
        <div className="hp-bk__cell">
          <div className="hp-kicker">Stress Index</div>
          <div
            style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}
          >
            <strong
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 900,
                fontSize: 28,
                color: "var(--hp-ink)",
              }}
            >
              <TraceableNumber
                mode={traceMode}
                meta={
                  traceMode && freshnessMap
                    ? metaFromFreshness(
                        freshnessMap.weeklyBanking ??
                          freshnessMap.quarterlyBanking,
                        dashboard.stressScore,
                        {
                          sourceKey: "weeklyBanking",
                          note: "FRED H.8 + Q quarterly banking 합성 스트레스 인덱스 (0~1)",
                        },
                      )
                    : undefined
                }
              >
                {dashboard.stressScore.toFixed(2)}
              </TraceableNumber>
            </strong>
            <span style={{ fontSize: 12, color: "var(--hp-ink-3)" }}>/ 1.00</span>
          </div>
          <div className="hp-bk__desc">
            {dashboard.stressLabel} · 역사적 평균 0.45
          </div>
        </div>
      </div>
    </TileShell>
  );
}
