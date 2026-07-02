import type { Metadata } from "next";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpCard from "@/components/canvas-plus/CpCard";
import CpInsightCard from "@/components/canvas-plus/CpInsightCard";
import CpValuationBand from "@/components/canvas-plus/CpValuationBand";

export const metadata: Metadata = {
  title: "CANVAS+ Stock Lab | 100xFenok",
  description: "CANVAS+ stock report proof of concept.",
  robots: { index: false, follow: false },
};

const signalRows = [
  { label: "Profitability", value: "A", tone: "positive" },
  { label: "Technical flow", value: "+8.2%", tone: "positive" },
  { label: "Downside pressure", value: "Moderate", tone: "warning" },
] as const;

const financialRows = [
  { label: "Revenue growth", value: "+18.4%" },
  { label: "Gross margin", value: "74.2%" },
  { label: "FCF conversion", value: "0.86x" },
] as const;

export default function CanvasPlusStockPage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-stock>
      <main className="cp-lab cp-poc cp-stock-report">
        <section className="cp-stock-summary" data-stock-section="summary" aria-label="Stock summary">
          <div>
            <p className="cp-lab__eyebrow">CANVAS+ V2 STOCK</p>
            <h1 className="cp-hero-search__title">NVDA premium report surface</h1>
            <p className="cp-hero-search__summary">
              Summary first, then valuation, signals, and financials. This lab route keeps the production stock route untouched.
            </p>
          </div>
          <div className="cp-stock-summary__badges">
            <CpBadge tone="positive">Quality leader</CpBadge>
            <CpBadge tone="warning">Valuation watch</CpBadge>
          </div>
        </section>

        <section className="cp-poc__two-column" data-stock-section="valuation" aria-label="Stock valuation">
          <CpCard title="Valuation band" meta="Forward multiple context" action={<CpBadge tone="warning">Upper band</CpBadge>}>
            <CpValuationBand
              label="Forward P/E percentile"
              value="72%"
              position={72}
              lowLabel="Cheap"
              midLabel="Fair"
              highLabel="Expensive"
              tone="warning"
              summary="Premium remains acceptable only while earnings revisions stay positive."
            />
          </CpCard>
          <CpCard title="Setup" meta="Report summary">
            <div className="cp-metric-row">
              <span>Trend</span>
              <strong className="cp-number" data-tone="positive">Up</strong>
            </div>
            <div className="cp-metric-row">
              <span>Risk</span>
              <strong className="cp-number" data-tone="warning">Crowded</strong>
            </div>
            <div className="cp-metric-row">
              <span>Action</span>
              <strong>Watch pullback</strong>
            </div>
          </CpCard>
        </section>

        <section className="cp-poc__insight-grid" data-stock-section="signals" aria-label="Stock signals">
          <CpInsightCard
            title="Signal lens"
            meta="Long and short horizon"
            badge="Bullish"
            tone="positive"
            rows={signalRows}
          />
          <CpInsightCard
            title="Ownership pulse"
            meta="Smart money proxy"
            badge="Neutral"
            tone="neutral"
            rows={[
              { label: "13F overlap", value: "High", tone: "positive" },
              { label: "Insider pressure", value: "Low", tone: "positive" },
              { label: "Options heat", value: "High", tone: "warning" },
            ]}
          />
        </section>

        <section data-stock-section="financials" aria-label="Stock financials">
          <CpCard title="Financials" meta="Compact table rhythm">
            {financialRows.map((row) => (
              <div key={row.label} className="cp-metric-row">
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </CpCard>
        </section>
      </main>
    </div>
  );
}
