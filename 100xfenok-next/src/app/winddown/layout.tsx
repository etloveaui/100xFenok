import type { CSSProperties, ReactNode } from "react";
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07061a",
  viewportFit: "cover",
};

const nightTheme = {
  "--wd-bg": "var(--fnk-fixed-night-950)",
  "--wd-surface": "var(--fnk-fixed-night-900)",
  "--wd-surface-raised": "var(--fnk-fixed-night-800)",
  "--wd-border":
    "color-mix(in oklab, var(--fnk-color-white) 13%, transparent)",
  "--wd-text": "var(--fnk-fixed-night-ink)",
  "--wd-text-muted": "var(--fnk-fixed-night-dim)",
  "--wd-accent": "var(--fnk-fixed-amber-300)",
  "--wd-listening": "var(--fnk-fixed-mint-300)",
  "--wd-thinking": "var(--fnk-sky-400)",
  "--wd-success": "var(--fnk-fixed-mint-300)",
  "--wd-warning": "var(--fnk-warn-500)",
  "--wd-danger": "var(--fnk-fixed-rose-300)",
  "--wd-ink": "var(--wd-text)",
  "--wd-muted": "var(--wd-text-muted)",
  "--wd-line": "var(--wd-border)",
  "--wd-card": "var(--wd-surface)",
  "--wd-card-solid": "var(--wd-surface)",
  "--wd-accent-2": "var(--fnk-fixed-violet-300)",
  "--wd-accent-soft":
    "color-mix(in oklab, var(--wd-accent) 16%, var(--wd-surface))",
  "--wd-apricot": "var(--wd-warning)",
  "--wd-apricot-soft":
    "color-mix(in oklab, var(--wd-warning) 14%, var(--wd-surface))",
  "--wd-shadow":
    "0 26px 60px color-mix(in oklab, var(--fnk-color-black) 55%, transparent)",
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
