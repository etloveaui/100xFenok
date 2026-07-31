import type { CSSProperties, ReactNode } from "react";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#020617",
  viewportFit: "cover",
};

const nightTheme = {
  "--wd-bg": "var(--fnk-fixed-slate-950)",
  "--wd-surface": "var(--fnk-fixed-slate-900)",
  "--wd-surface-raised":
    "color-mix(in oklab, var(--fnk-fixed-slate-900) 84%, var(--fnk-color-white))",
  "--wd-border":
    "color-mix(in oklab, var(--fnk-color-white) 14%, transparent)",
  "--wd-text": "var(--fnk-color-white)",
  "--wd-text-muted":
    "color-mix(in oklab, var(--fnk-color-white) 66%, transparent)",
  "--wd-accent": "var(--fnk-purple-600)",
  "--wd-listening": "var(--fnk-emerald-400)",
  "--wd-thinking": "var(--fnk-sky-400)",
  "--wd-success": "var(--fnk-gain-400)",
  "--wd-warning": "var(--fnk-warn-500)",
  "--wd-danger": "var(--fnk-loss-500)",
  "--wd-ink": "var(--wd-text)",
  "--wd-muted": "var(--wd-text-muted)",
  "--wd-line": "var(--wd-border)",
  "--wd-card": "var(--wd-surface)",
  "--wd-card-solid": "var(--wd-surface)",
  "--wd-accent-2": "var(--wd-listening)",
  "--wd-accent-soft":
    "color-mix(in oklab, var(--wd-accent) 16%, var(--wd-surface))",
  "--wd-apricot": "var(--wd-warning)",
  "--wd-apricot-soft":
    "color-mix(in oklab, var(--wd-warning) 14%, var(--wd-surface))",
  "--wd-shadow":
    "0 24px 80px color-mix(in oklab, var(--wd-bg) 72%, transparent)",
} as CSSProperties;

export default function WindDownLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div
      data-wd-theme="night"
      style={nightTheme}
      className="min-h-[100dvh] bg-[var(--wd-bg)] text-[var(--wd-text)]"
    >
      {children}
    </div>
  );
}
