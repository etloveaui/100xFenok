import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.join(import.meta.dirname, ".."));

function read(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

const fenokLens = read("src/app/stock/[ticker]/FenokSignalLensCard.tsx");
const stockTabs = read("src/app/stock/[ticker]/StockTabs.tsx");
const stockDetail = read("src/app/stock/[ticker]/StockDetailClient.tsx");

for (const requiredMarker of ["Fenok Edge Score", "Short Edge", "Long Edge"]) {
  assert.match(fenokLens, new RegExp(requiredMarker), `missing UI_CONTRACTS marker: ${requiredMarker}`);
}

for (const bannedCopy of [
  "as_of",
  "로컬 OHLCV 프록시",
  "실제 주문 흐름 아님",
  "OCC 옵션 거래량 편향",
  "실제 플로우 아님",
  "FINRA 공개 데이터 파생",
  "다크풀/방향 신호 아님",
  "숏 볼륨",
]) {
  assert.doesNotMatch(fenokLens, new RegExp(bannedCopy), `banned stock copy remains: ${bannedCopy}`);
}

assert.doesNotMatch(fenokLens, /coverage\s*\{/, "raw coverage label remains in rendered stock copy");
assert.doesNotMatch(fenokLens, /`coverage\s/, "raw coverage label remains in template stock copy");
assert.doesNotMatch(fenokLens, /function formatAsOf\(/, "FenokSignalLensCard must use shared data-state formatAsOf");
assert.match(fenokLens, /formatAsOf as formatDataAsOf/, "FenokSignalLensCard must import the shared data-state formatAsOf");

assert.doesNotMatch(stockTabs, /₩.*[조억]/, "StockTabs must not mix KRW 조/억 local compact money copy");
assert.match(stockTabs, /formatCurrencyCompact/, "StockTabs must adopt shared formatCurrencyCompact");
assert.doesNotMatch(stockDetail, /OHLCV/, "StockDetailClient must not expose raw OHLCV copy");

console.log("[test-stock-copy-grammar] OK");
