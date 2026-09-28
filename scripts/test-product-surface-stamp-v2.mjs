#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { businessDayAge } from "./lib/market-calendar.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCT_SURFACE_COLLECTION_MAX_AGE_HOURS,
  PRODUCT_SURFACE_DATELESS_REASON,
  REQUIRED_SURFACE_IDS,
} from "./lib/kpi-contract-constants.mjs";
import {
  classifyProductSurfaceV2,
  createProductSurfaceIssuerLifecycle,
  deriveProductSurfaceStampEvidence,
  nextProductSurfaceLineageV2,
  validateProductSurfaceCoverageV2Artifact,
} from "./lib/product-surface-stamp-v2.mjs";
import { registerKpiFixtureRoot } from "./lib/kpi-fixture-hermetic-fs-guard.mjs";
import { assertProductSurfaceCoverageV2Contract } from "../100xfenok-next/scripts/smoke-stockanalysis-routes.mjs";
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

// v3 changes ETF membership eligibility only; v2 defaults above remain intact.
function lifecycleFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "product-issuer-lifecycle-"));
  registerKpiFixtureRoot(tmp);
  const dataRoot = path.join(tmp, "data");
  const now = "2026-09-28T03:00:00Z";
  const symbols = ["IWDL", "IWFL", "IWML", "MTUL", "QULL", "SCDL", "USML"];
  const events = symbols.map((symbol) => ({symbol, event: "issuer_announced_redemption", effective_date: "2026-08-19",
    effective_date_basis: "issuer_expected_settlement", issuer: "UBS AG", primary_source_domain: "etracs.ubs.com",
    source_urls: ["https://etracs.ubs.com/news/show-article/id/724", "https://etracs.ubs.com/news/show-article/id/727"],
    notice_date: "2026-07-16", source_published_date: "2026-07-16", settlement_amount_notice_date: "2026-08-17",
    last_trading_date_expected: "2026-08-18", settlement_date_expected: "2026-08-19", payment_status: "not_verified"}));
  events.push({symbol: "MMC", event: "ticker_rename", alias_target: "MRSH", issuer: "Marsh McLennan",
    primary_source_domain: "marshmclennan.com", notice_date: "2025-10-14", source_published_date: "2025-10-16",
    announced_month: "2026-01", eligibility_after: "2026-02-01", eligibility_basis: "after_announced_month",
    source_urls: ["https://www.marshmclennan.com/web-assets/files-for-download/investors/2025/pdf-2025-marsh-mclennan-investors-3q-news-release.pdf"]});
  const write = (rel, value) => {const file = path.join(dataRoot, rel); fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");};
  const policy = {schema_version: "yahoo-issuer-lifecycle/v1", events};
  const policyRel = "admin/yahoo-batch-quote-history/issuer-lifecycle.json";
  write(policyRel, policy);
  write("yf/finance/MRSH.json", {schema_version: "yf-finance/v2", ticker: "MRSH", profile: "daily",
    fetched_at: "2026-09-26T01:54:48Z", quote_as_of: "2026-09-25T20:00:02Z", history_as_of: "2026-09-25", source_as_of: "2026-09-25",
    data: {info: {symbol: "MRSH", regularMarketPrice: 171.12, regularMarketTime: 1790366402}, history_1y: [{date: "2026-09-25", Close: 171.12}]}});
  const members = [...Array.from({length: 976}, (_, i) => date(`etf_detail:ACT${String(i).padStart(4, "0")}`,
    i < 855 ? (i === 0 ? "2026-06-29" : "2026-09-25") : null)), ...symbols.map((symbol) => date(`etf_detail:${symbol}`, null))];
  const index = {schema_version: "data-supply-etf-detail-public-index/v1", entries: Object.fromEntries(members.map((member) => {
    const ticker = member.id.slice("etf_detail:".length); return [ticker, {ticker, source_as_of: member.source_as_of}];}))};
  const indexRel = "computed/data-supply/etf-detail/index.json"; write(indexRel, index);
  const overlay = createProductSurfaceIssuerLifecycle(members, now, {dataRoot});
  const options = {policyVersion: 3, issuerLifecycle: overlay.issuerLifecycle, dataRoot, surfaceId: "etf_center"};
  return {tmp, dataRoot, now, symbols, members: overlay.members, originalMembers: members, options, policy, policyRel, index, indexRel, write};
}
{
  const f = lifecycleFixture();
  try {
    const e = deriveProductSurfaceStampEvidence(f.members, f.now, f.options);
    assert.equal(e.policy_version, 3); assert.equal(e.members.length, 983);
    assert.equal(e.membership.catalogue_count, 983); assert.equal(e.membership.active_count, 976); assert.equal(e.membership.inactive_count, 7);
    assert.equal(e.date_bearing.required_count, 976); assert.equal(e.date_bearing.stamped_count, 855);
    assert.equal(e.date_bearing.missing_count, 121); assert.equal(e.date_bearing.source_floor_as_of, "2026-06-29");
    assert.equal(e.state, "pending_true_date");
    assert.ok(businessDayAge(e.date_bearing.source_floor_as_of, f.now.slice(0, 10), "us_market") > 10, "June 29 remains stale");
    assert.deepEqual(e.members.map((row) => row.source_as_of), f.originalMembers.map((row) => row.source_as_of));
    assert.ok(e.members.filter((row) => row.stamp_class === "issuer_notice_inactive").every((row) => row.source_as_of === null));
    assert.ok(e.issuer_lifecycle.events.every((row) => row.payment_status === "not_verified"));
    assert.equal(JSON.stringify(e).includes("admin/yahoo-batch-quote-history/"), false);
    const v2 = deriveProductSurfaceStampEvidence(f.originalMembers, f.now);
    assert.equal(v2.policy_version, 2); assert.equal(v2.date_bearing.required_count, 983); assert.equal(v2.date_bearing.missing_count, 128);
    const dated = f.members.map((row) => row.stamp_class === "date_bearing" ? {...row, source_as_of: "2026-09-25"} : row);
    for (const row of dated) f.index.entries[row.id.slice("etf_detail:".length)].source_as_of = row.source_as_of;
    f.write(f.indexRel, f.index);
    const refreshed = createProductSurfaceIssuerLifecycle(dated, f.now, {dataRoot: f.dataRoot});
    const fresh = deriveProductSurfaceStampEvidence(refreshed.members, f.now, {...f.options, issuerLifecycle: refreshed.issuerLifecycle});
    assert.equal(fresh.state, "stamped"); assert.equal(fresh.date_bearing.missing_count, 0);
    const rows = requiredRows(deriveProductSurfaceStampEvidence([date("active", "2026-09-25")], f.now));
    rows.find((row) => row.id === "etf_center").stamp_evidence = fresh;
    rows.find((row) => row.id === "etf_center").source_as_of = fresh.date_bearing.source_floor_as_of;
    assert.equal(classifyProductSurfaceV2(rows, f.now, REQUIRED_SURFACE_IDS, {dataRoot: f.dataRoot}).kind, "stamped");
    assert.equal(classifyProductSurfaceV2(rows, f.now, REQUIRED_SURFACE_IDS).kind, "shape_error", "emitted v3 facts cannot certify themselves without canonical files");
    ok("v3 preserves 983 catalogue / seven null histories and leaves 121 active nulls pending; fresh active members then stamp");
  } finally {fs.rmSync(f.tmp, {recursive: true, force: true});}
}
{
  const mutations = [
    ["missing policy", (f) => fs.unlinkSync(path.join(f.dataRoot, f.policyRel))],
    ["hash tamper", (f) => {f.options.issuerLifecycle.sha256 = "0".repeat(64);}],
    ["wrong issuer event", (f) => {f.policy.events[0].event = "issuer_completed_acquisition"; f.write(f.policyRel, f.policy);}],
    ["future event", (f) => {f.policy.events[0].effective_date = "2026-10-01"; f.write(f.policyRel, f.policy);}],
    ["policy scope expands beyond seven", (f) => {f.options.issuerLifecycle.inactive_symbols.push("ACT0000");}],
    ["missing inactive row", (f) => {f.members = f.members.filter((row) => row.id !== "etf_detail:IWDL");}],
    ["extra inactive row", (f) => {f.members[0].stamp_class = "issuer_notice_inactive";}],
    ["duplicate catalogue row", (f) => {f.members.push(f.members[0]);}],
    ["canonical catalogue drift", (f) => {delete f.index.entries.ACT0000; f.write(f.indexRel, f.index);}],
    ["tampered alias", (f) => {f.write("yf/finance/MRSH.json", {schema_version: "yf-finance/v2", ticker: "MRSH", data: {}});}],
    ["self-certified proof", (f) => {delete f.options.dataRoot;}],
    ["private locator injection", (f) => {f.options.issuerLifecycle.private_path = "admin/yahoo-batch-quote-history/issuer-lifecycle.json";}],
    ["v3 on another surface", (f) => {f.options.surfaceId = "stock_detail";}],
  ];
  for (const [label, mutate] of mutations) {
    const f = lifecycleFixture();
    try {
      mutate(f);
      if (["wrong issuer event", "future event"].includes(label)) {
        f.options.issuerLifecycle.sha256 = createHash("sha256").update(fs.readFileSync(path.join(f.dataRoot, f.policyRel))).digest("hex");
      }
      const e = deriveProductSurfaceStampEvidence(f.members, f.now, f.options);
      assert.equal(e.state, "shape_error", label);
      assert.ok(e.shape_errors.length > 0, label);
      assert.notEqual(e.state, "stamped");
      assert.equal(JSON.stringify(e).includes("admin/yahoo-batch-quote-history/"), false, `${label}: rejected proof cannot echo a private locator`);
    } finally {fs.rmSync(f.tmp, {recursive: true, force: true});}
  }
  const f = lifecycleFixture();
  try {assert.equal(deriveProductSurfaceStampEvidence(f.members, f.now).state, "shape_error", "inactive class is forbidden in v2");}
  finally {fs.rmSync(f.tmp, {recursive: true, force: true});}
  ok("v3 proof, exact seven identities, complete catalogue, event dates and canonical aliases fail closed under mutation");
}

{
  const f = lifecycleFixture();
  try {
    const stamp = deriveProductSurfaceStampEvidence(f.members, f.now, f.options);
    const ordinary = deriveProductSurfaceStampEvidence([date("ordinary", "2026-09-25")], f.now);
    const artifact = {schema_version: "product-surface-coverage/v2", source_stamp_version: 2, generated_at: f.now,
      surfaces: REQUIRED_SURFACE_IDS.map((id) => {const evidence = id === "etf_center" ? stamp : ordinary;
        return {id, source_as_of: evidence.date_bearing.source_floor_as_of, source_as_of_reason: null, stamp_evidence: evidence};})};
    const originalBytes = JSON.stringify(artifact);
    const verificationNowIso = "2026-09-28T05:00:00Z";
    f.write("yf/finance/MRSH.json", {schema_version: "yf-finance/v2", ticker: "MRSH", profile: "daily",
      fetched_at: "2026-09-28T04:00:00Z", quote_as_of: "2026-09-25T20:00:02Z", history_as_of: "2026-09-25", source_as_of: "2026-09-25",
      data: {info: {symbol: "MRSH", regularMarketPrice: 171.12, regularMarketTime: 1790366402}, history_1y: [{date: "2026-09-25", Close: 171.12}]}});
    assert.deepEqual(validateProductSurfaceCoverageV2Artifact(artifact, {dataRoot: f.dataRoot, verificationNowIso}), [],
      "current legitimate alias acquisition must not invalidate unchanged historical stamp evidence");
    assert.doesNotThrow(() => assertProductSurfaceCoverageV2Contract(artifact, {dataRoot: f.dataRoot, verificationNowIso}),
      "existing route consumer forwards the current alias verification clock");
    assert.ok(validateProductSurfaceCoverageV2Artifact(artifact, {dataRoot: f.dataRoot, verificationNowIso: "2026-09-28T03:30:00Z"}).length > 0,
      "alias fetched after the explicit current verification clock still fails closed");
    assert.equal(JSON.stringify(artifact), originalBytes, "validator and consumer preserve generated_at and every historical evidence byte");
    assert.equal(stamp.date_bearing.missing_count, 121); assert.equal(stamp.date_bearing.source_floor_as_of, "2026-06-29");
    ok("artifact and consumer retain historical stamps while qualifying legitimate aliases at a separate current clock");
  } finally {fs.rmSync(f.tmp, {recursive: true, force: true});}
}

console.log(`# ${passed} fixtures passed`);
