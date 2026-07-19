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
  const sign = signed && pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatSignedPercent(value: unknown, options: Omit<PercentOptions, "signed"> = {}): string {
  return formatPercent(value, { ...options, signed: true });
}

export function formatPlainPercent(value: unknown, options: Omit<PercentOptions, "signed"> = {}): string {
  return formatPercent(value, { ...options, signed: false });
}

export type Currency = "USD" | "KRW";

type NumberOptions = {
  digits?: number;
  empty?: string;
};

function fixedLocale(n: number, digits: number): string {
  return n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatDecimal(value: unknown, options: NumberOptions = {}): string {
  const { digits = 1, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  return fixedLocale(n, digits);
}

export function formatInteger(value: unknown, empty = "—"): string {
  const n = finiteNumber(value);
  if (n === null) return empty;
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
}

export function formatSignedDecimal(value: unknown, options: NumberOptions = {}): string {
  const { digits = 1, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fixedLocale(Math.abs(n), digits)}`;
}

export function formatMultiple(value: unknown, options: NumberOptions = {}): string {
  const { digits = 1, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  return `${fixedLocale(n, digits)}배`;
}

export function formatBasisPoints(value: unknown, options: NumberOptions = {}): string {
  const { digits = 1, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  return `${fixedLocale(n, digits)}bp`;
}

export function formatShares(value: unknown, options: { compact?: boolean; empty?: string } = {}): string {
  const { compact = false, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  if (!compact) return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}주`;
  const abs = Math.abs(n);
  if (abs >= 100_000_000) {
    const scaled = n / 100_000_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}억주`;
  }
  if (abs >= 10_000) {
    const scaled = n / 10_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}만주`;
  }
  return `${n.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}주`;
}

export function formatCompactNumber(value: unknown, empty = "—"): string {
  const n = finiteNumber(value);
  if (n === null) return empty;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) {
    const scaled = n / 1_000_000_000_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}T`;
  }
  if (abs >= 1_000_000_000) {
    const scaled = n / 1_000_000_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}B`;
  }
  if (abs >= 1_000_000) {
    const scaled = n / 1_000_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}M`;
  }
  if (abs >= 1_000) {
    const scaled = n / 1_000;
    return `${fixedLocale(scaled, compactDigits(scaled))}K`;
  }
  return fixedLocale(n, 0);
}

function compactDigits(scaled: number): number {
  return Math.abs(scaled) >= 100 ? 0 : 1;
}

export function formatCurrencyCompact(value: unknown, currency: Currency, empty = "—"): string {
  const n = finiteNumber(value);
  if (n === null) return empty;

  if (currency === "KRW") {
    if (Math.abs(n) >= 1_000_000_000_000) {
      const scaled = n / 1_000_000_000_000;
      return `${fixedLocale(scaled, compactDigits(scaled))}조원`;
    }
    if (Math.abs(n) >= 100_000_000) {
      const scaled = n / 100_000_000;
      return `${fixedLocale(scaled, compactDigits(scaled))}억원`;
    }
    if (Math.abs(n) >= 10_000) {
      const scaled = n / 10_000;
      return `${fixedLocale(scaled, compactDigits(scaled))}만원`;
    }
    return `${n.toLocaleString("ko-KR")}원`;
  }

  // USD default
  if (Math.abs(n) >= 1_000_000_000_000) {
    const scaled = n / 1_000_000_000_000;
    return `$${fixedLocale(scaled, compactDigits(scaled))}T`;
  }
  if (Math.abs(n) >= 1_000_000_000) {
    const scaled = n / 1_000_000_000;
    return `$${fixedLocale(scaled, compactDigits(scaled))}B`;
  }
  if (Math.abs(n) >= 1_000_000) {
    const scaled = n / 1_000_000;
    return `$${fixedLocale(scaled, compactDigits(scaled))}M`;
  }
  if (Math.abs(n) >= 1_000) {
    const scaled = n / 1_000;
    return `$${fixedLocale(scaled, compactDigits(scaled))}K`;
  }
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatCurrency(value: unknown, currency: Currency, options: NumberOptions = {}): string {
  const { digits = 2, empty = "—" } = options;
  const n = finiteNumber(value);
  if (n === null) return empty;
  if (currency === "KRW") {
    return `₩${n.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

// --- Multi-currency money (any ISO code), folded from the per-route helper so
// non-USD/KRW listings (JPY/HKD/TWD/…) share one number language. USD/KRW keep
// the currency-origin compact above; other codes go through Intl currency style.

const ZERO_DECIMAL_CURRENCIES = new Set(["KRW", "JPY", "TWD", "VND", "IDR"]);
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  KRW: "₩",
  JPY: "¥",
  HKD: "HK$",
  TWD: "NT$",
  CNY: "CN¥",
  EUR: "€",
  GBP: "£",
};

export function normalizeCurrency(currency: unknown): string {
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency.trim().toUpperCase())
    ? currency.trim().toUpperCase()
    : "USD";
}

function defaultCurrencyDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

export function formatMoney(value: unknown, currency: unknown = "USD", digits?: number): string {
  const v = finiteNumber(value);
  if (v === null) return "—";
  const code = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits ?? defaultCurrencyDigits(code),
    }).format(v);
  } catch {
    // Invalid-code fallback. Locale pinned to en-US (deterministic) rather than
    // the environment default, per §H "no locale drift".
    const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
    return `${symbol}${v.toLocaleString("en-US", { maximumFractionDigits: digits ?? defaultCurrencyDigits(code) })}`;
  }
}

export function formatCompactMoney(value: unknown, currency: unknown = "USD"): string {
  const v = finiteNumber(value);
  if (v === null) return "—";
  const code = normalizeCurrency(currency);
  if (code === "USD" || code === "KRW") return formatCurrencyCompact(v, code);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      compactDisplay: "short",
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 1,
    }).format(v);
  } catch {
    const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
    return `${symbol}${formatCompactNumber(v)}`;
  }
}
