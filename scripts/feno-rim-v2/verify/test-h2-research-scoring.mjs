#!/usr/bin/env node

// FENO RIM v2 — Phase 3B: h2-research-scoring contract tests.
//
// Proves on real repo data: determinism (identical per-index block and sha
// across two builds), the research_only flag, the absence of any promotion
// key with a value, rates within [0,1], and the origin counts matching the
// feasibility receipt (same harness call, same data).

import assert from "node:assert/strict";
import { buildResearchScoring } from "./h2-research-scoring.mjs";
import { readJson } from "../adapters/panel-common.mjs";

const receipt = readJson("data/computed/feno-rim-v2/h2-feasibility-receipt.json");

// --- determinism ------------------------------------------------------------

const s1 = buildResearchScoring();
const s2 = buildResearchScoring();
assert.deepEqual(s1.per_index, s2.per_index, "per-index scoring must be identical across builds");
assert.equal(s1.scoring_sha256, s2.scoring_sha256, "scoring hash must be stable (generated_at excluded)");

// --- research-only surface --------------------------------------------------

assert.equal(s1.research_only, true, "research_only flag must be true");
assert.equal(s1.promotion, null, "promotion must be null");

// No key named "promotion" may carry a value anywhere in the artifact.
(function walk(node, pathSoFar) {
  if (Array.isArray(node)) {
    node.forEach((child, i) => walk(child, `${pathSoFar}[${i}]`));
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "promotion" && value !== null) {
        assert.fail(`promotion key with a value at ${pathSoFar}.${key}`);
      }
      walk(value, `${pathSoFar}.${key}`);
    }
  }
})(s1, "$");

// --- per-index contract -----------------------------------------------------

const indexIds = Object.keys(s1.per_index);
assert.ok(indexIds.length === 6, "all six indices must be scored");

for (const id of indexIds) {
  const s = s1.per_index[id];
  const r = receipt.indices[id];
  assert.ok(s, `${id}: scored block present`);

  // Rates within [0,1].
  assert.ok(s.coverage_rate >= 0 && s.coverage_rate <= 1, `${id}: coverage_rate in [0,1]`);
  assert.ok(s.directional_rate >= 0 && s.directional_rate <= 1, `${id}: directional_rate in [0,1]`);

  // Origin count must match the feasibility receipt (same harness, same data).
  assert.equal(s.origins_scored, r.origins_scored, `${id}: origins_scored matches the receipt`);

  // Hull is a finite ordered band; status NULL while the ERP band is unproven.
  assert.ok(Number.isFinite(s.hull.low) && Number.isFinite(s.hull.high), `${id}: hull finite`);
  assert.ok(s.hull.low < s.hull.high, `${id}: hull ordered`);
  assert.equal(s.hull.public_status, "NULL", `${id}: NULL public status expected in research mode`);
  assert.ok(s.hull.null_reasons.includes("core_erp_unidentified"), `${id}: null reason named`);

  // Dividend adjustment count must match the receipt.
  assert.equal(s.dividend_adjusted, r.dividend_adjusted_origins, `${id}: dividend_adjusted matches the receipt`);

  // CIs are ordered when present.
  if (s.ci.coverage) assert.ok(s.ci.coverage.ci_lower <= s.ci.coverage.ci_upper, `${id}: coverage CI ordered`);
  if (s.ci.directional) assert.ok(s.ci.directional.ci_lower <= s.ci.directional.ci_upper, `${id}: directional CI ordered`);

  // ESS reported from the receipt.
  assert.equal(s.ess_capped, r.ess.ess_capped, `${id}: ess_capped matches the receipt`);
}

console.log("feno-rim-v2 h2-research-scoring tests passed");
