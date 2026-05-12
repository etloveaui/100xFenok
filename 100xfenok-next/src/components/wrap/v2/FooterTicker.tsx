"use client";

import type { WrapAnchor } from "./types";

type Props = {
  anchors: WrapAnchor[];
  marketState?: "OPEN" | "CLOSED" | "PRE" | "AFTER";
};

const STATE_STYLE: Record<string, { bg: string; label: string }> = {
  OPEN: { bg: "rgba(16,185,129,0.20)", label: "MARKET OPEN" },
  CLOSED: { bg: "rgba(244,63,94,0.20)", label: "MARKET CLOSED" },
  PRE: { bg: "rgba(245,158,11,0.20)", label: "PRE MARKET" },
  AFTER: { bg: "rgba(245,158,11,0.20)", label: "AFTER HOURS" },
};

export default function FooterTicker({ anchors, marketState = "OPEN" }: Props) {
  const state = STATE_STYLE[marketState] ?? STATE_STYLE.OPEN;
  const items = anchors.map((a) => ({
    sym: a.sym,
    value: a.value,
    delta: a.delta,
    tone: a.tone,
  }));
  const renderItem = (
    item: (typeof items)[number],
    key: string,
  ) => (
    <span key={key} className="mw-ticker-item">
      <span className="mw-ticker-sym">{item.sym}</span>
      <span className="mono mw-ticker-value">{item.value}</span>
      <span
        className={`mono mw-ticker-delta mw-ticker-delta-${item.tone}`}
      >
        {item.delta}
      </span>
    </span>
  );
  return (
    <div className="mw-ticker" role="region" aria-label="live market ticker">
      <div className="mw-ticker-track">
        {items.map((item, idx) => renderItem(item, `a-${idx}`))}
        {items.map((item, idx) => renderItem(item, `b-${idx}`))}
      </div>
      <span className="mw-ticker-state" style={{ background: state.bg }}>
        {state.label}
      </span>
    </div>
  );
}
