export const QUOTE_CONTRACT_VERSION = "quote.v1" as const;
export const QUOTE_ENDPOINT_PATTERN = "/api/ticker/{symbol}/" as const;
export const QUOTE_CACHE_CONTROL = "public, s-maxage=15, stale-while-revalidate=45" as const;
export const QUOTE_STALE_AFTER_MINUTES = 1;

export const QUOTE_SYMBOL_PATTERN = /^[A-Z0-9^._-]{1,20}$/;

export type QuoteMarketState = "PRE" | "REGULAR" | "POST" | "CLOSED" | "UNKNOWN";
export type QuoteProviderSource = "yahoo" | "worker";

export type QuoteDataState = {
  status: "partial" | "stale" | "unavailable" | "error";
  label: string;
  detail: string;
  asOf: string | null;
  staleAfter: string | null;
};

export type QuotePayload = {
  schemaVersion: typeof QUOTE_CONTRACT_VERSION;
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  preMarket: number | null;
  postMarket: number | null;
  marketState: QuoteMarketState;
  source: QuoteProviderSource;
  fetchedAt: string;
  lastUpdated: string;
  staleAfter: string;
  state: QuoteDataState;
};

export type QuoteErrorPayload = {
  schemaVersion: typeof QUOTE_CONTRACT_VERSION;
  error: "SYMBOL_REQUIRED" | "INVALID_SYMBOL" | "TICKER_FETCH_FAILED";
  symbol?: string;
  message?: string;
  usage?: string;
  state: QuoteDataState;
};

export function quoteErrorState(detail: string): QuoteDataState {
  return {
    status: "error",
    label: "확인 불가",
    detail,
    asOf: null,
    staleAfter: null,
  };
}

export function normalizeQuoteSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidQuoteSymbol(raw: string): boolean {
  return QUOTE_SYMBOL_PATTERN.test(normalizeQuoteSymbol(raw));
}
