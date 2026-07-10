/**
 * Market calendar SSOT for KPI v2 source SLA freshness.
 *
 * Provides us_market / krx_market business-day walkback plus calendar-day and
 * wall-clock-hour age helpers so the builder and the checker share one exact
 * definition of "how stale is this source date".
 *
 * Phase A scope: fixed 2026 holiday lists are sufficient. The business-day
 * logic duplicated in fetch-fenok-occ-options-volume.mjs / build-fenok-flow-proxies.mjs
 * is not migrated in this wave (opportunistic per contract §5). Thresholds and
 * holiday lists are tunable constants.
 */

export const calendar_version = "market-calendar/v1-2026";

// US equity market full-day closures, 2026 (observed dates).
export const US_MARKET_HOLIDAYS_2026 = Object.freeze([
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed, Jul 4 is Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
]);

// KRX full-day closures, 2026 (includes substitute holidays).
export const KRX_MARKET_HOLIDAYS_2026 = Object.freeze([
  "2026-01-01", // New Year's Day
  "2026-02-16", // Seollal holiday
  "2026-02-17", // Seollal
  "2026-02-18", // Seollal holiday
  "2026-03-02", // Independence Movement Day (substitute, Mar 1 is Sunday)
  "2026-05-01", // Labour Day (KRX closed)
  "2026-05-05", // Children's Day
  "2026-05-25", // Buddha's Birthday (substitute, May 24 is Sunday)
  "2026-08-17", // Liberation Day (substitute, Aug 15 is Saturday)
  "2026-09-24", // Chuseok holiday
  "2026-09-25", // Chuseok
  "2026-09-26", // Chuseok holiday
  "2026-10-05", // National Foundation Day (substitute, Oct 3 is Saturday)
  "2026-10-09", // Hangeul Day
  "2026-12-25", // Christmas Day
  "2026-12-31", // Year-end market closure
]);

const HOLIDAYS = {
  us_market: new Set(US_MARKET_HOLIDAYS_2026),
  krx_market: new Set(KRX_MARKET_HOLIDAYS_2026),
};

export function isoDateOf(value) {
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function toUtcDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`);
}

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, delta) {
  const date = toUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoFromDate(date);
}

export function isWeekend(isoDate) {
  const day = toUtcDate(isoDate).getUTCDay();
  return day === 0 || day === 6;
}

export function isHoliday(isoDate, market) {
  const set = HOLIDAYS[market];
  return Boolean(set && set.has(isoDate));
}

export function isBusinessDay(isoDate, market) {
  return !isWeekend(isoDate) && !isHoliday(isoDate, market);
}

/**
 * Number of market business days elapsed since sourceDate up to nowDate.
 * sourceDate == nowDate -> 0. Counts business days d with sourceDate < d <= nowDate.
 * Future source dates clamp to 0.
 */
export function businessDayAge(sourceValue, nowValue, market) {
  const source = isoDateOf(sourceValue);
  const now = isoDateOf(nowValue);
  if (!source || !now) return null;
  if (now <= source) return 0;
  let count = 0;
  let cursor = source;
  while (cursor < now) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor, market)) count += 1;
  }
  return count;
}

/**
 * ISO date that is `n` market business days before fromValue (walkback).
 * n = 0 walks back to the nearest business day <= fromValue.
 */
export function walkbackBusinessDays(fromValue, n, market) {
  let cursor = isoDateOf(fromValue);
  if (!cursor) return null;
  while (!isBusinessDay(cursor, market)) cursor = addDays(cursor, -1);
  let remaining = Number(n) || 0;
  while (remaining > 0) {
    cursor = addDays(cursor, -1);
    if (isBusinessDay(cursor, market)) remaining -= 1;
  }
  return cursor;
}

/** Calendar-day age (floor), source date to now date. Future clamps to 0. */
export function calendarDayAge(sourceValue, nowValue) {
  const source = isoDateOf(sourceValue);
  const now = isoDateOf(nowValue);
  if (!source || !now) return null;
  const diff = Math.floor((toUtcDate(now).getTime() - toUtcDate(source).getTime()) / 86400000);
  return Math.max(0, diff);
}

/** Wall-clock hour age between an ISO timestamp and now. Future clamps to 0. */
export function hoursAge(sourceTimestamp, nowValue) {
  const text = String(sourceTimestamp ?? "").trim();
  if (!text) return null;
  const time = new Date(text).getTime();
  const now = new Date(nowValue).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(now)) return null;
  return Math.max(0, Number(((now - time) / 3600000).toFixed(2)));
}

/**
 * Is the source strictly in the future relative to now? Age helpers clamp future
 * to 0 (which would read as "fresh"); callers must flag this anomaly rather than
 * silently trust a future-dated source (contract §5 fail-closed).
 */
export function isFutureSource(sourceValue, nowValue, unit) {
  if (sourceValue == null) return false;
  if (unit === "hours") {
    const s = new Date(sourceValue).getTime();
    const n = new Date(nowValue).getTime();
    return Number.isFinite(s) && Number.isFinite(n) && s > n;
  }
  const s = isoDateOf(sourceValue);
  const n = isoDateOf(nowValue);
  return Boolean(s && n && s > n);
}
