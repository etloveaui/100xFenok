// Reading rule for the RIM valuation band.
//
// The producer publishes a two-endpoint assumption band for the two primary
// indices and refuses to publish anything for the rest. This module is the only
// place the UI is allowed to decide whether a band may be drawn, so the rule is
// testable without rendering a page, and so a future panel cannot re-implement a
// looser version of it.
//
// The rule is deliberately paranoid about a malformed payload: a band is drawn
// only when the index is one of the two the contract covers, the producer says
// it is ready, EVERY publication gate passed, and both endpoints are real and
// ordered. Anything else renders nothing at all rather than a partial band --
// one endpoint, or a midpoint, is the single target the contract forbids.

export const RIM_BAND_ELIGIBLE_INDEX_IDS = ["SPX", "NDX"] as const;

export const RIM_BAND_REQUIRED_GATES = [
  "primary_index",
  "source_tier_satisfied",
  "blockers_empty",
  "operands_complete",
  "source_clock_honest",
  "payout_routes_reconciled",
  "model_sensitivity_bounded",
] as const;

export const RIM_BAND_READY_STATUS = "ready_range_no_single_target";

// The reader's copy of the producer's ROUTE CAPABILITY ALLOWLIST. It is here, in
// code, for the same reason it is there: a payload can rewrite every field that
// describes a clock, including the clock's own `kind`. What it cannot rewrite is
// what the provider is able to publish.
//
// Trusting row.kind meant a payload could relabel the reconciliation clock as an
// observation date and the panel would silently drop the caveat -- presenting a
// collection time to the reader as if someone had observed the market that day.
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// Deeply frozen. Object.freeze is shallow, so a plain freeze would still let
// anything push a kind onto one of these arrays at runtime.
// Each source is bound to the EXACT field its date must come from. Route and
// kind alone cannot tell observed.price from benchmark_row -- both are main /
// source_as_of -- so two sources could swap dates and every capability check
// would still agree. The evidence path is what makes the identity load-bearing.
export const RIM_CLOCK_ROUTE_CAPABILITIES: Readonly<Record<string, {
  route: string;
  kinds: readonly string[];
  evidence: readonly string[];
}>> = deepFreeze({
  "observed.price": { route: "main", kinds: ["source_as_of"], evidence: ["observed", "price", "as_of"] },
  "observed.forward_eps": { route: "main", kinds: ["source_as_of"], evidence: ["observed", "forward_eps", "as_of"] },
  "observed.price_to_book": { route: "main", kinds: ["source_as_of"], evidence: ["observed", "price_to_book", "as_of"] },
  "observed.risk_free_rate": { route: "main", kinds: ["source_as_of"], evidence: ["observed", "risk_free_rate", "as_of"] },
  "observed.equity_risk_premium": { route: "main", kinds: ["source_as_of"], evidence: ["observed", "equity_risk_premium", "as_of"] },
  "computed/stock_action_index.json": {
    route: "main", kinds: ["source_as_of"],
    evidence: ["derived", "forecast_grid_v1", "coverage", "stock_action_source_date"],
  },
  benchmark_row: {
    route: "main", kinds: ["source_as_of"],
    evidence: ["derived", "payout_ratio", "coverage", "benchmark_as_of"],
  },
  "reconciliation.index_yield": {
    route: "reconciliation", kinds: ["collected_at"],
    evidence: ["derived", "legacy_payout_ratio_qa", "coverage", "index_yield_collected_at"],
  },
});

// Any of these as a KEY at ANY depth means a single target is trying to reach
// the screen inside an otherwise well-formed band.
const FORBIDDEN_TARGET_KEYS = new Set([
  "point_target", "target", "target_price", "price_target",
  "fair_value", "fairValue", "intrinsic_value", "intrinsicValue",
  "single_target", "estimate", "valuation",
]);

function containsForbiddenTargetKey(node: unknown): boolean {
  if (Array.isArray(node)) return node.some((item) => containsForbiddenTargetKey(item));
  if (!node || typeof node !== "object") return false;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (FORBIDDEN_TARGET_KEYS.has(key)) return true;
    if (containsForbiddenTargetKey(value)) return true;
  }
  return false;
}

function readPath(root: unknown, path: readonly string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

// A COMPLETE strict UTC instant, never a prefix sliced off arbitrary text.
// `"2026-08-01 is when we think"`.slice(0, 10) is a valid-looking day, and that
// is exactly how a malformed clock would have been accepted as a real one.
// A real calendar day, not a shape. The regex alone accepted 2026-02-31 and
// 2025-02-29, so a band could carry a date that never existed.
function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

// Mirrors the producer's INDEX_YIELD_COLLECTION_SLA_HOURS. A parity regression
// asserts the two capability maps and this constant stay identical.
export const RIM_COLLECTION_SLA_HOURS = 750;

function utcDayIndex(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 86_400_000);
}

export function strictUtcDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // A COMPLETE instant that is explicitly UTC. `Z` and `+00:00`/`-00:00` are the
  // same clock and providers use both -- SlickCharts emits +00:00 -- but a real
  // offset like +09:00 is a different clock and is refused, not silently shifted.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(Z|[+-]00:00)$/.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const day = match[1];
  if (!isIsoDay(day)) return null;
  // Round-trip: rejects instants whose calendar date does not survive parsing,
  // so 2026-02-31T00:00:00Z and 2026-08-01T99:99:99Z cannot become a day.
  return new Date(ms).toISOString().slice(0, 10) === day ? day : null;
}

export interface RimValuationRange {
  public_status?: string;
  emits_single_target?: boolean;
  as_of?: string | null;
  gates?: Record<string, { passed?: boolean; reason?: string } | null> | null;
  range?: { low?: number | null; high?: number | null } | null;
  assumptions?: {
    terminal_growth?: { low?: number | null; high?: number | null } | null;
    fade_years?: { value?: number | null } | null;
    discount_rate?: { value?: number | null } | null;
  } | null;
  price_context?: { observed_price?: number | null; position?: string | null } | null;
  source_clock?: {
    as_of?: string | null;
    contributing_sources?: Array<{ source?: string; route?: string; kind?: string; as_of?: string | null } | null> | null;
  } | null;
}

export interface RimBandView {
  low: number;
  high: number;
  position: string | null;
  asOf: string;
  terminalGrowthLow: number;
  terminalGrowthHigh: number;
  fadeYears: number;
  discountRate: number;
  // True when the reconciliation operand stands on a COLLECTION time because the
  // provider publishes no observation date. The panel must say so; a reader who
  // is not told will read the band's as_of as an observation date throughout.
  reconciliationUsesCollectionTime: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface RimIndexEntryForBand {
  observed?: unknown;
  derived?: { valuation_range_v1?: RimValuationRange | null } | null;
}

export function readRimBand(
  indexId: string,
  entry: RimIndexEntryForBand | null | undefined,
  options: { generatedAt?: string | null } = {},
): RimBandView | null {
  const range = entry?.derived?.valuation_range_v1;
  // The document's own clock, validated as a COMPLETE strict UTC instant.
  // Absent or malformed fails closed: freshness that cannot be checked is not
  // freshness that may be assumed.
  const generatedAt = strictUtcDay(options.generatedAt);
  if (!(RIM_BAND_ELIGIBLE_INDEX_IDS as readonly string[]).includes(indexId)) return null;
  if (!range || range.public_status !== RIM_BAND_READY_STATUS) return null;
  if (range.emits_single_target !== false) return null;

  // A nested point target anywhere in the block disqualifies it, however
  // well-formed the endpoints are.
  if (containsForbiddenTargetKey(range)) return null;

  // The EXACT gate set. Checking only that the required gates passed let a
  // payload carry an EXTRA failed gate and still render: the reader would be
  // ignoring a refusal the producer wrote down.
  const gates = range.gates ?? {};
  const declared = Object.keys(gates).sort().join(",");
  if (declared !== [...RIM_BAND_REQUIRED_GATES].sort().join(",")) return null;
  for (const gate of Object.values(gates)) {
    if (gate?.passed !== true) return null;
  }

  // A band with no valid day is a band with no clock.
  if (!isIsoDay(range.as_of)) return null;

  const low = range.range?.low;
  const high = range.range?.high;
  if (!isFiniteNumber(low) || !isFiniteNumber(high) || !(low < high)) return null;

  // The assumptions are part of the band, not a footnote: a reader who cannot
  // see them cannot tell an opinion from a measurement. Refuse rather than
  // render two bare numbers.
  const terminalGrowthLow = range.assumptions?.terminal_growth?.low;
  const terminalGrowthHigh = range.assumptions?.terminal_growth?.high;
  const fadeYears = range.assumptions?.fade_years?.value;
  const discountRate = range.assumptions?.discount_rate?.value;
  if (
    !isFiniteNumber(terminalGrowthLow)
    || !isFiniteNumber(terminalGrowthHigh)
    || !isFiniteNumber(fadeYears)
    || !isFiniteNumber(discountRate)
  ) {
    return null;
  }
  if (!(terminalGrowthHigh < discountRate)) return null;

  // FAIL CLOSED ON THE WHOLE INVENTORY, not row by row.
  //
  // Validating only the rows that happen to be present let a payload DELETE the
  // reconciliation row: every remaining row checked out, and the caveat -- the
  // one sentence telling the reader this clock is a fetch time and not an
  // observation -- silently disappeared. Suppression by omission is the same
  // lie as suppression by relabel, and it is easier to perform.
  const declaredRows = range.source_clock?.contributing_sources ?? [];
  if (!Array.isArray(declaredRows) || declaredRows.length !== Object.keys(RIM_CLOCK_ROUTE_CAPABILITIES).length) {
    return null;
  }
  const seenSources = new Set<string>();
  for (const row of declaredRows) {
    const source = row?.source;
    if (typeof source !== "string") return null;
    const capability = RIM_CLOCK_ROUTE_CAPABILITIES[source];
    if (!capability) return null;                       // extra / unknown source
    if (seenSources.has(source)) return null;           // duplicate
    seenSources.add(source);
    if (row?.route !== capability.route) return null;   // swapped route
    if (typeof row?.kind !== "string" || !capability.kinds.includes(row.kind)) return null;
    if (!isIsoDay(row?.as_of)) return null;             // partial / undated

    // IDENTITY BINDING. The date must be the one this source's own evidence
    // carries, so two sources sharing a route and kind still cannot swap dates.
    const evidence = readPath(entry, capability.evidence);
    const expectedDay = capability.kinds[0] === "collected_at"
      ? strictUtcDay(evidence)
      : (isIsoDay(evidence) ? evidence : null);
    if (expectedDay === null || row.as_of !== expectedDay) return null;
  }
  for (const source of Object.keys(RIM_CLOCK_ROUTE_CAPABILITIES)) {
    if (!seenSources.has(source)) return null;          // missing
  }

  // The band's own clock must be the oldest declared one, recomputed here rather
  // than read from the payload.
  const declaredDays = declaredRows.map((row) => row!.as_of as string).sort();
  if (range.as_of !== declaredDays[0]) return null;

  // Freshness of the collection clock, recomputed against the document's own
  // generation time. The row's declared age fields are payload text.
  if (generatedAt === null) return null;
  const generatedDay = utcDayIndex(generatedAt);
  for (const row of declaredRows) {
    const day = utcDayIndex(row!.as_of as string);
    if (day > generatedDay) return null;                                   // future
    if (row!.kind === "collected_at" && (generatedDay - day) * 24 > RIM_COLLECTION_SLA_HOURS) {
      return null;                                                          // beyond SLA
    }
  }

  const position = range.price_context?.position;
  return {
    low,
    high,
    position: typeof position === "string" ? position : null,
    asOf: range.as_of,
    terminalGrowthLow,
    terminalGrowthHigh,
    fadeYears,
    discountRate,
    // Derived from the ALLOWLIST, not from the row: the caveat is a property of
    // the provider, so a payload cannot suppress it by relabelling itself.
    // From the ALLOWLIST. The inventory is now mandatory, so the row cannot be
    // removed to suppress this, and the kind cannot be relabelled to suppress it.
    reconciliationUsesCollectionTime:
      RIM_CLOCK_ROUTE_CAPABILITIES["reconciliation.index_yield"].kinds.includes("collected_at"),
  };
}
