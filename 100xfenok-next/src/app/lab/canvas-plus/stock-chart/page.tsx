import type { Metadata } from "next";

import CpPriceChart from "@/components/canvas-plus/charts/CpPriceChart";
import type { CpChartDatum } from "@/components/canvas-plus/charts/types";

export const metadata: Metadata = {
  title: "CANVAS+ Stock Chart Lab | 100xFenok",
  description: "CANVAS+ V4 candlestick and volume chart proof of concept.",
  robots: { index: false, follow: false },
};

const stockSeries: CpChartDatum[] = [
  { time: "2026-06-18", open: 184.2, high: 188.6, low: 181.9, close: 187.8, volume: 74200000 },
  { time: "2026-06-19", open: 187.9, high: 190.4, low: 186.5, close: 188.1, volume: 69100000 },
  { time: "2026-06-22", open: 188.4, high: 193.2, low: 187.6, close: 192.5, volume: 81200000 },
  { time: "2026-06-23", open: 192.2, high: 194.1, low: 189.7, close: 190.6, volume: 76800000 },
  { time: "2026-06-24", open: 190.8, high: 195.9, low: 190.1, close: 195.1, volume: 84600000 },
  { time: "2026-06-25", open: 195.6, high: 198.3, low: 193.8, close: 197.4, volume: 90400000 },
  { time: "2026-06-26", open: 197.2, high: 201.5, low: 196.4, close: 200.8, volume: 98200000 },
  { time: "2026-06-29", open: 201.1, high: 203.6, low: 199.2, close: 202.9, volume: 93600000 },
  { time: "2026-06-30", open: 202.4, high: 204.7, low: 200.6, close: 201.7, volume: 88400000 },
  { time: "2026-07-01", open: 201.9, high: 206.1, low: 200.8, close: 205.6, volume: 101200000 },
];

export default function CanvasPlusStockChartPage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-stock-chart>
      <main className="cp-lab">
        <header className="cp-lab__header">
          <p className="cp-lab__eyebrow">CANVAS+ V4 STOCK CHART</p>
          <h1 className="cp-lab__title">Candlestick and volume lane for stock detail pages.</h1>
          <p className="cp-lab__summary">
            This lab keeps OHLC and volume rendering behind the same client-only chart boundary.
          </p>
        </header>

        <CpPriceChart
          kind="candlestick"
          range="1M"
          height={420}
          title="NVDA lab OHLC"
          summary="Price is holding the short-term uptrend with volume expansion into the latest close."
          data={stockSeries}
          showVolume
        />
      </main>
    </div>
  );
}
