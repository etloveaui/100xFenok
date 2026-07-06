import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.join(import.meta.dirname, ".."));

function read(relativePath) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

// FenokSignalLensCard was retired with the legacy ?v2=0 branch (legacy L2);
// its copy contracts moved with the surface to screener/StockDetailPanel,
// covered by the dual-hexagon gate.
const stockTabs = read("src/app/stock/[ticker]/StockTabs.tsx");
const stockDetail = read("src/app/stock/[ticker]/StockDetailClient.tsx");

assert.doesNotMatch(stockTabs, /₩.*[조억]/, "StockTabs must not mix KRW 조/억 local compact money copy");
assert.match(stockTabs, /formatCurrencyCompact/, "StockTabs must adopt shared formatCurrencyCompact");
assert.doesNotMatch(stockDetail, /OHLCV/, "StockDetailClient must not expose raw OHLCV copy");

console.log("[test-stock-copy-grammar] OK");
