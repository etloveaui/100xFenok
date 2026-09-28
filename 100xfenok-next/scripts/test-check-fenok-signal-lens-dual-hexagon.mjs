#!/usr/bin/env node
// Focused regression for the dual-hexagon UI contract update:
// positive = shipped live bar-panel layout passes; negatives = a disconnected
// renderer and missing required data bindings must fail; plus wiring and
// strictness guards (stale markers out, numerical/null/data/privacy checks in).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOCK_DETAIL_PANEL_UI_FILE,
  STOCK_DETAIL_PANEL_UI_MARKERS,
  markerMissing,
} from "../../scripts/lib/dual-hexagon-ui-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const live = fs.readFileSync(path.join(appRoot, STOCK_DETAIL_PANEL_UI_FILE), "utf8");
const gateSource = fs.readFileSync(
  path.join(__dirname, "check-fenok-signal-lens-dual-hexagon.mjs"),
  "utf8",
);

// 1. Positive: shipped live layout satisfies the current contract.
assert.deepEqual(
  markerMissing(live),
  [],
  "live StockDetailPanel.tsx must satisfy every current bar-panel marker",
);

// 2. Negative: disconnected renderer (panel no longer rendered).
const disconnected = live.replaceAll("<SharedEdgePanel", "");
assert.ok(
  markerMissing(disconnected).includes("<SharedEdgePanel"),
  "disconnected renderer must be rejected",
);

// 3. Negative: missing required score binding.
const noScore = live.replaceAll("shortScore={shortTermConvictionScore}", "");
assert.ok(
  markerMissing(noScore).includes("shortScore={shortTermConvictionScore}"),
  "missing shortScore data binding must be rejected",
);

// 4. Negative: missing required rows binding.
const noRows = live.replaceAll("shortRows={", "");
assert.ok(
  markerMissing(noRows).includes("shortRows={"),
  "missing shortRows data binding must be rejected",
);

// 5. Negative: Bar import without actual <Bar rendering must be rejected.
const noBarRender = live.replaceAll("<Bar ", "");
assert.ok(
  markerMissing(noBarRender).includes("<Bar value={row.score ?? 0}"),
  "missing <Bar rendering binding must be rejected",
);

// 6. Negative: each renderRows invocation must be required independently.
const noShortRenderRows = live.replaceAll("renderRows(shortRows)", "");
assert.ok(
  markerMissing(noShortRenderRows).includes("renderRows(shortRows)"),
  "missing renderRows(shortRows) invocation must be rejected",
);
const noLongRenderRows = live.replaceAll("renderRows(longRows)", "");
assert.ok(
  markerMissing(noLongRenderRows).includes("renderRows(longRows)"),
  "missing renderRows(longRows) invocation must be rejected",
);

// 7. Wiring: the gate consumes the shared contract list.
assert.match(
  gateSource,
  /STOCK_DETAIL_PANEL_UI_MARKERS/,
  "gate must use the shared STOCK_DETAIL_PANEL_UI_MARKERS contract",
);

// 8. Stale markers stay out of the contract (radar / removed call badge /
//    legacy aria/labels must not be demanded from the shipped layout).
for (const stale of [
  "FenokSignalRadarHexagonPair",
  "shortTermConvictionCall",
  "aria-label={`Fenok Edge",
  "Short Edge",
]) {
  assert.equal(
    STOCK_DETAIL_PANEL_UI_MARKERS.includes(stale),
    false,
    `stale marker must stay out of the contract: ${stale}`,
  );
}

// 9. Strictness retained: numerical/null/data/privacy checks remain in force.
assert.ok(
  STOCK_DETAIL_PANEL_UI_MARKERS.includes("투자 조언이 아닙니다"),
  "privacy disclaimer marker must remain required",
);
assert.ok(
  STOCK_DETAIL_PANEL_UI_MARKERS.includes("aria-label={`${row.label}"),
  "null-aware per-row aria semantics must remain required",
);
assert.match(gateSource, /"shortTermConvictionCall"/, "data-layer convictionCall contract must stay in the gate");
assert.match(gateSource, /conviction_call/, "full composite conviction_call data keys must stay in the gate");
assert.match(
  gateSource,
  /shortPressureProxy hexagon axis must render as inverted safety display/,
  "inverted numerical display check must stay in the gate",
);
assert.match(
  gateSource,
  /signal help bands must use display-aware inverted bands/,
  "display-aware help band check must stay in the gate",
);

console.log(JSON.stringify({
  ok: true,
  suite: "dual-hexagon-ui-contract",
  positive_live_layout: true,
  negatives: [
    "disconnected_renderer",
    "missing_score_binding",
    "missing_rows_binding",
    "missing_bar_render",
    "missing_renderrows_short",
    "missing_renderrows_long",
  ],
  stale_markers_excluded: 4,
  gate_wired_to_shared_contract: true,
  numerical_null_data_privacy_strictness: "retained",
}, null, 2));
