export const ENTITY_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
export const ROUTE_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
export const QUOTE_TICKER_PATTERN = /^[A-Z0-9^._-]{1,20}$/;

export function normalizeForDisplay(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^\$/, "").toUpperCase();
}

export function normalizeForEntityKey(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/^\$/, "").toUpperCase();
}

export function normalizeForFilePath(value: string | null | undefined): string {
  return normalizeForEntityKey(value).replace(/[^A-Z0-9.-]/g, "");
}

export function normalizeForQuoteProvider(value: string | null | undefined): string {
  return normalizeForDisplay(value);
}

export function normalizeForRouteTicker(value: string | null | undefined): string {
  return normalizeForFilePath(value);
}

export function normalizeTickerQuery(value: string | null | undefined): string {
  return normalizeForRouteTicker(value);
}

export function isValidEntityTicker(value: string | null | undefined): boolean {
  return ENTITY_TICKER_PATTERN.test(normalizeForEntityKey(value));
}

export function isValidRouteTicker(value: string | null | undefined): boolean {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("^")) return false;
  return ROUTE_TICKER_PATTERN.test(normalizeForRouteTicker(value));
}

export function isValidQuoteTicker(value: string | null | undefined): boolean {
  return QUOTE_TICKER_PATTERN.test(normalizeForQuoteProvider(value));
}
