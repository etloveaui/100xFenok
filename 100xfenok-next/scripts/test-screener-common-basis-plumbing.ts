import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { projectFenokShortTermFields } from "../src/hooks/useScreenerData";
import { passesFenokEdgeFilters } from "../src/app/screener/ScreenerClient";
import { rankFenokEdgeAxes } from "../src/app/screener/StockDetailPanel";
import {
  commonBasisShortTermView,
  screenerSortValue,
} from "../src/lib/screener/common-basis-short-term";
import { commonBasisSignalSummaryView } from "../src/lib/fenok-signals/common-basis-signal-summary";
import {
  parseScreenerFilterState,
  serializeScreenerFilterState,
  updateScreenerUrl,
} from "../src/lib/screener/filter-url";
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
  fenokLongTermScore: 95,
  fenokLongTermConvictionScore: 95,
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

const shortOnly = { fenokShortTermScore: 74, fenokLongTermScore: 40 } as ScreenerStock;
const longOnly = { fenokShortTermScore: 40, fenokLongTermScore: 95 } as ScreenerStock;
const unknownEdge = { fenokShortTermScore: null, fenokLongTermScore: 95 } as ScreenerStock;
const unknownLongEdge = { fenokShortTermScore: 95, fenokLongTermScore: null } as ScreenerStock;
assert.equal(passesFenokEdgeFilters(shortOnly, 70, null), true, "Short threshold must use only Short");
assert.equal(passesFenokEdgeFilters(shortOnly, null, 70), false, "Long threshold must reject a Long-below fixture");
assert.equal(passesFenokEdgeFilters(longOnly, null, 70), true, "Long threshold must use only Long");
assert.equal(passesFenokEdgeFilters(longOnly, 70, null), false, "Short threshold must reject a Short-below fixture");
assert.equal(passesFenokEdgeFilters(unknownEdge, 70, null), false, "null Short must fail closed under an active threshold");
assert.equal(passesFenokEdgeFilters(unknownLongEdge, null, 70), false, "null Long must fail closed under an active threshold");
const rankingFixture = [
  { key: "offExchange", score: 99, referenceOnly: true },
  { key: "technicalFlow", score: 74, referenceOnly: false },
  { key: "relativeStrength", score: 61, referenceOnly: false },
] as const;
assert.deepEqual(
  rankFenokEdgeAxes(rankingFixture, "desc", 3).map((axis) => axis.key),
  ["technicalFlow", "relativeStrength"],
  "Short ranking must exclude a higher reference-only axis",
);
assert.deepEqual(
  rankFenokEdgeAxes(rankingFixture, "asc", 1).map((axis) => axis.key),
  ["relativeStrength"],
  "Short weakness ranking must exclude a reference-only axis",
);

const migratedFilterState = parseScreenerFilterState({ fenokEdgeMin: "70", convMin: "60" });
assert.equal(migratedFilterState.fenokEdgeMin, "70", "legacy Short URL alias must migrate to state");
assert.equal(migratedFilterState.convictionMin, "60", "legacy Long URL alias must migrate to state");
const canonicalParams = serializeScreenerFilterState(migratedFilterState);
assert.equal(canonicalParams.get("shortEdgeMin"), "70");
assert.equal(canonicalParams.get("longEdgeMin"), "60");
assert.equal(canonicalParams.has("fenokEdgeMin"), false);
assert.equal(canonicalParams.has("convictionMin"), false);
assert.equal(canonicalParams.has("convMin"), false);
const clearedLongHref = updateScreenerUrl(
  "https://fenok.example/screener?macro=cycle&shortEdgeMin=70&longEdgeMin=60&convictionMin=60&convMin=60",
  { ...migratedFilterState, convictionMin: "" },
);
const clearedLongParams = new URL(clearedLongHref).searchParams;
assert.equal(clearedLongParams.get("macro"), "cycle", "unrelated URL state must survive filter updates");
assert.equal(clearedLongParams.has("longEdgeMin"), false, "clearing Long must remove canonical Long URL state");
assert.equal(clearedLongParams.has("convictionMin"), false, "clearing Long must remove the old conviction alias");
assert.equal(clearedLongParams.has("convMin"), false, "clearing Long must remove the old convMin alias");

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

const panelSource = fs.readFileSync(path.join(appRoot, "src/app/screener/StockDetailPanel.tsx"), "utf8");
assert.match(panelSource, /rankFenokEdgeAxes\(shortTermAxes, "desc", 3\)/, "Short strengths must use the reference-only-safe ranking helper");
assert.match(panelSource, /rankFenokEdgeAxes\(shortTermAxes, "asc", 1\)/, "Short weaknesses must use the reference-only-safe ranking helper");
assert.match(panelSource, /function rankFenokEdgeAxes[\s\S]*!axis\.referenceOnly/, "Short ranking helper must exclude reference-only axes");
assert.match(panelSource, /shortTermBasis\.sourceInputCount[\s\S]*?\/3–5/, "Panel must disclose Short N/3–5 inputs");
assert.match(panelSource, /shortTermBasis\.exclusionNote|장외거래 참고축\(평균 제외\)/, "Panel must disclose off-exchange exclusion from Short averaging");

const screenerSource = fs.readFileSync(path.join(appRoot, "src/app/screener/ScreenerClient.tsx"), "utf8");
assert.match(screenerSource, /N\/3–5 입력/, "Screener must disclose the Short N/3–5 basis");
assert.match(screenerSource, /장외거래는 참고축이며 평균에서 제외/, "Screener must disclose off-exchange reference-only exclusion");

const filterUrlSource = fs.readFileSync(path.join(appRoot, "src/lib/screener/filter-url.ts"), "utf8");
assert.match(filterUrlSource, /params\.shortEdgeMin \?\? params\.fenokEdgeMin/, "URL parser must prefer the canonical Short key and retain its legacy alias");
assert.match(filterUrlSource, /params\.longEdgeMin \?\? params\.convictionMin \?\? params\.convMin/, "URL parser must prefer canonical Long and migrate both legacy aliases");
assert.match(filterUrlSource, /setIfPresent\(params, "longEdgeMin", state\.convictionMin\)/, "URL serializer must emit the canonical Long key");
assert.doesNotMatch(filterUrlSource, /setIfPresent\(params, "convictionMin"/, "URL serializer must not emit the old conviction alias");

console.log("test-screener-common-basis-plumbing: ok");
