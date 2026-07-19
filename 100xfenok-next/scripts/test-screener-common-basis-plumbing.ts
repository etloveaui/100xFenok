import assert from "node:assert/strict";

import { projectFenokShortTermFields } from "../src/hooks/useScreenerData";

const usEnrichedSignal = {
  symbol: "USX",
  shortTermScore: 74,
  shortTermConvictionScore: 74,
  shortTermConvictionCall: "concentrated" as const,
  shortTermCommonBasisScore: 61,
  shortTermCommonBasisCall: "mixed" as const,
  shortTermInputCount: 5,
  shortTermBasisCode: "us_enriched_v1",
};

const projected = projectFenokShortTermFields(usEnrichedSignal);

assert.deepStrictEqual(
  {
    fenokShortTermCommonBasisScore: projected.fenokShortTermCommonBasisScore,
    fenokShortTermCommonBasisCall: projected.fenokShortTermCommonBasisCall,
    fenokShortTermInputCount: projected.fenokShortTermInputCount,
    fenokShortTermBasisCode: projected.fenokShortTermBasisCode,
  },
  {
    fenokShortTermCommonBasisScore: 61,
    fenokShortTermCommonBasisCall: "혼재",
    fenokShortTermInputCount: 5,
    fenokShortTermBasisCode: "us_enriched_v1",
  },
);

assert.deepStrictEqual(
  {
    fenokShortTermScore: projected.fenokShortTermScore,
    fenokShortTermConvictionScore: projected.fenokShortTermConvictionScore,
    fenokShortTermConvictionCall: projected.fenokShortTermConvictionCall,
  },
  {
    fenokShortTermScore: 74,
    fenokShortTermConvictionScore: 74,
    fenokShortTermConvictionCall: "집중",
  },
);

console.log("test-screener-common-basis-plumbing: ok");
