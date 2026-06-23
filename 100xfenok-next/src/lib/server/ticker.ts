import {
  QUOTE_CONTRACT_VERSION,
  QUOTE_STALE_AFTER_MINUTES,
  isValidQuoteSymbol,
  normalizeQuoteSymbol,
  type QuoteMarketState,
  type QuotePayload,
  type QuoteProviderSource,
} from "@/lib/quote-contract";
import { addMinutesIso } from "@/lib/data-state";

const YAHOO_BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const WORKER_TICKER_BASE = "https://ticker-api.etloveaui.workers.dev/api/ticker";
const FETCH_TIMEOUT_MS = 5000;

type TradingPeriodWindow = {
  start?: unknown;
  end?: unknown;
};

type YahooMeta = Record<string, unknown> & {
  marketState?: unknown;
  regularMarketPrice?: unknown;
  chartPreviousClose?: unknown;
  previousClose?: unknown;
  preMarketPrice?: unknown;
  postMarketPrice?: unknown;
  regularMarketTime?: unknown;
  currentTradingPeriod?: {
    pre?: TradingPeriodWindow;
    regular?: TradingPeriodWindow;
    post?: TradingPeriodWindow;
  };
};

type YahooResult = {
  meta?: YahooMeta;
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
  currentTradingPeriod?: YahooMeta["currentTradingPeriod"];
  regularMarketTime?: unknown;
};

type WorkerPayload = WorkerSymbolPayload & {
  symbols?: Record<string, WorkerSymbolPayload>;
};

export type TickerQuote = QuotePayload;

function normalizeSymbol(raw: string): string {
  return normalizeQuoteSymbol(raw);
}

function ensureValidSymbol(raw: string): string {
  const symbol = normalizeSymbol(raw);
  if (!isValidQuoteSymbol(symbol)) {
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

function normalizeMarketState(raw: unknown): QuoteMarketState {
  const value = String(raw ?? "").toUpperCase();
  if (value.includes("PRE")) return "PRE";
  if (value.includes("POST") || value.includes("AFTER")) return "POST";
  if (value.includes("REGULAR")) return "REGULAR";
  if (value.includes("CLOSE")) return "CLOSED";
  return "UNKNOWN";
}

function toEpochSeconds(value: unknown): number | null {
  const n = toNumber(value);
  if (n === null) return null;
  return Math.trunc(n);
}

export function deriveMarketStateFromTradingPeriods(params: {
  marketStateRaw?: unknown;
  currentTradingPeriod?: YahooMeta["currentTradingPeriod"];
  regularMarketTime?: unknown;
  nowMs?: number;
}): QuoteMarketState {
  const parsed = normalizeMarketState(params.marketStateRaw);
  if (parsed !== "UNKNOWN") {
    return parsed;
  }

  const nowSec = Math.floor((params.nowMs ?? Date.now()) / 1000);
  const preStart = toEpochSeconds(params.currentTradingPeriod?.pre?.start);
  const regularStart = toEpochSeconds(params.currentTradingPeriod?.regular?.start);
  const regularEnd = toEpochSeconds(params.currentTradingPeriod?.regular?.end);
  const postEnd = toEpochSeconds(params.currentTradingPeriod?.post?.end);

  if (preStart !== null && regularStart !== null && nowSec >= preStart && nowSec < regularStart) {
    return "PRE";
  }
  if (regularStart !== null && regularEnd !== null && nowSec >= regularStart && nowSec < regularEnd) {
    return "REGULAR";
  }
  if (regularEnd !== null && postEnd !== null && nowSec >= regularEnd && nowSec < postEnd) {
    return "POST";
  }

  const regularMarketTime = toEpochSeconds(params.regularMarketTime);
  if (regularMarketTime !== null && regularEnd !== null && regularMarketTime < regularEnd) {
    return "CLOSED";
  }

  if (regularMarketTime !== null && regularStart !== null && regularEnd !== null) {
    if (regularMarketTime >= regularStart && regularMarketTime < regularEnd) {
      return "REGULAR";
    }
    return "CLOSED";
  }

  return "UNKNOWN";
}

function pickPrice(
  marketState: QuoteMarketState,
  regular: number,
  preMarket: number | null,
  postMarket: number | null,
): number {
  if (marketState === "PRE" && preMarket !== null && preMarket > 0) return preMarket;
  if (marketState === "POST" && postMarket !== null && postMarket > 0) return postMarket;
  return regular;
}

function quoteState(fetchedAt: string, source: QuoteProviderSource): Pick<TickerQuote, "lastUpdated" | "staleAfter" | "state"> {
  const staleAfter = addMinutesIso(fetchedAt, QUOTE_STALE_AFTER_MINUTES);
  return {
    lastUpdated: fetchedAt,
    staleAfter,
    state: {
      status: "partial",
      quoteStatus: "delayed",
      label: "시세 연결됨",
      detail: source === "yahoo"
        ? "지연 가능 시세입니다. 기준 시각을 함께 확인하세요."
        : "보조 시세 경로에서 받은 값입니다. 기준 시각을 함께 확인하세요.",
      asOf: fetchedAt,
      staleAfter,
    },
  };
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
  const marketState = deriveMarketStateFromTradingPeriods({
    marketStateRaw: meta.marketState,
    currentTradingPeriod: meta.currentTradingPeriod,
    regularMarketTime: meta.regularMarketTime,
  });
  const price = pickPrice(marketState, regular, preMarket, postMarket);
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  const fetchedAt = new Date().toISOString();
  return {
    schemaVersion: QUOTE_CONTRACT_VERSION,
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    preMarket,
    postMarket,
    marketState,
    source: "yahoo",
    fetchedAt,
    ...quoteState(fetchedAt, "yahoo"),
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
  const marketState = deriveMarketStateFromTradingPeriods({
    marketStateRaw: candidate.marketState,
    currentTradingPeriod: candidate.currentTradingPeriod,
    regularMarketTime: candidate.regularMarketTime,
  });

  const fetchedAt = new Date().toISOString();
  return {
    schemaVersion: QUOTE_CONTRACT_VERSION,
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    preMarket,
    postMarket,
    marketState,
    source: "worker",
    fetchedAt,
    ...quoteState(fetchedAt, "worker"),
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
