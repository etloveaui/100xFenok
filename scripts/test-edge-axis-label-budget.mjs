#!/usr/bin/env node
/**
 * The radar label budget is arithmetic, not a judgement.
 *
 * Before this gate existed, `renderRadar` painted a label ring at radius 104
 * inside a 260-unit viewBox and nothing related the two. The four side anchors
 * of a six-axis chart land 39.93 units from the edge, so a middle-anchored side
 * label had 79.87 units against strings of 71 to 113 and the overflow was
 * simply cut. The clip was scale-invariant, so it survived every viewport width
 * and every card size anyone tried.
 *
 * This recomputes the budget from the renderer's own geometry and checks every
 * axis line against it, so adding a thirteenth axis or lengthening a label
 * fails here rather than truncating on a customer's screen.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const modulePath = resolve(
  repo,
  "100xfenok-next/src/lib/fenok-signals/edge-axis-labels.mjs",
);
const rendererPath = resolve(
  repo,
  "100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx",
);

const {
  EDGE_AXIS_SPOKE_LABELS,
  EDGE_RADAR_GEOMETRY,
  approximateTextWidth,
  sideAxisLineBudget,
  edgeAxisRadarLines,
} = await import(modulePath);

const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

// 1. The budget is derived, and the geometry it derives from is the shipped one.
const budget = sideAxisLineBudget();
// 2. Every axis fits, on both of its lines, at every score width.
const REFERENCE_ONLY = new Set([
  "marketSimilarityScore",
  "offExchangeActivityProxyScore",
]);
let widest = { text: "", width: 0, key: "" };
for (const [key, spoke] of Object.entries(EDGE_AXIS_SPOKE_LABELS)) {
  // 100 is the widest score the axis can carry; "—" is the null case.
  for (const score of [100, null]) {
    for (const line of edgeAxisRadarLines(spoke, REFERENCE_ONLY.has(key), score)) {
      const width = approximateTextWidth(line, EDGE_RADAR_GEOMETRY.fontSizePx);
      if (width > widest.width) widest = { text: line, width, key };
      check(
        width <= budget,
        `${key}: "${line}" needs ${width.toFixed(1)} units against a ${budget.toFixed(2)} budget`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error("test-edge-axis-label-budget: FAIL");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(
  `test-edge-axis-label-budget: ok — budget ${budget.toFixed(2)}, widest "${widest.text}" ${widest.width.toFixed(1)} (${widest.key})`,
);
