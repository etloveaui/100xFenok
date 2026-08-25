#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  OECD_MAX_ATTEMPT_HISTORY,
  OECD_MAX_MONTHS_PER_SERIES,
  OECD_PERSISTENCE_POLICY,
  OECD_SERIES,
  evaluateOecdProviderProgress,
  parseOecdCsv,
  recordOecdAttempt,
  retainLatestOecdMonths,
  runOecdCliShadow,
  validOecdPayload,
} from "./fetch-oecd-cli.mjs";
import {
  classifyAttempt,
  validateAttemptShard,
} from "./build-data-supply-detection-floor.mjs";
import { buildAttemptRow, returnedTuple } from "./lib/data-supply-attempt-shard.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";

const header = "REF_AREA,TIME_PERIOD,OBS_VALUE\n";
const rows = Object.entries(OECD_SERIES).map(([code, key], index) => `${code},2026-06,${code === "KOR" ? "102.8698" : 100 + index / 100}`).join("\n");
const payload = parseOecdCsv(`${header}${rows}\n`);
assert.equal(Object.keys(payload.series).length, 22);
assert.equal(payload.latest_values.korea, 102.8698, "live-verified KOR anchor is preserved");
assert.equal(payload.records.length, 1);
assert.equal(validOecdPayload(payload), true);
{
  const codes = Object.keys(OECD_SERIES);
  const oneSeriesAdvancedRows = Object.entries(OECD_SERIES)
    .map(([code], index) => `${code},${index === 0 ? "2026-07" : "2026-06"},${100 + index / 100}`)
    .join("\n");
  const oneSeriesAdvanced = parseOecdCsv(`${header}${oneSeriesAdvancedRows}\n`);
  const progress = evaluateOecdProviderProgress(payload, oneSeriesAdvanced);
  assert.equal(progress.eligible, true);
  assert.deepStrictEqual(progress.advanced_series, [OECD_SERIES[codes[0]]]);
  assert.equal(
    evaluateOecdProviderProgress(payload, payload).reason,
    "recovery_not_advanced_by_provider",
  );

  const mixedCadenceRows = Object.entries(OECD_SERIES)
    .map(([code], index) => {
      const period = index === 0 ? "2026-07" : index === 1 ? "2026-05" : "2026-06";
      return `${code},${period},${100 + index / 100}`;
    })
    .join("\n");
  const mixedProgress = evaluateOecdProviderProgress(
    payload,
    parseOecdCsv(`${header}${mixedCadenceRows}\n`),
  );
  assert.equal(mixedProgress.eligible, false);
  assert.deepStrictEqual(mixedProgress.regressed_series, [OECD_SERIES[codes[1]]]);
  assert.deepStrictEqual(mixedProgress.advanced_series, [OECD_SERIES[codes[0]]]);
}
{
  const latestValuesTamper = structuredClone(payload);
  latestValuesTamper.latest_values.korea += 1;
  assert.equal(validOecdPayload(latestValuesTamper), false);

  const recordsValueTamper = structuredClone(payload);
  recordsValueTamper.records[0].values.korea += 1;
  assert.equal(validOecdPayload(recordsValueTamper), false);

  const recordsPeriodTamper = structuredClone(payload);
  recordsPeriodTamper.records[0].period = "2099-12";
  assert.equal(validOecdPayload(recordsPeriodTamper), false);

  const latestDateTamper = structuredClone(payload);
  latestDateTamper.latest_date = "2026-07-01";
  assert.equal(validOecdPayload(latestDateTamper), false);
}
assert.equal(OECD_MAX_MONTHS_PER_SERIES, 240);
assert.deepEqual(OECD_PERSISTENCE_POLICY, {
  schema_version: "oecd-cli-bounded-persistence/v1",
  basis: "monthly_provider_period_per_series",
  max_months_per_series: 240,
  eviction: "oldest_provider_period_first",
});
{
  const monthly = Array.from({ length: OECD_MAX_MONTHS_PER_SERIES + 1 }, (_, index) => {
    const date = new Date(Date.UTC(2000, index, 1)).toISOString().slice(0, 10);
    return { date, value: index };
  });
  const retained = retainLatestOecdMonths(monthly);
  assert.equal(retained.rows.length, OECD_MAX_MONTHS_PER_SERIES);
  assert.equal(retained.persistence_state.pruned_months, 1);
  assert.deepEqual(retainLatestOecdMonths(retained.rows).rows, retained.rows);
  assert.throws(() => retainLatestOecdMonths([{ date: "2026-02-31", value: 1 }]), /valid monthly/);
}
assert.throws(() => parseOecdCsv(`${header}${rows.replace(/^AUS.*\n/mu, "")}`), /missing OECD series/);
assert.throws(() => parseOecdCsv(`${header}${rows}\nXXX,2026-06,100\n`), /unknown OECD area/);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-shadow-"));
  const shadowPath = path.join(root, "admin", "shadow", "oecd-cli.json");
  const parityReportPath = path.join(root, "admin", "parity-report.json");
  const attemptShardPath = path.join(root, "attempts", "oecd_cli.json");
  const canonicalPath = path.join(root, "data", "macro", "activity-surveys.json");
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, "canonical-sentinel\n");
  const result = await runOecdCliShadow({
    repoRoot: root,
    shadowPath,
    parityReportPath,
    attemptShardPath,
    canonicalPath,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-500-1-oecd-cli",
    runId: "500",
    eventName: "schedule",
  });
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(shadowPath, "utf8")).latest_values.korea, 102.8698);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), "canonical-sentinel\n");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "data", "admin", "oecd_cli", "index.json"), "utf8")).retry_set, []);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-state-write-rollback-"));
  const paths = {
    repoRoot: root,
    shadowPath: path.join(root, "data", "admin", "oecd_cli", "shadow", "oecd-cli.json"),
    parityReportPath: path.join(root, "data", "admin", "oecd_cli", "parity-report.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalPath: path.join(root, "missing.json"),
  };
  await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-510-1-oecd-cli",
    runId: "510",
    eventName: "schedule",
  });
  const statePath = path.join(root, "data", "admin", "oecd_cli", "index.json");
  const rolledBackPaths = [paths.shadowPath, paths.parityReportPath];
  const before = new Map(rolledBackPaths.map((filePath) => [filePath, fs.readFileSync(filePath)]));
  const advancedRows = Object.entries(OECD_SERIES)
    .map(([code, key], index) => `${code},2026-07,${code === "KOR" ? "102.9698" : 101 + index / 100}`)
    .join("\n");
  await assert.rejects(
    runOecdCliShadow({
      ...paths,
      request: async () => ({ statusCode: 200, body: `${header}${advancedRows}\n` }),
      observedAt: "2026-08-01T08:00:00Z",
      attemptId: "gh-511-1-oecd-cli",
      runId: "511",
      eventName: "schedule",
      lkgStoreFactory: ({ repoRoot, laneId }) => {
        const store = new LaneLkgStore({ repoRoot, laneId });
        const recordSuccess = store.recordSuccess.bind(store);
        store.recordSuccess = (input) => {
          recordSuccess(input);
          throw new Error("injected recovery state write failure");
        };
        return store;
      },
    }),
    /injected recovery state write failure/,
  );
  for (const filePath of rolledBackPaths) {
    assert.deepEqual(
      fs.readFileSync(filePath),
      before.get(filePath),
      `${path.relative(root, filePath)} must roll back byte-for-byte after state-write failure`,
    );
  }
  const attempt = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8")).attempts[0];
  assert.equal(attempt.execution, "threw");
  assert.deepEqual(classifyAttempt(attempt), {
    status: "unavailable",
    reason: "unexpected_error",
    observed_at: "2026-08-01T08:00:00Z",
  });
  const failedState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(failedState.retry_set, ["oecd_cli"]);
  assert.equal(failedState.items.oecd_cli.resolution_state, "lkg_primary");
  assert.equal(failedState.items.oecd_cli.retry, true);
  assert.deepEqual(failedState.items.oecd_cli.latest_failure, {
    run_id: "511",
    run_attempt: 1,
    observed_at: "2026-08-01T08:00:00Z",
    reason: "unexpected_error",
  });
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-candidate-validation-failure-"));
  const paths = {
    repoRoot: root,
    shadowPath: path.join(root, "data", "admin", "oecd_cli", "shadow", "oecd-cli.json"),
    parityReportPath: path.join(root, "data", "admin", "oecd_cli", "parity-report.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalPath: path.join(root, "missing.json"),
  };
  fs.mkdirSync(path.dirname(paths.shadowPath), { recursive: true });
  fs.writeFileSync(paths.shadowPath, "malformed canonical\n");
  await assert.rejects(
    runOecdCliShadow({
      ...paths,
      request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
      observedAt: "2026-08-02T08:00:00Z",
      attemptId: "gh-512-1-oecd-cli",
      runId: "512",
      eventName: "schedule",
      lkgStoreFactory: ({ repoRoot, laneId }) => {
        const store = new LaneLkgStore({ repoRoot, laneId });
        store.evaluatePromotionCandidates = () => {
          throw new Error("injected candidate validation failure");
        };
        return store;
      },
    }),
    /injected candidate validation failure/,
  );
  const attempt = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8")).attempts[0];
  assert.equal(attempt.execution, "threw");
  assert.deepEqual(classifyAttempt(attempt), {
    status: "unavailable",
    reason: "unexpected_error",
    observed_at: "2026-08-02T08:00:00Z",
  });
  const state = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "oecd_cli", "index.json"),
    "utf8",
  ));
  assert.deepEqual(state.retry_set, ["oecd_cli"]);
  assert.equal(state.items.oecd_cli.resolution_state, "unavailable");
  assert.equal(state.items.oecd_cli.retry, true);
  assert.equal(state.items.oecd_cli.lkg ?? null, null);
  assert.deepEqual(state.items.oecd_cli.latest_failure, {
    run_id: "512",
    run_attempt: 1,
    observed_at: "2026-08-02T08:00:00Z",
    reason: "unexpected_error",
  });
  assert.equal(fs.readFileSync(paths.shadowPath, "utf8"), "malformed canonical\n");
  fs.rmSync(root, { recursive: true, force: true });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-failure-"));
  const shadowPath = path.join(root, "shadow.json");
  const parityReportPath = path.join(root, "parity.json");
  const attemptShardPath = path.join(root, "attempt.json");
  fs.writeFileSync(shadowPath, "shadow-sentinel\n");
  const result = await runOecdCliShadow({
    repoRoot: root,
    shadowPath,
    parityReportPath,
    attemptShardPath,
    canonicalPath: path.join(root, "missing.json"),
    request: async () => { throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); },
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-501-1-oecd-cli",
    runId: "501",
    eventName: "workflow_dispatch",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.failure_detail, /^Error: reset$/);
  assert.equal(fs.readFileSync(shadowPath, "utf8"), "shadow-sentinel\n");
  assert.equal(JSON.parse(fs.readFileSync(attemptShardPath, "utf8")).attempts[0].execution, "threw");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-parse-failure-"));
  const result = await runOecdCliShadow({
    repoRoot: root,
    shadowPath: path.join(root, "shadow.json"),
    parityReportPath: path.join(root, "parity.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalPath: path.join(root, "missing.json"),
    request: async () => ({ statusCode: 200, body: "provider-secret-body" }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-502-1-oecd-cli",
    runId: "502",
    eventName: "workflow_dispatch",
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.failure_detail, /^Error: OECD CSV missing column REF_AREA$/);
  assert.doesNotMatch(result.failure_detail, /provider-secret-body/);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-recovery-"));
  const paths = {
    repoRoot: root,
    shadowPath: path.join(root, "data", "admin", "oecd_cli", "shadow", "oecd-cli.json"),
    parityReportPath: path.join(root, "data", "admin", "oecd_cli", "parity-report.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalPath: path.join(root, "missing.json"),
  };
  await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-600-1-oecd-cli",
    runId: "600",
    eventName: "schedule",
  });
  const failed = await runOecdCliShadow({
    ...paths,
    request: async () => { throw new Error("must not request during controlled failure"); },
    observedAt: "2026-07-21T00:00:00Z",
    attemptId: "gh-601-1-oecd-cli",
    runId: "601",
    eventName: "workflow_dispatch",
    controlledFailure: true,
  });
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["oecd_cli"]);
  const retainedBytes = fs.readFileSync(paths.shadowPath);

  const mixedCadenceRows = Object.entries(OECD_SERIES)
    .map(([code], index) => {
      const period = index === 0 ? "2026-07" : index === 1 ? "2026-05" : "2026-06";
      return `${code},${period},${101 + index / 100}`;
    })
    .join("\n");
  const mixedCadence = await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${mixedCadenceRows}\n` }),
    observedAt: "2026-07-21T00:30:00Z",
    attemptId: "gh-6015-1-oecd-cli",
    runId: "6015",
    eventName: "schedule",
  });
  assert.equal(mixedCadence.reason, "recovery_provider_regression");
  assert.deepStrictEqual(
    fs.readFileSync(paths.shadowPath),
    retainedBytes,
    "one advancing series must not mask another OECD series regression",
  );
  assert.deepEqual(mixedCadence.retrySet, ["oecd_cli"]);

  const dispatch = await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-21T01:00:00Z",
    attemptId: "gh-602-1-oecd-cli",
    runId: "602",
    eventName: "workflow_dispatch",
  });
  assert.equal(dispatch.reason, "recovery_requires_schedule");

  const advancedRows = Object.entries(OECD_SERIES)
    .map(([code, key], index) => `${code},2026-07,${code === "KOR" ? "102.9698" : 101 + index / 100}`)
    .join("\n");
  const recovered = await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${advancedRows}\n` }),
    observedAt: "2026-08-01T08:00:00Z",
    attemptId: "gh-603-1-oecd-cli",
    runId: "603",
    eventName: "schedule",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.retrySet, []);
  const state = JSON.parse(fs.readFileSync(path.join(root, "data", "admin", "oecd_cli", "index.json"), "utf8"));
  assert.equal(state.items.oecd_cli.recovered_from_run_id, "601");
  assert.equal(state.items.oecd_cli.recovery_event_name, "schedule");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-mixed-cadence-advance-"));
  const paths = {
    repoRoot: root,
    shadowPath: path.join(root, "data", "admin", "oecd_cli", "shadow", "oecd-cli.json"),
    parityReportPath: path.join(root, "data", "admin", "oecd_cli", "parity-report.json"),
    attemptShardPath: path.join(root, "attempt.json"),
    canonicalPath: path.join(root, "missing.json"),
  };
  const baselineRows = Object.entries(OECD_SERIES)
    .map(([code], index) => `${code},${index === 0 ? "2026-07" : "2026-06"},${100 + index / 100}`)
    .join("\n");
  await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${baselineRows}\n` }),
    observedAt: "2026-07-20T00:00:00Z",
    attemptId: "gh-610-1-oecd-cli",
    runId: "610",
    eventName: "schedule",
  });
  await runOecdCliShadow({
    ...paths,
    request: async () => { throw new Error("must not request during controlled failure"); },
    observedAt: "2026-07-21T00:00:00Z",
    attemptId: "gh-611-1-oecd-cli",
    runId: "611",
    eventName: "workflow_dispatch",
    controlledFailure: true,
  });
  const advancedRows = Object.entries(OECD_SERIES)
    .map(([code], index) => `${code},${index <= 1 ? "2026-07" : "2026-06"},${101 + index / 100}`)
    .join("\n");
  const recovered = await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${advancedRows}\n` }),
    observedAt: "2026-08-01T08:00:00Z",
    attemptId: "gh-612-1-oecd-cli",
    runId: "612",
    eventName: "schedule",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.retrySet, []);
  assert.equal(
    JSON.parse(fs.readFileSync(paths.shadowPath, "utf8")).latest_date,
    "2026-07-01",
    "per-series progress must recover even when the scalar maximum is unchanged",
  );
  fs.rmSync(root, { recursive: true, force: true });
}

{
  assert.equal(OECD_MAX_ATTEMPT_HISTORY, 24, "default OECD attempt history cap must be 24");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-attempt-history-"));
  const attemptShardPath = path.join(root, "oecd_cli.json");

  // 1. Single attempt with scheduled event provenance
  const row1 = buildAttemptRow({
    laneId: "oecd_cli",
    memberId: null,
    tuple: returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "sdmx_cli_rows", passed: true }],
    }),
    attemptId: "gh-1001-1-oecd-cli",
    observedAt: "2026-08-01T08:00:00Z",
    eventName: "schedule",
    runId: "1001",
    runAttempt: 1,
  });
  assert.equal(row1.event_name, "schedule");
  assert.equal(row1.run_id, "1001");
  assert.equal(row1.run_attempt, 1);

  const shard1 = recordOecdAttempt({ attemptShardPath, row: row1 });
  assert.equal(validateAttemptShard(shard1, "oecd_cli"), true);
  assert.equal(shard1.attempts.length, 1);
  assert.equal(shard1.attempts[0].event_name, "schedule");
  assert.equal(shard1.attempts[0].run_id, "1001");
  assert.equal(shard1.attempts[0].run_attempt, 1);

  // 2. Dispatch run appends and records event_name="workflow_dispatch"
  const row2 = buildAttemptRow({
    laneId: "oecd_cli",
    memberId: null,
    tuple: returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "sdmx_cli_rows", passed: true }],
    }),
    attemptId: "gh-1002-1-oecd-cli",
    observedAt: "2026-08-02T10:00:00Z",
    eventName: "workflow_dispatch",
    runId: "1002",
    runAttempt: 1,
  });
  const shard2 = recordOecdAttempt({ attemptShardPath, row: row2 });
  assert.equal(validateAttemptShard(shard2, "oecd_cli"), true);
  assert.equal(shard2.attempts.length, 2);
  assert.equal(shard2.attempts[0].attempt_id, "gh-1002-1-oecd-cli", "newest observed_at must be first");
  assert.equal(shard2.attempts[0].event_name, "workflow_dispatch");
  assert.equal(shard2.attempts[1].attempt_id, "gh-1001-1-oecd-cli");
  assert.equal(shard2.attempts[1].event_name, "schedule");

  // 3. Re-running the same attempt_id updates in place, preserving length
  const row2Retry = buildAttemptRow({
    laneId: "oecd_cli",
    memberId: null,
    tuple: returnedTuple({
      httpStatus: 200,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "sdmx_cli_rows", passed: true }],
    }),
    attemptId: "gh-1002-1-oecd-cli",
    observedAt: "2026-08-02T10:05:00Z",
    eventName: "workflow_dispatch",
    runId: "1002",
    runAttempt: 2,
  });
  const shard2Updated = recordOecdAttempt({ attemptShardPath, row: row2Retry });
  assert.equal(validateAttemptShard(shard2Updated, "oecd_cli"), true);
  assert.equal(shard2Updated.attempts.length, 2, "re-running same attempt_id must not duplicate rows");
  assert.equal(shard2Updated.attempts[0].run_attempt, 2);
  assert.equal(shard2Updated.attempts[0].observed_at, "2026-08-02T10:05:00Z");

  // 4. Bounded history eviction with custom small cap
  for (let i = 3; i <= 10; i += 1) {
    const day = String(i).padStart(2, "0");
    const row = buildAttemptRow({
      laneId: "oecd_cli",
      memberId: null,
      tuple: returnedTuple({
        httpStatus: 200,
        decode: "ok",
        payload: "non_empty",
        assertions: [{ id: "sdmx_cli_rows", passed: true }],
      }),
      attemptId: `gh-10${day}-1-oecd-cli`,
      observedAt: `2026-08-${day}T08:00:00Z`,
      eventName: i % 2 === 0 ? "schedule" : "workflow_dispatch",
      runId: `10${day}`,
      runAttempt: 1,
    });
    recordOecdAttempt({ attemptShardPath, row, maxAttempts: 5 });
  }
  const cappedShard = JSON.parse(fs.readFileSync(attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(cappedShard, "oecd_cli"), true);
  assert.equal(cappedShard.attempts.length, 5, "attempts must be capped at maxAttempts=5");
  assert.equal(cappedShard.attempts[0].attempt_id, "gh-1010-1-oecd-cli", "newest attempt retained at top");
  assert.equal(cappedShard.attempts[4].attempt_id, "gh-1006-1-oecd-cli", "oldest within bound retained at bottom");

  fs.rmSync(root, { recursive: true, force: true });
}

{
  // 5. Full runOecdCliShadow records event provenance and retains history across runs
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oecd-cli-shadow-history-"));
  const paths = {
    repoRoot: root,
    shadowPath: path.join(root, "data", "admin", "oecd_cli", "shadow", "oecd-cli.json"),
    parityReportPath: path.join(root, "data", "admin", "oecd_cli", "parity-report.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "oecd_cli.json"),
    canonicalPath: path.join(root, "data", "macro", "activity-surveys.json"),
  };
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.writeFileSync(paths.canonicalPath, "canonical\n");

  // Run 1: schedule
  await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${rows}\n` }),
    observedAt: "2026-07-01T08:00:00Z",
    attemptId: "gh-701-1-oecd-cli",
    runId: "701",
    runAttempt: 1,
    eventName: "schedule",
  });

  // Run 2: dispatch controlled failure
  await runOecdCliShadow({
    ...paths,
    request: async () => { throw new Error("controlled failure"); },
    observedAt: "2026-07-15T12:00:00Z",
    attemptId: "gh-702-1-oecd-cli",
    runId: "702",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailure: true,
  });

  // Run 3: schedule recovery
  const advancedRows = Object.entries(OECD_SERIES)
    .map(([code, key], index) => `${code},2026-07,${code === "KOR" ? "102.9698" : 101 + index / 100}`)
    .join("\n");
  await runOecdCliShadow({
    ...paths,
    request: async () => ({ statusCode: 200, body: `${header}${advancedRows}\n` }),
    observedAt: "2026-08-01T08:00:00Z",
    attemptId: "gh-703-1-oecd-cli",
    runId: "703",
    runAttempt: 1,
    eventName: "schedule",
  });

  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "oecd_cli"), true);
  assert.equal(shard.attempts.length, 3, "shard must accumulate bounded attempt history across runs");
  assert.deepEqual(
    shard.attempts.map((a) => ({ attempt_id: a.attempt_id, event_name: a.event_name, run_id: a.run_id, run_attempt: a.run_attempt })),
    [
      { attempt_id: "gh-703-1-oecd-cli", event_name: "schedule", run_id: "703", run_attempt: 1 },
      { attempt_id: "gh-702-1-oecd-cli", event_name: "workflow_dispatch", run_id: "702", run_attempt: 1 },
      { attempt_id: "gh-701-1-oecd-cli", event_name: "schedule", run_id: "701", run_attempt: 1 },
    ],
    "attempt rows must prove scheduled vs dispatch provenance and run identity in descending order",
  );

  fs.rmSync(root, { recursive: true, force: true });
}

console.log("test-fetch-oecd-cli: ok");
