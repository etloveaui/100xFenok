import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

const parser = source("src/lib/data-supply-etf-ui.ts");
assert.match(
  parser,
  /kind:\s*"shard_infrastructure_unavailable"/,
  "ETF API parser must expose a distinct shard-infrastructure result",
);
assert.match(
  parser,
  /STOCKANALYSIS_ETF_SHARD_UNAVAILABLE/,
  "ETF API parser must recognize the typed shard error",
);

const route = source("src/app/api/data/stockanalysis/[assetType]/[ticker]/route.ts");
assert.match(route, /STOCKANALYSIS_ETF_SHARD_UNAVAILABLE/);
assert.match(route, /kind === "shard_unavailable"/);
assert.doesNotMatch(
  route,
  /getEtfSurfaceFallback/,
  "ETF detail route must not downgrade failures or absence through a surface summary",
);
assert.match(
  route,
  /bypassCache:\s*resolution\.kind === "shard_unavailable"/,
  "typed shard failures must bypass any previously cached success",
);

const detail = source("src/app/etfs/[ticker]/EtfDetailClient.tsx");
assert.match(detail, /status:\s*"shard_infrastructure_unavailable"/);
assert.match(detail, /data-etf-shard-infrastructure-state="unavailable"/);

const compare = source("src/app/etfs/compare/EtfCompareClient.tsx");
assert.match(compare, /loadState:\s*"shard_infrastructure_unavailable"/);
assert.match(compare, /data-etf-compare-shard-infrastructure-state="unavailable"/);

const stock = source("src/app/stock/[ticker]/StockDetailClient.tsx");
assert.match(stock, /kind:\s*"shard_infrastructure_unavailable"/);
assert.match(stock, /data-stock-etf-shard-infrastructure-state="unavailable"/);

console.log("stockanalysis ETF client contracts passed");
