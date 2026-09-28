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
check(
  Math.abs(budget - 79.87) < 0.01,
  `derived side-axis budget moved to ${budget.toFixed(2)}; if the geometry changed on purpose, update this expectation deliberately`,
);

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

// 3. No second copy of the geometry. Scoped to renderRadar, because the same
//    file legitimately holds other charts with their own fixed viewBoxes.
const source = readFileSync(rendererPath, "utf8");
const start = source.indexOf("function renderRadar(");
check(start !== -1, "renderRadar is gone from the stock-detail client");
const renderer = start === -1 ? "" : source.slice(start, source.indexOf("\n  }", start));
check(
  renderer.includes("EDGE_RADAR_GEOMETRY"),
  "renderRadar no longer reads EDGE_RADAR_GEOMETRY; a second copy of the geometry has appeared",
);
check(
  !/viewBox="0 0 \d+ \d+"/.test(renderer),
  "renderRadar hardcodes a viewBox again; it must come from EDGE_RADAR_GEOMETRY",
);
check(
  !/\b(cx|cy|maxR)\s*=\s*\d+/.test(renderer),
  "renderRadar restates cx/cy/maxR; those live in EDGE_RADAR_GEOMETRY",
);
check(
  renderer.includes("edgeAxisRadarLines"),
  "renderRadar builds its label text itself again; it must call edgeAxisRadarLines",
);

// 4. Every axis the renderer declares has a label in the shared map.
for (const match of source.matchAll(/key: "([A-Za-z]+Score)"/g)) {
  check(
    Object.hasOwn(EDGE_AXIS_SPOKE_LABELS, match[1]),
    `the client declares axis ${match[1]} with no spoke label in the shared map`,
  );
}

if (failures.length > 0) {
  console.error("test-edge-axis-label-budget: FAIL");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(
  `test-edge-axis-label-budget: ok — budget ${budget.toFixed(2)}, widest "${widest.text}" ${widest.width.toFixed(1)} (${widest.key})`,
);
