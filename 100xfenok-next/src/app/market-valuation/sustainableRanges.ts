// Reading rule for the FENO RIM sustainable index ranges.
//
// This is a SECOND reader, deliberately not an extension of rimBand.ts. That
// module reads a different producer with a different contract, and folding the
// two together would mean one loosened check silently weakening both surfaces.
// The two files share a philosophy and no code: refuse rather than render.
//
// What reaches the screen from here is a research diagnostic. Every row carries
// three two-ended ranges and no midpoint is computed anywhere in this module or
// its panel, because a midpoint IS the single target the producer's policy
// forbids. A row that cannot supply both ends of all three ranges renders
// nothing at all.

export const SUSTAINABLE_PUBLIC_SCHEMA_VERSION = "fenok_rim_sustainable_public_projection.v1";
export const SUSTAINABLE_PUBLISHABLE_ROW_STATUS = "RESEARCH_DIAGNOSTIC";

// Any of these as a key at ANY depth means a single target is trying to reach
// the screen inside an otherwise well-formed payload. Kept in step with the
// producer's own refusal list.
const FORBIDDEN_TARGET_KEYS = new Set([
  "point_estimate", "point_target", "target", "target_price", "price_target",
  "fair_value", "fairValue", "intrinsic_value", "intrinsicValue",
  "single_target", "midpoint", "mid",
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A real calendar day, not a shape: the regex alone accepts 2026-02-31.
function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

interface Endpoints { low: number; high: number }

function readEndpoints(node: unknown): Endpoints | null {
  if (!node || typeof node !== "object") return null;
  const { low, high } = node as { low?: unknown; high?: unknown };
  if (!isFiniteNumber(low) || !isFiniteNumber(high)) return null;
  // `low === high` collapses to one number on screen and is refused for the
  // same reason a midpoint is.
  if (!(low < high)) return null;
  return { low, high };
}

export interface SustainableRangeRow {
  id?: unknown;
  label?: unknown;
  as_of?: unknown;
  publication_status?: unknown;
  confidence?: unknown;
  current_price?: unknown;
  range?: unknown;
  upside?: unknown;
  expected_12m?: unknown;
  assumptions?: {
    discount_rate?: unknown;
    explicit_years?: unknown;
    convexity_ratio?: unknown;
    convexity_status?: unknown;
  } | null;
}

export interface SustainableRangesDoc {
  schema_version?: unknown;
  as_of?: unknown;
  policy?: { no_public_single_target?: unknown; emits_single_target?: unknown } | null;
  promotion?: {
    promoted?: unknown;
    receipt_eligible?: unknown;
    findings?: Array<{ id?: unknown; detail?: unknown }> | null;
  } | null;
  rows?: unknown;
}

export interface SustainableRangeView {
  id: string;
  label: string;
  asOf: string;
  confidence: string | null;
  currentPrice: number | null;
  range: Endpoints;
  upside: Endpoints;
  twelveMonth: Endpoints;
  discountRate: number;
  explicitYears: number;
  convexityRatio: number;
  convexityStatus: string;
}

export interface SustainableRangesView {
  asOf: string;
  rows: SustainableRangeView[];
  // Disclosed, not resolved. The panel shows these next to the numbers; a
  // reader who cannot see them cannot tell what the measurement does not cover.
  findings: Array<{ id: string; detail: string }>;
  // Non-null when nothing may be drawn, so the caller renders an honest
  // refusal instead of an empty section that looks like missing data.
  refusal: string | null;
}

export function readSustainableRanges(doc: SustainableRangesDoc | null | undefined): SustainableRangesView {
  const refuse = (reason: string): SustainableRangesView => ({
    asOf: "", rows: [], findings: [], refusal: reason,
  });

  if (!doc || typeof doc !== "object") return refuse("payload_absent");
  if (doc.schema_version !== SUSTAINABLE_PUBLIC_SCHEMA_VERSION) return refuse("schema_version_mismatch");

  // The producer's own policy, read from the payload rather than assumed. A
  // payload that stops declaring the policy stops being publishable here.
  if (doc.policy?.no_public_single_target !== true) return refuse("policy_absent");
  if (doc.policy?.emits_single_target !== false) return refuse("payload_emits_single_target");

  // Promotion and the calibration receipt are document-level gates: a failure in
  // either withholds every row, never a subset.
  if (doc.promotion?.promoted !== true) return refuse("not_promoted");
  if (doc.promotion?.receipt_eligible !== true) return refuse("calibration_receipt_not_eligible");

  if (containsForbiddenTargetKey(doc)) return refuse("payload_carries_single_target");
  if (!isIsoDay(doc.as_of)) return refuse("document_clock_absent");
  if (!Array.isArray(doc.rows)) return refuse("rows_absent");

  const rows: SustainableRangeView[] = [];
  for (const candidate of doc.rows as SustainableRangeRow[]) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.publication_status !== SUSTAINABLE_PUBLISHABLE_ROW_STATUS) continue;

    const range = readEndpoints(candidate.range);
    const upside = readEndpoints(candidate.upside);
    const twelveMonth = readEndpoints(candidate.expected_12m);
    if (!range || !upside || !twelveMonth) continue;

    const discountRate = candidate.assumptions?.discount_rate;
    const explicitYears = candidate.assumptions?.explicit_years;
    const convexityRatio = candidate.assumptions?.convexity_ratio;
    const convexityStatus = candidate.assumptions?.convexity_status;
    // The assumptions are part of the reading, not a footnote. Refuse rather
    // than render endpoints a reader cannot interpret.
    if (!isFiniteNumber(discountRate) || !isFiniteNumber(explicitYears)) continue;
    if (!isFiniteNumber(convexityRatio) || typeof convexityStatus !== "string") continue;
    if (typeof candidate.id !== "string" || typeof candidate.label !== "string") continue;
    if (!isIsoDay(candidate.as_of)) continue;

    rows.push({
      id: candidate.id,
      label: candidate.label,
      asOf: candidate.as_of,
      confidence: typeof candidate.confidence === "string" ? candidate.confidence : null,
      currentPrice: isFiniteNumber(candidate.current_price) ? candidate.current_price : null,
      range,
      upside,
      twelveMonth,
      discountRate,
      explicitYears,
      convexityRatio,
      convexityStatus,
    });
  }

  if (rows.length === 0) return refuse("no_publishable_row");

  const findings = Array.isArray(doc.promotion?.findings)
    ? doc.promotion!.findings!
      .filter((finding) => typeof finding?.id === "string" && typeof finding?.detail === "string")
      .map((finding) => ({ id: finding.id as string, detail: finding.detail as string }))
    : [];

  return { asOf: doc.as_of as string, rows, findings, refusal: null };
}
