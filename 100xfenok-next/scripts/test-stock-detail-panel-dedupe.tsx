import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// StockDetailPanel now imports the shared earnings panel and its CSS module.
// Node's static renderer needs a CSS-module loader before that dependency loads.
const testRequire = createRequire(import.meta.url);
const previousCssLoader = testRequire.extensions[".css"];
testRequire.extensions[".css"] = (module, filename) => {
  const classNames = new Set(
    Array.from(readFileSync(filename, "utf8").matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g), match => match[1]),
  );
  module.exports = Object.fromEntries(Array.from(classNames, name => [name, name]));
};
let sharedPanel: typeof import("../src/app/screener/StockDetailPanel");
try {
  sharedPanel = testRequire("../src/app/screener/StockDetailPanel");
  const { yfFinanceForDisplay, latestYfRecommendation } = testRequire("../src/app/stock/[ticker]/StockTabs");
  const captured = {
    source_as_of: "2026-10-09", info: { regularMarketPrice: 22, targetMeanPrice: 31, targetLowPrice: 0, heldPercentInsiders: 0, heldPercentInstitutions: 0.6 },
    analyst_price_targets: { high: 35 }, major_holders: { institutionsCount: 12 },
  };
  const original = JSON.stringify(captured);
  const display = yfFinanceForDisplay(captured);
  assert.equal(display.info.currentPrice, 22);
  assert.deepEqual(display.analyst_price_targets, { high: 35, low: 0, mean: 31 });
  assert.deepEqual(display.major_holders, { institutionsCount: 12, insidersPercentHeld: 0, institutionsPercentHeld: 0.6 });
  assert.equal(display.source_as_of, captured.source_as_of);
  assert.equal(JSON.stringify(captured), original, "captured provider values and clocks are immutable");
  assert.deepEqual(yfFinanceForDisplay(display), display, "display mapping is idempotent");
  const populated = yfFinanceForDisplay({ info: { currentPrice: 0, regularMarketPrice: 99, targetMeanPrice: 99 }, analyst_price_targets: { mean: 0 } });
  assert.equal(populated.info.currentPrice, 0);
  assert.equal(populated.analyst_price_targets.mean, 0);
  assert.equal(yfFinanceForDisplay({ info: { regularMarketPrice: "12" } }).info.currentPrice, undefined);
  assert.equal(yfFinanceForDisplay({}).info.currentPrice, undefined);
  assert.equal(yfFinanceForDisplay(null), null);
  const current = { period: "0m", buy: 1 };
  const old = { period: "-1m", buy: 0 };
  assert.equal(latestYfRecommendation([current, old]), current);
  assert.equal(latestYfRecommendation([old, current]), current);
  assert.equal(latestYfRecommendation([{ period: "-2m", buy: 4 }, old]), old, "do not fill an empty latest row from older recommendations");
  assert.equal(latestYfRecommendation([{ buy: 4 }, { period: "+1m", buy: 8 }]), null);

} finally {
  if (previousCssLoader) testRequire.extensions[".css"] = previousCssLoader;
  else delete testRequire.extensions[".css"];
}
const { PerBandChart, Sparkline, chartValueLabelPlacement } = sharedPanel;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

assert.deepEqual(
  chartValueLabelPlacement({
    x: 100,
    y: 50,
    rightBoundary: 270,
    topBoundary: 10,
    defaultXOffset: 6,
    defaultAnchor: "start",
  }),
  { x: 106, y: 40, anchor: "start" },
  "Sparkline normal label policy stays offset-right and start-anchored",
);
assert.deepEqual(
  chartValueLabelPlacement({
    x: 260,
    y: 20,
    rightBoundary: 270,
    topBoundary: 10,
    defaultXOffset: 6,
    defaultAnchor: "start",
  }),
  { x: 254, y: 34, anchor: "end" },
  "Sparkline near-edge label policy stays left/down and end-anchored",
);
assert.deepEqual(
  chartValueLabelPlacement({
    x: 100,
    y: 50,
    rightBoundary: 270,
    topBoundary: 12,
    defaultXOffset: 0,
    defaultAnchor: "middle",
  }),
  { x: 100, y: 40, anchor: "middle" },
  "PER normal label policy stays centered",
);
assert.deepEqual(
  chartValueLabelPlacement({
    x: 260,
    y: 20,
    rightBoundary: 270,
    topBoundary: 12,
    defaultXOffset: 0,
    defaultAnchor: "middle",
  }),
  { x: 254, y: 34, anchor: "end" },
  "PER near-edge label policy stays left/down and end-anchored",
);

const sparkIncomplete = renderToStaticMarkup(createElement(Sparkline, {
  data: [10, 20, 15],
  years: ["2024", "2025", "2026"],
  estimates: { fy1: 25, fy2: null, fy3: 30 },
  color: "red",
  formatValue: (value: number) => value.toFixed(1),
}));
const sparkComplete = renderToStaticMarkup(createElement(Sparkline, {
  data: [10, 20, 15],
  years: ["2024", "2025", "2026"],
  estimates: { fy1: 25, fy2: 28, fy3: 30 },
  color: "red",
  formatValue: (value: number) => value.toFixed(1),
}));
const perProps = {
  years: ["2024", "2025", "2026"],
  per: [12, 18, 24],
  perBands: { current: 24, min_8y: 10, avg_8y: 20, max_8y: 30, source: "test" },
};
const perIncomplete = renderToStaticMarkup(createElement(PerBandChart, {
  ...perProps,
  estimates: { fy1: 26, fy2: null, fy3: 28 },
}));
const perComplete = renderToStaticMarkup(createElement(PerBandChart, {
  ...perProps,
  estimates: { fy1: 26, fy2: 27, fy3: 28 },
}));

const renderHashes = {
  sparkIncomplete: sha256(sparkIncomplete),
  sparkComplete: sha256(sparkComplete),
  perIncomplete: sha256(perIncomplete),
  perComplete: sha256(perComplete),
};
assert.equal(renderHashes.sparkIncomplete, "c6b2aa3b8253190c8c9fb02a93ebf31a76bf3cfb50eb0cfaef2729e500b207b2");
assert.equal(renderHashes.sparkComplete, "e6f9745693172f5f152c34b20655057f9e24c60f5080efa1ce1f1321f62bb655");
assert.equal(renderHashes.perIncomplete, "83bdd6461923adbd1efbbe5baf04256f925bd6fdd4fbc03d660bdf42e78f0626");
assert.equal(renderHashes.perComplete, "081bd17bea18c726c3bdb1a8bd0628b6b59e2393b816605e4dd4232d877e6ce8");

console.log("[test-stock-detail-panel-dedupe] OK");
