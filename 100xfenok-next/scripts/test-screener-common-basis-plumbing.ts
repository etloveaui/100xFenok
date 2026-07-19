import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { projectFenokShortTermFields } from "../src/hooks/useScreenerData";
import {
  commonBasisShortTermView,
  screenerSortValue,
} from "../src/lib/screener/common-basis-short-term";
import { commonBasisSignalSummaryView } from "../src/lib/fenok-signals/common-basis-signal-summary";
import type { ScreenerStock } from "../src/lib/screener/types";

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

assert.deepStrictEqual(commonBasisSignalSummaryView(usEnrichedSignal), {
  score: 61,
  call: "mixed",
  sourceInputCount: 5,
  basisCode: "us_enriched_v1",
});

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

const valueChangingFixture = {
  ticker: "USX",
  fenokConvictionScore: 74,
  fenokShortTermScore: 74,
  fenokShortTermConvictionScore: 74,
  fenokShortTermConvictionCall: "집중",
  fenokShortTermCommonBasisScore: 61,
  fenokShortTermCommonBasisCall: "혼재",
  fenokShortTermInputCount: 5,
  fenokShortTermBasisCode: "us_enriched_v1",
} as ScreenerStock;

assert.deepStrictEqual(commonBasisShortTermView(valueChangingFixture), {
  score: 61,
  call: "혼재",
  sourceInputCount: 5,
  basisCode: "us_enriched_v1",
});
assert.equal(
  screenerSortValue(valueChangingFixture, "fenokConvictionScore"),
  61,
  "the conviction column must sort by the same common-basis score that it renders",
);
assert.deepStrictEqual(
  {
    legacyScore: valueChangingFixture.fenokShortTermConvictionScore,
    legacyCall: valueChangingFixture.fenokShortTermConvictionCall,
  },
  { legacyScore: 74, legacyCall: "집중" },
  "the common-basis flip must not erase legacy data used by later slices",
);

const appRoot = path.resolve(import.meta.dirname, "..");
for (const relativePath of [
  "src/app/screener/ScreenerClient.tsx",
  "src/app/screener/StockDetailPanel.tsx",
]) {
  const source = fs.readFileSync(path.join(appRoot, relativePath), "utf8");
  assert.match(source, /commonBasisShortTermView/, `${relativePath} must render the common-basis selector`);
}
const stockDetailClient = fs.readFileSync(path.join(appRoot, "src/app/stock/[ticker]/StockDetailClient.tsx"), "utf8");
assert.match(stockDetailClient, /commonBasisSignalSummaryView/, "the direct stock-detail path must use the common-basis selector");
assert.match(stockDetailClient, /shortTermCommonBasisCopy/, "the direct stock-detail path must use common-basis disclosure");
assert.doesNotMatch(stockDetailClient, /record\.shortTermConvictionScore|record\.shortTermScore/, "the direct stock-detail path must not render legacy short-term scores");

console.log("test-screener-common-basis-plumbing: ok");
