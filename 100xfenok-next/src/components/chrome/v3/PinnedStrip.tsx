"use client";

import type { DashboardSnapshot } from "@/lib/dashboard/types";
import type { Pin, WatchableMetric } from "@/lib/watch/types";
import { metricByKey } from "@/lib/watch/metrics";
import { v2cx } from "@/components/dashboard/v2/types";

type Props = {
  pins: Pin[];
  alerts: Record<WatchableMetric, boolean>;
  dashboard: DashboardSnapshot;
  onUnpin: (id: WatchableMetric) => void;
  onAdd: (id: WatchableMetric) => void;
};

const SUGGESTED: WatchableMetric[] = ["VIX", "FG", "HY"];

function formatValue(metric: WatchableMetric, value: number | null): string {
  if (value == null) return "—";
  const def = metricByKey(metric);
  if (!def) return value.toFixed(2);
  if (def.unit === "$" || metric === "BTC") return `$${value.toLocaleString()}`;
  if (def.unit === "%") return `${value.toFixed(2)}%`;
  if (def.unit === "bp") return `${value.toFixed(0)}bp`;
  return value.toFixed(metric === "VIX" ? 1 : 0);
}

export default function PinnedStrip({
  pins,
  alerts,
  dashboard,
  onUnpin,
  onAdd,
}: Props) {
  const isEmpty = pins.length === 0;
  return (
    <div className="hp-pinstrip" data-empty={isEmpty}>
      <span className="hp-pinstrip__kicker">📌 My Pins</span>
      {isEmpty ? (
        <>
          <span className="hp-pinstrip__empty">자주 보는 지표를 위에 고정 →</span>
          {SUGGESTED.map((id) => {
            const def = metricByKey(id);
            if (!def) return null;
            return (
              <button
                key={id}
                type="button"
                className="hp-pinstrip__suggest"
                onClick={() => onAdd(id)}
              >
                + {def.label}
              </button>
            );
          })}
        </>
      ) : (
        <div className="hp-pinstrip__list">
          {pins.map((pin) => {
            const def = metricByKey(pin.id);
            if (!def) return null;
            const value = def.get(dashboard);
            const hasAlert = alerts[pin.id];
            return (
              <button
                key={pin.id}
                type="button"
                className={v2cx(
                  "hp-pinstrip__chip",
                  hasAlert && "hp-pinstrip__chip--alert",
                )}
                onClick={() => onUnpin(pin.id)}
                title="클릭하여 핀 해제"
              >
                <span>{def.label}</span>
                <span className="hp-pinstrip__chip-value">
                  {formatValue(pin.id, value)}
                </span>
                {hasAlert ? <span aria-hidden="true">🔔</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
