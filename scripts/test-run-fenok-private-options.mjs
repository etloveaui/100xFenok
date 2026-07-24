#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SCHEDULED_TICKERS,
  buildAvailabilityMarker,
  runYahooPrivateOptions,
  validAvailabilityMarker,
} from "./run-fenok-private-options.mjs";

function makeSummary(observedAt, { failedCount = 0 } = {}) {
  const rows = SCHEDULED_TICKERS.map((ticker, index) => ({
    ticker,
    status: index < failedCount ? "failed" : "ready",
    ...(index < failedCount ? { reason: "provider_error" } : {
      fetched_at: observedAt,
      expiry_count: 2,
      call_rows: 4,
      put_rows: 5,
    }),
  }));
  return {
    schema_version: "fenok-private-options-collection-summary/v1",
    generated_at: observedAt,
    scheduled: true,
    tickers: [...SCHEDULED_TICKERS],
    requested_count: 8,
    ready_count: rows.filter((row) => row.status === "ready").length,
    failed_count: rows.filter((row) => row.status === "failed").length,
    results: rows,
  };
}

function tempRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fenok-private-options-${tag}-`));
}

{
  const marker = buildAvailabilityMarker(makeSummary("2026-07-18T01:10:00Z"));
  assert.equal(validAvailabilityMarker(marker), true);
  assert.deepEqual(marker.tickers, SCHEDULED_TICKERS);
  assert.equal(marker.counts.ready, 8);
  const serialized = JSON.stringify(marker);
  for (const forbidden of ["contractSymbol", "strike", "bid", "ask", "openInterest", '"calls"', '"puts"', '"options"']) {
    assert.equal(serialized.includes(forbidden), false, `marker leaked ${forbidden}`);
  }
}

{
  const root = tempRoot("success");
  try {
    const observedAt = "2026-07-18T01:10:00Z";
    const result = runYahooPrivateOptions({
      repoRoot: root,
      observedAt,
      runId: "run-success",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary(observedAt),
    });
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(fs.existsSync(path.join(root, "data/computed/fenok_yahoo_private_options_availability.json")), true);
    const publicMirror = path.join(root, "100xfenok-next/public/data/computed/fenok_yahoo_private_options_availability.json");
    assert.equal(fs.existsSync(publicMirror), true);
    assert.deepEqual(
      fs.readFileSync(publicMirror),
      fs.readFileSync(path.join(root, "data/computed/fenok_yahoo_private_options_availability.json")),
    );
    assert.equal(fs.existsSync(path.join(root, "data/admin/yahoo_private_options/index.json")), true);
    assert.equal(fs.existsSync(path.join(root, "data/admin/data-supply-state/detection-attempts/yahoo_private_options.json")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempRoot("lkg");
  try {
    const firstAt = "2026-07-17T01:10:00Z";
    runYahooPrivateOptions({
      repoRoot: root,
      observedAt: firstAt,
      runId: "run-first",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary(firstAt),
    });
    const canonical = path.join(root, "data/computed/fenok_yahoo_private_options_availability.json");
    const firstBytes = fs.readFileSync(canonical);
    const partial = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: "2026-07-18T00:10:00Z",
      runId: "run-partial",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary("2026-07-18T00:10:00Z", { failedCount: 1 }),
    });
    assert.equal(partial.degraded, true);
    assert.equal(partial.corrupt, false);
    assert.equal(partial.exitCode, 0);
    assert.deepEqual(fs.readFileSync(canonical), firstBytes);

    const failed = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: "2026-07-18T01:10:00Z",
      runId: "run-failed",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary("2026-07-18T01:10:00Z", { failedCount: 8 }),
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.corrupt, true);
    assert.equal(failed.exitCode, 2);
    assert.deepEqual(fs.readFileSync(canonical), firstBytes);
    const state = JSON.parse(fs.readFileSync(path.join(root, "data/admin/yahoo_private_options/index.json"), "utf8"));
    assert.equal(state.items.availability.resolution_state, "lkg_primary");
    assert.equal(state.items.availability.retry, true);

    const recoveredAt = "2026-07-19T01:10:00Z";
    const recovered = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: recoveredAt,
      runId: "run-recovered",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary(recoveredAt),
    });
    assert.equal(recovered.ok, true);
    const recoveredState = JSON.parse(fs.readFileSync(path.join(root, "data/admin/yahoo_private_options/index.json"), "utf8"));
    assert.equal(recoveredState.items.availability.retry, false);
    assert.equal(recoveredState.items.availability.recovered_from_run_id, "run-failed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempRoot("controlled-failure");
  try {
    const baselineAt = "2026-07-17T01:10:00Z";
    const baseline = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: baselineAt,
      runId: "controlled-baseline",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary(baselineAt),
    });
    assert.equal(baseline.ok, true);
    const canonical = path.join(root, "data/computed/fenok_yahoo_private_options_availability.json");
    const baselineBytes = fs.readFileSync(canonical);

    let collectCalls = 0;
    const injected = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: "2026-07-18T01:10:00Z",
      runId: "controlled-failure-run",
      runAttempt: 1,
      eventName: "workflow_dispatch",
      controlledFailureKey: "availability",
      collect: () => {
        collectCalls += 1;
        throw new Error("controlled failure must not call the provider");
      },
    });
    assert.equal(collectCalls, 0);
    assert.equal(injected.ok, false);
    assert.equal(injected.reason, "controlled_failure");
    assert.equal(injected.degraded, true);
    assert.equal(injected.corrupt, false);
    assert.equal(injected.exitCode, 0);
    assert.deepEqual(injected.retrySet, ["availability"]);
    assert.deepEqual(fs.readFileSync(canonical), baselineBytes);
    const failedState = JSON.parse(fs.readFileSync(path.join(root, "data/admin/yahoo_private_options/index.json"), "utf8"));
    assert.equal(failedState.items.availability.resolution_state, "lkg_primary");
    assert.equal(failedState.items.availability.latest_failure.run_id, "controlled-failure-run");
    assert.equal(failedState.items.availability.latest_failure.reason, "controlled_failure");

    const recoveredAt = "2026-07-19T01:10:00Z";
    const recovered = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: recoveredAt,
      runId: "controlled-recovery",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary(recoveredAt),
    });
    assert.equal(recovered.ok, true);
    const recoveredState = JSON.parse(fs.readFileSync(path.join(root, "data/admin/yahoo_private_options/index.json"), "utf8"));
    assert.equal(recoveredState.items.availability.retry, false);
    assert.equal(recoveredState.items.availability.recovered_from_run_id, "controlled-failure-run");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempRoot("controlled-failure-rejected");
  try {
    assert.throws(() => runYahooPrivateOptions({
      repoRoot: root,
      eventName: "schedule",
      controlledFailureKey: "availability",
    }), /controlled failure requires workflow_dispatch/);
    assert.throws(() => runYahooPrivateOptions({
      repoRoot: root,
      eventName: "workflow_dispatch",
      controlledFailureKey: "availability,other",
    }), /unknown controlled private options key/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = tempRoot("no-lkg");
  try {
    const result = runYahooPrivateOptions({
      repoRoot: root,
      observedAt: "2026-07-18T01:10:00Z",
      runId: "run-failed",
      runAttempt: 1,
      eventName: "schedule",
      collect: () => makeSummary("2026-07-18T01:10:00Z", { failedCount: 8 }),
    });
    assert.equal(result.corrupt, true);
    assert.equal(result.exitCode, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("test-run-fenok-private-options: ok");
