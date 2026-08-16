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
  shortTermComparableScore: null,
  shortTermComparableCall: null,
};

const projected = projectFenokShortTermFields(usEnrichedSignal);

assert.deepStrictEqual(
  {
    fenokShortTermCommonBasisScore: projected.fenokShortTermCommonBasisScore,
    fenokShortTermCommonBasisCall: projected.fenokShortTermCommonBasisCall,
    fenokShortTermInputCount: projected.fenokShortTermInputCount,
    fenokShortTermBasisCode: projected.fenokShortTermBasisCode,
    fenokShortTermComparableScore: projected.fenokShortTermComparableScore,
    fenokShortTermComparableCall: projected.fenokShortTermComparableCall,
  },
  {
    fenokShortTermCommonBasisScore: 61,
    fenokShortTermCommonBasisCall: "혼재",
    fenokShortTermInputCount: 5,
    fenokShortTermBasisCode: "us_enriched_v1",
    fenokShortTermComparableScore: null,
    fenokShortTermComparableCall: null,
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
// The 2026-08-03 mandate retired the single integrated score: the column renders
// 단기 and 장기 separately, so it must ORDER by the directional short-term score it
// displays. It used to sort by the common-basis figure — the list then showed one
// number and ranked by another, under the default sort of the fenokPicks preset.
// The legacy `fenokConvictionScore` key survives only so old shared URLs and saved
// sorts keep working; it resolves to the displayed value, never to the retired one.
assert.equal(
  screenerSortValue(valueChangingFixture, "fenokConvictionScore"),
  74,
  "the legacy conviction sort key must order by the directional short-term score the column renders",
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
// This used to forbid the directional fields entirely. That inverted after
// 2026-08-03: the stock page's headline number IS shortTermConvictionScore. The
// old assertion also never bit — it matched `record.` while the code writes
// `record?.`, so it would have passed no matter what the page rendered.
// What must stay forbidden is the retired integrated score returning as a
// fallback under a 단기 or 장기 label, which is the failure the mandate names.
assert.match(
  stockDetailClient,
  /record\?\.shortTermConvictionScore/,
  "the stock-detail headline must read the directional short-term score",
);
assert.doesNotMatch(
  stockDetailClient,
  /record\?\.convictionScore/,
  "the retired integrated score must never be a fallback behind a 단기 or 장기 label",
);

console.log("test-screener-common-basis-plumbing: ok");
