/**
 * Analyst price targets read against the price the stock page displays.
 *
 * yfinance's `analyst_price_targets.current` is the price Yahoo stamped on its
 * analyst module, and it can lag the quote carried by the same fetch (NVDA,
 * fetched 2026-09-24: 217.21 against `info.currentPrice` 225.51). Measuring
 * upside from that stamp put a second "현재가" on the page and overstated the
 * upside by five points. Upside is measured from the displayed quote; the
 * analyst stamp is only the fallback when the page has no quote at all.
 */

export type PriceTargetBasis = "quote" | "analyst-stamp";

export type PriceTargetRead = {
  /** Price the upside and the range marker are measured from. */
  current: number | null;
  basis: PriceTargetBasis | null;
  low: number | null;
  mean: number | null;
  median: number | null;
  high: number | null;
  /** (mean - current) / current as a fraction; null when either side is missing. */
  upsidePct: number | null;
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readPriceTargets(targets: unknown, quotePrice: number | null | undefined): PriceTargetRead {
  const record = targets && typeof targets === "object" ? (targets as Record<string, unknown>) : {};
  const quote = finite(quotePrice);
  const stamp = finite(record.current);
  const current = quote !== null && quote > 0 ? quote : stamp !== null && stamp > 0 ? stamp : null;
  const basis: PriceTargetBasis | null = current === null ? null : current === quote ? "quote" : "analyst-stamp";
  const mean = finite(record.mean);
  return {
    current,
    basis,
    low: finite(record.low),
    mean,
    median: finite(record.median),
    high: finite(record.high),
    upsidePct: current !== null && mean !== null ? (mean - current) / current : null,
  };
}
