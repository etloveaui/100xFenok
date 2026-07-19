// Single source of truth for the ETF history-gap report's recommended_dispatch.status
// vocabulary. The generator (report-stockanalysis-history-gap.mjs) EMITS these values; the
// audit checker (check-stockanalysis-market-audit.mjs) MATCHES against them. Keeping the
// enum in one leaf module (zero imports) prevents the owner_gated/scheduled_backfill_active
// drift that dead-lettered the daily_1y-continuity carve-out. Any status in the report that
// is not in this set is treated as a hard error so vocabulary drift becomes loud.
export const DISPATCH_STATUS = Object.freeze({
  MANUAL_DISPATCH_RECOMMENDED: "manual_dispatch_recommended",
  SCHEDULED_BACKFILL_ACTIVE: "scheduled_backfill_active",
  NOT_RECOMMENDED: "not_recommended",
});

export const DISPATCH_STATUS_VALUES = new Set(Object.values(DISPATCH_STATUS));

const DAILY_1Y_INPUTS = Object.freeze({
  history_gaps_only: "true",
  required_history_periods: "daily_1y",
  incremental_etf_limit: "100",
});

function scheduledDaily1yDispatch() {
  return {
    status: DISPATCH_STATUS.SCHEDULED_BACKFILL_ACTIVE,
    workflow: "fetch-stockanalysis.yml",
    schedule: "50 22 * * 1-5",
    schedule_kst: "Tue-Sat 07:50",
    inputs: { ...DAILY_1Y_INPUTS, incremental_etf_limit: "120" },
    note: "The weekday scheduled lane drains ETF daily 1Y required-history gaps at 120 per run. Manual reruns remain owner-gated and this diagnostic lane is not the ETF service gate.",
  };
}

function buildExplicitDaily1yDispatchPlan(tickers, shardSize = 100) {
  const normalizedTickers = [];
  const seen = new Set();
  for (const rawTicker of Array.isArray(tickers) ? tickers : []) {
    const ticker = String(rawTicker || "").trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    normalizedTickers.push(ticker);
  }
  const shards = [];
  for (let offset = 0; offset < normalizedTickers.length; offset += shardSize) {
    const shardTickers = normalizedTickers.slice(offset, offset + shardSize);
    shards.push({
      shard: shards.length + 1,
      ticker_count: shardTickers.length,
      inputs: {
        ...DAILY_1Y_INPUTS,
        etfs: shardTickers.join(","),
      },
    });
  }
  return {
    status: normalizedTickers.length > 0 ? "ready" : "missing_exact_tickers",
    selection: "explicit full-primary daily_1y fetchable tickers; not the scored-ETF scheduled plan",
    single_writer: true,
    shard_size: shardSize,
    ticker_count: normalizedTickers.length,
    shard_count: shards.length,
    shards,
  };
}

export function buildHistoryGapRecommendedDispatch({
  fetchableRequiredHistory = 0,
  fetchableTickers = [],
  requiredHistoryPeriods = [],
  scoredDaily1yFetchable = 0,
} = {}) {
  const periods = Array.isArray(requiredHistoryPeriods) ? requiredHistoryPeriods : [];
  const requiredHistoryKey = periods.join(",");
  const hasFetchableRequiredHistory = Number(fetchableRequiredHistory) > 0;

  if (hasFetchableRequiredHistory && requiredHistoryKey === "daily_1y") {
    return {
      status: DISPATCH_STATUS.MANUAL_DISPATCH_RECOMMENDED,
      workflow: "fetch-stockanalysis.yml",
      inputs: { ...DAILY_1Y_INPUTS },
      dispatch_plan: buildExplicitDaily1yDispatchPlan(fetchableTickers),
      note: "Full-primary daily 1Y gaps are outside the exact scored-ETF scheduled plan. Use only the explicit single-writer shards after owner approval; no dispatch has been run.",
    };
  }

  if (hasFetchableRequiredHistory) {
    return {
      status: DISPATCH_STATUS.MANUAL_DISPATCH_RECOMMENDED,
      workflow: "fetch-stockanalysis.yml",
      inputs: {
        history_gaps_only: "true",
        required_history_periods: requiredHistoryKey,
        incremental_etf_limit: "120",
      },
      note: "Default multi-year required-history gaps are not the daily 1Y scheduled catch-up lane; external manual dispatch still requires explicit owner approval.",
    };
  }

  if (Number(scoredDaily1yFetchable) > 0) {
    return scheduledDaily1yDispatch();
  }

  return {
    status: DISPATCH_STATUS.NOT_RECOMMENDED,
    workflow: "fetch-stockanalysis.yml",
    inputs: null,
    note: "No current scored ETF daily 1Y gap is immediately fetchable. Remaining gaps are inception-limited or recent terminal provider-limited states that the scheduled lane will revisit as they age or cooldown expires.",
  };
}
