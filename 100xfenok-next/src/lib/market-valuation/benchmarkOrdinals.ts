// Reading rule for the benchmark ordinal layer of /market-valuation.
//
// The 2026-08 redesign splits the page into a cardinal axis (methodology
// levels, owned by methodologyAxis.ts) and this ordinal layer: where each
// index sits in its OWN history. Ordinal claims need no fair-value model, so
// they carry the verdict weight wherever methods disagree — which is why the
// reading rule is strict:
//
// - Every as-of date comes from the ROWS, never from an envelope stamp. The
//   producers' `metadata.generated` / `metadata.version` already disagree
//   with the newest observation (sections in one file carry different last
//   dates), so a badge keyed on the envelope would print the wrong day.
// - Percentile follows the page's existing convention (strict below / length,
//   rounded), NOT the deleted admin lab's copy: one convention per surface.
// - Nothing here renders a verdict. It returns ranks; tone and traffic
//   lights are the caller's decision and stay visible as such.

export const BENCHMARK_ORDINAL_MIN_HISTORY = 52;

/**
 * Trailing windows added to the forward-PE reading (owner ruling 2026-08-06):
 * 3y / 5y / 10y, each trailing from the section's OWN as-of date, plus the
 * existing all-history percentile. A window whose data does not span its full
 * requested length is REFUSED (percentile null, truncated true, spanYears
 * states the actual span) — missing is missing; the all-history percentile is
 * never substituted and the window is never silently shortened.
 */
export const BENCHMARK_ORDINAL_WINDOWS = [
  { id: "w3", years: 3 },
  { id: "w5", years: 5 },
  { id: "w10", years: 10 },
] as const;

export type BenchmarkWindowId = (typeof BENCHMARK_ORDINAL_WINDOWS)[number]["id"];

export type BenchmarkOrdinalHorizon = "all" | "w5" | "w10";

export const BENCHMARK_ORDINAL_GROUPS = [
  { id: "us", file: "/data/benchmarks/us.json", label: "미국 지수" },
  { id: "us_sectors", file: "/data/benchmarks/us_sectors.json", label: "미국 섹터" },
  { id: "developed", file: "/data/benchmarks/developed.json", label: "선진국" },
  { id: "emerging", file: "/data/benchmarks/emerging.json", label: "신흥국" },
  { id: "msci", file: "/data/benchmarks/msci.json", label: "MSCI" },
  { id: "micro_sectors", file: "/data/benchmarks/micro_sectors.json", label: "마이크로 섹터" },
] as const;

export type BenchmarkGroupId = (typeof BENCHMARK_ORDINAL_GROUPS)[number]["id"];

/** One metric read against the section's own history. */
export interface OrdinalMetric {
  current: number | null;
  /**
   * Age in days of the row behind `current`, when known. Non-null with a null
   * `current` means the series stopped: the last computable value was this
   * many days before the as-of date and is deliberately NOT shown.
   */
  currentStaleDays: number | null;
  /** Percentile rank of `current` within the history (0–100), rounded. */
  percentile: number | null;
  /** Arithmetic mean of the same accepted history used for the percentile. */
  average: number | null;
  /** Population z-score of `current` within the history. */
  zScore: number | null;
  /**
   * Trailing-window percentiles of `current` (3y/5y/10y from the section's own
   * as-of). A window that cannot span its full length carries percentile null,
   * truncated true and the ACTUAL span in spanYears — never a substituted or
   * silently shortened number.
   */
  windows: Record<BenchmarkWindowId, WindowedMetric>;
}

/** One trailing window's reading of the metric. */
export interface WindowedMetric {
  /** Percentile of `current` within the window (same strict-below definition); null when the window is refused or the history is too short to rank. */
  percentile: number | null;
  /** Arithmetic mean of the same accepted window population; null when refused or too short. */
  average: number | null;
  /** True when the section's data does not reach back the full window length. */
  truncated: boolean;
  /** Actual data span behind the window in years (asOf − earliest dated row), rounded to 1 decimal; equals the requested length when not truncated. */
  spanYears: number | null;
  /** Observations inside the window (PE rows strictly after asOf − window, at or before asOf). */
  points: number;
}

export interface BenchmarkOrdinalRow {
  id: string;
  groupId: BenchmarkGroupId;
  name: string;
  nameEn: string | null;
  /** Last ROW date in the section — never an envelope stamp. */
  asOf: string | null;
  price: number | null;
  /** Forward P/E (best_pe_ratio) vs own history. */
  pe: OrdinalMetric;
  /** P/B (px_to_book_ratio) vs own history. */
  pb: OrdinalMetric;
  /** ROE (fraction) vs own history. Higher is better; inverting is UI work. */
  roe: OrdinalMetric;
  /** 1/PE at the latest observation; null when PE is absent or zero. */
  earningsYield: number | null;
  /**
   * Sector PE / SPX PE − 1 at the SAME observation date. Only sector rows
   * carry it; null everywhere else and whenever the SPX base lacks that date.
   */
  spxPremium: number | null;
  /** Observation count behind the percentile (0 when the section is empty). */
  points: number;
}

export interface BenchmarkOrdinalGroup {
  id: BenchmarkGroupId;
  label: string;
  /** Conservative: the oldest last-row date among the group's sections. */
  asOf: string | null;
  /** Non-null when the whole group failed the reading rule. */
  refusal: string | null;
  rows: BenchmarkOrdinalRow[];
}

export type BenchmarkOrdinalsView =
  | { status: "ready"; groups: BenchmarkOrdinalGroup[]; asOf: string | null }
  | { status: "refused"; reason: string };

export interface BenchmarkHorizonReading {
  percentile: number | null;
  average: number | null;
  points: number;
  truncated: boolean;
  spanYears: number | null;
}

interface RawRow {
  date?: unknown;
  px_last?: unknown;
  best_pe_ratio?: unknown;
  px_to_book_ratio?: unknown;
  roe?: unknown;
}

interface RawSection {
  name?: unknown;
  name_en?: unknown;
  data?: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A real calendar day, not a shape: the regex alone accepts 2026-02-31.
function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

/** Page convention: strict below / length × 100, rounded. */
export function percentileRank(series: readonly number[], current: number | null): number | null {
  if (current === null || series.length === 0) return null;
  let below = 0;
  for (const value of series) {
    if (value < current) below += 1;
  }
  return Math.round((below / series.length) * 100);
}

/** Population z-score; null when the history has no spread. */
export function zScorePopulation(series: readonly number[], current: number | null): number | null {
  if (current === null || series.length === 0) return null;
  let sum = 0;
  for (const value of series) sum += value;
  const mean = sum / series.length;
  let squared = 0;
  for (const value of series) squared += (value - mean) * (value - mean);
  const std = Math.sqrt(squared / series.length);
  if (std === 0) return null;
  return (current - mean) / std;
}

function arithmeticMean(series: readonly number[]): number | null {
  if (series.length === 0) return null;
  let sum = 0;
  for (const value of series) sum += value;
  return sum / series.length;
}

function lastFinite(values: readonly number[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

/**
 * The current value must be CURRENT. `lastFinite` walks back until it finds a
 * number, which is right for a one-week gap and wrong for a series that stopped
 * years ago: us_biotech's forward PE last computed on 2011-03-18 because the
 * sector's forward EPS is now negative, and the panel was printing that 2011
 * multiple as today's. A stale value is worse than an absent one - the reader
 * cannot tell it is stale.
 *
 * Returns the last finite value only when its own row is within
 * CURRENT_VALUE_MAX_STALE_DAYS of the section's as-of date, and reports how
 * stale it actually is so the surface can say why the cell is empty.
 */
const CURRENT_VALUE_MAX_STALE_DAYS = 45;

function lastFreshFinite(
  values: readonly number[],
  dates: readonly (string | null)[],
  asOfMs: number | null,
): { value: number | null; staleDays: number | null } {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (!Number.isFinite(values[i])) continue;
    const iso = dates[i];
    if (asOfMs === null || typeof iso !== "string") return { value: values[i], staleDays: null };
    const ageDays = (asOfMs - msOfDay(iso)) / 86_400_000;
    if (ageDays <= CURRENT_VALUE_MAX_STALE_DAYS) return { value: values[i], staleDays: Math.round(ageDays) };
    return { value: null, staleDays: Math.round(ageDays) };
  }
  return { value: null, staleDays: null };
}

const YEAR_MS = 365.25 * 86_400_000;
const msOfDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * Trailing-window percentile, computed from the DATA per index per window:
 * the window holds the section's PE rows strictly after (asOf − window) and at
 * or before asOf; the requested length is compared against the section's
 * EARLIEST dated row — a window whose data cannot span its full length is
 * refused (percentile null) and reports the ACTUAL span instead. This is never
 * a hard-coded list: a new section or a backfill re-derives the refusal on its
 * own.
 */
export function windowedMetricFromRows(
  rows: readonly RawRow[],
  asOfMs: number,
  years: number,
  current: number | null,
): WindowedMetric {
  const windowStartMs = asOfMs - years * YEAR_MS;
  // The window's DATA is the PE series: the span held is measured from the
  // earliest FINITE PE observation, not from the section's first dated row —
  // a section can carry rows back to 2010 while its forward-PE history starts
  // in 2016, and the window must refuse on the metric's own span.
  let peDataStartMs: number | null = null;
  const windowValues: number[] = [];
  for (const row of rows) {
    if (!isIsoDay(row.date)) continue;
    if (!isFiniteNumber(row.best_pe_ratio)) continue;
    const rowMs = msOfDay(row.date);
    if (peDataStartMs === null || rowMs < peDataStartMs) peDataStartMs = rowMs;
    if (rowMs > windowStartMs && rowMs <= asOfMs) {
      windowValues.push(row.best_pe_ratio);
    }
  }
  const truncated = peDataStartMs !== null && peDataStartMs > windowStartMs;
  const spanYears = truncated && peDataStartMs !== null ? (asOfMs - peDataStartMs) / YEAR_MS : years;
  const enough = windowValues.length >= BENCHMARK_ORDINAL_MIN_HISTORY;
  return {
    percentile: truncated || !enough ? null : percentileRank(windowValues, current),
    average: truncated || !enough ? null : arithmeticMean(windowValues),
    truncated,
    spanYears: Math.round(spanYears * 10) / 10,
    points: windowValues.length,
  };
}

function windowedMetrics(rows: readonly RawRow[], asOfMs: number, current: number | null): Record<BenchmarkWindowId, WindowedMetric> {
  return Object.fromEntries(
    BENCHMARK_ORDINAL_WINDOWS.map((w) => [w.id, windowedMetricFromRows(rows, asOfMs, w.years, current)]),
  ) as Record<BenchmarkWindowId, WindowedMetric>;
}

function metricFromSeries(
  values: readonly number[],
  dates: readonly (string | null)[] = [],
  asOfMs: number | null = null,
): OrdinalMetric {
  const clean = values.filter(isFiniteNumber);
  const fresh = lastFreshFinite(values, dates, asOfMs);
  const current = fresh.value;
  const enough = clean.length >= BENCHMARK_ORDINAL_MIN_HISTORY;
  // Windows are computed for the forward-PE metric only (owner ruling scope:
  // the 38-index forward-PE panel). pb/roe carry an explicit "not computed"
  // placeholder — spanYears null, never a fake number.
  const notComputed = (): WindowedMetric => ({ percentile: null, average: null, truncated: false, spanYears: null, points: 0 });
  return {
    current,
    currentStaleDays: fresh.staleDays,
    percentile: enough ? percentileRank(clean, current) : null,
    average: enough ? arithmeticMean(clean) : null,
    zScore: enough ? zScorePopulation(clean, current) : null,
    windows: { w3: notComputed(), w5: notComputed(), w10: notComputed() },
  };
}

function readSectionRows(section: RawSection): RawRow[] {
  return Array.isArray(section.data)
    ? (section.data as RawRow[]).filter((row) => row && typeof row === "object")
    : [];
}

/** Section key → ISO day of its newest row, for the same-date premium base. */
function buildSpxPeByDate(usPayload: unknown): Map<string, number> {
  const byDate = new Map<string, number>();
  const sections = (usPayload as { sections?: Record<string, RawSection> } | null)?.sections;
  const sp500 = sections?.sp500;
  if (!sp500) return byDate;
  for (const row of readSectionRows(sp500)) {
    if (isIsoDay(row.date) && isFiniteNumber(row.best_pe_ratio)) {
      byDate.set(row.date, row.best_pe_ratio);
    }
  }
  return byDate;
}

function buildGroup(
  descriptor: (typeof BENCHMARK_ORDINAL_GROUPS)[number],
  payload: unknown,
  spxPeByDate: Map<string, number>,
): BenchmarkOrdinalGroup {
  const refuse = (reason: string): BenchmarkOrdinalGroup => ({
    id: descriptor.id, label: descriptor.label, asOf: null, refusal: reason, rows: [],
  });

  if (!payload || typeof payload !== "object") return refuse("payload_absent");
  const sections = (payload as { sections?: unknown }).sections;
  if (!sections || typeof sections !== "object") return refuse("sections_absent");

  const sectorGroup = descriptor.id === "us_sectors" || descriptor.id === "micro_sectors";
  const rows: BenchmarkOrdinalRow[] = [];
  let groupAsOf: string | null = null;

  for (const [id, rawSection] of Object.entries(sections as Record<string, RawSection>)) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const data = readSectionRows(rawSection).filter((row) => isIsoDay(row.date));
    if (data.length === 0) continue;

    let asOf: string | null = null;
    for (const row of data) {
      if (isIsoDay(row.date) && (asOf === null || row.date > asOf)) asOf = row.date;
    }

    const peSeries = data.map((row) => row.best_pe_ratio);
    const pbSeries = data.map((row) => row.px_to_book_ratio);
    const roeSeries = data.map((row) => row.roe);
    const acceptedPePoints = peSeries.filter(isFiniteNumber).length;
    const rowDates = data.map((row) => (typeof row.date === "string" ? row.date : null));
    const asOfMsForRows = asOf !== null ? msOfDay(asOf) : null;
    const pe = metricFromSeries(peSeries as unknown[] as readonly number[], rowDates, asOfMsForRows);
    // Forward-PE windows, trailing from the section's own as-of date, computed
    // from the DATA per index per window (truncation refusal included).
    // Windows are computed even when `current` is absent: the span and its
    // truncation are properties of the DATA, not of whether today's value
    // happens to be computable. percentileRank returns null for a null current,
    // so a section with no fresh value reports honest spans and no ranks
    // instead of silently reporting nothing at all.
    if (asOf !== null) {
      pe.windows = windowedMetrics(data, msOfDay(asOf), pe.current);
    }
    const pb = metricFromSeries(pbSeries as unknown[] as readonly number[], rowDates, asOfMsForRows);
    const roe = metricFromSeries(roeSeries as unknown[] as readonly number[], rowDates, asOfMsForRows);
    const price = lastFinite(data.map((row) => row.px_last) as unknown[] as number[]);

    let spxPremium: number | null = null;
    if (
      sectorGroup
      && id !== "sp500"
      && asOf !== null
      && isFiniteNumber(pe.current)
      && pe.current !== 0
    ) {
      const basePe = spxPeByDate.get(asOf);
      if (isFiniteNumber(basePe) && basePe !== 0) {
        spxPremium = pe.current / basePe - 1;
      }
    }

    if (asOf !== null && (groupAsOf === null || asOf < groupAsOf)) groupAsOf = asOf;

    rows.push({
      id,
      groupId: descriptor.id,
      name: typeof rawSection.name === "string" && rawSection.name.length > 0 ? rawSection.name : id,
      nameEn: typeof rawSection.name_en === "string" ? rawSection.name_en : null,
      asOf,
      price,
      pe,
      pb,
      roe,
      earningsYield: isFiniteNumber(pe.current) && pe.current !== 0 ? 1 / pe.current : null,
      spxPremium,
      points: acceptedPePoints,
    });
  }

  if (rows.length === 0) return refuse("no_publishable_row");

  return { id: descriptor.id, label: descriptor.label, asOf: groupAsOf, refusal: null, rows };
}

/**
 * Read all six benchmark payloads into ordinal groups. A missing or malformed
 * file refuses its OWN group only — one broken source must not blank the
 * other five. The view is refused outright only when nothing at all may be
 * shown.
 */
export function readBenchmarkOrdinals(
  payloads: Partial<Record<BenchmarkGroupId, unknown>>,
): BenchmarkOrdinalsView {
  const spxPeByDate = buildSpxPeByDate(payloads.us);
  const groups = BENCHMARK_ORDINAL_GROUPS.map((descriptor) =>
    buildGroup(descriptor, payloads[descriptor.id], spxPeByDate),
  );

  const ready = groups.filter((group) => group.refusal === null && group.rows.length > 0);
  if (ready.length === 0) {
    const firstRefusal = groups.find((group) => group.refusal !== null)?.refusal ?? "no_publishable_row";
    return { status: "refused", reason: firstRefusal };
  }

  let asOf: string | null = null;
  for (const group of ready) {
    if (group.asOf !== null && (asOf === null || group.asOf < asOf)) asOf = group.asOf;
  }
  return { status: "ready", groups, asOf };
}

export function benchmarkHorizonReading(
  row: BenchmarkOrdinalRow,
  horizon: BenchmarkOrdinalHorizon,
): BenchmarkHorizonReading {
  if (horizon === "all") {
    return {
      percentile: row.pe.percentile,
      average: row.pe.average,
      points: row.points,
      truncated: false,
      spanYears: null,
    };
  }
  const window = row.pe.windows[horizon];
  return {
    percentile: window.percentile,
    average: window.average,
    points: window.points,
    truncated: window.truncated,
    spanYears: window.spanYears,
  };
}
