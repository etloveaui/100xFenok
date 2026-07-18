#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  NATIVE_SIGNAL_FORMULA_VERSION,
  buildShortTermConvictionComposite,
  shortTermConvictionCallFromScore,
} from "./lib/fenok-proxy-formula-contract.mjs";

function signals({ technical = 80, volume = 70, relative = 60, options, shortPressure } = {}) {
  return {
    technical_flow: { score_0_100: technical },
    volume_liquidity_trend: { score_0_100: volume },
    short_term_relative_strength: { score_0_100: relative },
    net_options_proxy: options === undefined ? null : { score_0_100: options },
    short_pressure_proxy: shortPressure === undefined ? null : { score_0_100: shortPressure },
  };
}

assert.equal(NATIVE_SIGNAL_FORMULA_VERSION, "fenok-native-signals-v0.2.3-common-basis");
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

console.log("fenok native signal formula contract tests passed");
