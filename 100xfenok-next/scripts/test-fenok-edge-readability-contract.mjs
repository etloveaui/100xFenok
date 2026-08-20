#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

const stockDetail = read("src/app/stock/[ticker]/StockDetailClient.tsx");
const stockDetailPanel = read("src/app/screener/StockDetailPanel.tsx");
const screener = read("src/app/screener/ScreenerClient.tsx");
const basisCopy = read("src/lib/fenok-signals/conviction-basis-copy.mjs");
const basisSort = read("src/lib/screener/common-basis-short-term.ts");

assert.doesNotMatch(stockDetail, /compositeVerdict|compositeTone/, "stock detail must not render a cross-horizon verdict or tone");
assert.doesNotMatch(stockDetail, /shortR\s*>=\s*longR|longR\s*>=\s*shortR/, "stock detail must not compare Long and Short scores");
assert.match(stockDetail, /단기·장기 독립 진단/, "stock detail must disclose independent horizons");
assert.match(stockDetail, /장기 5개 방향성 축 평균/, "stock detail must describe the five directional Long axes");

assert.doesNotMatch(stockDetailPanel, /shortScore\s*>=\s*longScore|longScore\s*>=\s*shortScore/, "screener detail panel must not compare Long and Short scores");
assert.doesNotMatch(stockDetailPanel, /장기 6축/, "screener detail panel must not call Long a six-axis average");
assert.match(stockDetailPanel, /shortTermBasis\.windowLabel/, "screener detail panel must show the Short diagnostic window");

assert.doesNotMatch(screener, /Math\.max\(short,\s*long\)/, "Edge filtering must not use the higher Long/Short score");
assert.doesNotMatch(screener, /Math\.max\(shortC,\s*longC\)/, "legacy conviction filtering must not use the higher Long/Short score");
assert.match(screener, /Short Edge/, "screener must expose a distinct Short Edge filter");
assert.match(screener, /Long Edge/, "screener must expose a distinct Long Edge filter");
assert.match(screener, /shortEdgeMinValue[\s\S]*fenokShortTermScore/, "Short Edge filter must read only the Short score");
assert.match(screener, /longEdgeMinValue[\s\S]*fenokLongTermScore/, "Long Edge filter must read only the Long score");
assert.match(screener, /fenokEdgeMin:\s*shortEdgeMin/, "legacy Edge URL state must migrate to explicit Short filtering");
assert.match(screener, /convictionMin:\s*longEdgeMin/, "legacy conviction URL state must migrate to explicit Long filtering");

assert.match(basisCopy, /20\/60 trading-day/, "Short basis copy must disclose the diagnostic window");
assert.match(basisCopy, /장외거래.*참고축|참고축.*장외거래/, "Short basis copy must mark off-exchange as reference-only");
assert.doesNotMatch(basisSort, /Math\.max\(.*fenokShortTerm.*fenokLongTerm/, "legacy sort plumbing must not create a Long/Short composite");

console.log("[test-fenok-edge-readability-contract] OK");
