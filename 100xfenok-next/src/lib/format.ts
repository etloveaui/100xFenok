export function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type PercentOptions = {
  digits?: number;
  empty?: string;
  fraction?: boolean;
  signed?: boolean;
};

export function formatPercent(value: unknown, options: PercentOptions = {}): string {
  const {
    digits = 1,
    empty = "—",
    fraction = true,
    signed = false,
  } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  const pct = fraction ? n * 100 : n;
  const sign = signed && pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatSignedPercent(value: unknown, options: Omit<PercentOptions, "signed"> = {}): string {
  return formatPercent(value, { ...options, signed: true });
}

export function formatPlainPercent(value: unknown, options: Omit<PercentOptions, "signed"> = {}): string {
  return formatPercent(value, { ...options, signed: false });
}
