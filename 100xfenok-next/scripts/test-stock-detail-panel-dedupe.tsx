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

assert.equal(sha256(sparkIncomplete), "a79233b3a340e3f72f721ffd146c3c48fedda017efe7248d695ee85d4260959e");
assert.equal(sha256(sparkComplete), "aa2bc152f59ebecb38fa6921f4bbeeab3d8246595d431ee110101f1844c2bbed");
assert.equal(sha256(perIncomplete), "0031cdbb244a13126fe718459fe508465c157398252ea6207c65d610baaf098d");
assert.equal(sha256(perComplete), "f5055426e837a56d1deeeb0c3b8e8df1985c44e12065b42532ffb3c7eb0f440c");

console.log("[test-stock-detail-panel-dedupe] OK");
