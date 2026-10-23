// Compact, deterministic view of the same daily snapshots being published.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOP_PER_DAY = 10;
const DISPLAY_LIMIT = 10;

function snapshots(document, side) {
  if (!Array.isArray(document?.history)) return null;
  const days = new Map();
  for (const snapshot of document.history) {
    const date = snapshot?.date;
    if (typeof date !== "string" || !ISO_DAY.test(date) || !Number.isFinite(Date.parse(date))
      || !Array.isArray(snapshot[side]) || days.has(date)) continue;
    const seen = new Set();
    const rows = snapshot[side]
      .map((row, index) => ({ ...row, order: Number.isFinite(row?.rank) ? row.rank : index + 1 }))
      .filter(row => typeof row.symbol === "string" && row.symbol.trim()
        && typeof row.changePercent === "number" && Number.isFinite(row.changePercent)
        && (side === "gainers" ? row.changePercent > 0 : row.changePercent < 0))
      .sort((a, b) => a.order - b.order)
      .filter(row => {
        const symbol = row.symbol.trim().toUpperCase();
        if (seen.has(symbol)) return false;
        seen.add(symbol);
        return true;
      }).slice(0, TOP_PER_DAY);
    days.set(date, rows);
  }
  return days;
}

function summarize(days, dates) {
  const symbols = new Map();
  for (const date of dates) {
    for (const row of days.get(date)) {
      const symbol = row.symbol.trim().toUpperCase();
      const previous = symbols.get(symbol);
      symbols.set(symbol, {
        symbol,
        company: typeof row.company === "string" ? row.company : symbol,
        appearances: (previous?.appearances ?? 0) + 1,
        last_date: date,
        last_change_percent: row.changePercent,
      });
    }
  }
  return [...symbols.values()].filter(row => row.appearances >= 2)
    .sort((a, b) => b.appearances - a.appearances || b.last_date.localeCompare(a.last_date)
      || a.symbol.localeCompare(b.symbol)).slice(0, DISPLAY_LIMIT);
}

export function buildSlickchartsRepeatMovers(gainers, losers) {
  const up = snapshots(gainers, "gainers");
  const down = snapshots(losers, "losers");
  if (!up || !down) return null;
  const dates = [...up.keys()].filter(date => down.has(date)).sort();
  if (!dates.length) return null;
  return {
    schema_version: "slickcharts-repeat-movers/v1",
    source: "slickcharts",
    source_as_of: dates.at(-1),
    window_start: dates[0],
    window_end: dates.at(-1),
    observed_days: dates.length,
    top_per_day: TOP_PER_DAY,
    source_updated: { gainers: gainers.updated ?? null, losers: losers.updated ?? null },
    gainers: summarize(up, dates),
    losers: summarize(down, dates),
  };
}
