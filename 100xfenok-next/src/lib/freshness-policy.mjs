/**
 * Freshness policy by cadence — one pure module shared by the app and scripts.
 *
 * Age = whole days from the data's own as-of date to "today" in KST.
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
 * Trading-day math counts weekends only (Saturday/Sunday are skipped; holiday
 * calendars are a later slice) and clamps at zero for future dates.
 *
 * The Yardeni family inherits the benchmarks cadence (owner weekly), not its
 * Saturday workflow.
 */

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

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
});

export function todayKST(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

export function dateOnly(value) {
  const match = typeof value === "string" ? DATE_RE.exec(value.trim()) : null;
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
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
  let days = 0;
  for (let ms = utcMs(asOf) + DAY_MS; ms <= utcMs(today); ms += DAY_MS) {
    const day = new Date(ms).getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

export function resolveFamilyPolicy(family) {
  if (!family) return null;
  if (typeof family === "string") return FAMILY_POLICY[family] ?? null;
  if (typeof family === "object" && typeof family.cadence === "string") return family;
  return null;
}

export function freshnessVerdict(asOf, family, today = todayKST()) {
  const policy = resolveFamilyPolicy(family);
  const unknown = {
    state: "unknown",
    ageDays: null,
    supplier: policy?.supplier ?? null,
    cadence: policy?.cadence ?? null,
  };
  if (!policy) return unknown;
  const asOfDate = dateOnly(asOf);
  const todayDate = dateOnly(today);
  if (!asOfDate || !todayDate) return unknown;
  const klass = FRESHNESS_CLASSES[policy.cadence] ?? FRESHNESS_CLASSES.weekly;
  const trading = klass.tradingDays
    || policy.calendar === "us_trading"
    || policy.calendar === "kr_trading";
  const ageDays = trading ? ageInTradingDays(asOfDate, todayDate) : ageInDays(asOfDate, todayDate);
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
