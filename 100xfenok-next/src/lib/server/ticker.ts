const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const WORKER_TICKER_BASE = "https://ticker-api.etloveaui.workers.dev/api/ticker";
const FETCH_TIMEOUT_MS = 5000;

type YahooResult = {
  meta?: Record<string, unknown>;
  indicators?: {
    quote?: Array<{
      close?: unknown[];
    }>;
  };
};

type YahooPayload = {
  chart?: {
    result?: YahooResult[];
  };
};

type WorkerSymbolPayload = {
  current?: unknown;
  price?: unknown;
  previousClose?: unknown;
  close?: unknown;
  change?: unknown;
  changePercent?: unknown;
  percent?: unknown;
  preMarket?: unknown;
  postMarket?: unknown;
  afterHours?: unknown;
  marketState?: unknown;
};

type WorkerPayload = WorkerSymbolPayload & {
  symbols?: Record<string, WorkerSymbolPayload>;
};

export type TickerQuote = {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  preMarket: number | null;
  postMarket: number | null;
  marketState: "PRE" | "REGULAR" | "POST" | "CLOSED" | "UNKNOWN";
  source: "yahoo" | "worker";
  fetchedAt: string;
};

function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

function ensureValidSymbol(raw: string): string {
  const symbol = normalizeSymbol(raw);
  const ok = /^[A-Z0-9^._-]{1,20}$/.test(symbol);
  if (!ok) {
    throw new Error("Invalid symbol format");
  }
  return symbol;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function lastFinite(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const n = toNumber(values[i]);
    if (n !== null) return n;
  }
  return null;
}

function normalizeMarketState(raw: unknown): TickerQuote["marketState"] {
  const value = String(raw ?? "").toUpperCase();
  if (value.includes("PRE")) return "PRE";
  if (value.includes("POST") || value.includes("AFTER")) return "POST";
  if (value.includes("REGULAR")) return "REGULAR";
  if (value.includes("CLOSE")) return "CLOSED";
  return "UNKNOWN";
}

function pickPrice(
  marketState: TickerQuote["marketState"],
  regular: number,
  preMarket: number | null,
  postMarket: number | null,
): number {
  if (marketState === "PRE" && preMarket !== null && preMarket > 0) return preMarket;
  if (marketState === "POST" && postMarket !== null && postMarket > 0) return postMarket;
  return regular;
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooQuote(symbol: string): Promise<TickerQuote> {
  const url = `${YAHOO_BASE_URL}${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=true`;
  const payload = await fetchJsonWithTimeout(url);
  const result = (payload as YahooPayload).chart?.result?.[0];
  if (!result) {
    throw new Error("Yahoo payload has no chart.result");
  }

  const meta = result.meta ?? {};
  const closeSeries = result.indicators?.quote?.[0]?.close;
  const latestClose = lastFinite(closeSeries);
  const regular = toNumber(meta.regularMarketPrice) ?? latestClose;
  if (regular === null || regular <= 0) {
    throw new Error("Yahoo payload has no valid market price");
  }

  const previousClose =
    toNumber(meta.chartPreviousClose) ??
    toNumber(meta.previousClose) ??
    latestClose ??
    regular;
  const preMarket = toNumber(meta.preMarketPrice);
  const postMarket = toNumber(meta.postMarketPrice);
  const marketState = normalizeMarketState(meta.marketState);
  const price = pickPrice(marketState, regular, preMarket, postMarket);
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    preMarket,
    postMarket,
    marketState,
    source: "yahoo",
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchWorkerQuote(symbol: string): Promise<TickerQuote> {
  const url = `${WORKER_TICKER_BASE}/${encodeURIComponent(symbol)}`;
  const payload = (await fetchJsonWithTimeout(url)) as WorkerPayload;
  const candidate =
    payload.symbols?.[symbol] ??
    payload.symbols?.[symbol.toLowerCase()] ??
    payload;

  const price = toNumber(candidate.current) ?? toNumber(candidate.price);
  if (price === null || price <= 0) {
    throw new Error("Worker payload has no valid price");
  }

  const previousClose =
    toNumber(candidate.previousClose) ??
    toNumber(candidate.close) ??
    price;
  const change = toNumber(candidate.change) ?? (price - previousClose);
  const changePercent =
    toNumber(candidate.changePercent) ??
    toNumber(candidate.percent) ??
    (previousClose > 0 ? (change / previousClose) * 100 : 0);
  const preMarket = toNumber(candidate.preMarket);
  const postMarket =
    toNumber(candidate.postMarket) ??
    toNumber(candidate.afterHours);
  const marketState = normalizeMarketState(candidate.marketState);

  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    preMarket,
    postMarket,
    marketState,
    source: "worker",
    fetchedAt: new Date().toISOString(),
  };
}

export async function getTickerQuote(rawSymbol: string): Promise<TickerQuote> {
  const symbol = ensureValidSymbol(rawSymbol);

  try {
    return await fetchYahooQuote(symbol);
  } catch {
    return fetchWorkerQuote(symbol);
  }
}
