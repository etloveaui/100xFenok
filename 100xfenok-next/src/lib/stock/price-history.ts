/**
 * Daily price bars for the stock chart, from the yf finance document's
 * `history_1y` (data/yf/finance/{SYMBOL}.json, one year of daily bars).
 *
 * The producer fetches that history with yfinance auto_adjust, which scales
 * every bar before an ex-dividend date by (1 - dividend / prior close). The
 * chart shows prices as quoted (split-adjusted, dividends not taken out), the
 * basis of the header price and of Yahoo's 52-week range, so the scaling is
 * undone walking back from the latest bar with the Dividends column each row
 * carries. Splits need nothing: yfinance history is split-adjusted either way.
 */

export type DailyBar = {
  /** Exchange-local trading day, YYYY-MM-DD. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type YfHistoryRow = {
  date?: unknown;
  Open?: unknown;
  High?: unknown;
  Low?: unknown;
  Close?: unknown;
  Volume?: unknown;
  Dividends?: unknown;
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A row without a full OHLC (the session still in progress) is not a bar, but
 * a dividend on it still applies to the bars before it. A repeated date keeps
 * its last row, as the producer's merge does.
 */
export function quotedDailyBars(history: unknown): DailyBar[] {
  if (!Array.isArray(history)) return [];
  const byDate = new Map<string, YfHistoryRow & { date: string }>();
  for (const row of history as YfHistoryRow[]) {
    if (!row || typeof row !== "object" || typeof row.date !== "string" || !ISO_DAY.test(row.date)) continue;
    const date = row.date.slice(0, 10);
    byDate.set(date, { ...row, date });
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const bars: DailyBar[] = [];
  let factor = 1;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const { date, Open: open, High: high, Low: low, Close: close, Volume: volume, Dividends: dividend } = rows[index];
    if (finite(open) && finite(high) && finite(low) && finite(close)) {
      bars.push({
        time: date,
        open: open / factor,
        high: high / factor,
        low: low / factor,
        close: close / factor,
        volume: finite(volume) ? volume : undefined,
      });
    }
    const priorClose = rows[index - 1]?.Close;
    if (finite(dividend) && dividend > 0 && finite(priorClose)) {
      // The stored prior close is quoted × factor × (1 - dividend / quoted).
      const quotedPriorClose = priorClose / factor + dividend;
      if (quotedPriorClose > dividend) factor *= 1 - dividend / quotedPriorClose;
    }
  }
  return bars.reverse();
}
