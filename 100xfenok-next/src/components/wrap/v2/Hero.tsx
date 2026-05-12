"use client";

import { v2cx } from "@/components/dashboard/v2/types";
import type { DailyWrap } from "./types";

const TONE_VALUE_CLASS: Record<string, string> = {
  up: "mw-axis-value-up",
  down: "mw-axis-value-down",
  warn: "mw-axis-value-warn",
  flat: "",
};

export default function Hero({ wrap }: { wrap: DailyWrap }) {
  return (
    <section className="mw-hero">
      <div className="mw-hero-inner">
        <div className="mw-hero-grid">
          <div className="mw-hero-thesis">
            <div className="mw-hero-meta">
              <span className="kicker">100x DAILY WRAP · {wrap.todayLabel} · KST 08:14</span>
              <span
                className={v2cx(
                  "mw-chip",
                  `mw-chip-regime-${wrap.regime.tone}`,
                )}
              >
                <span className="mw-chip-dot" />
                {wrap.regime.label}
              </span>
              <span className="mw-chip mw-chip-outline">
                Confidence {wrap.regime.confidence}%
              </span>
              <span className="mw-hero-tags">
                {wrap.thesis.tags.map((tag) => (
                  <span key={tag} className="mw-chip mw-chip-outline-soft">
                    {tag}
                  </span>
                ))}
              </span>
            </div>
            <h1 className="mw-hero-headline">{wrap.thesis.headline}</h1>
            <p className="mw-hero-sub">{wrap.thesis.sub}</p>
            <div className="mw-hero-rows">
              <div className="mw-hero-row">
                <span className="kicker">어제</span>
                <span className="mw-hero-row-value mono">{wrap.yesterdayLine}</span>
              </div>
              <div className="mw-hero-row">
                <span className="kicker">오늘</span>
                <span className="mw-hero-row-value mono">{wrap.todayLine}</span>
              </div>
            </div>
          </div>
          <div className="mw-hero-axes">
            {wrap.microAxes.map((axis) => (
              <div key={axis.label} className="mw-axis">
                <span className="kicker">{axis.label}</span>
                <span className={v2cx("mw-axis-value", TONE_VALUE_CLASS[axis.tone])}>
                  {typeof axis.value === "number" ? axis.value.toString() : axis.value}
                </span>
                <span className="mw-axis-meta">{axis.meta}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
