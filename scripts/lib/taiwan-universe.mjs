/**
 * Pure Taiwan universe classification + denominator reconciliation helpers for
 * build-fenok-edge-coverage-index.mjs. Extracted so the classification contract
 * and the carry-over denominator fix can be unit-tested; the classification
 * behavior mirrors the inline logic it replaced.
 */

const TAIWAN_MARKET_RE = /^(TW|TAIWAN|TPE|TPEX)$/i;
const TAIWAN_SCOPE_RE = /taiwan/i;
const TAIWAN_SUFFIX_TICKER_RE = /\.(TW|TWO)$/i;
const TAIWAN_SUFFIX_NORMALIZED_RE = /-(TW|TWO)$/i;

// Explicit Taiwan = rows whose upstream market/market_scope already identifies
// Taiwan. Suffix-only rows that carry a wrong upstream market tag (e.g. a .TW
// ticker still tagged US_CLASS) are intentionally NOT promoted here — they are
// surfaced as anomalies until the upstream market tag is corrected, so the
// Taiwan scoring bucket never silently grows on a misclassified row.
export function isExplicitTaiwanRow(row) {
  return TAIWAN_MARKET_RE.test(String(row?.market ?? ""))
    || TAIWAN_SCOPE_RE.test(String(row?.market_scope ?? ""));
}

export function selectExplicitTaiwanRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(isExplicitTaiwanRow);
}

// True when a row carries a Taiwan ticker suffix (.TW/.TWO, or normalized
// -TW/-TWO). This is the authoritative-but-unused Taiwan signal that the
// upstream market tag should have honored.
export function hasTaiwanTickerSuffix(row) {
  return TAIWAN_SUFFIX_TICKER_RE.test(String(row?.ticker ?? ""))
    || TAIWAN_SUFFIX_NORMALIZED_RE.test(String(row?.ticker_normalized ?? ""));
}

// Anomalies = Taiwan-suffix tickers that did NOT land in the explicit Taiwan
// bucket. They are surfaced honestly, not reclassified, so a wrong upstream tag
// stays visible instead of being papered over.
export function selectTaiwanTickerAnomalies(rows, explicitTaiwanRows) {
  const explicit = new Set(explicitTaiwanRows ?? []);
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => hasTaiwanTickerSuffix(row))
    .filter((row) => !explicit.has(row))
    .map((row) => ({
      ticker: row.ticker,
      ticker_normalized: row.ticker_normalized,
      market: row.market,
      market_scope: row.market_scope,
      company: row.company,
    }));
}

// When taiwan_current_universe is carried over from the prior index (historical
// smoke manifest missing), replaceById copies the prior row wholesale — which
// freezes its denominator at whatever the active universe total was at that
// prior build. Re-stamp it so the denominator always equals the CURRENT
// active_scoring_universe.total that the row's denominator_label claims,
// instead of drifting behind it.
export function reconcileTaiwanCurrentUniverseDenominator(row, activeScoringTotal, pct) {
  if (!row || typeof row !== "object") return row;
  row.denominator = activeScoringTotal;
  const count = Number(row.covered_count) || 0;
  row.coverage_pct = pct(count, activeScoringTotal);
  row.active_scoring_coverage_pct = pct(count, activeScoringTotal);
  return row;
}
