// The one rule for reading `dividendYield`.
//
// `computed/stock_action_index.json` has stored this field in BOTH conventions
// in the same column, and not split by market: AAPL (US) is `0.00321` while MTB
// (US) is `2.43`. 74 of 1179 rows were percent-encoded, and every consumer that
// assumed a fraction rendered them a hundred times too large -- the live screener
// showed a dividend of 243% for MTB and 815% for CAG, and the action scorer put
// all 74 at the top of the income bucket.
//
// MAGNITUDE CANNOT DECIDE. A percent-encoded 0.4% yield is `0.4` and a
// fraction-encoded one is `0.004`; both are below 1, so any threshold rule
// mis-scales exactly the low-yield rows it looks safest on. The only honest
// discriminator is the row's OWN trailing dividend over its OWN price, which is
// a fraction by construction and can arbitrate between the two readings.
//
// FAIL CLOSED. A row that carries no measurable dividend and price returns
// `null`, not a guess. A hundred-fold error is worse than a gap, and a gap is
// visible while a wrong unit is not.

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export const DIVIDEND_YIELD_UNITS = Object.freeze(["fraction", "percent", "zero", "unresolved"]);

/**
 * Resolve a stored dividend yield to a fraction.
 *
 * @param {{dividendYield?: unknown, price?: unknown, dividendHistory?: {ttm?: unknown} | null}} row
 * @returns {{value: number|null, unit: "fraction"|"percent"|"zero"|"unresolved", reason: string}}
 */
export function resolveDividendYieldFraction(row) {
  const stored = finiteNumber(row?.dividendYield);
  if (stored === null || stored < 0) {
    return { value: null, unit: "unresolved", reason: "row carries no usable dividend yield" };
  }
  // A genuine zero is a measurement, not a gap.
  if (stored === 0) return { value: 0, unit: "zero", reason: "" };

  const price = finiteNumber(row?.price);
  const trailingDividend = finiteNumber(row?.dividendHistory?.ttm);
  if (price === null || price <= 0 || trailingDividend === null || trailingDividend <= 0) {
    return {
      value: null,
      unit: "unresolved",
      reason: "no trailing dividend and price to measure the unit against",
    };
  }

  const measuredFraction = trailingDividend / price;
  const asFraction = stored;
  const asPercent = stored / 100;
  if (Math.abs(asPercent - measuredFraction) < Math.abs(asFraction - measuredFraction)) {
    return { value: asPercent, unit: "percent", reason: "" };
  }
  return { value: asFraction, unit: "fraction", reason: "" };
}

/** A fresh zeroed tally, so callers can publish the mix instead of averaging it away. */
export function emptyDividendYieldUnitMix() {
  return { fraction: 0, percent: 0, zero: 0, unresolved: 0 };
}

export function tallyDividendYieldUnit(mix, unit) {
  if (mix && Object.hasOwn(mix, unit)) mix[unit] += 1;
  return mix;
}
