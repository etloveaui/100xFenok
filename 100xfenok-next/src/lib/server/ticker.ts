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

function epochSecondsIso(value: unknown): string | null {
  const seconds = toEpochSeconds(value);
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function zonedWallTimeIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
  );
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess - (representedAsUtc - guess)).toISOString();
}

function nextUsWeekdayOpen(sourceAsOf: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(sourceAsOf)).map((part) => [part.type, part.value]),
  );
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return zonedWallTimeIso(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    9,
    30,
    "America/New_York",
  );
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

function quoteState(params: {
  fetchedAt: string;
  source: QuoteProviderSource;
  regularMarketTime: unknown;
  marketState: QuoteMarketState;
  currentTradingPeriod?: YahooMeta["currentTradingPeriod"];
}): Pick<TickerQuote, "lastUpdated" | "staleAfter" | "state"> {
  const sourceAsOf = epochSecondsIso(params.regularMarketTime);
  const nextRegularStart = epochSecondsIso(params.currentTradingPeriod?.regular?.start);
  let staleAfter = sourceAsOf
    ? addMinutesIso(sourceAsOf, QUOTE_STALE_AFTER_MINUTES)
    : params.fetchedAt;

  if (sourceAsOf && params.marketState !== "REGULAR") {
    const sessionStart = nextRegularStart && new Date(nextRegularStart) > new Date(sourceAsOf)
      ? nextRegularStart
      : nextUsWeekdayOpen(sourceAsOf);
    staleAfter = addMinutesIso(sessionStart, QUOTE_STALE_AFTER_MINUTES);
  }

  const isStale = sourceAsOf !== null && Date.now() > new Date(staleAfter).getTime();
  const status = sourceAsOf === null ? "unavailable" : isStale ? "stale" : "ready";
  return {
    lastUpdated: params.fetchedAt,
    staleAfter,
    state: {
      status,
      quoteStatus: "delayed",
      label: sourceAsOf === null ? "시세 기준시각 없음" : isStale ? "시세 갱신 지연" : "시세 연결됨",
      detail: sourceAsOf === null
        ? "공급자가 실제 시세 기준시각을 제공하지 않아 최신성을 판정하지 않았습니다."
        : isStale
          ? "시장 세션 기준 갱신 시한을 지났지만 더 최신 시세가 없습니다."
          : params.source === "yahoo"
            ? "지연 가능 시세이며 시장 세션에 맞춰 실제 시세 기준시각을 판정했습니다."
            : "보조 시세 경로의 실제 시세 기준시각을 시장 세션에 맞춰 판정했습니다.",
      asOf: sourceAsOf,
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
    ...quoteState({
      fetchedAt,
      source: "yahoo",
      regularMarketTime: meta.regularMarketTime,
      marketState,
      currentTradingPeriod: meta.currentTradingPeriod,
    }),
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
    ...quoteState({
      fetchedAt,
      source: "worker",
      regularMarketTime: candidate.regularMarketTime,
      marketState,
      currentTradingPeriod: candidate.currentTradingPeriod,
    }),
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
