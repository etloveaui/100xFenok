#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareSemantic } from "./check-sec13f-live-parity.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(ROOT, ".github/workflows/check-sec13f-live-parity.yml");

const canonical = {
  summary: {
    metadata: {
      source_quarter: "2026-Q2",
      quarters_covered: Array.from({ length: 31 }, (_, index) => `q-${index}`),
      investor_count: 60,
    },
  },
  consensus: {
    metadata: {
      current_cohort_investors: 56,
      excluded_stale_investors: ["einhorn", "ackman", "scion", "vanguard"],
    },
  },
  byTicker: { AAPL: {}, MSFT: {}, NVDA: {} },
};

function liveFromCanonical() {
  return {
    summary: structuredClone(canonical.summary),
    consensus: structuredClone(canonical.consensus),
    byTicker: structuredClone(canonical.byTicker),
  };
}

function statuses(overrides = {}) {
  return { summary: 200, consensus: 200, byTicker: 200, ...overrides };
}

const baseline = compareSemantic({ canonical, live: liveFromCanonical(), statuses: statuses() });
assert.equal(baseline.ok, true, "matching live payloads must pass");

const quarterDrift = liveFromCanonical();
quarterDrift.summary.metadata.source_quarter = "2026-Q1";
assert.equal(compareSemantic({ canonical, live: quarterDrift, statuses: statuses() }).ok, false);

const historyDrift = liveFromCanonical();
historyDrift.summary.metadata.quarters_covered.pop();
assert.equal(compareSemantic({ canonical, live: historyDrift, statuses: statuses() }).ok, false);

const investorCountDrift = liveFromCanonical();
investorCountDrift.summary.metadata.investor_count = 59;
assert.equal(compareSemantic({ canonical, live: investorCountDrift, statuses: statuses() }).ok, false);

const staleOrderChange = liveFromCanonical();
staleOrderChange.consensus.metadata.excluded_stale_investors.reverse();
assert.equal(
  compareSemantic({ canonical, live: staleOrderChange, statuses: statuses() }).ok,
  true,
  "stale-list ordering is semantic-insensitive",
);

const staleMemberDrift = liveFromCanonical();
staleMemberDrift.consensus.metadata.excluded_stale_investors[0] = "different";
assert.equal(compareSemantic({ canonical, live: staleMemberDrift, statuses: statuses() }).ok, false);

const tickerCountDrift = liveFromCanonical();
delete tickerCountDrift.byTicker.NVDA;
assert.equal(compareSemantic({ canonical, live: tickerCountDrift, statuses: statuses() }).ok, false);

const serviceFailure = compareSemantic({
  canonical,
  live: liveFromCanonical(),
  statuses: statuses({ summary: 530 }),
});
assert.equal(serviceFailure.ok, false, "an HTTP 530 must fail closed");

const missingKey = liveFromCanonical();
delete missingKey.consensus.metadata.current_cohort_investors;
assert.equal(compareSemantic({ canonical, live: missingKey, statuses: statuses() }).ok, false);

const workflow = fs.readFileSync(workflowPath, "utf8");
for (const required of [
  "15 10 * * *",
  "workflow_dispatch",
  "origin/main",
  "scripts/ops/check-sec13f-live-parity.mjs",
  "scripts/test-sec13f-live-privacy.mjs",
  "continue-on-error: true",
  "issues: write",
]) {
  assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `workflow contract missing ${required}`);
}

console.log("check-sec13f-live-parity: ok (semantic drift, route failure, missing-key and workflow cases)");
