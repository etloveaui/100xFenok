"use client";

import type { Issue } from "./types";

const TONE_BG: Record<string, string> = {
  navy: "linear-gradient(135deg, var(--fnk-brand-navy) 0%, var(--fnk-brand-interactive) 100%)",
  blue: "linear-gradient(135deg, var(--fnk-brand-interactive) 0%, var(--fnk-brand-interactive-2) 100%)",
  gold: "linear-gradient(135deg, var(--fnk-brand-gold) 0%, var(--fnk-brand-gold-bright) 100%)",
};

const TONE_SOLID: Record<string, string> = {
  navy: "var(--fnk-brand-navy)",
  blue: "var(--fnk-brand-interactive)",
  gold: "var(--fnk-brand-gold)",
};

const COVER_FILL = "color-mix(in srgb, var(--fnk-color-white) 18%, transparent)";
const COVER_STROKE = "color-mix(in srgb, var(--fnk-color-white) 85%, transparent)";

/**
 * 3 cover patterns auto-rendered from issue data with zero artwork:
 * - data: mini sparkline + accent pin
 * - gradient: angled gradient + filled spark
 * - minimal: flat tone block + big ticker glyph
 */
export default function CoverArt({
  issue,
  size = "lg",
}: {
  issue: Issue;
  size?: "lg" | "sm";
}) {
  const { cover, picks } = issue;
  const isLarge = size === "lg";
  const height = isLarge ? 240 : 120;
  const bg = TONE_BG[cover.tone] ?? TONE_BG.navy;
  const solid = cover.accent || TONE_SOLID[cover.tone] || TONE_SOLID.navy;
  const accentTicker = picks[0]?.ticker ?? "NVDA";

  if (cover.pattern === "minimal") {
    return (
      <div
        className={`as-cover-art as-cover-art--minimal as-cover-art--tone-${cover.tone}`}
        style={{ background: solid, height }}
      >
        <span className="as-cover-art__ticker">{accentTicker}</span>
      </div>
    );
  }

  if (cover.pattern === "gradient") {
    const min = Math.min(...cover.spark);
    const max = Math.max(...cover.spark);
    const range = max - min || 1;
    const path = cover.spark
      .map((v, i) => {
        const x = (i / (cover.spark.length - 1)) * 100;
        const y = 100 - ((v - min) / range) * 60 - 15;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <div
        className={`as-cover-art as-cover-art--gradient as-cover-art--tone-${cover.tone}`}
        style={{ background: bg, height }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="as-cover-art__svg">
          <path d={`${path} L 100 100 L 0 100 Z`} fill={COVER_FILL} />
          <path d={path} fill="none" stroke={COVER_STROKE} strokeWidth={1.4} />
        </svg>
      </div>
    );
  }

  // data pattern: gridded spark + accent pin
  const max = Math.max(...cover.spark);
  const min = Math.min(...cover.spark);
  const range = max - min || 1;
  const bars = cover.spark.map((v) => ((v - min) / range) * 80 + 10);
  return (
    <div
      className={`as-cover-art as-cover-art--data as-cover-art--tone-${cover.tone}`}
      style={{ background: bg, height }}
    >
      <div className="as-cover-art__grid">
        {bars.map((h, i) => (
          <span
            key={i}
            className="as-cover-art__bar"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className="as-cover-art__pin">
        <span className="as-cover-art__pin-kicker">PICK</span>
        <span className="as-cover-art__pin-ticker">{accentTicker}</span>
      </span>
    </div>
  );
}
