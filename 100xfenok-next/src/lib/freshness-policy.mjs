/**
 * Freshness policy by cadence — one pure module shared by the app and scripts.
 *
 * Age = whole days from the data's own as-of date to the policy's civil date:
 * US calendars use New York, KR calendars use Seoul, calendar-day families UTC.
 * Families declare: cadence (daily | weekly | monthly | quarterly | annual),
 * releaseLagDays (source-specific), supplier ("owner" | "automated") and
 * calendar ("us_trading" | "kr_trading" | "calendar").
 *
 * Bands (age in days):
 *   fresh   : age <= cycle + releaseLag + grace
 *   delayed : age <= 2*cycle + releaseLag + grace   (one edition missed)
 *   stopped : beyond that                           (two or more missed)
 *
 * Grace by class: daily 1 trading day, weekly 4, monthly 15, quarterly 30,
 * annual 60. Weekly owner files: 7 + 2 + 4 -> fresh <= 13 days, delayed
 * 14-20, stopped >= 21 ("two weeks = delayed").
 *
 * Market-day math uses the shared 2026 market calendar. Unknown or future
 * source dates never produce a fresh verdict.
 *
 * The Yardeni family inherits the benchmarks cadence (owner weekly), not its
 * Saturday workflow.
 */

import { businessDayAge, businessDayAgeWithCalendar, isRealCalendarDate } from "./market-calendar.mjs";

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const FRESHNESS_CLASSES = Object.freeze({
  daily: Object.freeze({ cycleDays: 1, graceDays: 1, tradingDays: true }),
  weekly: Object.freeze({ cycleDays: 7, graceDays: 4, tradingDays: false }),
  monthly: Object.freeze({ cycleDays: 30, graceDays: 15, tradingDays: false }),
  quarterly: Object.freeze({ cycleDays: 91, graceDays: 30, tradingDays: false }),
  annual: Object.freeze({ cycleDays: 365, graceDays: 60, tradingDays: false }),
});

export const FAMILY_POLICY = Object.freeze({
  benchmarks: Object.freeze({
    cadence: "weekly",
    releaseLagDays: 2,
    supplier: "owner",
    calendar: "calendar",
    label: "Bloomberg benchmark payloads",
  }),
  global_scouter: Object.freeze({
    cadence: "weekly",
    releaseLagDays: 2,
    supplier: "owner",
    calendar: "calendar",
    label: "Global Scouter export",
  }),
  fred_yardeni: Object.freeze({
    cadence: "weekly",
    releaseLagDays: 2,
    supplier: "owner",
    calendar: "calendar",
    label: "Yardeni model (content derives from benchmarks)",
  }),
  damodaran: Object.freeze({
    cadence: "annual",
    releaseLagDays: 31,
    supplier: "automated",
    calendar: "calendar",
    label: "Damodaran historical ERP",
  }),
  treasury_tga: Object.freeze({
    cadence: "daily", releaseLagDays: 1, supplier: "automated",
    calendar: "us_federal_business", label: "Treasury TGA",
  }),
  krx: Object.freeze({
    cadence: "daily", releaseLagDays: 0, supplier: "automated",
    calendar: "kr_trading", label: "KRX Open API daily",
  }),
  oecd_cli: Object.freeze({
    cadence: "monthly", releaseLagDays: 0, supplier: "automated",
    calendar: "calendar", sourceAnchor: "month_end", label: "OECD CLI monthly",
  }),
  finra_ats_weekly: Object.freeze({
    cadence: "weekly", releaseLagDays: 28, supplier: "automated",
    calendar: "calendar", sourceAnchor: "week_end", label: "FINRA ATS weekly",
  }),
  earnings_overview: Object.freeze({
    cadence: "quarterly", releaseLagDays: 45, supplier: "automated",
    calendar: "calendar", label: "SEC earnings period end",
  }),
});

// Each FRED banking file has a different publication clock. In particular,
// BOGZ1FL010000016Q is published on a slower Financial Stability schedule:
// https://fred.stlouisfed.org/series/BOGZ1FL010000016Q . The 180-day lag is
// a conservative bounded product policy, not a provider-published SLA.
export const FRED_BANKING_FILE_POLICY = Object.freeze({
  fred_banking_daily: Object.freeze({ cadence: "daily", releaseLagDays: 1, supplier: "automated", calendar: "us_trading", label: "FRED banking daily" }),
  fred_banking_weekly: Object.freeze({ cadence: "weekly", releaseLagDays: 9, supplier: "automated", calendar: "calendar", label: "FRED H.8 weekly" }),
  // IRLTLT01KRM156N records August as Aug 1 and was updated Sep 15:
  // https://fred.stlouisfed.org/series/IRLTLT01KRM156N
  fred_banking_monthly: Object.freeze({ cadence: "monthly", releaseLagDays: 0, supplier: "automated", calendar: "calendar", sourceAnchor: "month_end", label: "FRED banking monthly" }),
  fred_banking_quarterly: Object.freeze({ cadence: "quarterly", releaseLagDays: 180, supplier: "automated", calendar: "calendar", sourceAnchor: "quarter_end", label: "FRED banking quarterly" }),
});

const FRED_FILE_FROM_PATH = Object.freeze({
  "/data/macro/fred-banking-daily.json": "fred_banking_daily",
  "/data/macro/fred-banking-weekly.json": "fred_banking_weekly",
  "/data/macro/fred-banking-monthly.json": "fred_banking_monthly",
  "/data/macro/fred-banking-quarterly.json": "fred_banking_quarterly",
});

/** Registry cadence is the default; only source-specific semantics override it. */
export function resolveSourcePolicy({ laneId, cadence, artifactId, path, calendar } = {}) {
  const fileId = artifactId ?? FRED_FILE_FROM_PATH[path];
  if (fileId && FRED_BANKING_FILE_POLICY[fileId]) return FRED_BANKING_FILE_POLICY[fileId];
  if (laneId && FAMILY_POLICY[laneId]) return FAMILY_POLICY[laneId];
  if (!FRESHNESS_CLASSES[cadence]) return null;
  return { cadence, releaseLagDays: 0, supplier: "automated", calendar: calendar === "us_trading" || calendar === "kr_trading" ? calendar : "calendar" };
}

export function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

export function policyToday(now, policy) {
  const zone = policy?.calendar === "us_federal_business" || policy?.calendar === "us_trading"
    ? "America/New_York" : policy?.calendar === "kr_trading" ? "Asia/Seoul" : "UTC";
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(now));
}

export function dateOnly(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const day = text.slice(0, 10);
  if (!isRealCalendarDate(day)) return null;
  if (DATE_RE.test(text)) return day;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
    && Number.isFinite(Date.parse(text)) ? day : null;
}

function utcMs(date) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function ageInDays(asOf, today) {
  const days = Math.round((utcMs(today) - utcMs(asOf)) / DAY_MS);
  return days > 0 ? days : 0;
}

export function ageInTradingDays(asOf, today) {
  return businessDayAge(asOf, today, "us_market");
}

export function sourceAgeAnchor(asOf, policy) {
  const day = dateOnly(asOf);
  if (!day) return null;
  if (policy?.sourceAnchor === "week_end") {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return new Date(utcMs(day) + ((7 - weekday) % 7) * DAY_MS).toISOString().slice(0, 10);
  }
  if (policy?.sourceAnchor === "month_end" || policy?.sourceAnchor === "quarter_end") {
    const [year, month] = day.split("-").map(Number);
    const endMonth = policy.sourceAnchor === "quarter_end" ? Math.ceil(month / 3) * 3 : month;
    return new Date(Date.UTC(year, endMonth, 0)).toISOString().slice(0, 10);
  }
  return day;
}

export function resolveFamilyPolicy(family) {
  if (!family) return null;
  if (typeof family === "string") return FAMILY_POLICY[family] ?? null;
  if (typeof family === "object" && typeof family.cadence === "string") return family;
  return null;
}

export function freshnessVerdict(asOf, family, today, { calendars = null } = {}) {
  const policy = resolveFamilyPolicy(family);
  const unknown = {
    state: "unknown",
    ageDays: null,
    supplier: policy?.supplier ?? null,
    cadence: policy?.cadence ?? null,
  };
  if (!policy) return unknown;
  const asOfDate = dateOnly(asOf);
  const todayDate = dateOnly(today === undefined ? policyToday(new Date(), policy) : today);
  if (!asOfDate || !todayDate || asOfDate > todayDate) return unknown;
  const klass = FRESHNESS_CLASSES[policy.cadence];
  if (!klass) return unknown;
  const anchor = sourceAgeAnchor(asOfDate, policy);
  if (!anchor || anchor > todayDate) return unknown;
  let ageDays;
  if (policy.calendar === "us_trading" || policy.calendar === "kr_trading") {
    ageDays = businessDayAge(anchor, todayDate, policy.calendar === "us_trading" ? "us_market" : "krx_market");
  } else if (policy.calendar === "us_federal_business") {
    const federal = calendars?.calendars?.find((row) => row.id === "us_federal_business");
    ageDays = businessDayAgeWithCalendar(anchor, todayDate, federal);
  } else if (policy.calendar === "calendar") {
    ageDays = ageInDays(anchor, todayDate);
  } else return unknown;
  if (!Number.isFinite(ageDays)) return unknown;
  const releaseLag = Number.isFinite(policy.releaseLagDays) ? policy.releaseLagDays : 0;
  const freshLimit = klass.cycleDays + releaseLag + klass.graceDays;
  const delayedLimit = 2 * klass.cycleDays + releaseLag + klass.graceDays;
  const state = ageDays <= freshLimit ? "fresh" : ageDays <= delayedLimit ? "delayed" : "stopped";
  return { state, ageDays, supplier: policy.supplier, cadence: policy.cadence };
}

/** Korean user-visible wording; null while fresh/unknown so callers show nothing new. */
export function freshnessMessage(verdict) {
  if (!verdict || verdict.state === "fresh" || verdict.state === "unknown") return null;
  const owner = verdict.supplier === "owner";
  if (verdict.state === "delayed") return owner ? "이번 주 자료 대기" : "수집 지연";
  return owner ? "2주 넘게 새 자료 없음" : "수집 멈춤";
}

/**
 * EvidenceRail mapping (DEC-417): fresh -> { freshness: "fresh", label: null };
 * delayed -> { freshness: "stale", label } (amber); stopped ->
 * { freshness: "error", label } (red); unknown -> null (caller logic stays in
 * charge). The label carries the verdict's own wording; rails render it via
 * EvidenceRail's stateLabel.
 */
export function freshnessRailState(verdict) {
  if (!verdict || verdict.state === "unknown") return null;
  if (verdict.state === "delayed") return { freshness: "stale", label: freshnessMessage(verdict) };
  if (verdict.state === "stopped") return { freshness: "error", label: freshnessMessage(verdict) };
  return { freshness: "fresh", label: null };
}

/**
 * The age verdict may only make a state WORSE, never better: the rail override
 * when it is stale/error, else null so the caller's original chain (LKG,
 * partial, fixed) stays byte-for-byte in charge.
 */
export function freshnessAgeOverride(verdict) {
  const rail = freshnessRailState(verdict);
  return rail && rail.freshness !== "fresh" ? rail : null;
}
