/** Source id of the one-year daily beta this site calculates itself (scripts/build-market-facts.py). */
const DERIVED_DAILY_1Y_BETA = "derived.daily_1y_beta";

/**
 * "KOSPI 대비 · 1년 일간 자체 계산" for a beta fact this site derived, when the
 * fact names its benchmark (provenance.benchmark: SPY, KOSPI or KOSDAQ).
 * A provider beta, or a derived one that names no benchmark, returns null so
 * the caller prints plain beta: a benchmark is never assumed.
 */
export function derivedBetaLabel(fact: unknown): string | null {
  if (!fact || typeof fact !== "object") return null;
  const { source, provenance } = fact as { source?: unknown; provenance?: unknown };
  if (source !== DERIVED_DAILY_1Y_BETA || !provenance || typeof provenance !== "object") return null;
  const benchmark = (provenance as { benchmark?: unknown }).benchmark;
  if (typeof benchmark !== "string" || !/^[A-Za-z0-9^.-]{1,12}$/.test(benchmark.trim())) return null;
  return `${benchmark.trim()} 대비 · 1년 일간 자체 계산`;
}
