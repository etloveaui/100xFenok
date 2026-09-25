// Shared UI contract for src/app/screener/StockDetailPanel.tsx, consumed by
// 100xfenok-next/scripts/check-fenok-signal-lens-dual-hexagon.mjs and its
// focused regression test.
//
// Shipped reality (2026-09-03 shared light-system replacement, slice-4): the
// surface renders EdgeMark + bar rows only — no gauges/radars/donuts. The old
// radar/call/label markers were intentionally removed with that replacement;
// the numerical, null, data and privacy checks stay in the gate untouched.

export const STOCK_DETAIL_PANEL_UI_FILE = "src/app/screener/StockDetailPanel.tsx";

export const STOCK_DETAIL_PANEL_UI_MARKERS = [
  // Axis config + builders (unchanged since the gate-era revision).
  "const DETAIL_LONG_TERM_AXIS_CONFIG",
  "const DETAIL_SHORT_TERM_AXIS_CONFIG",
  "function buildDetailLongTermAxes",
  "function buildDetailShortTermAxes",
  // Common-basis copy/view + conviction score data flow.
  "commonBasisShortTermView",
  "shortTermCommonBasisCopy",
  "shortTermConvictionScore",
  // Owner-mandate comment: Short Edge (단기) / Long Edge (장기) as substance.
  "Long Edge",
  // Shipped shared bar-panel: primitives import, definition, identity.
  'import { Panel, PanelHeader, Row, Bar, EdgeMark, EvidenceRail } from "@/components/ui"',
  "export function SharedEdgePanel",
  "<SharedEdgePanel",
  'eyebrow = "Fenok Edge"',
  // Data bindings at the render sites.
  "shortScore={shortTermConvictionScore}",
  "longScore={longTermConvictionScore}",
  "shortRows={",
  "longRows={",
  "단기 축",
  "장기 축",
  // Null-aware per-row semantics, evidence rail, privacy line.
  "aria-label={`${row.label}",
  "<EvidenceRail",
  "투자 조언이 아닙니다",
  // Actual Row+Bar rendering and BOTH axis row invocations (a blank panel
  // must not pass: import-only is insufficient).
  "<Row key={row.key}>",
  "<Bar value={row.score ?? 0}",
  "renderRows(shortRows)",
  "renderRows(longRows)",
  // Explicit current null score display: visible dash and waiting text.
  'row.score !== null ? Math.round(row.score) : "—"',
  'row.score !== null ? Math.round(row.score) : "대기"}점',
];

export function markerMissing(text, markers = STOCK_DETAIL_PANEL_UI_MARKERS) {
  return markers.filter((marker) => !text.includes(marker));
}
