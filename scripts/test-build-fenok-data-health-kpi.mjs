#!/usr/bin/env node
/**
 * KPI v2 runtime self-proof fixtures (contract §"Fixtures").
 *
 * Runs the real builder CLI against temp data roots with an injected clock and
 * GitHub/origin envelope env, then asserts the runtime block, slot accounting,
 * source SLA, and public projection. Also spawns the checker to prove exit codes
 * (warn-only Phase A) and reuses the checker's own validation functions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  projectPublicKpi,
  PUBLIC_RUNTIME_DENY_KEYS,
} from "./lib/kpi-runtime-projection.mjs";
import {
  evaluateSlaAge,
  slaStatusForAge,
} from "./build-fenok-data-health-kpi.mjs";
import { SOURCE_SLA_DEF } from "./lib/kpi-contract-constants.mjs";
import { ETF_CORE_DAILY_BASKET_CONFIG } from "./build-fenok-etf-core-daily-basket.mjs";
import {
  checkV2Runtime,
  checkSourceSla,
  checkPublicProjection,
} from "../100xfenok-next/scripts/check-fenok-data-health-kpi.mjs";
import { projectFenokDataHealthKpiPublicMirror } from "../100xfenok-next/sync-static-overrides.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dirname, "build-fenok-data-health-kpi.mjs");
const CHECKER = path.join(__dirname, "..", "100xfenok-next", "scripts", "check-fenok-data-health-kpi.mjs");
const COMMITTED_V1 = path.join(__dirname, "..", "data", "admin", "fenok-data-health-kpi.json");
const KPI_REL = path.join("admin", "fenok-data-health-kpi.json");

// Build a genuinely-ready v2 doc pair (real committed lanes + a v2 runtime) so the
// checker's status/lane gate is satisfied and only runtime/sla/projection is exercised.
function seedReadyV2(tmp, { now, runtime, sla }) {
  const base = JSON.parse(fs.readFileSync(COMMITTED_V1, "utf8"));
  const root = {
    ...base,
    schema_version: "fenok-data-health-kpi/v2",
    generated_at: now,
    runtime,
    source_sla: sla,
  };
  const pub = projectPublicKpi(root, now);
  writeJson(path.join(tmp, "data", KPI_REL), root);
  writeJson(path.join(tmp, "public", "data", KPI_REL), pub);
  return { root, public: pub };
}

// Emit ALL six canonical SOURCE_SLA sources fresh/ready by copying the DEFINITIONAL
// fields verbatim from SOURCE_SLA_DEF (so the checker's deep-equality passes) and
// attaching fresh observations; overrides mutate one.
const READY_DATES = {
  s0_finra_occ_mapping_ledger: "2026-07-09",
  rim_index_inputs: "2026-07-06",
  etf_core_daily_basket_admin: "2026-07-08",
  fenok_edge_coverage_index: "2026-07-09",
  product_surface_coverage: "2026-07-09",
  etf_daily1y_readiness_admin: "2026-07-10T00:00:00.000Z",
};
function slaEntry(def, sourceDate, now, extra = {}) {
  const age = sourceDate == null ? null : evaluateSlaAge({ sourceDate, unit: def.unit, calendar: def.calendar, nowIso: now });
  return { ...def, source_date: sourceDate, age, status: slaStatusForAge(age, def.max_staleness), ...extra };
}
function readySla(now, overrides = {}) {
  const list = SOURCE_SLA_DEF.map((def) => slaEntry(def, READY_DATES[def.source_id], now));
  if (overrides.staleFinra) {
    const e = list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger");
    e.source_date = "2026-06-01";
    e.age = evaluateSlaAge({ sourceDate: e.source_date, unit: e.unit, calendar: e.calendar, nowIso: now });
    e.status = slaStatusForAge(e.age, e.max_staleness);
  }
  if (overrides.emptySla) return [];
  if (overrides.dropRequired) return list.filter((x) => x.source_id !== "rim_index_inputs");
  if (overrides.unavailableRequired) {
    const e = list.find((x) => x.source_id === "rim_index_inputs");
    e.source_date = null; e.age = null; e.status = "unavailable";
  }
  if (overrides.futureRequired) {
    const e = list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger");
    e.source_date = "2026-07-20"; e.age = 0; e.status = "future_date_anomaly"; e.future_date_anomaly = true;
  }
  if (typeof overrides.tamper === "function") overrides.tamper(list);
  return list;
}

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ok - ${label}`);
}

function baseEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GITHUB_") || k.startsWith("KPI_")) continue;
    env[k] = v;
  }
  return env;
}

function mkTmp(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kpi-v2-${name}-`));
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "computed", "rim-index"), { recursive: true });
  fs.mkdirSync(path.join(dir, "public", "data", "admin"), { recursive: true });
  return dir;
}

function writeJson(absPath, payload) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function seedPrior(tmp, priorDoc) {
  writeJson(path.join(tmp, "data", KPI_REL), priorDoc);
}

function seedFinraOccLedger(tmp, { finra, occ }) {
  writeJson(path.join(tmp, "data", "admin", "fenok-s0-finra-occ-mapping-ledger.json"), {
    generated_at: "2026-07-10T00:00:00.000Z",
    source_audit: { source_dates: { finra_source_date: finra, occ_source_date: occ } },
  });
}

function runBuilder(tmp, env, nowIso, { expectExit = 0 } = {}) {
  let status = 0;
  try {
    execFileSync("node", [BUILDER, "--data-root", tmp], {
      env: { ...baseEnv(), ...env, KPI_FAKE_NOW: nowIso },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status ?? 1;
  }
  assert.equal(status, expectExit, `builder exit ${status} != ${expectExit}`);
  return {
    root: JSON.parse(fs.readFileSync(path.join(tmp, "data", KPI_REL), "utf8")),
    public: JSON.parse(fs.readFileSync(path.join(tmp, "public", "data", KPI_REL), "utf8")),
  };
}

function runChecker(tmp, nowIso, { strict = false } = {}) {
  const args = [CHECKER, "--data-root", tmp];
  if (strict) args.push("--strict");
  try {
    execFileSync("node", args, {
      env: { ...baseEnv(), KPI_FAKE_NOW: nowIso },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exit: 0 };
  } catch (error) {
    return { exit: error.status ?? 1, stderr: String(error.stderr ?? "") };
  }
}

function makeProducerRuntime({ builtAt, slotKey, runId }) {
  return {
    producer_context: {
      built_at: builtAt,
      duration_ms: 12,
      run_id: runId,
      run_attempt: 1,
      event_name: "schedule",
      workflow: "Update Manifest",
      sha: "deadbeef",
      slot_key: slotKey,
      origin: null,
    },
    last_rebuild_context: { built_at: builtAt, run_id: runId, workflow: "Update Manifest", event_name: "schedule", sha: "deadbeef" },
    cadence: { crons_utc: ["30 2 * * *", "30 9 * * *"], slot_grace_minutes: 360, hard_max_age_hours: 26, slot_retention_days: 14, v2_activated_at: builtAt, calendar_version: "market-calendar/v1-2026" },
    slots: { satisfied_slot_keys: slotKey ? [slotKey] : [], last_satisfied_slot_key: slotKey, missed_slot_keys: [], cron_deferrals: [] },
    successful_snapshot_history: [{ built_at: builtAt, slot_key: slotKey, run_id: runId, run_attempt: 1, workflow: "Update Manifest", status: "ready", duration_ms: 12 }],
  };
}

function v2Doc(runtime, extra = {}) {
  return {
    schema_version: "fenok-data-health-kpi/v2",
    generated_at: runtime.producer_context?.built_at ?? "2026-07-10T00:00:00.000Z",
    status: "ready",
    runtime,
    ...extra,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

console.log("# KPI v2 runtime self-proof fixtures");

// 1. push build -> non-authoritative, producer null
{
  const tmp = mkTmp("push");
  const now = "2026-07-10T05:00:00.000Z";
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "someuser", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.equal(root.schema_version, "fenok-data-health-kpi/v2");
  assert.equal(root.runtime.producer_context, null, "push: producer null");
  assert.equal(root.runtime.authoritative_context.authoritative, false);
  assert.equal(pub.runtime.built_at, null);
  assert.equal(pub.runtime.fresh, false);
  assert.equal(pub.runtime.hard_age_ok, false);
  ok("push build is non-authoritative with null producer and honest public projection");
}

// 2. bare manual dispatch -> non-authoritative
{
  const tmp = mkTmp("bare");
  const now = "2026-07-10T05:00:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "2", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.equal(root.runtime.producer_context, null, "bare dispatch: producer null");
  assert.equal(root.runtime.authoritative_context.authoritative, false);
  ok("bare manual dispatch (no envelope) is non-authoritative");
}

// 3. invalid-envelope dispatch -> non-authoritative (bad actor)
{
  const tmp = mkTmp("invalid");
  const now = "2026-07-10T05:00:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "3", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "attacker", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z",
  }, now);
  assert.equal(root.runtime.producer_context, null, "invalid envelope: producer null");
  assert.match(root.runtime.authoritative_context.reason, /invalid_envelope/);
  ok("invalid-envelope dispatch (bad actor) is non-authoritative");
}

// 4. valid enveloped edge dispatch -> authoritative, producer.slot_key === origin slot
{
  const tmp = mkTmp("valid-dispatch");
  const now = "2026-07-10T00:40:00.000Z"; // Fri
  const slotKey = "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z";
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "441", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ID: "999", KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "1",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: slotKey,
  }, now);
  assert.equal(root.runtime.authoritative_context.authoritative, true);
  assert.equal(root.runtime.producer_context.slot_key, slotKey, "producer slot = origin slot");
  assert.equal(root.runtime.producer_context.origin.source_workflow, "fenok-edge-daily.yml");
  assert.deepEqual(root.runtime.slots.satisfied_slot_keys, [slotKey]);
  // public projection equality + deny-key scan
  const expected = projectPublicKpi(root, pub.runtime.evaluated_at);
  assert.equal(JSON.stringify(expected), JSON.stringify(pub), "public == projectPublicKpi(root, stored evaluated_at)");
  for (const key of PUBLIC_RUNTIME_DENY_KEYS) assert.ok(!(key in pub.runtime), `deny key ${key} absent`);
  assert.ok(!JSON.stringify(pub).includes("\"999\""), "origin run id not leaked to public");
  ok("valid enveloped edge dispatch is authoritative; public projection exact + redacted");
}

// 4b. checker end-to-end on a genuinely-ready v2 doc (exit codes + warn-only)
{
  const tmp = mkTmp("checker-ready");
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "e2e" });
  runtime.cadence.v2_activated_at = now; // due set empty -> missed empty
  seedReadyV2(tmp, { now, runtime, sla: readySla(now) });
  assert.equal(runChecker(tmp, now).exit, 0, "checker green on ready v2 doc (fresh sources)");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 0, "strict mode also green when everything fresh");
  ok("checker passes end-to-end on a ready v2 doc in both warn-only and strict modes");
}

// 5. delayed run outside grace -> slotless (historical extremes +368m / +364m)
for (const [runId, delayMin] of [["26765173733", 368], ["27940007940", 364]]) {
  const tmp = mkTmp(`slotless-${delayMin}`);
  const cronOcc = Date.UTC(2026, 6, 10, 2, 30, 0); // 2026-07-10T02:30Z (Fri)
  const jobStart = new Date(cronOcc + delayMin * 60000).toISOString();
  const now = new Date(cronOcc + (delayMin + 5) * 60000).toISOString();
  // Prior watermark before the occurrence so the passed 02:30 slot is due (thus missable).
  const prior = makeProducerRuntime({ builtAt: "2026-07-09T02:31:00.000Z", slotKey: null, runId: "prev" });
  prior.cadence.v2_activated_at = "2026-07-09T00:00:00.000Z";
  prior.slots.satisfied_slot_keys = [];
  prior.slots.last_satisfied_slot_key = null;
  seedPrior(tmp, v2Doc(prior));
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: jobStart,
  }, now);
  assert.equal(root.runtime.authoritative_context.authoritative, true, "delayed run still authoritative");
  assert.equal(root.runtime.producer_context.slot_key, null, `+${delayMin}m is slotless (outside 360m grace)`);
  assert.deepEqual(root.runtime.slots.satisfied_slot_keys, [], "slotless run satisfies no slot");
  assert.ok(root.runtime.slots.missed_slot_keys.includes("update-manifest.yml:30 2 * * *@2026-07-10T02:30Z"),
    "the passed 02:30 occurrence is due-but-unsatisfied (missed)");
  assert.equal(root.runtime.successful_snapshot_history.at(-1).run_id, runId, "slotless run recorded in history");
  ok(`delayed run +${delayMin}m (run ${runId}) is slotless yet recorded`);
}

// 5b. run_attempt > 1 is always slotless even when in grace
{
  const tmp = mkTmp("rerun");
  const now = "2026-07-10T02:35:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "77", GITHUB_RUN_ATTEMPT: "3",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.producer_context.slot_key, null, "run_attempt>1 is slotless");
  ok("run_attempt>1 is always slotless (§2)");
}

// 6. superseded/missed slot: prior watermark 3d back, past occurrences unsatisfied
{
  const tmp = mkTmp("missed");
  const now = "2026-07-10T02:35:00.000Z";
  const prior = makeProducerRuntime({ builtAt: "2026-07-07T02:31:00.000Z", slotKey: null, runId: "old" });
  prior.cadence.v2_activated_at = "2026-07-07T00:00:00.000Z";
  prior.slots.satisfied_slot_keys = [];
  prior.slots.last_satisfied_slot_key = null;
  seedPrior(tmp, v2Doc(prior));
  const currentSlot = "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "600", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.cadence.v2_activated_at, "2026-07-07T00:00:00.000Z", "watermark carried forward");
  assert.ok(root.runtime.slots.satisfied_slot_keys.includes(currentSlot), "current slot satisfied");
  assert.ok(!root.runtime.slots.missed_slot_keys.includes(currentSlot), "current slot not missed");
  assert.ok(root.runtime.slots.missed_slot_keys.length > 0, "past due occurrences are missed");
  ok("superseded/missed: past due occurrences missed, current slot satisfied");
}

// 7. missing prior v1 -> bootstrap (v2_activated_at = now, no carry)
{
  const tmp = mkTmp("v1prior");
  const now = "2026-07-10T02:35:00.000Z";
  seedPrior(tmp, { schema_version: "fenok-data-health-kpi/v1", generated_at: "2026-07-09T00:00:00Z", status: "ready" });
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "700", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T02:33:00.000Z",
  }, now);
  assert.equal(root.runtime.cadence.v2_activated_at, now, "v1 prior -> fresh watermark = now");
  assert.equal(root.runtime.producer_context.run_id, "700");
  ok("missing prior v1: v2 bootstraps watermark at now, no runtime carry-forward");
}

// 8. deploy/local rebuild preservation — direct-builder write path
{
  const tmp = mkTmp("preserve");
  const now = "2026-07-10T10:00:00.000Z";
  const prior = makeProducerRuntime({ builtAt: "2026-07-10T02:30:30.000Z", slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "auth-1" });
  seedPrior(tmp, v2Doc(prior));
  const { root, public: pub } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", // non-authoritative local/deploy rebuild
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "deploy-9", GITHUB_RUN_ATTEMPT: "1", GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
  }, now);
  assert.deepEqual(root.runtime.producer_context, prior.producer_context, "producer_context preserved verbatim");
  assert.deepEqual(root.runtime.slots, prior.slots, "slots preserved verbatim");
  assert.deepEqual(root.runtime.successful_snapshot_history, prior.successful_snapshot_history, "history preserved verbatim");
  assert.equal(root.runtime.last_rebuild_context.run_id, "deploy-9", "only last_rebuild_context updates");
  assert.equal(pub.runtime.built_at, prior.producer_context.built_at, "public built_at reflects preserved producer");
  ok("non-authoritative rebuild preserves producer/slots/history; only last_rebuild_context changes");

  // 8b. post-copy override write path — the ACTUAL sync-static-overrides function,
  // run against a temp root (not the in-memory projector).
  const tmp2 = mkTmp("override");
  const clobberedPublicPath = path.join(tmp2, "public", "data", KPI_REL);
  writeJson(clobberedPublicPath, JSON.parse(JSON.stringify(root))); // cp ../data -> public clobber
  projectFenokDataHealthKpiPublicMirror({ rootDir: tmp2, nowIso: now });
  const overridden = JSON.parse(fs.readFileSync(clobberedPublicPath, "utf8"));
  const denySet = new Set(PUBLIC_RUNTIME_DENY_KEYS);
  (function assertNoDeny(node, p) {
    if (Array.isArray(node)) return node.forEach((x, i) => assertNoDeny(x, `${p}[${i}]`));
    if (node && typeof node === "object") for (const k of Object.keys(node)) {
      assert.ok(!denySet.has(k), `override output must not expose ${k} at ${p}`);
      assertNoDeny(node[k], `${p}.${k}`);
    }
  })(overridden, "$");
  assert.equal(overridden.runtime.built_at, prior.producer_context.built_at, "override keeps producer built_at");
  assert.equal(overridden.runtime.evaluated_at, now, "override used injected clock");
  assert.ok(!fs.existsSync(`${clobberedPublicPath}.tmp`), "atomic write left no .tmp");
  ok("real sync-static override path re-projects the clobbered public mirror on a temp root (atomic, recursive-clean)");
}

// 9. checker functions on an in-memory authoritative doc (projection equality + sla + runtime)
{
  const now = "2026-07-10T02:35:00.000Z";
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "z" });
  runtime.cadence.v2_activated_at = now;
  const root = v2Doc(runtime, { source_sla: readySla(now) });
  const pub = projectPublicKpi(root, now);
  const errors = [];
  const warnings = [];
  checkV2Runtime(root, { errors, warnings }, now);
  checkSourceSla(root, { errors, warnings });
  checkPublicProjection(root, pub, { errors, warnings });
  assert.equal(errors.length, 0, `no hard errors: ${errors.join("; ")}`);
  ok("checker validation functions accept a well-formed v2 doc with no hard errors");

  // tamper: public runtime deny key present -> hard error
  const tampered = JSON.parse(JSON.stringify(pub));
  tampered.runtime.run_id = "leak";
  const e2 = [];
  checkPublicProjection(root, tampered, { errors: e2, warnings: [] });
  assert.ok(e2.some((m) => /forbidden runtime-identity key.*run_id/.test(m)), "deny-key leak is a hard error");
  ok("redaction deny-key scan flags a leaked run_id as a hard error");

  // nested leak deeper than runtime top-level is also caught (recursive scan)
  const nested = JSON.parse(JSON.stringify(pub));
  nested.lanes = [{ id: "x", details: { origin: { source_run_id: "leak" } } }];
  const e3 = [];
  checkPublicProjection(root, nested, { errors: e3, warnings: [] });
  assert.ok(e3.some((m) => /forbidden runtime-identity key.*origin/.test(m)), "nested deny-key leak caught by recursive scan");
  ok("recursive deny-key scan catches a leak nested below runtime top-level");
}

// 10. per-source SLA staleness (contract §5) — builder emits stale/ready from source dates
{
  const now = "2026-07-10T05:00:00.000Z";

  const tmpStale = mkTmp("sla-stale");
  seedFinraOccLedger(tmpStale, { finra: "20260601", occ: "20260601" }); // >3 business days old
  const { root: staleRoot } = runBuilder(tmpStale, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "s1", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const staleEntry = staleRoot.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(staleEntry.source_date, "2026-06-01", "oldest of finra/occ source dates");
  assert.equal(staleEntry.status, "stale", "old required source is stale");

  const tmpFresh = mkTmp("sla-fresh");
  seedFinraOccLedger(tmpFresh, { finra: "20260709", occ: "20260708" });
  const { root: freshRoot } = runBuilder(tmpFresh, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "s2", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const freshEntry = freshRoot.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(freshEntry.source_date, "2026-07-08", "oldest of finra/occ = occ 07-08");
  assert.equal(freshEntry.status, "ready", "recent required source is ready");
  ok("per-source SLA: builder emits stale for old required source and ready for recent one");
}

// 10b. checker treats a stale REQUIRED source as warn-only in Phase A, blocking in strict
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("sla-checker");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "sla" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp, { now, runtime, sla: readySla(now, { staleFinra: true }) });
  assert.equal(runChecker(tmp, now).exit, 0, "Phase A: stale required source is warn-only (exit 0)");
  assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, "Phase B (strict): stale required source blocks (exit 1)");
  ok("stale required source: warn-only in Phase A, hard block under --strict (Phase B flip)");
}

// 11. FIX 1 — a delayed 02:30 run at 09:35 must NOT claim the 09:30 slot
{
  const tmp = mkTmp("own-cron");
  const now = "2026-07-10T09:40:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "own1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 2 * * *", // this run WAS the 02:30 cron, delayed
    KPI_JOB_STARTED_AT: "2026-07-10T09:35:00.000Z",
  }, now);
  assert.equal(root.runtime.producer_context.slot_key, null, "02:30 run delayed to 09:35 is slotless on its own cron");
  assert.ok(!root.runtime.slots.satisfied_slot_keys.includes("update-manifest.yml:30 9 * * *@2026-07-10T09:30Z"),
    "must NOT falsely claim the 09:30 slot");

  // Positive contrast: a genuine 09:30 run at 09:35 claims the 09:30 slot.
  const tmp2 = mkTmp("own-cron-pos");
  const { root: r2 } = runBuilder(tmp2, {
    GITHUB_EVENT_NAME: "schedule",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "own2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_EVENT_SCHEDULE: "30 9 * * *",
    KPI_JOB_STARTED_AT: "2026-07-10T09:35:00.000Z",
  }, now);
  assert.equal(r2.runtime.producer_context.slot_key, "update-manifest.yml:30 9 * * *@2026-07-10T09:30Z",
    "genuine 09:30 run claims the 09:30 slot on its own cron");
  ok("FIX 1: schedule slot inferred on the run's OWN cron only (no cross-cron false claim)");
}

// 12. FIX 2 — stale/replayed and attempt-2 dispatch envelopes
{
  // (a) 10-day-old canonical slot_key -> non-authoritative (outside grace of now)
  const tmp = mkTmp("stale-env");
  const now = "2026-07-10T00:40:00.000Z";
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "st1", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "1",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-06-30T00:30Z",
  }, now);
  assert.equal(root.runtime.producer_context, null, "stale replayed slot_key -> non-authoritative");
  assert.match(root.runtime.authoritative_context.reason, /origin_slot_key/);

  // (b) fresh slot but source_run_attempt=2 -> authoritative but slotless
  const tmp2 = mkTmp("attempt2-env");
  const { root: r2 } = runBuilder(tmp2, {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_WORKFLOW_REF: "o/r/.github/workflows/update-manifest.yml@refs/heads/main",
    GITHUB_RUN_ID: "st2", GITHUB_RUN_ATTEMPT: "1",
    GITHUB_ACTOR: "github-actions[bot]", GITHUB_REF: "refs/heads/main",
    KPI_ORIGIN_SOURCE_WORKFLOW: "fenok-edge-daily.yml",
    KPI_ORIGIN_SOURCE_RUN_ATTEMPT: "2",
    KPI_ORIGIN_ORIGINAL_EVENT: "schedule",
    KPI_ORIGIN_SLOT_KEY: "fenok-edge-daily.yml:30 0 * * 2-6@2026-07-10T00:30Z",
  }, now);
  assert.equal(r2.runtime.authoritative_context.authoritative, true, "attempt-2 valid envelope is still authoritative");
  assert.equal(r2.runtime.producer_context.slot_key, null, "source_run_attempt>1 -> slotless (claims no slot)");
  assert.deepEqual(r2.runtime.slots.satisfied_slot_keys, [], "attempt-2 dispatch satisfies no slot");
  ok("FIX 2: stale-replayed envelope rejected; attempt-2 envelope authoritative-but-slotless");
}

// 13. FIX 3 — under strict, a 48h-old producer vs the CHECKER clock is a hard error
{
  const tmp = mkTmp("frozen");
  const built = "2026-07-10T02:30:00.000Z";
  const checkerNow = "2026-07-12T02:35:00.000Z"; // ~48h later, producer never rebuilt
  const runtime = makeProducerRuntime({ builtAt: built, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "frozen" });
  runtime.cadence.v2_activated_at = built; // due/missed empty at build clock
  seedReadyV2(tmp, { now: built, runtime, sla: readySla(built) });
  assert.equal(runChecker(tmp, checkerNow).exit, 0, "Phase A: frozen 48h producer is warn-only (exit 0)");
  assert.equal(runChecker(tmp, checkerNow, { strict: true }).exit, 1, "strict: 48h producer vs checker clock is a hard error (exit 1)");
  ok("FIX 3: frozen-green producer (48h stale vs checker clock) blocks under strict, warns in Phase A");
}

// 14. FIX 5a — empty / missing-required / unavailable-required SLA fail closed under strict
{
  const now = "2026-07-10T02:35:00.000Z";
  const mkReady = (overrides) => {
    const tmp = mkTmp("sla-failclosed");
    const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "fc" });
    runtime.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime, sla: readySla(now, overrides) });
    return tmp;
  };
  for (const [label, overrides] of [["empty", { emptySla: true }], ["dropped-required", { dropRequired: true }], ["unavailable-required", { unavailableRequired: true }]]) {
    const tmp = mkReady(overrides);
    assert.equal(runChecker(tmp, now).exit, 0, `Phase A: ${label} SLA is warn-only (exit 0)`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, `strict: ${label} SLA fails closed (exit 1)`);
  }
  ok("FIX 5a: empty / missing-required / unavailable-required SLA is warn-only Phase A, hard block under strict");
}

// 15. FIX 5d — future-dated source is an anomaly, never clamped to ready
{
  const now = "2026-07-10T05:00:00.000Z";
  // (a) builder: a future source date is flagged, not read as age-0 fresh
  const tmp = mkTmp("future-build");
  seedFinraOccLedger(tmp, { finra: "20260720", occ: "20260720" }); // 10 days in the future
  const { root } = runBuilder(tmp, {
    GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/deploy-worker.yml@refs/heads/main",
    GITHUB_RUN_ID: "fut", GITHUB_RUN_ATTEMPT: "1",
  }, now);
  const futureEntry = root.source_sla.find((s) => s.source_id === "s0_finra_occ_mapping_ledger");
  assert.equal(futureEntry.status, "future_date_anomaly", "future source date is an anomaly, not ready");
  assert.equal(futureEntry.future_date_anomaly, true, "future anomaly flagged");

  // (b) checker: future required source fails closed under strict
  const tmp2 = mkTmp("future-check");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "fut2" });
  runtime.cadence.v2_activated_at = now;
  seedReadyV2(tmp2, { now, runtime, sla: readySla(now, { futureRequired: true }) });
  assert.equal(runChecker(tmp2, now).exit, 0, "Phase A: future-dated required source warn-only (exit 0)");
  assert.equal(runChecker(tmp2, now, { strict: true }).exit, 1, "strict: future-dated required source fails closed (exit 1)");
  ok("FIX 5d: future-dated source flagged as anomaly (builder) and fails closed under strict (checker)");
}

// 16. ROOT — SLA definitional tamper is a HARD error even in Phase A (never warn-only)
{
  const now = "2026-07-10T02:35:00.000Z";
  const tmp = mkTmp("sla-tamper");
  const runtime = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "t" });
  runtime.cadence.v2_activated_at = now;
  const sla = readySla(now, { tamper: (list) => {
    const e = list.find((x) => x.source_id === "rim_index_inputs");
    e.required = false; e.max_staleness = 999999; e.freshness_basis = "mutated";
  } });
  seedReadyV2(tmp, { now, runtime, sla });
  assert.equal(runChecker(tmp, now).exit, 1, "SLA definitional tamper is a hard error in Phase A");
  ok("ROOT: SLA definitional tamper (required/max/basis mutated) hard-errors even in Phase A");
}

// 17. ROOT — cadence tamper + malformed producer are HARD errors even in Phase A
{
  const now = "2026-07-10T02:35:00.000Z";

  const tmpCad = mkTmp("cadence-tamper");
  const rtCad = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "c" });
  rtCad.cadence.v2_activated_at = now;
  rtCad.cadence.hard_max_age_hours = 9999; // definition tamper
  seedReadyV2(tmpCad, { now, runtime: rtCad, sla: readySla(now) });
  assert.equal(runChecker(tmpCad, now).exit, 1, "cadence ceiling=9999 tamper hard-errors in Phase A");

  const tmpProd = mkTmp("producer-empty");
  const rtProd = makeProducerRuntime({ builtAt: now, slotKey: null, runId: "p" });
  rtProd.cadence.v2_activated_at = now;
  rtProd.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  rtProd.producer_context = {}; // malformed: no built_at / run_id / workflow / event_name
  seedReadyV2(tmpProd, { now, runtime: rtProd, sla: readySla(now) });
  assert.equal(runChecker(tmpProd, now).exit, 1, "producer_context={} hard-errors in Phase A");

  const tmpGarbage = mkTmp("producer-garbage");
  const rtG = makeProducerRuntime({ builtAt: "garbage", slotKey: null, runId: "g" });
  rtG.cadence.v2_activated_at = now;
  rtG.slots = { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] };
  seedReadyV2(tmpGarbage, { now, runtime: rtG, sla: readySla(now) });
  assert.equal(runChecker(tmpGarbage, now).exit, 1, "producer_context.built_at='garbage' hard-errors in Phase A");
  ok("ROOT: cadence tamper + malformed producer (empty / garbage built_at) hard-error even in Phase A");
}

// 18. AGE-BAND BOUNDARY — explicit named boundary fixtures (auditor-findable)
//     ceiling = hard_max_age_hours = 26h; tolerance band = 10m.
{
  const built = "2026-07-10T02:30:00.000Z";
  const ageBandCeilingPlus5m = "2026-07-11T04:35:00.000Z";  // built + 26h05m
  const ageBandCeilingPlus11m = "2026-07-11T04:41:00.000Z"; // built + 26h11m
  const mk = () => {
    const tmp = mkTmp("age-band-boundary");
    const rt = makeProducerRuntime({ builtAt: built, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "b" });
    rt.cadence.v2_activated_at = built;
    seedReadyV2(tmp, { now: built, runtime: rt, sla: readySla(built) });
    return tmp;
  };
  assert.equal(runChecker(mk(), ageBandCeilingPlus5m, { strict: true }).exit, 0, "age_band_ceiling_plus_5m: within band, strict passes");
  ok("age band boundary ceiling+5m PASSES strict (within 10m tolerance)");
  assert.equal(runChecker(mk(), ageBandCeilingPlus11m, { strict: true }).exit, 1, "age_band_ceiling_plus_11m: beyond band, strict fails");
  ok("age band boundary ceiling+11m FAILS strict (beyond 10m tolerance)");
}

// 19. ADDENDUM (a) — FUTURE producer built_at vs checker clock: +1h rejected, +5m tolerated
{
  const checkerNow = "2026-07-10T02:30:00.000Z";
  const mk = (builtAt, slotTs) => {
    const tmp = mkTmp("future-built");
    const rt = makeProducerRuntime({ builtAt, slotKey: `update-manifest.yml:30 2 * * *@${slotTs}`, runId: "f" });
    rt.cadence.v2_activated_at = builtAt; // watermark=built so missed stays empty at the build clock
    rt.slots = { satisfied_slot_keys: [rt.producer_context.slot_key], last_satisfied_slot_key: rt.producer_context.slot_key, missed_slot_keys: [], cron_deferrals: [] };
    seedReadyV2(tmp, { now: builtAt, runtime: rt, sla: readySla(builtAt) });
    return tmp;
  };
  // built_at = checkerNow + 1h -> beyond 10m band -> hard error even in Phase A
  assert.equal(runChecker(mk("2026-07-10T03:30:00.000Z", "2026-07-10T02:30Z"), checkerNow).exit, 1,
    "producer built_at = checkerNow+1h is a hard error even in Phase A");
  // built_at = checkerNow + 5m -> within 10m skew band -> tolerated
  assert.equal(runChecker(mk("2026-07-10T02:35:00.000Z", "2026-07-10T02:30Z"), checkerNow).exit, 0,
    "producer built_at = checkerNow+5m is within the skew band -> tolerated");
  ok("ADDENDUM (a): future producer built_at rejected at +1h, tolerated at +5m (skew band)");
}

// 20. ADDENDUM (b) — etf_core SLA max_staleness is the SAME number as the basket config
{
  const etfCoreDef = SOURCE_SLA_DEF.find((d) => d.source_id === "etf_core_daily_basket_admin");
  assert.equal(etfCoreDef.max_staleness, ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays,
    "etf_core SLA max_staleness must equal ETF_CORE_DAILY_BASKET_CONFIG.maxQuoteAgeDays (no second number)");
  ok("ADDENDUM (b): etf_core SLA max_staleness stays single-sourced with the basket config (drift guard)");
}

// 21. SLA tamper — unit / calendar mutation, duplicate row, unknown extra row.
//     Each is a DEFINITION tamper => hard error in BOTH Phase A and strict.
{
  const now = "2026-07-10T02:35:00.000Z";
  const mkTampered = (tamper) => {
    const tmp = mkTmp("sla-tamper-cases");
    const rt = makeProducerRuntime({ builtAt: now, slotKey: "update-manifest.yml:30 2 * * *@2026-07-10T02:30Z", runId: "tc" });
    rt.cadence.v2_activated_at = now;
    seedReadyV2(tmp, { now, runtime: rt, sla: readySla(now, { tamper }) });
    return tmp;
  };
  const cases = [
    ["unit mutated (business_days->hours)", (list) => { list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger").unit = "hours"; }],
    ["calendar mutated (us_market->wall_clock)", (list) => { list.find((x) => x.source_id === "s0_finra_occ_mapping_ledger").calendar = "wall_clock"; }],
    ["duplicate source_id row", (list) => { list.push(JSON.parse(JSON.stringify(list.find((x) => x.source_id === "rim_index_inputs")))); }],
    ["unknown extra source_id row", (list) => { list.push({ source_id: "bogus_source", freshness_basis: ".x", unit: "hours", calendar: "wall_clock", max_staleness: 1, required: true, source_date: null, age: null, status: "unavailable" }); }],
  ];
  for (const [label, tamper] of cases) {
    const tmp = mkTampered(tamper);
    assert.equal(runChecker(tmp, now).exit, 1, `Phase A: ${label} is a hard error (exit 1)`);
    assert.equal(runChecker(tmp, now, { strict: true }).exit, 1, `strict: ${label} is a hard error (exit 1)`);
  }
  ok("SLA tamper: unit/calendar mutation + duplicate row + unknown extra row all hard-error in Phase A AND strict");
}

console.log(`\n# ${passed} fixtures passed`);
