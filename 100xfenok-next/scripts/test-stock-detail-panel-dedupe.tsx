import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PerBandChart,
  Sparkline,
  chartValueLabelPlacement,
} from "../src/app/screener/StockDetailPanel";

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

assert.equal(sha256(sparkIncomplete), "c6b2aa3b8253190c8c9fb02a93ebf31a76bf3cfb50eb0cfaef2729e500b207b2");
assert.equal(sha256(sparkComplete), "e6f9745693172f5f152c34b20655057f9e24c60f5080efa1ce1f1321f62bb655");
assert.equal(sha256(perIncomplete), "e33cbdd9ec65e367287b0a61979631b7a28bd809ba0b58e654045cd4808c7db3");
assert.equal(sha256(perComplete), "cb4c4f8773a4cabebe1603a8e12a94953b8169f357415062ac93e1b74c1e281a");

console.log("[test-stock-detail-panel-dedupe] OK");
