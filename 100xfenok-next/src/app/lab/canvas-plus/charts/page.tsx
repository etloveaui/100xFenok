import type { Metadata } from "next";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpPriceChart from "@/components/canvas-plus/charts/CpPriceChart";
import type { CpChartDatum } from "@/components/canvas-plus/charts/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CANVAS+ Charts Lab | 100xFenok",
  description: "CANVAS+ V4 Lightweight Charts line, area, sparkline, and fallback proof of concept.",
  robots: { index: false, follow: false },
};

const marketPulseData: CpChartDatum[] = [
  { time: "2026-01-05", value: 100 },
  { time: "2026-02-03", value: 106 },
  { time: "2026-03-02", value: 102 },
  { time: "2026-04-01", value: 112 },
  { time: "2026-05-04", value: 118 },
  { time: "2026-06-01", value: 121 },
  { time: "2026-07-01", value: 126 },
];

const breadthData: CpChartDatum[] = [
  { time: "2026-01-05", value: 48 },
  { time: "2026-02-03", value: 52 },
  { time: "2026-03-02", value: 49 },
  { time: "2026-04-01", value: 58 },
  { time: "2026-05-04", value: 61 },
  { time: "2026-06-01", value: 59 },
  { time: "2026-07-01", value: 64 },
];

const sparklineData: CpChartDatum[] = [
  { time: "2026-06-24", value: 72 },
  { time: "2026-06-25", value: 71 },
  { time: "2026-06-26", value: 74 },
  { time: "2026-06-29", value: 77 },
  { time: "2026-06-30", value: 76 },
  { time: "2026-07-01", value: 79 },
];

export default function CanvasPlusChartsPage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-charts>
      <main className="cp-lab">
        <header className="cp-lab__header">
          <p className="cp-lab__eyebrow">CANVAS+ V4 CHARTS</p>
          <h1 className="cp-lab__title">Client-only chart kit for dense market surfaces.</h1>
          <p className="cp-lab__summary">
            Lightweight Charts loads only after the lab card is near the viewport, while the text summary stays visible.
          </p>
          <div className="cp-lab__badges">
            <CpBadge tone="positive">client-only</CpBadge>
            <CpBadge tone="neutral">token-mapped</CpBadge>
            <CpBadge tone="warning">lab route</CpBadge>
          </div>
        </header>

        <section className="cp-lab__grid" aria-label="CANVAS+ chart variants">
          <CpPriceChart
            className="cp-lab__span-6"
            kind="line"
            range="6M"
            title="Market pulse"
            summary="Indexed trend remains constructive after the April reset."
            data={marketPulseData}
          />
          <CpPriceChart
            className="cp-lab__span-6"
            kind="area"
            range="6M"
            title="Breadth participation"
            summary="Participation recovered into July, but still needs confirmation from smaller cohorts."
            data={breadthData}
          />
          <CpPriceChart
            className="cp-lab__span-4"
            kind="sparkline"
            range="1M"
            height={150}
            density="compact"
            title="Quality basket"
            summary="Compact route card sparkline for repeated lists."
            data={sparklineData}
            showGrid={false}
            showCrosshair={false}
          />
          <div className="cp-lab__span-8" data-cp-chart-fallback-demo>
            <CpPriceChart
              kind="line"
              range="1M"
              title="Fallback state"
              summary="The visible summary remains available even when chart data is empty."
              data={[]}
              emptyLabel="Awaiting enough observations for this series."
            />
          </div>
        </section>
      </main>
    </div>
  );
}
