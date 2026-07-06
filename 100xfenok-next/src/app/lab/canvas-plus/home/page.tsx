import type { Metadata } from "next";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpFeatureTile from "@/components/canvas-plus/CpFeatureTile";
import CpHeroSearch from "@/components/canvas-plus/CpHeroSearch";
import CpInsightCard from "@/components/canvas-plus/CpInsightCard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CANVAS+ Home Lab | 100xFenok",
  description: "CANVAS+ search-first home proof of concept.",
  robots: { index: false, follow: false },
};

const featureTiles = [
  {
    label: "Market",
    title: "Risk pulse",
    value: "Constructive",
    detail: "Breadth and liquidity are aligned, with valuation still a watch item.",
    tone: "positive",
  },
  {
    label: "Valuation",
    title: "S&P 500 band",
    value: "Upper mid",
    detail: "Multiples sit above neutral, so upside needs earnings confirmation.",
    tone: "warning",
  },
  {
    label: "Signals",
    title: "Quality leaders",
    value: "18 names",
    detail: "Durability and short-term flow screens overlap in mega-cap tech.",
    tone: "accent",
  },
  {
    label: "Workflow",
    title: "Saved radar",
    value: "4 lists",
    detail: "The next step is review, compare, then open the stock report.",
    tone: "neutral",
  },
] as const;

export default function CanvasPlusHomePage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-home>
      <main className="cp-lab cp-poc">
        <CpHeroSearch
          eyebrow="CANVAS+ V2 HOME"
          title="Search first, then decide where the market deserves attention."
          summary="A light premium home surface for ticker lookup, market state scanning, and next-action discovery without touching the production home route."
          placeholder="Search NVDA, SPY, semiconductors..."
          defaultValue="NVDA"
          metrics={[
            { label: "Market stance", value: <CpBadge tone="positive">Risk-on</CpBadge> },
            { label: "Watch items", value: "7" },
            { label: "Updated", value: "Lab data" },
          ]}
        />

        <section className="cp-poc__feature-grid" aria-label="CANVAS+ home feature tiles">
          {featureTiles.map((tile) => (
            <CpFeatureTile
              key={tile.title}
              label={tile.label}
              title={tile.title}
              value={tile.value}
              detail={tile.detail}
              tone={tile.tone}
            />
          ))}
        </section>

        <section className="cp-poc__insight-grid" aria-label="CANVAS+ home insight cards">
          <CpInsightCard
            title="Today focus"
            meta="Dense briefing card"
            badge="3 checks"
            tone="neutral"
            rows={[
              { label: "Liquidity", value: "Supportive", tone: "positive" },
              { label: "Valuation", value: "Elevated", tone: "warning" },
              { label: "Momentum", value: "+1.4%", tone: "positive" },
            ]}
          />
          <CpInsightCard
            title="Action queue"
            meta="Portfolio review"
            badge="Review"
            tone="warning"
            rows={[
              { label: "Semis", value: "Compare" },
              { label: "Quality", value: "Add 2" },
              { label: "Cash", value: "Hold" },
            ]}
          />
        </section>
      </main>
    </div>
  );
}
