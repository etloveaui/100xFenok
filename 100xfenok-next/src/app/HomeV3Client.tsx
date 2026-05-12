"use client";

import { useEffect, useMemo, useState } from "react";
import { useDashboardData } from "@/hooks/useDashboardData";
import {
  clamp,
  getRegimeClass,
  getRegimeLabel,
} from "@/lib/dashboard/formatters";
import HomeBentoGridV3 from "@/components/dashboard/v3/HomeBentoGridV3";
import NavbarV3 from "@/components/chrome/v3/NavbarV3";
import PinnedStrip from "@/components/chrome/v3/PinnedStrip";
import AlertInbox from "@/components/chrome/v3/AlertInbox";
import WatchBuilder from "@/components/chrome/v3/WatchBuilder";
import FooterTickerV2 from "@/components/chrome/v2/FooterTickerV2";
import { useWatchStorage } from "@/lib/watch/storage";
import { evaluateWatches } from "@/lib/watch/evaluator";
import type { Watch, WatchableMetric } from "@/lib/watch/types";

/**
 * V3 dashboard — Watch & Alert. V1 chrome hidden by DesignVersionToggle
 * (`body.design-v3`). All user state (pins/watches/alerts) lives in
 * localStorage; no backend call is added beyond what V1/V2 already does.
 */
export default function HomeV3Client() {
  const { dashboard, dataReady, failedSources, freshness } = useDashboardData();
  const {
    pins,
    watches,
    alerts,
    storageError,
    togglePin,
    addWatch,
    pushAlerts,
    markAllRead,
  } = useWatchStorage();

  const [inboxOpen, setInboxOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  /** Re-evaluate watches each time the snapshot changes. Cooldown is now
   *  keyed on persisted `alerts` (60-minute window) so a page reload no
   *  longer re-fires a watch that already triggered this hour. */
  useEffect(() => {
    if (!dataReady || watches.length === 0) return;
    const fired = evaluateWatches(dashboard, watches, alerts);
    if (fired.length === 0) return;
    pushAlerts(fired);
  }, [dashboard, dataReady, watches, alerts, pushAlerts]);

  /** Regime axes — same shape as V2. */
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
  };

  /** Build the alerts-by-metric record for PinnedStrip flash. */
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
      {storageError ? (
        <div className="hp-storage-warn" role="status">
          브라우저 저장이 비활성화돼 Watch · 핀 · 알림이 새로고침 후 유지되지 않습니다.
        </div>
      ) : null}
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
        <HomeBentoGridV3
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
