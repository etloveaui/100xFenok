import type { MacroRawPoint, MacroSeriesDefinition } from "./types";

export const STOOQ_PROXY_BASE = "https://stooq-proxy.etloveaui.workers.dev";
export const STOOQ_CACHE_TTL_MS = 86_400_000;
export const STOOQ_SERIES_ID_PREFIX = "stq~";

const STOOQ_INPUT_SYMBOL_PATTERN = /^[A-Za-z0-9.^-]{1,16}(?:\.[A-Za-z]{1,4})?$/;
const STOOQ_RESOLVED_SYMBOL_PATTERN = /^[a-z0-9.^-]{1,16}(?:\.[a-z]{1,4})?$/;

function asNumber(value: unknown): number | null {
  const next = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(next) ? next : null;
}

export function toStooqSymbol(symbol: string): string | null {
  const raw = symbol.trim();
  if (!STOOQ_INPUT_SYMBOL_PATTERN.test(raw)) return null;
  if (raw.startsWith("^")) return raw.toLowerCase();
  if (/^[0-9]{6}\.KS$/i.test(raw)) return `${raw.slice(0, 6).toLowerCase()}.kr`;
  if (/\.[A-Za-z]{1,4}$/.test(raw)) return raw.toLowerCase();
  return `${raw.toLowerCase()}.us`;
}

export function isResolvedStooqSymbol(symbol: string) {
  return STOOQ_RESOLVED_SYMBOL_PATTERN.test(symbol);
}

export function stooqSeriesIdFromInput(input: string): string | null {
  const stooqSymbol = toStooqSymbol(input);
  if (!stooqSymbol || !isResolvedStooqSymbol(stooqSymbol)) return null;
  return `${STOOQ_SERIES_ID_PREFIX}${stooqSymbol.toUpperCase()}`;
}

export function stooqInputFromSeriesId(id: string): string | null {
  if (!id.startsWith(STOOQ_SERIES_ID_PREFIX)) return null;
  const raw = id.slice(STOOQ_SERIES_ID_PREFIX.length).trim();
  if (!raw || raw.includes(":")) return null;
  const stooqSymbol = toStooqSymbol(raw);
  return stooqSymbol && isResolvedStooqSymbol(stooqSymbol) ? raw.toUpperCase() : null;
}

export function stooqProxyUrl(stooqSymbol: string) {
  const proxyBase = STOOQ_PROXY_BASE.endsWith("/") ? STOOQ_PROXY_BASE : `${STOOQ_PROXY_BASE}/`;
  const upstream = `https://stooq.com/q/d/l/?s=${stooqSymbol}&i=d`;
  return `${proxyBase}${encodeURIComponent(upstream)}`;
}

export function parseStooqDailyCsv(csv: string): MacroRawPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  const [header, ...rows] = lines;
  if (!header || !header.toLowerCase().startsWith("date,")) throw new Error("Stooq CSV format");
  return rows
    .map((line) => {
      const fields = line.split(",");
      const date = fields[0]?.trim();
      const close = asNumber(fields[4]);
      if (!date || close === null) return null;
      return { date, value: close };
    })
    .filter((point): point is MacroRawPoint => point !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function stooqSeriesDefinitionFromId(id: string): MacroSeriesDefinition | undefined {
  const input = stooqInputFromSeriesId(id);
  if (!input) return undefined;
  const label = input.replace(/\.US$/i, "");
  return {
    id,
    label,
    shortLabel: label,
    group: "equity",
    unit: "usd",
    frequency: "daily",
    sourceKind: "stooq",
    sourcePath: `stooq:${input}`,
    stooqSymbol: input,
    accessor: { kind: "array", valueKey: "value" },
    description: `${label} daily close from Stooq via owner Worker proxy`,
    defaultTransform: "rebase100",
    colorToken: "brandAlt",
  };
}
