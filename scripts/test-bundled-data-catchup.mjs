import assert from "node:assert/strict";
import { catchupDecision, checkCatchup, isBundleInput } from "./check-bundled-data-catchup.mjs";
const live = { schema_version: "deploy-provenance/v1", sha: "a".repeat(40), build_id: "live-1" };
const decision = (files, extra = {}) => catchupDecision({ live, buildId: "live-1\n", files, ...extra });
assert.equal(decision([]), "skip-unchanged");
assert.equal(decision([...Array.from({ length: 450 }, (_, i) => `docs/${i}.md`), "data/yf/finance/AAPL.json"]), "proceed", "no 300-file compare cap");
assert.equal(decision(["docs/example.md", "ops/a1-lanes/external-clock.mjs", "data/admin/private-probe/evidence.json"]), "skip-unchanged");
for (const file of ["data/yf/finance/AAPL.json", "data/global-scouter/core/stocks_analyzer.json",
  "data/computed/market_facts/tickers/AAPL.json", "data/stockanalysis/etfs/SPY.json",
  "100xfenok-next/public/data/computed/data-supply/etf-detail/payloads/SPY.json",
  "data/admin/data-supply-state/etf-detail/index.json"]) assert.equal(decision([file]), "proceed", file);
assert.equal(decision(["data/admin/fred_macro/index.json"], { publicFiles: new Set(["100xfenok-next/public/data/admin/fred_macro/index.json"]) }), "proceed");
for (const status of ["pending", "queued", "in_progress", "waiting", "requested"]) {
  assert.equal(catchupDecision({ codeRuns: [{ event: "push", status }] }), "skip-code-deploy");
}
assert.throws(() => decision([], { buildId: "another" }), /inconsistent/);
assert.throws(() => decision(undefined), /unavailable/);
assert.equal(isBundleInput(".github/workflows/deploy-worker.yml"), false);
// Real I/O seam: a busy code deploy requires no live fetch and no Git diff.
let reads = 0;
assert.equal(await checkCatchup({ head: "b".repeat(40), repo: "etloveaui/100xFenok",
  command: () => JSON.stringify([{ event: "push", status: "in_progress" }]),
  fetchImpl: () => { reads++; throw new Error("must not fetch"); },
}), "skip-code-deploy");
assert.equal(reads, 0);
// Identical serving source or a docs-only diff is a no-op; diff failure is red.
for (const diff of ["", "docs/readme.md\0"]) {
  assert.equal(await checkCatchup({ head: "b".repeat(40), repo: "etloveaui/100xFenok",
    command: (cmd, args) => cmd === "gh" ? "[]" : args[0] === "diff" ? diff : "",
    fetchImpl: async (url) => new Response(url.includes("/BUILD_ID") ? "live-1" : JSON.stringify(live)),
  }), "skip-unchanged");
}
await assert.rejects(checkCatchup({ head: "b".repeat(40), repo: "etloveaui/100xFenok",
  command: (cmd) => { if (cmd === "gh") return "[]"; throw new Error("missing tree"); },
  fetchImpl: async (url) => new Response(url.includes("/BUILD_ID") ? "live-1" : JSON.stringify(live)),
}), /missing tree/);
console.log("bundled data catch-up: PASS (unchanged, docs/admin-only, bundle families, code priority, identity and I/O failures)");
