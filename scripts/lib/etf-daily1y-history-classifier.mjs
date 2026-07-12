import { createHash } from "node:crypto";

const MS_PER_DAY = 86_400_000;

export const DAILY_1Y_HISTORY_EVIDENCE_POLICY = Object.freeze({
  min_rows: 20,
  min_density: 0.8,
  max_internal_gap_days: 15,
  max_latest_age_business_days: 10,
  cross_provider_start_tolerance_days: 7,
  declared_start_tolerance_days: 30,
  provider_truncation_days: 30,
  required_age_days: 365,
});

function dateOnlyUtc(value) {
  const parsed = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return null;
  if (typeof value === "string") {
    const literal = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (literal) {
      const literalDate = new Date(Date.UTC(
        Number(literal[1]),
        Number(literal[2]) - 1,
        Number(literal[3]),
      ));
      if (
        literalDate.getUTCFullYear() !== Number(literal[1])
          || literalDate.getUTCMonth() + 1 !== Number(literal[2])
          || literalDate.getUTCDate() !== Number(literal[3])
      ) return null;
    }
  }
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

export function parseDaily1yRowDate(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of ["date", "t", "time"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      const parsed = dateOnlyUtc(value);
      if (parsed) return parsed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = dateOnlyUtc(value > 10_000_000_000 ? value : value * 1000);
      if (parsed) return parsed;
    }
  }
  return null;
}

function isoDay(value) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function diffDays(left, right) {
  return Math.round((left.valueOf() - right.valueOf()) / MS_PER_DAY);
}

function businessDaysInclusive(start, end) {
  if (!start || !end || start > end) return 0;
  let count = 0;
  for (let cursor = start.valueOf(); cursor <= end.valueOf(); cursor += MS_PER_DAY) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function businessDaysAfter(start, end) {
  if (!start || !end || start > end) return null;
  let count = 0;
  for (let cursor = start.valueOf() + MS_PER_DAY; cursor <= end.valueOf(); cursor += MS_PER_DAY) {
    const weekday = new Date(cursor).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

export function daily1ySeriesEvidence(rows, now = new Date()) {
  const classificationDate = dateOnlyUtc(now);
  const dates = [...new Set((Array.isArray(rows) ? rows : [])
    .map(parseDaily1yRowDate)
    .filter(Boolean)
    .map((value) => value.valueOf()))]
    .sort((left, right) => left - right)
    .map((value) => new Date(value));
  const earliest = dates[0] ?? null;
  const latest = dates.at(-1) ?? null;
  const expectedTradingDays = businessDaysInclusive(earliest, latest);
  const observedTradingDays = dates.filter((value) => ![0, 6].includes(value.getUTCDay())).length;
  let maxInternalGapDays = 0;
  for (let index = 1; index < dates.length; index += 1) {
    maxInternalGapDays = Math.max(maxInternalGapDays, diffDays(dates[index], dates[index - 1]));
  }
  const latestAgeBusinessDays = businessDaysAfter(latest, classificationDate);
  const latestAgeDays = latest && classificationDate && latest <= classificationDate
    ? diffDays(classificationDate, latest)
    : null;
  const density = expectedTradingDays > 0
    ? Number(Math.min(1, observedTradingDays / expectedTradingDays).toFixed(6))
    : 0;
  const policy = DAILY_1Y_HISTORY_EVIDENCE_POLICY;
  const latestNotFuture = Boolean(latest && classificationDate && latest <= classificationDate);
  const evidencePass = Boolean(
    dates.length >= policy.min_rows
      && latestNotFuture
      && latestAgeBusinessDays != null
      && latestAgeBusinessDays <= policy.max_latest_age_business_days
      && density >= policy.min_density
      && maxInternalGapDays <= policy.max_internal_gap_days
  );
  return {
    row_count: Array.isArray(rows) ? rows.length : 0,
    valid_unique_date_count: dates.length,
    earliest_observation: isoDay(earliest),
    latest_observation: isoDay(latest),
    span_days: earliest && latest ? diffDays(latest, earliest) : null,
    expected_trading_days: expectedTradingDays,
    observed_trading_days: observedTradingDays,
    density,
    max_internal_gap_days: maxInternalGapDays,
    latest_observation_age_days: latestAgeDays,
    latest_observation_age_business_days: latestAgeBusinessDays,
    latest_not_future: latestNotFuture,
    evidence_pass: evidencePass,
  };
}

function parseOptionalDate(value) {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return dateOnlyUtc(value);
  if (typeof value === "string" && value.trim()) return dateOnlyUtc(value);
  return null;
}

function pendingStableObservation(pendingEntry, currentStart) {
  if (!currentStart || !pendingEntry || typeof pendingEntry !== "object") {
    return { confirmed: false, pinned_start: null };
  }
  const stableCount = Number(pendingEntry.stable_observation_count || 0);
  const storedStart = pendingEntry.confirmed_history_start_date
    ?? pendingEntry.short_history_evidence?.earliest_date
    ?? pendingEntry.observed_history_start_date
    ?? null;
  const stored = parseOptionalDate(storedStart);
  const current = parseOptionalDate(currentStart);
  const confirmed = Boolean(
    stableCount >= 2
      && stored
      && current
      && current >= stored
  );
  return {
    confirmed,
    pinned_start: confirmed ? isoDay(stored) : null,
  };
}

export function classifyDaily1yShortHistory({
  rows,
  yfRows = null,
  declaredInception = null,
  declaredInceptionSource = null,
  pendingEntry = null,
  now = new Date(),
  selfHistoryAuthoritative = false,
} = {}) {
  const policy = DAILY_1Y_HISTORY_EVIDENCE_POLICY;
  const classificationDate = dateOnlyUtc(now);
  const primary = daily1ySeriesEvidence(rows, classificationDate);
  const yf = daily1ySeriesEvidence(yfRows, classificationDate);
  const observedStart = parseOptionalDate(primary.earliest_observation);
  const latest = parseOptionalDate(primary.latest_observation);
  const declared = parseOptionalDate(declaredInception);
  const declaredValid = Boolean(declared && latest && declared <= latest);
  const declaredInvalidFuture = Boolean(declared && latest && declared > latest);
  const startDifferenceDays = declaredValid && observedStart ? diffDays(observedStart, declared) : null;
  const yfStart = parseOptionalDate(yf.earliest_observation);
  const crossProviderConfirmed = Boolean(
    primary.evidence_pass
      && yf.evidence_pass
      && observedStart
      && yfStart
      && Math.abs(diffDays(observedStart, yfStart)) <= policy.cross_provider_start_tolerance_days
  );
  const providerTruncationSuspected = Boolean(
    observedStart
      && yfStart
      && yf.valid_unique_date_count >= 200
      && diffDays(observedStart, yfStart) > policy.provider_truncation_days
  );
  const stableObservation = pendingStableObservation(pendingEntry, primary.earliest_observation);
  const stableObservationConfirmed = stableObservation.confirmed;
  const observationConfirmed = Boolean(
    selfHistoryAuthoritative
      || (primary.evidence_pass && (crossProviderConfirmed || stableObservationConfirmed))
  );
  const stablePinnedStart = parseOptionalDate(stableObservation.pinned_start);
  const confirmedObservationStart = stableObservationConfirmed
    ? stablePinnedStart
    : observedStart;
  const effectiveStart = declaredValid && confirmedObservationStart
    ? new Date(Math.max(declared.valueOf(), confirmedObservationStart.valueOf()))
    : (declaredValid ? declared : (observationConfirmed ? confirmedObservationStart : null));
  const effectiveAgeDays = effectiveStart && classificationDate
    ? Math.max(0, diffDays(classificationDate, effectiveStart))
    : null;

  let category = "fetchable";
  let reason = primary.span_days != null && primary.span_days >= policy.required_age_days
    ? "full_span_sparse_history"
    : "unconfirmed_short_history";
  let effectiveSource = null;

  if (providerTruncationSuspected) {
    reason = "provider_truncated_suspected";
  } else if (
    declaredValid
      && observedStart
      && Math.abs(startDifferenceDays) <= policy.declared_start_tolerance_days
      && effectiveAgeDays != null
      && effectiveAgeDays < policy.required_age_days
  ) {
    category = "inception_limited";
    reason = "inception_limited_declared";
    effectiveSource = declaredInceptionSource || "declared_inception";
  } else if (observationConfirmed && effectiveAgeDays != null && effectiveAgeDays < policy.required_age_days) {
    effectiveSource = crossProviderConfirmed
      ? "daily_1y_cross_provider_start"
      : (stableObservationConfirmed ? "daily_1y_stable_observation_start" : "daily_1y_history_start");
    if (declaredValid && startDifferenceDays > policy.declared_start_tolerance_days) {
      category = "terminal_limited";
      reason = "provider_history_start_limited";
    } else {
      category = "inception_limited";
      reason = "inception_limited_observation_derived";
    }
  }

  return {
    category,
    classification_reason: reason,
    declared_inception_date: isoDay(declared),
    declared_inception_source: declaredInceptionSource,
    declared_inception_source_field: declaredInceptionSource,
    declared_inception_valid: declaredValid,
    declared_inception_invalid_future: declaredInvalidFuture,
    effective_start_date: isoDay(effectiveStart),
    effective_start_source: effectiveSource,
    provider_truncation_suspected: providerTruncationSuspected,
    cross_provider_start_confirmed: crossProviderConfirmed,
    stable_observation_confirmed: stableObservationConfirmed,
    stable_observation_pinned_start: stableObservation.pinned_start,
    daily_1y_row_count: primary.row_count,
    daily_1y_valid_unique_date_count: primary.valid_unique_date_count,
    daily_1y_earliest_observation: primary.earliest_observation,
    daily_1y_latest_observation: primary.latest_observation,
    daily_1y_span_days: primary.span_days,
    daily_1y_expected_trading_days: primary.expected_trading_days,
    daily_1y_density: primary.density,
    daily_1y_max_internal_gap_days: primary.max_internal_gap_days,
    latest_observation_age_days: primary.latest_observation_age_days,
    latest_observation_age_business_days: primary.latest_observation_age_business_days,
    daily_1y_evidence_pass: primary.evidence_pass,
    yf_crosscheck_rows: yf.row_count,
    yf_crosscheck_earliest: yf.earliest_observation,
    yf_crosscheck_latest: yf.latest_observation,
    yf_crosscheck_density: yf.density,
    classification_as_of: now instanceof Date && Number.isFinite(now.valueOf()) ? now.toISOString() : null,
    policy: DAILY_1Y_HISTORY_EVIDENCE_POLICY,
  };
}

export function daily1yClassificationProjection({
  complete = [],
  fetchable = [],
  inceptionLimited = [],
  terminalLimited = [],
} = {}) {
  const project = (rows, bucket) => (Array.isArray(rows) ? rows : []).map((row) => ({
    ticker: String(row?.ticker || "").trim().toUpperCase(),
    bucket,
    reason: (bucket === "terminal_limited" ? row?.terminal_limit_source : row?.classification_reason)
      ?? row?.classification_reason
      ?? row?.terminal_limit_source
      ?? row?.daily_1y_gap_source
      ?? bucket,
  }));
  const rows = [
    ...project(complete, "complete"),
    ...project(fetchable, "fetchable"),
    ...project(inceptionLimited, "inception_limited"),
    ...project(terminalLimited, "terminal_limited"),
  ].sort((left, right) => left.ticker.localeCompare(right.ticker) || left.bucket.localeCompare(right.bucket));
  const reasonCounts = {};
  for (const row of rows) {
    reasonCounts[row.reason] = (reasonCounts[row.reason] || 0) + 1;
  }
  const canonical = `${JSON.stringify(rows)}\n`;
  return {
    row_count: rows.length,
    sha256: createHash("sha256").update(canonical).digest("hex"),
    reason_counts: Object.fromEntries(Object.entries(reasonCounts).sort()),
  };
}
