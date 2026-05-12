"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  clamp,
  getRegimeClass,
  getRegimeLabel,
} from "@/lib/dashboard/formatters";
import HomeBentoGridV4 from "@/components/dashboard/v4/HomeBentoGridV4";
import { pushRegimeHistoryPoint } from "@/components/dashboard/v4/RegimeSparkline";
import NavbarV3 from "@/components/chrome/v3/NavbarV3";
import PinnedStrip from "@/components/chrome/v3/PinnedStrip";
import AlertInbox from "@/components/chrome/v3/AlertInbox";
import WatchBuilder from "@/components/chrome/v3/WatchBuilder";
import FooterTickerV2 from "@/components/chrome/v2/FooterTickerV2";
import { useWatchStorage } from "@/lib/watch/storage";
import { evaluateWatches } from "@/lib/watch/evaluator";
import type { Watch, WatchableMetric } from "@/lib/watch/types";
import type { TraceableMode } from "@/components/dashboard/v4/TraceableNumber";

/**
 * V4 dashboard — V3 (Watch & Alert) + TraceableNumber popovers on every
 * KPI + RegimeSparkline in the MarketPulse hero. Pure-additive client
 * polish; no new backend call, no LLM, no event feed.
 *
 * The V4 mode (`traceMode`) is currently hard-coded to `"hover-one"` —
 * the production default per V4 handoff README. Could move to user
 * settings later.
 */
export default function HomeV4Client() {
  const { dashboard, dataReady, failedSources, freshness } = useDashboardData();
  const {
    pins,
    watches,
    alerts,
    togglePin,
    addWatch,
    pushAlerts,
    markAllRead,
  } = useWatchStorage();

  const [inboxOpen, setInboxOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [sparklineKey, setSparklineKey] = useState(0);
  const lastFiredRef = useRef<Set<string>>(new Set());
  const traceMode: TraceableMode = "hover-one";

  /** Push a RegimeSparkline history point each time a fresh snapshot lands. */
  useEffect(() => {
    if (!dataReady) return;
    const spy = dashboard.quickIndices.find((q) => q.symbol === "SPY");
    if (!spy?.price) return;
    pushRegimeHistoryPoint({
      t: Date.now(),
      spy: spy.price,
      regime: dashboard.bankingTone,
    });
    // Bump the refresh key after writing to sessionStorage so RegimeSparkline
    // re-reads. This is a deliberate sync with an external store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSparklineKey((k) => k + 1);
  }, [dashboard, dataReady]);

  /** Re-evaluate watches each time the snapshot changes (same as V3). */
  useEffect(() => {
    if (!dataReady || watches.length === 0) return;
    const fired = evaluateWatches(dashboard, watches, lastFiredRef.current);
    if (fired.length === 0) return;
    fired.forEach((alert) => lastFiredRef.current.add(alert.watchId));
    pushAlerts(fired);
  }, [dashboard, dataReady, watches, pushAlerts]);

  const regime = useMemo(() => {
    const breadthTotal = Math.max(dashboard.sectorRows.length, 1);
    const breadthRatio = dashboard.sectorUp / breadthTotal;
    const sentiment = (dashboard.fearGreedScore / 100) * 0.45;
    const breadth = breadthRatio * 0.35;
    const stability = (1 - dashboard.stressScore) * 0.2;
    const score = clamp(sentiment + breadth + stability, 0, 1);
    const total = Math.max(sentiment + breadth + stability, 0.0001);
    return {
      label: getRegimeLabel(score),
      class: getRegimeClass(score),
      confidence: Math.round(score * 100),
      axes: [
        {
          label: "심리",
          tone: "up" as const,
          value: Math.round((sentiment / total) * 100),
          detail: `F&G ${Math.round(dashboard.fearGreedScore)} · ${dashboard.fearGreedLabel}`,
        },
        {
          label: "확산",
          tone:
            getRegimeClass(score) === "is-risk-off"
              ? ("down" as const)
              : ("up" as const),
          value: Math.round((breadth / total) * 100),
          detail: `${dashboard.sectorRows.length}개 중 ${dashboard.sectorUp}개 상승`,
        },
        {
          label: "금리·유동성",
          tone: "neutral" as const,
          value: Math.round((stability / total) * 100),
          detail: `스트레스 ${dashboard.stressScore.toFixed(2)} · ${dashboard.stressLabel}`,
        },
      ],
    };
  }, [dashboard]);

  const pinnedMetrics = useMemo(
    () => new Set(pins.map((pin) => pin.id)),
    [pins],
  );
  const alertMetrics = useMemo(() => {
    const set = new Set<WatchableMetric>();
    alerts.filter((alert) => !alert.read).forEach((alert) => set.add(alert.metric));
    return set;
  }, [alerts]);
  const unread = alerts.filter((alert) => !alert.read).length;

  const handleTogglePin = (metric: WatchableMetric) => {
    togglePin({ id: metric, addedAt: new Date().toISOString() });
  };

  const handleCreateWatch = (watch: Watch) => {
    addWatch(watch);
    lastFiredRef.current.delete(watch.id);
  };

  const alertsByMetric = useMemo(() => {
    const record: Partial<Record<WatchableMetric, boolean>> = {};
    alerts
      .filter((alert) => !alert.read)
      .forEach((alert) => (record[alert.metric] = true));
    return record as Record<WatchableMetric, boolean>;
  }, [alerts]);

  return (
    <>
      <NavbarV3
        alertsUnread={unread}
        onToggleInbox={() => setInboxOpen((open) => !open)}
        onOpenBuilder={() => setBuilderOpen(true)}
      />
      <AlertInbox
        open={inboxOpen}
        alerts={alerts}
        watches={watches}
        onClose={() => setInboxOpen(false)}
        onMarkAllRead={markAllRead}
        onOpenBuilder={() => {
          setInboxOpen(false);
          setBuilderOpen(true);
        }}
      />
      <PinnedStrip
        pins={pins}
        alerts={alertsByMetric}
        dashboard={dashboard}
        onUnpin={handleTogglePin}
        onAdd={handleTogglePin}
      />
      <main className="hp-page">
        <HomeBentoGridV4
          dashboard={dashboard}
          regimeLabel={regime.label}
          regimeClass={regime.class}
          regimeConfidence={regime.confidence}
          regimeAxes={regime.axes}
          dataReady={dataReady}
          failedSources={failedSources}
          freshness={freshness}
          pinnedMetrics={pinnedMetrics}
          alertMetrics={alertMetrics}
          onTogglePin={handleTogglePin}
          traceMode={traceMode}
          sparklineRefreshKey={sparklineKey}
        />
      </main>
      <FooterTickerV2 dashboard={dashboard} />
      <WatchBuilder
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onCreate={handleCreateWatch}
      />
    </>
  );
}
