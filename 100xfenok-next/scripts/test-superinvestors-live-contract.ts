import assert from "node:assert/strict";
import test from "node:test";

import * as hookModule from "../src/hooks/use13FData";

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
