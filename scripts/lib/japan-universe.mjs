/**
 * Pure Japan universe classification helpers for the Fenok Edge coverage index.
 * Explicit JP rows are counted only when upstream classification already says
 * Japan; suffix-only rows are surfaced as anomalies until that classification
 * is independently repaired and accepted.
 */

const JAPAN_MARKET_RE = /^(JP|JAPAN|TSE|JPX)$/i;
const JAPAN_SCOPE_RE = /japan/i;
const JAPAN_SUFFIX_TICKER_RE = /\.T$/i;
const JAPAN_SUFFIX_NORMALIZED_RE = /-T$/i;

export function isExplicitJapanRow(row) {
  return JAPAN_MARKET_RE.test(String(row?.market ?? ""))
    || JAPAN_SCOPE_RE.test(String(row?.market_scope ?? ""));
}

export function selectExplicitJapanRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isExplicitJapanRow);
}

export function hasJapanTickerSuffix(row) {
  return JAPAN_SUFFIX_TICKER_RE.test(String(row?.ticker ?? ""))
    || JAPAN_SUFFIX_NORMALIZED_RE.test(String(row?.ticker_normalized ?? ""));
}

export function selectJapanTickerAnomalies(rows, explicitJapanRows) {
  const explicit = new Set(explicitJapanRows ?? []);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => hasJapanTickerSuffix(row))
    .filter((row) => !explicit.has(row))
    .map((row) => ({
      ticker: row.ticker,
      ticker_normalized: row.ticker_normalized,
      market: row.market,
      market_scope: row.market_scope,
      company: row.company,
    }));
}
