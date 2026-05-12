"use client";

import type { Issue } from "./types";

const TONE_BG: Record<string, string> = {
  navy: "linear-gradient(135deg, #010079 0%, #1B73D3 100%)",
  blue: "linear-gradient(135deg, #1B73D3 0%, #4a8fdb 100%)",
  gold: "linear-gradient(135deg, #7a5a00 0%, #D5AD36 100%)",
};

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
  const accentTicker = picks[0]?.ticker ?? "NVDA";

  if (cover.pattern === "minimal") {
    return (
      <div
        className="as-cover-art as-cover-art--minimal"
        style={{ background: cover.accent, height }}
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
        className="as-cover-art as-cover-art--gradient"
        style={{ background: bg, height }}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="as-cover-art__svg">
          <path d={`${path} L 100 100 L 0 100 Z`} fill="rgba(255,255,255,0.18)" />
          <path d={path} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.4} />
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
      className="as-cover-art as-cover-art--data"
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
