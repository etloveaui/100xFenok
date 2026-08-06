// FENO RIM v2 — clean-surplus bridge gate (SPEC v3.0 section 7, gate B2).
//
// bridge_error_t = (B_t − B_(t−1) − NI_t + Div_t − NetIssuance_t − OCI_t) / B_(t−1)
//
// B2 joins the public hull iff, over the estimation window: issuance and OCI
// aggregates exist for every year, and |bridge_error| ≤ BRIDGE_TOLERANCE on
// every window year. Where the aggregates are absent (today: all indices),
// the gate returns admitted=false with the stated reason — never a guess.
//
// The math is deliberately pure: given a complete dated aggregate series the
// function must produce the same numbers as the definition above, which is
// what the synthetic tests pin (exact identity ⇒ zero error; 0.02 boundary).

export const BRIDGE_TOLERANCE = 0.02;
export const BRIDGE_DATA_INCOMPLETE_REASON =
  "clean-surplus bridge data incomplete: issuance and OCI aggregates absent";

/**
 * @param aggregates Array<{ date?, book, net_income?, dividends?,
 *        net_issuance?, oci? }> in chronological order. Rows may carry only
 *        `book` where the bridge inputs are absent for that year.
 * @returns { admitted: boolean, reason: string | null, bridge_errors: Array<{date, bridge_error}> }
 */
export function cleanSurplusBridge(aggregates) {
  const rows = Array.isArray(aggregates) ? aggregates : [];
  // The base row carries only the book level (B_(t−1) for the first error);
  // every later row must carry the full bridge input set.
  const hasBridgeInputs = (row) => row
    && Number.isFinite(row.book)
    && Number.isFinite(row.net_income)
    && Number.isFinite(row.dividends)
    && Number.isFinite(row.net_issuance)
    && Number.isFinite(row.oci);
  const complete = rows.length >= 2
    && Number.isFinite(rows[0]?.book)
    && rows.slice(1).every(hasBridgeInputs);
  if (!complete) {
    return { admitted: false, reason: BRIDGE_DATA_INCOMPLETE_REASON, bridge_errors: [] };
  }

  const bridgeErrors = [];
  for (let i = 1; i < rows.length; i += 1) {
    const { book: bt, net_income: ni, dividends: div, net_issuance: issuance, oci } = rows[i];
    const bPrev = rows[i - 1].book;
    if (bPrev === 0) {
      return { admitted: false, reason: "clean-surplus bridge cannot divide by zero book", bridge_errors: bridgeErrors };
    }
    const error = (bt - bPrev - ni + div - issuance - oci) / bPrev;
    bridgeErrors.push({ date: rows[i].date ?? String(i), bridge_error: error });
  }

  const worst = bridgeErrors.reduce(
    (acc, entry) => (Math.abs(entry.bridge_error) > Math.abs(acc) ? entry : acc),
    { bridge_error: 0 },
  );
  const admitted = bridgeErrors.every((entry) => Math.abs(entry.bridge_error) <= BRIDGE_TOLERANCE);
  return {
    admitted,
    reason: admitted
      ? null
      : `clean-surplus bridge error ${worst.bridge_error.toFixed(4)} exceeds tolerance ${BRIDGE_TOLERANCE}`,
    bridge_errors: bridgeErrors,
  };
}
