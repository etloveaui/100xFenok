import type { Metadata } from "next";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpButton from "@/components/canvas-plus/CpButton";
import CpCard from "@/components/canvas-plus/CpCard";
import CpTabs from "@/components/canvas-plus/CpTabs";

export const metadata: Metadata = {
  title: "CANVAS+ UI System Lab | 100xFenok",
  description: "CANVAS+ light token and primitive lab.",
  robots: { index: false, follow: false },
};

const densityRows = [
  { density: "compact", label: "Compact", row: "32px", value: "+1.8%" },
  { density: "default", label: "Default", row: "40px", value: "+0.6%" },
  { density: "comfy", label: "Comfy", row: "48px", value: "-0.4%" },
] as const;

const metricRows = [
  { label: "Revenue growth", value: "+18.4%", tone: "positive" },
  { label: "Margin pressure", value: "-2.1%", tone: "negative" },
  { label: "Cash conversion", value: "0.82x", tone: "neutral" },
] as const;

export default function CanvasPlusUiSystemPage() {
  return (
    <div className="canvas-plus" data-canvas-plus data-canvas-plus-ui-system>
      <div className="cp-lab">
        <header className="cp-lab__header">
          <p className="cp-lab__eyebrow">CANVAS+ V1</p>
          <h1 className="cp-lab__title">Light finance primitives for dense market surfaces</h1>
          <p className="cp-lab__summary">
            Token scope, density modes, financial state colors, and static tab states for the isolated lab route.
          </p>
        </header>

        <section className="cp-lab__grid" aria-label="CANVAS+ primitive showcase">
          {densityRows.map((item) => (
            <CpCard
              key={item.density}
              className="cp-lab__span-4"
              title={item.label}
              meta={`${item.row} row rhythm`}
              density={item.density}
              action={<CpBadge tone={item.value.startsWith("+") ? "positive" : "negative"}>{item.value}</CpBadge>}
              footer={
                <>
                  <CpButton density={item.density} variant="primary">Apply</CpButton>
                  <CpButton density={item.density} variant="ghost">Review</CpButton>
                </>
              }
            >
              <div className="cp-metric-row" data-density={item.density}>
                <span>Table row</span>
                <strong>{item.row}</strong>
              </div>
              <div className="cp-metric-row" data-density={item.density}>
                <span>Numeric density</span>
                <strong>13 / 1.35</strong>
              </div>
              <div className="cp-metric-row" data-density={item.density}>
                <span>Touch target</span>
                <strong>{item.density === "compact" ? "32px" : "40px+"}</strong>
              </div>
            </CpCard>
          ))}

          <CpCard
            className="cp-lab__span-6"
            title="Financial state badges"
            meta="Positive, negative, warning, neutral"
            action={<CpBadge tone="neutral">Neutral</CpBadge>}
          >
            <div className="flex flex-wrap gap-2">
              <CpBadge tone="positive">Positive +12.4%</CpBadge>
              <CpBadge tone="negative">Negative -3.8%</CpBadge>
              <CpBadge tone="warning">Warning 2 flags</CpBadge>
              <CpBadge tone="neutral">Neutral 0.0%</CpBadge>
            </div>
          </CpCard>

          <CpCard
            className="cp-lab__span-6"
            title="Action hierarchy"
            meta="Primary, secondary, ghost, disabled"
            footer={<CpButton variant="primary">Primary action</CpButton>}
          >
            <div className="flex flex-wrap gap-2">
              <CpButton variant="primary">Primary</CpButton>
              <CpButton variant="secondary">Secondary</CpButton>
              <CpButton variant="ghost">Ghost</CpButton>
              <CpButton variant="secondary" disabled>Disabled</CpButton>
            </div>
          </CpCard>

          <CpCard className="cp-lab__span-8" title="Static tab states" meta="Active, inactive, disabled">
            <CpTabs
              ariaLabel="CANVAS+ state tabs"
              items={[
                {
                  id: "overview",
                  label: "Overview",
                  active: true,
                  panel: (
                    <div className="grid gap-2">
                      {metricRows.map((row) => (
                        <div key={row.label} className="cp-metric-row">
                          <span>{row.label}</span>
                          <strong className="cp-number" data-tone={row.tone}>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  ),
                },
                {
                  id: "signals",
                  label: "Signals",
                  panel: <p className="text-[13px] text-[var(--cp-text-muted)]">Signal panel placeholder</p>,
                },
                {
                  id: "locked",
                  label: "Locked",
                  disabled: true,
                  panel: <p className="text-[13px] text-[var(--cp-text-muted)]">Locked panel</p>,
                },
              ]}
            />
          </CpCard>

          <CpCard className="cp-lab__span-4" title="Chart scaffold" meta="Low-contrast grid, strong data line">
            <div className="cp-chart-surface" aria-label="CANVAS+ chart scaffold">
              <div className="cp-chart-surface__line" />
            </div>
          </CpCard>

          <CpCard className="cp-lab__span-12" title="Primitive surface inventory" meta="Lab route only">
            <div className="grid gap-2 md:grid-cols-3">
              <div className="cp-metric-row">
                <span>Card radius</span>
                <strong>12px</strong>
              </div>
              <div className="cp-metric-row">
                <span>Toolbar height</span>
                <strong>44px</strong>
              </div>
              <div className="cp-metric-row">
                <span>Input height</span>
                <strong>40px</strong>
              </div>
            </div>
          </CpCard>
        </section>
      </div>
    </div>
  );
}
