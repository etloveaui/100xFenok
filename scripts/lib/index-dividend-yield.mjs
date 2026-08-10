// Pure PR/TR index dividend-yield and payout conversion.
//
// This module has no data-tree, output, owner-order, floor, or valuation-model
// dependency. It accepts already-fetched price-return (PR) and total-return
// (TR) observations, aligns them on exact dates, derives a trailing measured
// index dividend yield, and optionally converts that yield to a payout ratio.

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const INDEX_DIVIDEND_YIELD_DEFAULTS = Object.freeze({
  lookbackDays: 365,
  maxObservationAgeDays: 10,
  minimumTrPrRatio: 1 - 1e-4,
  maximumYield: 0.15,
  maximumPayout: 1,
});

function fail(code, reason) {
  return { ok: false, code, reason };
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function addDays(date, delta) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(earlier, later) {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS;
}

function normalizeRows(rows, seriesId) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return fail("missing_series", `${seriesId}: observations missing or empty`);
  }
  const normalized = [];
  const dates = new Set();
  for (const row of rows) {
    const date = row?.date;
    if (!isCalendarDate(date)) return fail("invalid_date", `${seriesId}: invalid observation date ${String(date)}`);
    if (dates.has(date)) return fail("duplicate_date", `${seriesId}: duplicate observation date ${date}`);
    dates.add(date);
    const value = typeof row?.value === "number" ? row.value : Number(row?.value);
    if (!Number.isFinite(value) || value <= 0) {
      return fail("invalid_value", `${seriesId}: ${date} value must be positive and finite`);
    }
    normalized.push({ date, value });
  }
  normalized.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, rows: normalized };
}

// Exact-date inner join. One-sided observations are deliberately dropped;
// interpolation and nearest-date pairing would mix return periods.
export function alignPriceTotalReturnSeries({
  totalReturnRows,
  priceReturnRows,
  totalReturnSeriesId = "NASDAQXCMP",
  priceReturnSeriesId = "NASDAQCOM",
}) {
  const tr = normalizeRows(totalReturnRows, totalReturnSeriesId);
  if (!tr.ok) return tr;
  const pr = normalizeRows(priceReturnRows, priceReturnSeriesId);
  if (!pr.ok) return pr;

  const priceByDate = new Map(pr.rows.map((row) => [row.date, row.value]));
  const rows = tr.rows
    .filter((row) => priceByDate.has(row.date))
    .map((row) => ({
      date: row.date,
      total_return: row.value,
      price_return: priceByDate.get(row.date),
    }));
  if (rows.length === 0) {
    return fail("no_aligned_observations", `${totalReturnSeriesId}/${priceReturnSeriesId}: no exact common dates`);
  }
  return {
    ok: true,
    rows,
    source_clocks: {
      total_return_last_observation: tr.rows.at(-1).date,
      price_return_last_observation: pr.rows.at(-1).date,
      aligned_last_observation: rows.at(-1).date,
    },
  };
}

// y(s,t) = (Tt * Ps) / (Ts * Pt) - 1
// t = max aligned date <= asOf; s = max aligned date <= t - lookbackDays.
export function deriveTrailingIndexDividendYield({
  totalReturnRows,
  priceReturnRows,
  asOf = null,
  lookbackDays = INDEX_DIVIDEND_YIELD_DEFAULTS.lookbackDays,
  maxObservationAgeDays = INDEX_DIVIDEND_YIELD_DEFAULTS.maxObservationAgeDays,
  minimumTrPrRatio = INDEX_DIVIDEND_YIELD_DEFAULTS.minimumTrPrRatio,
  maximumYield = INDEX_DIVIDEND_YIELD_DEFAULTS.maximumYield,
  totalReturnSeriesId = "NASDAQXCMP",
  priceReturnSeriesId = "NASDAQCOM",
  provider = "FRED (Nasdaq, Inc.)",
}) {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1) {
    return fail("invalid_lookback", `lookbackDays must be a positive integer; got ${lookbackDays}`);
  }
  if (!Number.isInteger(maxObservationAgeDays) || maxObservationAgeDays < 0) {
    return fail("invalid_freshness_gate", `maxObservationAgeDays must be a nonnegative integer; got ${maxObservationAgeDays}`);
  }
  if (!Number.isFinite(minimumTrPrRatio) || minimumTrPrRatio <= 0) {
    return fail("invalid_ratio_gate", `minimumTrPrRatio must be positive and finite; got ${minimumTrPrRatio}`);
  }
  if (!Number.isFinite(maximumYield) || maximumYield < 0) {
    return fail("invalid_yield_gate", `maximumYield must be nonnegative and finite; got ${maximumYield}`);
  }

  const aligned = alignPriceTotalReturnSeries({
    totalReturnRows,
    priceReturnRows,
    totalReturnSeriesId,
    priceReturnSeriesId,
  });
  if (!aligned.ok) return aligned;

  const requestedAsOf = asOf ?? aligned.rows.at(-1).date;
  if (!isCalendarDate(requestedAsOf)) return fail("invalid_asof", `asOf must be an exact calendar date; got ${String(asOf)}`);

  const eligible = aligned.rows.filter((row) => row.date <= requestedAsOf);
  if (eligible.length === 0) {
    return fail("asof_before_first_observation", `asOf ${requestedAsOf} precedes first aligned observation ${aligned.rows[0].date}`);
  }
  const terminal = eligible.at(-1);
  const observationAgeDays = daysBetween(terminal.date, requestedAsOf);
  if (observationAgeDays > maxObservationAgeDays) {
    return fail(
      "stale_observations",
      `used observation ${terminal.date} is ${observationAgeDays}d before asOf ${requestedAsOf}; max ${maxObservationAgeDays}d`,
    );
  }

  const anchorTarget = addDays(terminal.date, -lookbackDays);
  const anchor = aligned.rows.filter((row) => row.date <= anchorTarget).at(-1);
  if (!anchor) {
    return fail(
      "lookback_missing",
      `no aligned observation on or before ${anchorTarget}; first aligned observation is ${aligned.rows[0].date}`,
    );
  }

  const terminalRatio = terminal.total_return / terminal.price_return;
  const anchorRatio = anchor.total_return / anchor.price_return;
  if (!Number.isFinite(terminalRatio) || !Number.isFinite(anchorRatio)
    || terminalRatio < minimumTrPrRatio || anchorRatio < minimumTrPrRatio) {
    return fail(
      "tr_pr_ratio_below_gate",
      `TR/PR ratio below ${minimumTrPrRatio}: anchor=${anchorRatio}, terminal=${terminalRatio}`,
    );
  }

  const value = (terminal.total_return * anchor.price_return)
    / (anchor.total_return * terminal.price_return) - 1;
  if (!Number.isFinite(value) || value < 0 || value > maximumYield) {
    return fail("yield_out_of_gate", `yield ${value} outside [0, ${maximumYield}]`);
  }

  const firstKnowableAt = terminal.date;
  return {
    ok: true,
    value,
    unit: "fraction",
    date: terminal.date,
    anchor_date: anchor.date,
    requested_as_of: requestedAsOf,
    lookback_days_target: lookbackDays,
    lookback_days_actual: daysBetween(anchor.date, terminal.date),
    observation_age_days: observationAgeDays,
    tier: "trailing_measured_index_yield",
    formula: "(T_t * P_s) / (T_s * P_t) - 1",
    source: `${provider}: ${totalReturnSeriesId}/${priceReturnSeriesId}`,
    consistency: "same tier as measured trailing SPX/NDX index yields",
    first_knowable_at: firstKnowableAt,
    first_knowable_basis: "latest aligned observation date; stored daily rows carry no intraday publication timestamp",
    source_clocks: {
      ...aligned.source_clocks,
      requested_as_of: requestedAsOf,
      used_observation: terminal.date,
      anchor_observation: anchor.date,
      first_knowable_at: firstKnowableAt,
      all_used_inputs_at_or_before: terminal.date,
    },
  };
}

// payout = trailing measured dividend yield * same-date price / FY1 EPS.
export function dividendYieldToPayout({
  dividendYield,
  price,
  epsFy1,
  maximumYield = INDEX_DIVIDEND_YIELD_DEFAULTS.maximumYield,
  maximumPayout = INDEX_DIVIDEND_YIELD_DEFAULTS.maximumPayout,
}) {
  if (!Number.isFinite(maximumYield) || maximumYield < 0) {
    return fail("invalid_yield_gate", `maximumYield must be nonnegative and finite; got ${maximumYield}`);
  }
  if (!Number.isFinite(maximumPayout) || maximumPayout < 0) {
    return fail("invalid_payout_gate", `maximumPayout must be nonnegative and finite; got ${maximumPayout}`);
  }
  if (!Number.isFinite(dividendYield) || dividendYield < 0 || dividendYield > maximumYield) {
    return fail("invalid_yield_input", `dividendYield ${dividendYield} outside [0, ${maximumYield}]`);
  }
  if (!Number.isFinite(price) || price <= 0) return fail("invalid_price", `price must be positive and finite; got ${price}`);
  if (!Number.isFinite(epsFy1) || epsFy1 <= 0) return fail("invalid_eps", `epsFy1 must be positive and finite; got ${epsFy1}`);

  const value = dividendYield * price / epsFy1;
  if (!Number.isFinite(value) || value < 0 || value > maximumPayout) {
    return fail("payout_out_of_gate", `payout ${value} outside [0, ${maximumPayout}]`);
  }
  return {
    ok: true,
    value,
    unit: "fraction",
    formula: "dividend_yield * price / eps_fy1",
    basis: "trailing_measured_index_dividends_over_forward_fy1_earnings",
  };
}
