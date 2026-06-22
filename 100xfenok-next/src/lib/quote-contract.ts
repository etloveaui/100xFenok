export const QUOTE_CONTRACT_VERSION = "quote.v1" as const;
export const QUOTE_ENDPOINT_PATTERN = "/api/ticker/{symbol}/" as const;
export const QUOTE_CACHE_CONTROL = "public, s-maxage=15, stale-while-revalidate=45" as const;

export const QUOTE_SYMBOL_PATTERN = /^[A-Z0-9^._-]{1,20}$/;

export type QuoteMarketState = "PRE" | "REGULAR" | "POST" | "CLOSED" | "UNKNOWN";
export type QuoteProviderSource = "yahoo" | "worker";

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
};

export type QuoteErrorPayload = {
  schemaVersion: typeof QUOTE_CONTRACT_VERSION;
  error: "SYMBOL_REQUIRED" | "INVALID_SYMBOL" | "TICKER_FETCH_FAILED";
  symbol?: string;
  message?: string;
  usage?: string;
};

export function normalizeQuoteSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidQuoteSymbol(raw: string): boolean {
  return QUOTE_SYMBOL_PATTERN.test(normalizeQuoteSymbol(raw));
}
