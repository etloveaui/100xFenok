// Shared helpers for the CANVAS+ W5 kit (src/components/canvas-plus/kit/*).
// Not part of the public kit surface — import from ./index for components.

export type CpTone = "positive" | "negative" | "warning" | "neutral";

export function cpClassNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function cpBoundPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
