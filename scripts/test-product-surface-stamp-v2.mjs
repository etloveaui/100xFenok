#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS,
  PRODUCT_SURFACE_DATELESS_REASON,
  REQUIRED_SURFACE_IDS,
} from "./lib/kpi-contract-constants.mjs";
import {
  classifyProductSurfaceV2,
  deriveProductSurfaceStampEvidence,
  nextProductSurfaceLineageV2,
} from "./lib/product-surface-stamp-v2.mjs";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-07-16T03:40:44Z";
const DATELESS_REASON = "provider publishes no aggregate source date";
const date = (id, source_as_of) => ({ id, stamp_class: "date_bearing", source_as_of });
const dateless = (id, collected_at = "2026-07-16T01:00:00Z", extra = {}) => ({
  id, stamp_class: "dateless_by_provider", source_as_of: null,
  source_as_of_reason: DATELESS_REASON,
  recency_label: PRODUCT_SURFACE_DATELESS_REASON,
  collected_at,
  ...extra,
});
let passed = 0;
function ok(label) { passed += 1; console.log(`  ok - ${label}`); }
function evidence(members, now = NOW) { return deriveProductSurfaceStampEvidence(members, now); }
function requiredRows(surfaceEvidence) {
  return REQUIRED_SURFACE_IDS.map((id) => ({ id, source_as_of: surfaceEvidence.date_bearing.source_floor_as_of, stamp_evidence: surfaceEvidence }));
}

console.log("# product surface stamp taxonomy v2 fixtures");

{
  const e = evidence([date("priced", "2026-07-15"), dateless("events")]);
  assert.equal(e.state, "stamped"); assert.equal(e.date_bearing.source_floor_as_of, "2026-07-15"); assert.equal(e.dateless_by_provider.collection_fresh_count, 1);
  ok("1 all true dates + collection-fresh dateless => stamped");
}
{
  const members = Array.from({ length: 718 }, (_, i) => date(`etf:${i}`, i < 506 ? (i === 0 ? "2026-06-29" : "2026-07-08") : null));
  const e = evidence(members);
  assert.equal(e.state, "pending_true_date"); assert.equal(e.date_bearing.stamped_count, 506); assert.equal(e.date_bearing.missing_count, 212);
  assert.equal(e.date_bearing.source_floor_as_of, "2026-06-29"); assert.equal(e.date_bearing.coverage_ratio, Number((506 / 718).toFixed(6)));
  ok("2 ETF 506/718 emits true-date subset floor and pending_true_date");
}
{
  assert.equal(evidence([date("required", null)]).state, "pending_true_date");
  assert.equal(evidence([date("required", "bad")]).state, "shape_error");
  ok("3 static date-bearing null cannot downgrade to dateless; malformed is hard");
}
{
  const e = evidence([dateless("events")]);
  assert.equal(e.state, "stamped"); assert.equal(e.date_bearing.source_floor_as_of, null); assert.equal(e.dateless_by_provider.reason, PRODUCT_SURFACE_DATELESS_REASON);
  ok("4 dateless null + provider reason + fresh collected_at is collection-fresh");
}
{
  const e = evidence([dateless("events", undefined, { source_as_of: "2026-07-15" })]);
  assert.equal(e.state, "shape_error"); assert.ok(e.shape_errors.some((m) => m.includes("provider now publishes a date; reclassify surface to date_bearing")));
  ok("5 dateless non-null source date fails with actionable reclassification");
}
{
  for (const member of [
    { ...dateless("a"), source_as_of_reason: null },
    { ...dateless("b"), collected_at: null },
    { ...dateless("c"), collected_at: "bad" },
    { ...dateless("d"), collected_at: "2026-07-17T00:00:00Z" },
  ]) assert.notEqual(evidence([member]).state, "stamped");
  ok("6 dateless missing reason/time, malformed/future collection time fail closed");
}
{
  const e = evidence([dateless("events", "2026-07-13T00:00:00Z")]);
  assert.equal(e.state, "collection_stale"); assert.equal(e.dateless_by_provider.stale_count, 1);
  ok("7 collection older than 50h is lane-local collection_stale");
}
{
  const e = evidence([date("priced", "2026-07-01"), dateless("events", "2026-07-16T01:00:00Z")]);
  assert.equal(e.date_bearing.source_floor_as_of, "2026-07-01"); assert.equal(e.dateless_by_provider.collected_at_floor, "2026-07-16T01:00:00Z");
  ok("8 mixed domain keeps source and collection floors independent");
}
{
  const e = evidence([date("priced", "2026-07-15")]);
  const rows = requiredRows(e); rows[0].stamp_evidence = structuredClone(e); rows[0].stamp_evidence.date_bearing.stamped_count = 0;
  const cls = classifyProductSurfaceV2(rows, NOW, REQUIRED_SURFACE_IDS);
  assert.equal(cls.kind, "shape_error"); assert.ok(cls.shape_errors.some((m) => m.includes("re-derivation mismatch")));
  ok("9 count/ratio/denominator aggregate tamper is rejected by member re-derivation");
}
{
  assert.equal(evidence([date("priced", "2026-07-17")]).state, "future_anomaly");
  assert.equal(evidence([dateless("events", "2026-07-17T00:00:00Z")]).state, "future_anomaly");
  ok("10 true-source and collection future anomalies are independently hard");
}
{
  const migrated = nextProductSurfaceLineageV2({ legacyV1: { pending_since: "2026-07-01T00:00:00Z", ever_stamped: true }, kind: "pending_true_date", nowIso: NOW });
  assert.deepEqual(migrated.lineage.superseded_v1, { pending_since: "2026-07-01T00:00:00Z", ever_stamped: true, classification: "legacy-fabricated", disposition: "superseded" });
  assert.equal(migrated.lineage.v2.ever_stamped, false); assert.equal(migrated.regressed, false);
  ok("11 v1 ever_stamped is frozen as superseded and does not fabricate v2 regression");
}
{
  const first = nextProductSurfaceLineageV2({ kind: "stamped", nowIso: NOW }).lineage;
  const later = nextProductSurfaceLineageV2({ priorLineage: first, kind: "pending_true_date", nowIso: "2026-07-17T00:00:00Z" });
  assert.equal(later.regressed, true); assert.equal(later.lineage.v2.ever_stamped, true); assert.deepEqual(later.lineage.superseded_v1, first.superseded_v1);
  assert.throws(() => nextProductSurfaceLineageV2({ priorLineage: { ...first, active_version: 1 }, kind: "stamped", nowIso: NOW }), /downgrade or deletion/);
  assert.throws(() => nextProductSurfaceLineageV2({ priorLineage: { ...first, superseded_v1: { ...first.superseded_v1, disposition: "changed" } }, kind: "stamped", nowIso: NOW }), /mutated/);
  assert.throws(() => nextProductSurfaceLineageV2({ priorLineage: { ...first, superseded_v1: { ...first.superseded_v1, extra: true } }, kind: "stamped", nowIso: NOW }), /missing\/malformed/);
  ok("12 v2 regression named; downgrade/deletion/frozen legacy mutation rejected");
}
{
  const e = evidence([date("priced", "2026-07-15"), dateless("events")]);
  assert.equal(classifyProductSurfaceV2(requiredRows(e), NOW, REQUIRED_SURFACE_IDS).kind, "stamped");
  const tampered = requiredRows(e); tampered[2].stamp_evidence = structuredClone(e); tampered[2].stamp_evidence.date_bearing.source_floor_as_of = "2026-07-14";
  assert.equal(classifyProductSurfaceV2(tampered, NOW, REQUIRED_SURFACE_IDS).kind, "shape_error");
  ok("13 builder/checker shared classifier re-derives taxonomy and policy evidence");
}
{
  const e = evidence([date("priced", "2026-07-15"), dateless("events")]);
  const lineage = nextProductSurfaceLineageV2({ kind: "stamped", nowIso: NOW }).lineage;
  const root = { schema_version: "fenok-data-health-kpi/v2", source_sla: [{ source_id: "product_surface_coverage", source_stamp_version: 2, required_surface_rows: requiredRows(e), stamp_lineage: lineage }] };
  const pub = projectPublicKpi(root, NOW);
  assert.deepEqual(pub.source_sla[0], root.source_sla[0]); assert.ok(!JSON.stringify(pub).includes("private_path"));
  ok("14 source/public projection preserves exact v2 taxonomy and lineage without private fields");
}
{
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/fetch-stockanalysis.yml"), "utf8");
  const crons = [...workflow.matchAll(/- cron:\s*['\"]([^'\"]+)['\"]/g)].map((m) => m[1]);
  assert.ok(crons.includes("50 23 * * 1-5")); assert.ok(crons.includes("20 23 * * 0"));
  const occurrences = [];
  for (let day = 0; day < 21; day += 1) {
    const d = new Date(Date.UTC(2026, 6, 5 + day));
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) occurrences.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 50));
    if (d.getUTCDay() === 0) occurrences.push(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 20));
  }
  occurrences.sort((a, b) => a - b);
  const maxGap = Math.max(...occurrences.slice(1).map((value, i) => (value - occurrences[i]) / 3600000));
  assert.equal(maxGap, 47.5); assert.equal(PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS, 50); assert.ok(maxGap < PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS);
  ok("15 cron-policy pin proves the declared surface schedule remains within 50h");
}

console.log(`# ${passed} fixtures passed`);
