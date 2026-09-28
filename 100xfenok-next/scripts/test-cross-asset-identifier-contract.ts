import assert from "node:assert/strict";

import {
  normalizeForEntityKey,
  normalizeForFilePath,
  normalizeForRouteTicker,
} from "../src/lib/ticker";
import { normalizeStockConnectionTicker } from "../src/lib/data-entity-graph/stock-index";
import {
  marketFactsShardFileName,
  marketFactsTickerKey,
} from "../src/lib/market-facts-shard.mjs";
import {
  stockanalysisEtfShardFileName,
  stockanalysisEtfTickerKey,
} from "../src/lib/stockanalysis-etf-shard.mjs";

function assertSameNormalization(...values: string[]) {
  const normalized = values.map((value) => ({
    entity: normalizeForEntityKey(value),
    file: normalizeForFilePath(value),
    route: normalizeForRouteTicker(value),
    connection: normalizeStockConnectionTicker(value),
    marketFacts: marketFactsTickerKey(value),
    stockAnalysisEtf: stockanalysisEtfTickerKey(value),
  }));
  for (const value of normalized.slice(1)) assert.deepEqual(value, normalized[0]);
  return normalized[0];
}

// Ordinary ticker and one leading display "$" are the same identity everywhere.
const tqqq = assertSameNormalization("TQQQ", "$TQQQ", " tqqq ");
assert.equal(tqqq.marketFacts, "TQQQ");
assert.equal(tqqq.stockAnalysisEtf, "TQQQ");
assert.equal(marketFactsShardFileName("$TQQQ"), marketFactsShardFileName("TQQQ"));
assert.equal(stockanalysisEtfShardFileName("$TQQQ"), stockanalysisEtfShardFileName("TQQQ"));

// Dot/dash class aliases are deliberately not collapsed by current contracts.
assert.equal(normalizeForEntityKey("BRK.A"), "BRK.A");
assert.equal(normalizeForFilePath("BRK-B"), "BRK-B");
assert.notEqual(normalizeForEntityKey("BRK.A"), normalizeForEntityKey("BRK-B"));
assert.notEqual(stockanalysisEtfTickerKey("BRK.A"), stockanalysisEtfTickerKey("BRK-B"));
assert.notEqual(marketFactsTickerKey("BRK.A"), marketFactsTickerKey("BRK-B"));

// Exchange suffixes are distinct securities and must remain distinct identities.
assert.notEqual(normalizeForEntityKey("000001.SZ"), normalizeForEntityKey("000001.SS"));
assert.notEqual(marketFactsTickerKey("000001.SZ"), marketFactsTickerKey("000001.SS"));
assert.notEqual(stockanalysisEtfTickerKey("000001.SZ"), stockanalysisEtfTickerKey("000001.SS"));

console.log(JSON.stringify({
  ok: true,
  suite: "cross-asset identifier contract",
  cases: ["ordinary/$ ticker", "BRK.A vs BRK-B", "000001.SZ vs 000001.SS"],
}, null, 2));
