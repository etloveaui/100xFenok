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
  /** Percentile rank of `current` within the history (0–100), rounded. */
  percentile: number | null;
  /** Population z-score of `current` within the history. */
  zScore: number | null;
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

function lastFinite(values: readonly number[]): number | null {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

function metricFromSeries(values: readonly number[]): OrdinalMetric {
  const clean = values.filter(isFiniteNumber);
  const current = lastFinite(values);
  const enough = clean.length >= BENCHMARK_ORDINAL_MIN_HISTORY;
  return {
    current,
    percentile: enough ? percentileRank(clean, current) : null,
    zScore: enough ? zScorePopulation(clean, current) : null,
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
    const data = readSectionRows(rawSection);
    if (data.length === 0) continue;

    let asOf: string | null = null;
    for (const row of data) {
      if (isIsoDay(row.date) && (asOf === null || row.date > asOf)) asOf = row.date;
    }

    const peSeries = data.map((row) => row.best_pe_ratio);
    const pbSeries = data.map((row) => row.px_to_book_ratio);
    const roeSeries = data.map((row) => row.roe);
    const pe = metricFromSeries(peSeries as unknown[] as readonly number[]);
    const pb = metricFromSeries(pbSeries as unknown[] as readonly number[]);
    const roe = metricFromSeries(roeSeries as unknown[] as readonly number[]);
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
      points: data.length,
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
