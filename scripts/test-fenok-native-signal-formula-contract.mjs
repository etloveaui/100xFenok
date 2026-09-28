#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NATIVE_SIGNAL_FORMULA_VERSION,
  buildLongTermConvictionScore,
  buildShortTermConvictionComposite,
  shortTermConvictionCallFromScore,
} from "./lib/fenok-proxy-formula-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function signals({ technical = 80, volume = 70, relative = 60, options, shortPressure } = {}) {
  return {
    technical_flow: { score_0_100: technical },
    volume_liquidity_trend: { score_0_100: volume },
    short_term_relative_strength: { score_0_100: relative },
    net_options_proxy: options === undefined ? null : { score_0_100: options },
    short_pressure_proxy: shortPressure === undefined ? null : { score_0_100: shortPressure },
  };
}

assert.equal(NATIVE_SIGNAL_FORMULA_VERSION, "fenok-native-signals-v0.2.4-null-comparable");
assert.equal(shortTermConvictionCallFromScore(70), "concentrated");
assert.equal(shortTermConvictionCallFromScore(40), "diluted");
assert.equal(shortTermConvictionCallFromScore(55), "mixed");
assert.equal(shortTermConvictionCallFromScore(null), null);

assert.deepEqual(
  buildShortTermConvictionComposite(signals({ options: 90, shortPressure: 20 }), "us"),
  {
    shortTermCommonBasisScore: 70,
    shortTermCommonBasisCall: "concentrated",
    shortTermConvictionScore: 76,
    shortTermConvictionCall: "concentrated",
    shortTermInputCount: 5,
    shortTermBasisCode: "us_enriched_v1",
    shortTermComparableScore: null,
    shortTermComparableCall: null,
  },
);

assert.deepEqual(
  buildShortTermConvictionComposite(signals({ options: 90 }), "US"),
  {
    shortTermCommonBasisScore: 70,
    shortTermCommonBasisCall: "concentrated",
    shortTermConvictionScore: 75,
    shortTermConvictionCall: "concentrated",
    shortTermInputCount: 4,
    shortTermBasisCode: "us_enriched_v1",
    shortTermComparableScore: null,
    shortTermComparableCall: null,
  },
);

assert.deepEqual(
  buildShortTermConvictionComposite(signals(), " us "),
  {
    shortTermCommonBasisScore: 70,
    shortTermCommonBasisCall: "concentrated",
    shortTermConvictionScore: 70,
    shortTermConvictionCall: "concentrated",
    shortTermInputCount: 3,
    shortTermBasisCode: "common_3_v1",
    shortTermComparableScore: null,
    shortTermComparableCall: null,
  },
);

for (const marketScope of ["korea", "asia"]) {
  assert.deepEqual(
    buildShortTermConvictionComposite(
      signals({ technical: 30, volume: 40, relative: 20, options: 100, shortPressure: 0 }),
      marketScope,
    ),
    {
      shortTermCommonBasisScore: 30,
      shortTermCommonBasisCall: "diluted",
      shortTermConvictionScore: 30,
      shortTermConvictionCall: "diluted",
      shortTermInputCount: 3,
      shortTermBasisCode: "common_3_v1",
      shortTermComparableScore: null,
      shortTermComparableCall: null,
    },
  );
}

const unavailableComposite = {
  shortTermCommonBasisScore: null,
  shortTermCommonBasisCall: null,
  shortTermConvictionScore: null,
  shortTermConvictionCall: null,
  shortTermInputCount: null,
  shortTermBasisCode: null,
  shortTermComparableScore: null,
  shortTermComparableCall: null,
};

assert.deepEqual(
  buildShortTermConvictionComposite(signals({ volume: null, options: 90, shortPressure: 20 }), "us"),
  unavailableComposite,
);
assert.deepEqual(
  buildShortTermConvictionComposite(signals({ technical: Number.NaN }), "us"),
  unavailableComposite,
);
assert.deepEqual(buildShortTermConvictionComposite(signals(), "unknown"), unavailableComposite);

// Long-term score (장기 스코어, the UI's second axis): plain mean of the five
// present long-term axes — profitability, growth, upside, inverted downside
// pressure, durability — no weights, missing axes dropped, never imputed.
assert.equal(
  buildLongTermConvictionScore({
    profitability: { score_0_100: 60 },
    growth: { score_0_100: 80 },
    upside_downside: { upside_score_0_100: 70, downside_score_0_100: 20 },
    durability_profitability: { score_0_100: 50 },
  }),
  68, // (60 + 80 + 70 + (100-20) + 50) / 5
);
assert.equal(buildLongTermConvictionScore({ profitability: { score_0_100: 60 } }), 60);
assert.equal(buildLongTermConvictionScore({}), null);
assert.equal(buildLongTermConvictionScore(null), null);

const summary = JSON.parse(fs.readFileSync(path.join(repoRoot, "data/computed/fenok_signals_summary.json"), "utf8"));
const comparableScoreIndex = summary.fields.indexOf("shortTermComparableScore");
const comparableCallIndex = summary.fields.indexOf("shortTermComparableCall");
assert.ok(comparableScoreIndex >= 0, "public summary must carry the reserved comparable score field");
assert.ok(comparableCallIndex >= 0, "public summary must carry the reserved comparable call field");
assert.equal(summary.formula_version, NATIVE_SIGNAL_FORMULA_VERSION);
assert.ok(summary.rows.every((row) => row[comparableScoreIndex] === null && row[comparableCallIndex] === null));

console.log("fenok native signal formula contract tests passed");
