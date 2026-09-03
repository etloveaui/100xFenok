import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import * as hookModule from "../src/hooks/use13FData";

const root = path.resolve(import.meta.dirname, "..");
const clientSource = fs.readFileSync(
  path.join(root, "src/app/superinvestors/SuperinvestorsClient.tsx"),
  "utf8",
);

type Settled<T> = { data: T | null; failed: boolean };
type ResolveLoad = (sources: {
  consensus: Settled<unknown>;
  summary: Settled<unknown>;
  byTicker: Settled<unknown>;
  enhancedConsensus: Settled<unknown>;
  bySector: Settled<unknown>;
  convictionEntries: Settled<unknown>;
}) => {
  result: { dataReady: boolean; failed: boolean; summary: unknown; consensus: unknown };
  failedRequests: string[];
};

const resolveLoad = (hookModule as unknown as { resolve13FLoad?: ResolveLoad }).resolve13FLoad;
const ok = <T>(data: T): Settled<T> => ({ data, failed: false });
const missing = (): Settled<unknown> => ({ data: null, failed: true });
const summary = { metadata: { source_quarter: "2026-Q2" }, investors: { alpha: { name: "Alpha" } } };
const consensus = { metadata: { quarter: "2026-Q2", excluded_stale_investors: [] }, consensus: { NVDA: { ticker: "NVDA" } } };

test("public 13F requests use root-absolute canonical paths and a QA-safe timeout", () => {
  assert.ok(hookModule.SEC_13F_FETCH_TIMEOUT_MS >= 12_000);
  assert.ok(hookModule.SEC_13F_FETCH_TIMEOUT_MS <= 20_000);
  for (const requestPath of [
    "/data/sec-13f/analytics/consensus.json",
    "/data/sec-13f/summary.json",
    "/data/sec-13f/by_ticker.json",
    "/data/sec-13f/analytics/enhanced_consensus.json",
    "/data/sec-13f/by_sector.json",
    "/data/sec-13f/analytics/conviction_entries.json",
  ]) {
    assert.ok(fs.readFileSync(path.join(root, "src/hooks/use13FData.ts"), "utf8").includes(requestPath));
  }
  assert.ok(clientSource.includes('fetch13FJson<TurnoverData>("/data/sec-13f/analytics/turnover.json")'));
});

test("a healthy holder summary survives a consensus failure as partial data", () => {
  assert.equal(typeof resolveLoad, "function");
  if (!resolveLoad) return;
  const load = resolveLoad({
    consensus: missing(),
    summary: ok(summary),
    byTicker: missing(),
    enhancedConsensus: missing(),
    bySector: missing(),
    convictionEntries: missing(),
  });
  assert.equal(load.result.dataReady, true);
  assert.equal(load.result.failed, false);
  assert.equal(load.result.summary, summary);
  assert.equal(load.result.consensus, null);
  assert.ok(load.failedRequests.includes("consensus"));
});

test("the page is fatal only when both panel-driving feeds are unavailable", () => {
  assert.equal(typeof resolveLoad, "function");
  if (!resolveLoad) return;
  const load = resolveLoad({
    consensus: missing(),
    summary: missing(),
    byTicker: ok({}),
    enhancedConsensus: missing(),
    bySector: missing(),
    convictionEntries: missing(),
  });
  assert.equal(load.result.dataReady, false);
  assert.equal(load.result.failed, true);
});

test("holders and overlap expose their own feed failures", () => {
  assert.ok(clientSource.includes("const holdersFailed"));
  assert.ok(clientSource.includes("const overlapFailed"));
  assert.ok(clientSource.includes("error={holdersFailed}"));
  assert.ok(clientSource.includes("error={overlapFailed}"));
});
