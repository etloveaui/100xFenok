"use client";

import type { DashboardSnapshot } from "@/lib/dashboard/types";
import { v2cx } from "@/components/dashboard/v2/types";

type TickerItem = {
  label: string;
  value: string;
  delta?: string;
  tone?: "up" | "down" | "warn" | null;
  gold?: boolean;
};

/**
 * V2 footer = LIVE marquee ticker bar + HUD strip (desktop only).
 * Marquee track is duplicated so the CSS `translateX(-50%)` loops seamlessly.
 */
export default function FooterTickerV2({
  dashboard,
}: {
  dashboard: DashboardSnapshot;
}) {
  const spy = dashboard.quickIndices.find((q) => q.symbol === "SPY");
  const qqq = dashboard.quickIndices.find((q) => q.symbol === "QQQ");
  const items: TickerItem[] = [
    {
      label: "S&P 500",
      value: spy?.price ? spy.price.toLocaleString() : "—",
      delta: spy ? `${spy.change >= 0 ? "+" : ""}${spy.change.toFixed(2)}%` : undefined,
      tone: spy ? (spy.change >= 0 ? "up" : "down") : null,
    },
    {
      label: "NASDAQ",
      value: qqq?.price ? qqq.price.toLocaleString() : "—",
      delta: qqq ? `${qqq.change >= 0 ? "+" : ""}${qqq.change.toFixed(2)}%` : undefined,
      tone: qqq ? (qqq.change >= 0 ? "up" : "down") : null,
    },
    {
      label: "VIX",
      value: dashboard.vixValue.toFixed(2),
      delta: dashboard.vixLabel,
      tone: "warn",
    },
    {
      label: "F&G",
      value: `${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
    },
    {
      label: "10Y",
      value: `${dashboard.tenYearYield.toFixed(2)}%`,
      tone: "warn",
    },
    {
      label: "BTC",
      value: `F&G ${Math.round(dashboard.cryptoFearGreed)}`,
      delta: dashboard.cryptoLabel,
      gold: true,
    },
    {
      label: "Banking",
      value: dashboard.bankingLabel,
      tone:
        dashboard.bankingTone === "stable"
          ? "up"
          : dashboard.bankingTone === "watch"
            ? "warn"
            : "down",
    },
  ];

  const renderItem = (item: TickerItem, key: string) => (
    <span key={key} className={item.gold ? "gold" : undefined}>
      <b>{item.label}</b> {item.value}
      {item.delta ? (
        <>
          {" "}
          <em className={item.tone || undefined}>{item.delta}</em>
        </>
      ) : null}
    </span>
  );

  return (
    <div>
      <div className="hp-ticker" role="region" aria-label="실시간 시세 티커">
        <span className="hp-ticker__live">
          <span className="hp-ticker__dot" aria-hidden="true" />
          LIVE
        </span>
        <div className="hp-ticker__reel">
          <div className="hp-ticker__reel-track">
            {items.map((item, idx) => renderItem(item, `a-${idx}`))}
            {items.map((item, idx) => renderItem(item, `b-${idx}`))}
          </div>
        </div>
        <span className="hp-ticker__delay">15m</span>
        <span
          className="hp-state-pill"
          style={{ background: "linear-gradient(135deg,#10b981,#059669)" }}
        >
          MARKET OPEN
        </span>
      </div>
      <div
        className={v2cx("hp-hud")}
        style={{ display: "none" }}
        data-desktop-only
        aria-hidden="true"
      >
        <div className="hp-hud__brand">
          <div className="hp-hud__mark">
            <i className="fas fa-chart-line" aria-hidden="true" />
          </div>
          <div>
            <div className="hp-hud__name">
              100x <span>FENOK</span>
            </div>
            <div className="hp-hud__copy">© 2026 All rights reserved</div>
          </div>
        </div>
        <div className="hp-hud__disclaimer">
          모든 정보는 투자 참고용. <b>손실 나면 니 탓</b>{" "}
          <b className="gold">수익 나면 내 탓</b>
        </div>
      </div>
    </div>
  );
}
