#!/usr/bin/env node
// Focused tests for the Yoo replica negative result. No network.
//
// These do not test a model — there is no identified model. They pin the things that would
// silently rot: the correction chain, the guards that were frozen after specific mistakes, and
// the assertion that no current Yoo valuation exists anywhere in the namespace.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const Y = path.join(__dirname, "..", "data", "computed", "rim-index", "yoo-replica");
const read = (f) => JSON.parse(fs.readFileSync(path.join(Y, f), "utf8"));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(path.join(Y, f))).digest("hex");

let passed = 0;
const ok = (name) => { passed += 1; console.log(`PASS ${name}`); };

// ---- 0. the chain is the source of truth for every version-indexed check below ----
// Hardcoding a version list is how this file twice claimed coverage it did not have. Every
// version-indexed assertion now derives its list from the chain instead.
const eqChain = read("equation-identification.json").correction_chain;

// ---- 1. every freeze from v2 onward has its paired receipt, and every receipt matches ----
// v3 shipped without one. That is why this test exists.
const receiptVersions = eqChain.filter((c) => Number(c.version.slice(1)) >= 2);
assert.ok(receiptVersions.length >= 1, "no versions at or above v2 found in the chain");
for (const c of receiptVersions) {
  const criteria = c.file;
  const receipt = criteria.replace(/\.json$/, "-receipt.json");
  assert.ok(fs.existsSync(path.join(Y, receipt)), `${criteria} has no paired receipt`);
  const r = read(receipt);
  assert.equal(r.receipt_for.split("/").pop(), criteria,
    `${receipt} receipt_for points at ${r.receipt_for}, not ${criteria}`);
  assert.equal(r.criteria_sha256.length, 64, `${receipt} stores a truncated criteria hash`);
  assert.equal(r.criteria_sha256, sha(criteria), `${receipt} hash does not match ${criteria}`);
}
ok(`every freeze from v2 to v${eqChain.length} (${receiptVersions.length} of them) has a paired receipt whose receipt_for resolves and whose hash matches`);

// ---- 2. the correction chain is intact, ordered, and EVERY entry's hash is verified ----
// An earlier version of this test verified v1..v3 while reporting v1..v5 intact, and the chain
// stored truncated hashes for the versions it did not check. A test that overstates its own
// coverage is worse than no test, so this one iterates the chain and refuses truncation.
const eq = read("equation-identification.json");
const chain = eqChain;
assert.ok(chain.length >= 5, `correction chain has only ${chain.length} entries`);
chain.forEach((c, i) => {
  assert.equal(c.version, `v${i + 1}`, `chain is out of order at position ${i}: ${c.version}`);
  assert.ok(c.file, `${c.version} does not name its file`);
  assert.ok(fs.existsSync(path.join(Y, c.file)), `${c.version} names a missing file ${c.file}`);
  assert.equal(c.sha256.length, 64, `${c.version} stores a truncated hash (${c.sha256.length} chars)`);
  assert.equal(c.sha256, sha(c.file), `${c.version} hash drifted from ${c.file}`);
});
ok(`correction chain v1..v${chain.length} verified: every entry names its file and matches a full 64-char hash`);

// every freeze file on disk must appear in the chain — no orphan version
const onDisk = fs.readdirSync(Y).filter((f) => /^evidence-freeze(-v\d+)?\.json$/.test(f));
assert.equal(onDisk.length, chain.length,
  `${onDisk.length} freeze files on disk but ${chain.length} chain entries — an orphan version exists`);
ok(`all ${onDisk.length} freeze files on disk are accounted for in the chain`);

// ---- 3. the verdict is the negative one, and no promotion leaked in ----
assert.equal(eq.status, "YOO_METHOD_NOT_IDENTIFIED");
assert.equal(eq.branch, "B — negative result, closed");
for (const forbidden of ["STRONGLY_RECONSTRUCTED", "YOO_METHOD_VERIFIED", "MORE_RESEARCH_NEEDED"]) {
  assert.ok(!eq.status.includes(forbidden), `status leaked ${forbidden}`);
}
ok("status is YOO_METHOD_NOT_IDENTIFIED, branch B, with no promotion leaked into it");

// ---- 4. G_LEVEL is not cleared, and the PBR stays a candidate ----
// v4 cleared this against a gate v2 had already frozen. This test is the scar.
const book = eq.what_remains_open.book_basis_2018;
assert.equal(book.status, "UNRESOLVED — the whole of the open question");
assert.match(book.same_report_pbr.class, /HIGH-VALUE CANDIDATE/);
assert.match(book.same_report_pbr.class, /NOT a cleared G_LEVEL/);
assert.match(book.same_report_pbr.why_not_admissible, /2018-10-11/);
assert.match(book.same_report_pbr.why_not_admissible, /2018-10-12/);
ok("G_LEVEL is not cleared and the same-report PBR remains a FENO_MAPPING candidate, with both dates recorded");

// ---- 5. the AGGREGATE_EQUITY_IS_NOT_BPS guard survives ----
const v2 = read("evidence-freeze-v2.json");
const guard = v2.guard_against_the_specific_error_this_freeze_anticipates;
assert.equal(guard.name, "AGGREGATE_EQUITY_IS_NOT_BPS");
assert.match(guard.rule, /never/i);
ok("the AGGREGATE_EQUITY_IS_NOT_BPS guard is present and still forbidding");

// ---- 6. the rejected retention estimator stays rejected and visible ----
const est = eq.what_remains_open.retention_b.admissible_estimators;
assert.equal(est.E1_roae_identity, 0.8010);
assert.equal(est.E2_printed_payout, 0.8569);
assert.match(String(est.E3_beginning_equity), /REJECTED/);
// and the identity itself must still hold
const g = 0.070486, roae = 0.085;
const b = (2 * g) / (roae * (2 + g));
assert.ok(Math.abs(b - 0.8010) < 5e-4, `ROAE identity gives ${b}, expected 0.8010`);
ok(`retention estimators frozen; b = 2g/[ROAE(2+g)] recomputes to ${b.toFixed(4)}`);

// ---- 7. D1 is refuted book-free and D2/D3 are NOT discriminated ----
const disc = eq.what_is_established.rp_is_not_in_the_discount;
assert.equal(disc.D1_d_equals_rf_plus_rp.gates, "FAIL");
assert.equal(disc.D2_d_equals_rf_plus_c.gates, "PASS");
assert.equal(disc.D3_d_constant.gates, "PASS");
const gap = Math.abs(disc.D2_d_equals_rf_plus_c.median - disc.D3_d_constant.median);
assert.ok(gap < 1e-3, "D2 and D3 medians must remain within a rounding of each other");
assert.match(disc.what_this_does_not_settle, /D2 versus D3/);
ok("D1 refuted book-free; D2 and D3 remain undiscriminated and the record says so");

// ---- 8. exact namespace allowlist — no stray or renamed JSON may appear ----
const expected = new Set([
  "equation-identification.json",
  "historical-fixtures.json",
  "matrix-fingerprints.json",
  ...eqChain.map((c) => c.file),
  ...eqChain.filter((c) => Number(c.version.slice(1)) >= 2)
    .map((c) => c.file.replace(/\.json$/, "-receipt.json")),
]);
const actual = new Set(fs.readdirSync(Y).filter((f) => f.endsWith(".json")));
const extra = [...actual].filter((f) => !expected.has(f));
const missing = [...expected].filter((f) => !actual.has(f));
assert.deepEqual(extra, [], `unexpected JSON in the namespace: ${extra.join(", ")}`);
assert.deepEqual(missing, [], `expected JSON missing: ${missing.join(", ")}`);
ok(`namespace holds exactly the ${expected.size} allowlisted JSON files, derived from the chain and its receipts`);

// ---- 8b. no current valuation anywhere, checked structurally rather than by literal ----
const CUR = /(current|fair|target|base|bear|bull|grid_mean)/i;
const IDX = /\b(spx|ndx|qqq|s&p|nasdaq|sp500)\b/i;
function walk(node, keyPath, file) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) { node.forEach((v) => walk(v, keyPath, file)); return; }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) walk(v, `${keyPath}.${k}`, file);
    return;
  }
  if (typeof node !== "number") return;
  // a numeric leaf under a key that names a current/fair/target value for an index is forbidden
  const looksLikeValuation = CUR.test(keyPath) && IDX.test(keyPath);
  const inIndexRange = (node > 500 && node < 50000);
  assert.ok(!(looksLikeValuation && inIndexRange),
    `${file}${keyPath} = ${node} looks like a current index valuation and must not exist here`);
}
for (const f of actual) walk(read(f), "", f);
assert.equal(eq.no_current_values.current_yoo_fair_value_emitted, false);
for (const phase of ["E6_semantic_adapter", "E7_current_SPX_NDX_QQQ", "E8_reverse_implied"]) {
  assert.equal(eq.no_current_values[phase], "NOT RUN", `${phase} must stay unrun`);
}
ok("no numeric leaf anywhere in the namespace reads as a current index valuation; E6/E7/E8 stay unrun");

// ---- 8c. the v6 gate outcomes stay as scored, and v7 stays accurate ----
const scored = eq.discriminator_executed_and_scored;
assert.match(scored.verdict, /FAIL/, "G_B_SOURCED must remain a FAIL");
assert.match(scored.g_c_global.verdict, /CANNOT CLEAR/, "G_C_GLOBAL must remain uncleared");
assert.match(scored.g_n_unique.verdict, /NOT CLEARED/, "G_N_UNIQUE must remain uncleared");
assert.equal(scored.final, "NOT_IDENTIFIED");
const v7 = read("evidence-freeze-v7.json");
assert.match(v7.nature, /RECORD-INTEGRITY CORRECTION ONLY/);
assert.equal(Object.keys(v7.correction_2_prefix_hashes_in_immutable_freezes.authoritative_full_hashes).length, 6);
for (const [v, hh] of Object.entries(v7.correction_2_prefix_hashes_in_immutable_freezes.authoritative_full_hashes)) {
  assert.equal(hh.length, 64, `v7 records a short hash for ${v}`);
}
assert.match(eq.governing_criteria, /EMBEDDED receipt/);
assert.match(eq.governing_criteria, /PAIRED/);
ok("v6 gate outcomes hold (G_B_SOURCED FAIL, G_C_GLOBAL uncleared, G_N_UNIQUE uncleared) and v7's record is accurate");

// ---- 9. the fixture corpus still clears the corpus gates ----
const fx = read("historical-fixtures.json");
assert.ok(fx.counts.merged_independent >= 5, "independent matrix count fell below the frozen minimum");
assert.equal(fx.counts.distinct_report_dates, 2);
assert.equal(fx.counts.distinct_asset_types, 3);
assert.ok(fx.provenance.handler_error_disclosed.includes("overwrote"), "the cp overwrite disclosure was removed");
ok(`corpus gates hold: ${fx.counts.merged_independent} independent matrices, 2 dates, 3 asset types`);

// ---- 10. handler errors stay on the record ----
assert.ok(eq.handler_errors_recorded_not_quietly_fixed.length >= 4,
  "the handler error list was trimmed");
ok(`${eq.handler_errors_recorded_not_quietly_fixed.length} handler errors remain recorded rather than quietly fixed`);

console.log(`\n${passed} checks passed`);
