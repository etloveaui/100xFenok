/**
 * Screener filter-state URL (de)serialization.
 *
 * Pure utilities; safe to import in both server components and client code.
 */

import { normalizeForEntityKey } from "@/lib/ticker";
import { SCREENER_SORT_KEYS, type ScreenerSortKey, type SortDir } from "./types";

export type ActionFilter =
  | ""
  | "guru_held"
  | "smart_money"
  | "value_momentum"
  | "index_core"
  | "income"
  | "momentum"
  | "watch";

export type ConnectionFilter = "" | "filings" | "smartMoney" | "indexMembership" | "singleStockEtfs";

export type ColumnPreset =
  | "basic"
  | "action"
  | "connected"
  | "value"
  | "estimate"
  | "momentum"
  | "dividend"
  | "guru";

export const PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["ticker", "actionScore", "name", "sector", "country", "price", "marketCap", "per", "pbr", "dividendYield", "return12m"],
  action: ["ticker", "actionScore", "name", "sector", "guruHolders", "perBandCurrent", "return12m", "ret1y", "dividendYield", "marketCap"],
  connected: ["ticker", "connectionCount", "actionScore", "name", "sector", "guruHolders", "marketCap", "perBandCurrent", "forwardPeFy1", "return12m"],
  value: ["ticker", "name", "sector", "per", "peForward", "forwardPeFy1", "pbr", "peg", "roe", "opm", "perBandCurrent", "rank"],
  estimate: [
    "ticker",
    "actionScore",
    "name",
    "sector",
    "forwardPeFy1",
    "forwardPeFy2",
    "forwardPeFy3",
    "forwardEpsFy1",
    "forwardEpsFy2",
    "forwardEpsFy3",
    "revenueGrowthFy1",
    "revenueGrowthFy2",
    "revenueGrowthFy3",
    "epsGrowthFy1",
    "epsGrowthFy2",
    "epsGrowthFy3",
    "roeFy1",
    "roeFy2",
    "roeFy3",
    "operatingMarginFy1",
    "operatingMarginFy2",
    "operatingMarginFy3",
    "grossMarginFy1",
    "grossMarginFy2",
    "grossMarginFy3",
    "perBandCurrent",
    "marketCap",
  ],
  momentum: ["ticker", "name", "sector", "growthRate", "momentum1m", "momentum3m", "momentum6m", "momentum12m", "rank"],
  dividend: ["ticker", "name", "sector", "dividendYield", "dividendTtm", "ret1y", "ret3y", "ret5y", "per", "pbr", "marketCap"],
  guru: ["ticker", "name", "sector", "guruHolders", "per", "peForward", "perBandCurrent", "pbr", "peg", "roe", "marketCap", "return12m"],
};

export const PRESET_LABEL: Record<ColumnPreset, string> = {
  basic: "기본",
  action: "투자 신호",
  connected: "연결 데이터",
  value: "가치",
  estimate: "추정치",
  momentum: "모멘텀",
  dividend: "배당",
  guru: "대가 관심",
};

export function coerceColumnPreset(value: string | null | undefined): ColumnPreset | null {
  return value && value in PRESET_KEYS ? (value as ColumnPreset) : null;
}

export function coerceActionFilter(value: string | null | undefined): ActionFilter {
  if (
    value === "guru_held" ||
    value === "smart_money" ||
    value === "value_momentum" ||
    value === "index_core" ||
    value === "income" ||
    value === "momentum" ||
    value === "watch"
  ) {
    return value;
  }
  return "";
}

export function coerceConnectionFilter(value: string | null | undefined): ConnectionFilter {
  if (value === "filings" || value === "smartMoney" || value === "indexMembership" || value === "singleStockEtfs") {
    return value;
  }
  return "";
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function parseNumberParam(value: string | string[] | undefined): string {
  const raw = firstParam(value).trim();
  if (raw === "") return "";
  const n = Number(raw);
  return Number.isNaN(n) ? "" : raw;
}

function parseBoolParam(value: string | string[] | undefined): boolean {
  const raw = firstParam(value);
  return raw === "1" || raw === "true";
}

function parseListParam(value: string | string[] | undefined): string[] {
  const raw = firstParam(value);
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBand(value: string): "" | "cheap" | "fair" | "rich" {
  if (value === "cheap" || value === "fair" || value === "rich") return value;
  return "";
}

function parseSortKey(value: string): ScreenerSortKey {
  if (SCREENER_SORT_KEYS.includes(value as ScreenerSortKey)) return value as ScreenerSortKey;
  return "marketCap";
}

export interface ScreenerFilterState {
  search: string;
  selectedSectors: string[];
  selectedCountries: string[];
  perMin: string;
  perMax: string;
  forwardPerMax: string;
  revenueGrowthMin: string;
  epsGrowthMin: string;
  dividendYieldMin: string;
  dividendYieldMax: string;
  roeFy1Min: string;
  ret3yMin: string;
  ret5yMin: string;
  marketCapMin: string;
  marketCapMax: string;
  pbrMin: string;
  pbrMax: string;
  pegMax: string;
  roeMin: string;
  opmMin: string;
  return12mMin: string;
  profitableOnly: boolean;
  bandFilter: "" | "cheap" | "fair" | "rich";
  actionFilter: ActionFilter;
  connectionFilter: ConnectionFilter;
  sortKey: ScreenerSortKey;
  sortDir: SortDir;
  preset: ColumnPreset;
}

export function defaultScreenerFilterState(): ScreenerFilterState {
  return {
    search: "",
    selectedSectors: [],
    selectedCountries: [],
    perMin: "",
    perMax: "",
    forwardPerMax: "",
    revenueGrowthMin: "",
    epsGrowthMin: "",
    dividendYieldMin: "",
    dividendYieldMax: "",
    roeFy1Min: "",
    ret3yMin: "",
    ret5yMin: "",
    marketCapMin: "",
    marketCapMax: "",
    pbrMin: "",
    pbrMax: "",
    pegMax: "",
    roeMin: "",
    opmMin: "",
    return12mMin: "",
    profitableOnly: false,
    bandFilter: "",
    actionFilter: "",
    connectionFilter: "",
    sortKey: "marketCap",
    sortDir: "desc",
    preset: "basic",
  };
}

export function parseScreenerFilterState(params: Record<string, string | string[] | undefined>): ScreenerFilterState {
  const defaults = defaultScreenerFilterState();
  return {
    search: normalizeForEntityKey(firstParam(params.ticker ?? params.q)) || defaults.search,
    selectedSectors: parseListParam(params.sector),
    selectedCountries: parseListParam(params.country),
    perMin: parseNumberParam(params.perMin) || defaults.perMin,
    perMax: parseNumberParam(params.perMax) || defaults.perMax,
    forwardPerMax: parseNumberParam(params.fpeMax) || defaults.forwardPerMax,
    revenueGrowthMin: parseNumberParam(params.revMin) || defaults.revenueGrowthMin,
    epsGrowthMin: parseNumberParam(params.epsMin) || defaults.epsGrowthMin,
    dividendYieldMin: parseNumberParam(params.divMin) || defaults.dividendYieldMin,
    dividendYieldMax: parseNumberParam(params.divMax) || defaults.dividendYieldMax,
    roeFy1Min: parseNumberParam(params.roeFy1Min) || defaults.roeFy1Min,
    ret3yMin: parseNumberParam(params.ret3yMin) || defaults.ret3yMin,
    ret5yMin: parseNumberParam(params.ret5yMin) || defaults.ret5yMin,
    marketCapMin: parseNumberParam(params.capMin) || defaults.marketCapMin,
    marketCapMax: parseNumberParam(params.capMax) || defaults.marketCapMax,
    pbrMin: parseNumberParam(params.pbrMin) || defaults.pbrMin,
    pbrMax: parseNumberParam(params.pbrMax) || defaults.pbrMax,
    pegMax: parseNumberParam(params.pegMax) || defaults.pegMax,
    roeMin: parseNumberParam(params.roeMin) || defaults.roeMin,
    opmMin: parseNumberParam(params.opmMin) || defaults.opmMin,
    return12mMin: parseNumberParam(params.ret12mMin) || defaults.return12mMin,
    profitableOnly: parseBoolParam(params.profitable),
    bandFilter: parseBand(firstParam(params.band)),
    actionFilter: coerceActionFilter(firstParam(params.action)),
    connectionFilter: coerceConnectionFilter(firstParam(params.connection)),
    sortKey: parseSortKey(firstParam(params.sort)),
    sortDir: firstParam(params.dir) === "asc" ? "asc" : "desc",
    preset: coerceColumnPreset(firstParam(params.preset)) ?? defaults.preset,
  };
}

const URL_KEYS = [
  "ticker",
  "q",
  "sector",
  "country",
  "perMin",
  "perMax",
  "fpeMax",
  "revMin",
  "epsMin",
  "divMin",
  "divMax",
  "roeFy1Min",
  "ret3yMin",
  "ret5yMin",
  "capMin",
  "capMax",
  "pbrMin",
  "pbrMax",
  "pegMax",
  "roeMin",
  "opmMin",
  "ret12mMin",
  "profitable",
  "band",
  "action",
  "connection",
  "sort",
  "dir",
  "preset",
] as const;

function setIfPresent(params: URLSearchParams, key: string, value: string | boolean | string[] | undefined | null) {
  if (value === undefined || value === null || value === "" || value === false) return;
  if (Array.isArray(value)) {
    if (value.length > 0) params.set(key, value.join(","));
    return;
  }
  params.set(key, String(value));
}

export function serializeScreenerFilterState(state: ScreenerFilterState, preferTickerKey = false): URLSearchParams {
  const params = new URLSearchParams();
  const searchKey = preferTickerKey ? "ticker" : "q";
  setIfPresent(params, searchKey, state.search);
  setIfPresent(params, "sector", state.selectedSectors);
  setIfPresent(params, "country", state.selectedCountries);
  setIfPresent(params, "perMin", state.perMin);
  setIfPresent(params, "perMax", state.perMax);
  setIfPresent(params, "fpeMax", state.forwardPerMax);
  setIfPresent(params, "revMin", state.revenueGrowthMin);
  setIfPresent(params, "epsMin", state.epsGrowthMin);
  setIfPresent(params, "divMin", state.dividendYieldMin);
  setIfPresent(params, "divMax", state.dividendYieldMax);
  setIfPresent(params, "roeFy1Min", state.roeFy1Min);
  setIfPresent(params, "ret3yMin", state.ret3yMin);
  setIfPresent(params, "ret5yMin", state.ret5yMin);
  setIfPresent(params, "capMin", state.marketCapMin);
  setIfPresent(params, "capMax", state.marketCapMax);
  setIfPresent(params, "pbrMin", state.pbrMin);
  setIfPresent(params, "pbrMax", state.pbrMax);
  setIfPresent(params, "pegMax", state.pegMax);
  setIfPresent(params, "roeMin", state.roeMin);
  setIfPresent(params, "opmMin", state.opmMin);
  setIfPresent(params, "ret12mMin", state.return12mMin);
  setIfPresent(params, "profitable", state.profitableOnly ? "1" : "");
  setIfPresent(params, "band", state.bandFilter);
  setIfPresent(params, "action", state.actionFilter);
  setIfPresent(params, "connection", state.connectionFilter);
  const isDefaultSort = state.sortKey === "marketCap" && state.sortDir === "desc";
  setIfPresent(params, "sort", isDefaultSort ? "" : state.sortKey);
  setIfPresent(params, "dir", isDefaultSort ? "" : state.sortDir);
  setIfPresent(params, "preset", state.preset === "basic" ? "" : state.preset);
  return params;
}

/**
 * Update the current URL with the given filter state, preserving any
 * unrelated query parameters (e.g. `macro`). Returns the new href.
 */
export function updateScreenerUrl(currentHref: string, state: ScreenerFilterState): string {
  const url = new URL(currentHref, "http://localhost");
  const hadTicker = url.searchParams.has("ticker");
  URL_KEYS.forEach((key) => url.searchParams.delete(key));

  const next = serializeScreenerFilterState(state, hadTicker);
  next.forEach((value, key) => url.searchParams.set(key, value));

  return url.toString();
}
