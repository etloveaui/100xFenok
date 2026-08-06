#!/usr/bin/env node

// FENO RIM v2 — generic Family B engine (SPEC v3.0 sections 2, 4, 7, 8 and
// the Gate 2 amendments). ID-BLIND by construction: the compute path never
// reads the index id; adapters supply normalized inputs and the invariance
// property test proves the blindness against this function.
//
// The engine computes fair-value hulls only. Publication policy (NULL while
// the core ERP band is unproven, B2 gating, confidence UNVERIFIED) is applied
// here as explicit status flags so no downstream consumer can mistake a
// diagnostic hull for a publishable range.

export const HORIZONS = Object.freeze([5, 10]);
export const FADE_YEARS = 10; // F: terminal fade length
export const ROE_FADE_COMPLETE_YEAR = 5; // M: fade completes at year 5

// Terminal B fade coefficient: RI_(N+k) = RI_N · (F − k) / F, so the year-N+F
// term is exactly zero.
export function fadeCoefficient(k, F = FADE_YEARS) {
  return (F - k) / F;
}

// ROE path (SPEC v3.0 section 4): consensus FY1..FY3 where covered, then a
// linear fade from FY3 DIRECTLY to the swept band bound (completing at M=5),
// constant at that bound afterwards. No median waypoint.
export function roePath(bound, { consensus = null, coverage_ok: coverageOk = false } = {}) {
  const M = ROE_FADE_COMPLETE_YEAR;
  const path = [];
  const hasConsensus = coverageOk && Array.isArray(consensus) && consensus.length === 3
    && consensus.every((row) => Number.isFinite(row?.roe));
  const fy3 = hasConsensus ? consensus[2].roe : bound;
  for (let t = 1; t <= 3; t += 1) {
    path.push(hasConsensus ? consensus[t - 1].roe : bound);
  }
  for (let t = 4; t <= M; t += 1) {
    path.push(fy3 + (bound - fy3) * ((t - 3) / (M - 3)));
  }
  return path; // caller extends with the bound for t > M
}

function roeAt(path, bound, t) {
  return t <= path.length ? path[t - 1] : bound;
}

// One residual-value member: explicit years N, then the terminal policy.
function memberValue({ book, ke, riskFree, growthFor, roeFor, horizon, terminal }) {
  const discount = riskFree + ke;
  let rollingBook = book;
  let value = book;
  let residualN = 0;
  for (let t = 1; t <= horizon; t += 1) {
    const residual = (roeFor(t) - discount) * rollingBook;
    value += residual / (1 + discount) ** t;
    residualN = residual;
    rollingBook *= 1 + growthFor(t);
  }
  if (terminal === "A") {
    // zero-growth perpetuity, first terminal cash flow at N+1, RI_(N+1)=RI_N
    value += (residualN / discount) / (1 + discount) ** horizon;
  } else {
    for (let k = 1; k <= FADE_YEARS; k += 1) {
      const coefficient = fadeCoefficient(k);
      if (coefficient === 0) continue;
      value += (residualN * coefficient) / (1 + discount) ** (horizon + k);
    }
  }
  return value;
}

/**
 * Family B compute. `input` is a normalized record; the id field is carried
 * but never read by the math.
 *
 * input: {
 *   id, book, price (optional, for upside), risk_free,
 *   roe: { band: {low, high}, consensus, coverage_ok },
 *   payout_scenarios: [{ id, low, high }],           // TTM/TTM base; fwd/fwd optional
 *   growth_observed: { w5, w10, w15 },               // book CAGR windows
 *   erp_band: { low, high } | null,                  // null => core ERP unproven
 *   b2_admitted: boolean, b2_exclusion_reason: string | null,
 * }
 */
export function computeFamilyB(input) {
  const { book, risk_free: riskFree, roe, payout_scenarios: payoutScenarios, growth_observed: gObs, erp_band: erpBand } = input;
  const disclosures = [];
  const values = [];

  const push = (value, provenance) => {
    values.push(value);
    disclosures.push({ value, ...provenance });
  };

  const b1GrowthMembers = [gObs.w5, gObs.w10, gObs.w15].filter(Number.isFinite);
  const erpMembers = erpBand ? [erpBand.low, erpBand.high] : [null];

  const runMember = (scenarioId, growthFor, roeFor, ke, horizon, terminal) => {
    const value = memberValue({
      book,
      ke,
      riskFree,
      growthFor,
      roeFor,
      horizon,
      terminal,
    });
    push(value, { scenario: scenarioId, horizon, terminal });
    return value;
  };

  // B1 sweep.
  for (const g of b1GrowthMembers) {
    for (const erp of erpMembers) {
      for (const bound of [roe.band.low, roe.band.high]) {
        const path = roePath(bound, roe);
        const roeFor = (t) => roeAt(path, bound, t);
        for (const horizon of HORIZONS) {
          for (const terminal of ["A", "B"]) {
            runMember("B1_observed", () => g, roeFor, erp === null ? 0 : erp, horizon, terminal);
          }
        }
      }
    }
  }

  // B2 sweep, only when admitted by the clean-surplus gate.
  if (input.b2_admitted) {
    for (const payout of payoutScenarios) {
      for (const p of [payout.low, payout.high]) {
        for (const erp of erpMembers) {
          for (const bound of [roe.band.low, roe.band.high]) {
            const path = roePath(bound, roe);
            const roeFor = (t) => roeAt(path, bound, t);
            const growthFor = (t) => roeFor(t) * (1 - p);
            for (const horizon of HORIZONS) {
              for (const terminal of ["A", "B"]) {
                runMember(`B2_retention:${payout.id}`, growthFor, roeFor, erp === null ? 0 : erp, horizon, terminal);
              }
            }
          }
        }
      }
    }
  }

  const hull = { low: Math.min(...values), high: Math.max(...values) };
  const lowProv = disclosures.find((d) => d.value === hull.low);
  const highProv = disclosures.find((d) => d.value === hull.high);

  // Direction reversal between scenarios => NULL (SPEC v3.0 section 7).
  let reversal = false;
  if (input.b2_admitted) {
    const b1Values = disclosures.filter((d) => d.scenario === "B1_observed").map((d) => d.value);
    const b2Values = disclosures.filter((d) => d.scenario.startsWith("B2")).map((d) => d.value);
    if (b1Values.length && b2Values.length && input.price) {
      const sign = (v) => Math.sign(v / input.price - 1);
      const b1Signs = new Set(b1Values.map(sign));
      const b2Signs = new Set(b2Values.map(sign));
      reversal = [...b1Signs].some((s) => s !== 0 && [...b2Signs].some((t) => t !== 0 && t !== s));
    }
  }

  const nullReasons = [];
  if (!erpBand) nullReasons.push("core_erp_unidentified");
  if (reversal) nullReasons.push("scenario_direction_reversal");

  return {
    public_status: nullReasons.length ? "NULL" : "RANGE_CANDIDATE",
    null_reasons: nullReasons,
    value_hull: hull,
    hull_provenance: { low: lowProv, high: highProv },
    b2_admitted: Boolean(input.b2_admitted),
    b2_exclusion_reason: input.b2_exclusion_reason ?? null,
    disclosures: {
      horizons: [...HORIZONS],
      terminals: ["A", "B"],
      terminal_assumptions: {
        A: "RI_(N+1) = RI_N, zero-growth perpetuity, first terminal cash flow at N+1",
        B: `RI fades linearly to exactly zero at year N+${FADE_YEARS}`,
      },
      member_count: disclosures.length,
      members: disclosures,
    },
    confidence: "UNVERIFIED",
  };
}
