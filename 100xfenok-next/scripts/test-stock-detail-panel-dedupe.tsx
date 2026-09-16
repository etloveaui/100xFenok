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
assert.equal(renderHashes.perIncomplete, "c40a11126ccd398391833e57c32989b53149e79832d2f18781b93249d707b575");
assert.equal(renderHashes.perComplete, "eba6f05e5c490d0ef832f7c6383fae3911ac82c582540b38554850e85dc27270");

console.log("[test-stock-detail-panel-dedupe] OK");
