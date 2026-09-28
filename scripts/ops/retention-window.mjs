#!/usr/bin/env node
// retention-window.mjs — revision 2 (fh-598 corrections applied).
//
// One deadline begins BEFORE the first disable (≤1200 s): preflight, drain, the gated
// apply step and the FULL RESTORE run inside it; the apply child receives
// `deadline − reserve` and is killed and reaped before restoration so a still-deleting
// child cannot outlive the window.
//
// Guarantees and NON-guarantees (stated, not implied):
// - This run's own window is deadline-bounded; recovery from a crashed run is NOT a
//   bound on any future invocation's start time. Recovery latency after runner death is
//   bounded only by the advisory lease TTL and by the independent restore watchdog's
//   schedule (retention-restore.yml, every 15 minutes); hard remote outages are disclosed
//   limitations, never fictitious guarantees.
// - Every gh/child/sleep call is bounded by the remaining deadline minus the restore
//   reserve. A failed run-list query is an ERROR (never an empty idle list). Drain proof
//   uses every publisher workflow's complete nonterminal counts (per status, total_count
//   over all pages). All disables are verified against fresh state; all restores are
//   confirmed against fresh state, and entries that cannot be confirmed stay in the
//   durable journal instead of being cleared.
// - The lease/journal are advisory (workflow concurrency covers the normal single-dispatch
//   case); the operator contract "no manual publishers during a window" remains an
//   external prerequisite. The journal lives in a dedicated issue so a killed runner's
//   captured states survive for the watchdog and for the next invocation.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const JOURNAL_TITLE = "100xFenok R2 retention sweep state";
export const JOURNAL_MARKER = "[retention-window-journal]";
export const NONTERMINAL_STATUSES = Object.freeze(["queued", "in_progress", "requested", "waiting", "pending"]);
export const SUPPORTED_WORKFLOW_STATES = Object.freeze(["active", "disabled_manually", "disabled_inactivity"]);
export const DEFAULT_DEADLINE_SECONDS = 1200;
export const DEFAULT_RESERVE_SECONDS = 150;
export const DEFAULT_DRAIN_CAP_SECONDS = 600;
const DRAIN_POLL_SECONDS = 15;
const GH_CALL_MIN_TIMEOUT_MS = 5_000;
const PUBLISH_INVOCATION = /node\s+scripts\/publish-cloud-data-generation\.mjs/;
const SCRIPT_MENTION = /publish-cloud-data-generation\.mjs/;
const REFERENCE_ONLY_LINE = /^\s*(-\s*)?['"]?scripts\/publish-cloud-data-generation\.mjs['"]?\s*:?\s*(#.*)?$/;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

// --- pure helpers (exported for the retention safety suite) -------------------

// Derive the pause set from the workflow directory. A file that actually invokes the
// publish script is a publisher; a file that only MENTIONS the path in a reference list
// (e.g. a `paths:` trigger entry) is classified as reference-only; any other mention is
// an unclassified publishing invocation and fails the inventory closed.
export function derivePublisherWorkflows({ workflowsDir, readFileImpl = fs.readFileSync } = {}) {
  const files = fs.readdirSync(workflowsDir).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml")).sort();
  const publishers = [];
  const referenceOnly = [];
  const unclassified = [];
  for (const file of files) {
    const text = String(readFileImpl(path.join(workflowsDir, file), "utf8"));
    if (!SCRIPT_MENTION.test(text)) continue;
    const nameMatch = text.match(/^name:\s*(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : file;
    if (PUBLISH_INVOCATION.test(text)) { publishers.push({ file, name }); continue; }
    const lines = text.split("\n").filter((line) => SCRIPT_MENTION.test(line));
    if (lines.every((line) => REFERENCE_ONLY_LINE.test(line) || line.trimStart().startsWith("#"))) {
      referenceOnly.push({ file, name });
      continue;
    }
    unclassified.push({ file, name });
  }
  return { publishers, referenceOnly, unclassified };
}

export function summarizeRunCounts({ countsByFile } = {}) {
  const offenders = [];
  for (const [file, count] of countsByFile instanceof Map ? countsByFile : Object.entries(countsByFile ?? {})) {
    if (count > 0) offenders.push({ file, count });
  }
  return offenders;
}

export function planRestoreFromStates({ recorded = [], current = [] } = {}) {
  const currentByFile = new Map(current.map((row) => [row.file, row]));
  const enable = [];
  const keepDisabled = [];
  const missing = [];
  const unsupported = [];
  for (const entry of recorded) {
    const live = currentByFile.get(entry.file);
    if (!live) { missing.push(entry.file); continue; }
    if (!SUPPORTED_WORKFLOW_STATES.includes(live.state)) { unsupported.push({ file: entry.file, state: live.state }); continue; }
    if (entry.state === "active") {
      if (live.state === "active") { keepDisabled.push(entry.file); } else { enable.push(entry.file); }
    } else {
      keepDisabled.push(entry.file);
    }
  }
  return { enable, keepDisabled, missing, unsupported };
}

export function serializeJournal(value) {
  return `${JOURNAL_MARKER}\n${JSON.stringify(value, null, 2)}`;
}

export function parseJournalComment(text) {
  if (typeof text !== "string" || !text.startsWith(JOURNAL_MARKER)) return null;
  try {
    const parsed = JSON.parse(text.slice(JOURNAL_MARKER.length).trim());
    if (parsed.vendored_states && (!Array.isArray(parsed.vendored_states) || parsed.vendored_states.some(row => !row || typeof row.file !== "string" || !SUPPORTED_WORKFLOW_STATES.includes(row.state)))) fail("JOURNAL_INVALID", "restore records missing original state");
    return parsed;
  } catch {
    fail("JOURNAL_INVALID", "invalid restore journal");
  }
}

// --- gh driver (injectable; every call carries an enforced timeout) -----------

function createGhDriver({ execFileImpl = promisify(execFile), repo = null, now = () => Date.now(), reserveFloorMs = 0, hardDeadline = now() + 1200_000 } = {}) {
  const repoArgs = repo ? ["--repo", repo] : [];
  const call = async (args, { allowFailure = false, deadline = null, reserveMs = reserveFloorMs } = {}) => {
    const remaining = Math.floor(Math.min(deadline ?? hardDeadline, hardDeadline) - now() - reserveMs);
    if (remaining <= 0) fail("WINDOW_DEADLINE", "no remaining command budget");
    const timeout = Math.min(20_000, remaining);
    try {
      const scopedArgs = args[0] === "api" ? args : [...args, ...repoArgs];
      const { stdout } = await execFileImpl("gh", scopedArgs, {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
        ...(timeout > 0 ? { timeout, killSignal: "SIGKILL" } : {}),
      });
      return { ok: true, stdout: String(stdout) };
    } catch (error) {
      if (allowFailure) return { ok: false, stdout: String(error?.stdout ?? ""), error };
      fail("GH_COMMAND_FAILED", `${args.slice(0, 2).join(" ")}: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  };
  return { call };
}

// --- journal ------------------------------------------------------------------

async function readJournal({ gh, number = null }) {
  if (!number) {
  const list = await gh.call(["issue", "list", "--state", "open", "--search", `${JOURNAL_TITLE} in:title`, "--json", "number"], { allowFailure: true });
  if (!list.ok) fail("GH_COMMAND_FAILED", "issue list");
  const issues = JSON.parse(list.stdout || "[]");
  number = issues[0]?.number ?? null;
  }
  if (!number) return { number: null, journal: null };
  const view = await gh.call(["issue", "view", String(number), "--json", "comments"], { allowFailure: true });
  if (!view.ok) fail("GH_COMMAND_FAILED", "issue view");
  const comments = JSON.parse(view.stdout || "{}")?.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const parsed = parseJournalComment(comments[index]?.body ?? "");
    if (parsed) return { number, journal: parsed };
  }
  return { number, journal: null };
}

async function upsertJournal({ gh, number, journal, io }) {
  const stamped = { ...journal, updated_at: new Date().toISOString() };
  const bodyFile = path.join(process.env.RUNNER_TEMP ?? "/tmp", `retention-journal-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, `${serializeJournal(stamped)}\n`);
  let issueNumber = number;
  if (!issueNumber) {
    const created = await gh.call(["issue", "create", "--title", JOURNAL_TITLE,
      "--body", "Rolling state of the R2 retention sweep window (one comment, upserted; recovery record)."]);
    issueNumber = Number(String(created.stdout).trim().split("/").pop());
  }
  await gh.call(["issue", "comment", String(issueNumber), "--edit-last", "--create-if-none", "--body-file", bodyFile]);
  io.error(`retention-window: journal updated (vendored=${stamped.vendored_states?.length ?? 0})`);
  return issueNumber;
}

// Existing OPS issue route; the persisted lease id is the deduplication identity.
async function notifyRecovery({gh, journal, confirmed, unconfirmed}) {
  if (!confirmed.length) return;
  const title = "100xFenok pipeline job failure alarm";
  const marker = `[r2-recovery:${journal?.lease?.run_id ?? "legacy"}]`;
  const found = await gh.call(["issue", "list", "--state", "all", "--search", `${title} in:title`, "--json", "number,title"]);
  const issue = JSON.parse(found.stdout).find(row => row.title === title);
  if (issue) {
    const prior = await gh.call(["issue", "view", String(issue.number), "--json", "comments"]);
    if (JSON.parse(prior.stdout).comments.some(row => row.body.includes(marker))) return;
  }
  const body = `${marker}\nR2 cleanup recovery restored ${confirmed.length} publisher states; ${unconfirmed.length} remain unresolved.\n`;
  const file = path.join(process.env.RUNNER_TEMP ?? "/tmp", `r2-recovery-${process.pid}.md`);
  fs.writeFileSync(file, body);
  if (issue) await gh.call(["issue", "comment", String(issue.number), "--body-file", file]);
  else await gh.call(["issue", "create", "--title", title, "--body-file", file]);
}

// --- gh queries ---------------------------------------------------------------

async function workflowStates({ gh, deadline }) {
  const list = await gh.call(["workflow", "list", "--all", "--limit", "1000", "--json", "path,state"], { deadline });
  return JSON.parse(list.stdout || "[]").map((row) => ({
    file: row.path ? path.basename(row.path) : "",
    state: row.state,
  }));
}

// Complete nonterminal counts: one `gh api` per workflow × status reading total_count
// (counts over ALL pages of that query), so a last-200-global-runs window is never used
// as drain proof. Any query failure is an error, never an empty idle result.
async function nonterminalCounts({ gh, repo, publisherFiles, deadline }) {
  const counts = new Map();
  for (const file of publisherFiles) {
    let total = 0;
    for (const status of NONTERMINAL_STATUSES) {
      const answer = await gh.call(
        ["api", `/repos/${repo}/actions/workflows/${file}/runs?status=${status}&per_page=1`],
        { allowFailure: true, deadline },
      );
      if (!answer.ok) fail("RUN_LIST_FAILED", `${file} status=${status}`);
      let parsed;
      try {
        parsed = JSON.parse(answer.stdout || "{}");
      } catch {
        fail("RUN_LIST_FAILED", `${file} status=${status}: unparsable response`);
      }
      if (!Number.isInteger(parsed.total_count)) fail("RUN_LIST_FAILED", `${file} status=${status}: no total_count`);
      total += parsed.total_count;
    }
    counts.set(file, total);
  }
  return counts;
}

// --- window -------------------------------------------------------------------

function clampSleepMs(ms, deadline, reserveMs) {
  if (deadline === null) return ms;
  return Math.min(ms, Math.max(0, deadline - Date.now() - reserveMs));
}

export async function runWindow({
  planPath = null,
  repo = null,
  workflowsDir = ".github/workflows",
  deadlineSeconds = DEFAULT_DEADLINE_SECONDS,
  hardDeadlineEpochSeconds = null,
  reserveSeconds = DEFAULT_RESERVE_SECONDS,
  drainCapSeconds = DEFAULT_DRAIN_CAP_SECONDS,
  batchMaxKeys = null,
  skipManifests = false,
  keysOut = null,
  preflightOnly = false,
  env = process.env,
  io = console,
  deps = {},
} = {}) {
  const now = deps.now ?? (() => Date.now());
  const sleepImpl = deps.sleepImpl ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const startedMs = now();
  if (hardDeadlineEpochSeconds !== null && (!Number.isFinite(hardDeadlineEpochSeconds) || hardDeadlineEpochSeconds <= 0)) fail("WINDOW_BUDGET_INVALID", "invalid absolute deadline");
  const deadlineMs = Math.min(startedMs + Math.min(deadlineSeconds, DEFAULT_DEADLINE_SECONDS) * 1000,
    hardDeadlineEpochSeconds === null ? Infinity : hardDeadlineEpochSeconds * 1000);
  const reserveMs = Math.max(30, reserveSeconds) * 1000;
  if (deadlineMs - reserveMs <= startedMs + 60_000) fail("WINDOW_BUDGET_INVALID", "deadline too small for the restore reserve");
  const runId = `${new Date(startedMs).toISOString()}-${process.pid}`;
  const leaseTtlMs = Math.max(deadlineMs - startedMs + 300_000, 600_000);
  const gh = deps.gh ?? createGhDriver({ repo, now, hardDeadline: deadlineMs });
  const execFileImpl = deps.execFileImpl ?? promisify(execFile);
  const workflowRepo = repo ?? env.GITHUB_REPOSITORY ?? null;
  if (!workflowRepo) fail("WINDOW_REPO_MISSING", "repo could not be resolved (--repo or GITHUB_REPOSITORY)");
  const derived = deps.publishers ?? derivePublisherWorkflows({ workflowsDir });
  if (derived.unclassified.length > 0) fail("SWEEP_INVENTORY_UNCLASSIFIED", derived.unclassified.map((row) => row.file).join(", "));
  const publishers = derived.publishers;
  if (publishers.length === 0) fail("SWEEP_INVENTORY_EMPTY", "derived zero publisher workflows");
  const publisherFiles = publishers.map((row) => row.file);
  const notes = [
    "This run is deadline-bounded; crash recovery latency is bounded only by the lease TTL and the 15-minute restore watchdog — hard outages are disclosed limitations.",
  ];
  const report = {
    result: "retention_window_aborted",
    reason: null,
    run_id: runId,
    started_at: new Date(startedMs).toISOString(),
    deadline_epoch_seconds: Math.floor(deadlineMs / 1000),
    reserve_seconds: Math.floor(reserveMs / 1000),
    publishers: publisherFiles,
    reference_only_workflows: derived.referenceOnly.map((row) => row.file),
    notes,
    recovery: { performed: false },
    preflight: null,
    capture: null,
    disable: null,
    drain: null,
    apply: null,
    restore: null,
    duration: null,
  };

  // Lease liveness is checked BEFORE any recovery. A live foreign lease blocks both
  // recovery and pausing; preflight adds no claim and never touches the journal.
  const { number: journalNumber, journal } = await readJournal({ gh });
  const lease = journal?.lease ?? null;
  const leaseLive = Boolean(lease) && !lease.released_at && Date.parse(lease.expires_at) > now() && lease.run_id !== runId;
  const pendingStates = journal?.vendored_states ?? [];
  if (leaseLive) {
    if (preflightOnly) {
      return { ...report, result: "retention_window_preflight_blocked", reason: "live_lease", pending_recovery: pendingStates.length };
    }
    return { ...report, result: "retention_window_aborted", reason: "foreign_lease", pending_recovery: pendingStates.length };
  }

  let journalIssue = journalNumber;
  if (preflightOnly) {
    // Strictly read-only rehearsal: no lease claim, no recovery, no journal writes.
    const counts = await nonterminalCounts({ gh, repo: workflowRepo, publisherFiles, deadline: deadlineMs - reserveMs });
    const offenders = summarizeRunCounts({ countsByFile: counts });
    return {
      ...report,
      result: offenders.length > 0 ? "retention_window_preflight_busy" : "retention_window_preflight_ok",
      preflight: { offenders, pending_recovery: pendingStates.length, reference_only: derived.referenceOnly.length },
    };
  }

  // Recovery (lease is not live): restore journaled states first. Confirmed entries are
  // cleared; anything unconfirmed stays in the journal.
  if (pendingStates.length > 0) {
    const outcome = await restoreStates({ gh, repo: workflowRepo, recorded: pendingStates, io, deadline: deadlineMs, reserveMs, now, sleepImpl });
    await notifyRecovery({gh, journal, confirmed: outcome.confirmed, unconfirmed: outcome.unconfirmed});
    journalIssue = await upsertJournal({
      gh, number: journalIssue,
      journal: { ...(journal ?? {}), schema: "retention-window-journal/2", vendored_states: pendingStates.filter(row => outcome.unconfirmed.includes(row.file)) },
      io,
    });
    report.recovery = { performed: true, confirmed: outcome.confirmed, unconfirmed: outcome.unconfirmed };
    if (outcome.unconfirmed.length > 0) {
      return { ...report, result: "retention_window_aborted", reason: "recovery_incomplete" };
    }
  }

  // Claim the advisory lease; read-back detects a concurrent manual claim.
  let claimedJournal = {
    ...(journal ?? {}),
    schema: "retention-window-journal/2",
    lease: { run_id: runId, started_at: new Date(startedMs).toISOString(), expires_at: new Date(now() + leaseTtlMs).toISOString() },
  };
  journalIssue = await upsertJournal({ gh, number: journalIssue, journal: claimedJournal, io });
  const readBack = await readJournal({ gh, number: journalIssue });
  if (readBack.journal?.lease?.run_id !== runId) {
    return { ...report, result: "retention_window_aborted", reason: "lease_readback_mismatch" };
  }

  // Preflight idle BEFORE pausing. Query errors are errors (never "idle"): a failed
  // run-list query pauses nothing and returns an aborted report after releasing the lease.
  let preCounts;
  try {
    preCounts = await nonterminalCounts({ gh, repo: workflowRepo, publisherFiles, deadline: deadlineMs - reserveMs });
  } catch (error) {
    try {
      await upsertJournal({
        gh, number: journalIssue,
        journal: { ...claimedJournal, lease: { ...claimedJournal.lease, released_at: new Date(now()).toISOString() } },
        io,
      });
    } catch {
      // Lease release is best-effort; the TTL bounds a stale lease.
    }
    return { ...report, result: "retention_window_aborted", reason: "run_list_failed", detail: String(error?.message ?? error).slice(0, 200) };
  }
  const busy = summarizeRunCounts({ countsByFile: preCounts });
  report.preflight = { offenders: busy, pending_recovery: 0, reference_only: derived.referenceOnly.length };
  // Busy lanes are allowed here: disable new dispatches globally, then drain
  // existing runs without cancelling them. Timeout restores first and defers.

  // Capture exact enabled states (fresh list; unsupported states fail closed).
  const captured = await workflowStates({ gh, deadline: deadlineMs - reserveMs });
  const recorded = [];
  for (const entry of publishers) {
    const live = captured.find((row) => row.file === entry.file);
    if (!live) return { ...report, result: "retention_window_aborted", reason: "workflow_inventory_incomplete", detail: entry.file };
    if (!SUPPORTED_WORKFLOW_STATES.includes(live.state)) {
      return { ...report, result: "retention_window_aborted", reason: "workflow_state_unsupported", detail: `${entry.file}:${live.state}` };
    }
    recorded.push({ file: entry.file, name: entry.name, state: live.state });
  }
  report.capture = { count: recorded.length, to_disable: recorded.filter((row) => row.state === "active").length };

  // Durable capture BEFORE the first disable.
  claimedJournal = { ...claimedJournal, vendored_states: recorded };
  journalIssue = await upsertJournal({ gh, number: journalIssue, journal: claimedJournal, io });

  let firstDisableAt = null;
  let restoreOutcome = null;
  try {
    // Disable, then verify every disable against fresh state.
    const disableAttempted = [];
    for (const entry of recorded) {
      if (entry.state !== "active") continue;
      if (firstDisableAt === null) firstDisableAt = now();
      const call = await gh.call(["workflow", "disable", entry.file], { allowFailure: true, deadline: deadlineMs - reserveMs });
      if (!call.ok) throw Object.assign(new Error(`DISABLE_FAILED:${entry.file}`), { code: "DISABLE_FAILED", file: entry.file });
      disableAttempted.push(entry.file);
    }
    const afterDisable = await workflowStates({ gh, deadline: deadlineMs - reserveMs });
    const notDisabled = recorded
      .filter((entry) => entry.state === "active")
      .filter((entry) => afterDisable.find((row) => row.file === entry.file)?.state !== "disabled_manually");
    if (notDisabled.length > 0) {
      throw Object.assign(new Error(`DISABLE_UNVERIFIED:${notDisabled.map((row) => row.file).join(",")}`), { code: "DISABLE_UNVERIFIED" });
    }
    report.disable = { attempted: disableAttempted.length, verified: disableAttempted.length };

    // Drain: complete nonterminal counts for every publisher; zero for two consecutive
    // verifications (the second guards a queue that was mid-flight during the first).
    const drainDeadline = Math.min(now() + drainCapSeconds * 1000, deadlineMs - reserveMs);
    let drained = false;
    let verifications = 0;
    let zeroStreak = 0;
    let drainOffenders = busy;
    while (now() < drainDeadline) {
      let counts;
      try {
        counts = await nonterminalCounts({ gh, repo: workflowRepo, publisherFiles, deadline: Math.min(drainDeadline, deadlineMs - reserveMs) });
      } catch (error) {
        if (now() + GH_CALL_MIN_TIMEOUT_MS >= drainDeadline) break;
        throw error;
      }
      verifications += 1;
      const offenders = summarizeRunCounts({ countsByFile: counts });
      drainOffenders = offenders;
      if (offenders.length === 0) {
        zeroStreak += 1;
        if (zeroStreak >= 2) { drained = true; break; }
      } else {
        zeroStreak = 0;
      }
      await sleepImpl(clampSleepMs(DRAIN_POLL_SECONDS * 1000, drainDeadline, 5_000));
    }
    report.drain = { drained, verifications, offenders: drainOffenders, wait_seconds: Math.round((now() - (firstDisableAt ?? now())) / 1000) };
    if (!drained) throw Object.assign(new Error("DRAIN_TIMEOUT"), { code: "DRAIN_TIMEOUT" });

    // Apply with enforced timeout; on timeout the child is SIGKILLed and reaped by
    // execFile before restoration runs.
    const applyDeadlineMs = deadlineMs - reserveMs;
    if (Date.now() + 30_000 >= applyDeadlineMs) throw Object.assign(new Error("WINDOW_APPLY_BUDGET"), { code: "WINDOW_APPLY_BUDGET" });
    const applyTimeoutMs = Math.max(10_000, Math.floor(applyDeadlineMs - now()));
    let stdout = "";
    let exitCode = 0;
    try {
      const result = await execFileImpl(process.execPath, [
        "scripts/ops/retention-sweep.mjs", "apply",
        `--plan=${planPath}`,
        `--deadline-epoch-seconds=${Math.floor(applyDeadlineMs / 1000)}`,
        ...(batchMaxKeys ? [`--batch-max-keys=${batchMaxKeys}`] : []),
        ...(skipManifests ? ["--skip-manifests"] : []),
        ...(keysOut ? [`--keys-out=${keysOut}`] : []),
      ], { env, maxBuffer: 64 * 1024 * 1024, timeout: applyTimeoutMs, killSignal: "SIGKILL" });
      stdout = String(result.stdout ?? "");
    } catch (error) {
      stdout = String(error?.stdout ?? "");
      exitCode = Number.isInteger(error?.code) ? error.code : 1;
    }
    try {
      const lines = stdout.trim().split("\n");
      report.apply = JSON.parse(lines[lines.length - 1]);
      report.apply.apply_exit_code = exitCode;
    } catch {
      report.apply = { result: "retention_batch_aborted", reason: "apply_spawn_failed", apply_exit_code: exitCode };
    }
    if (exitCode === null || Number.isNaN(exitCode)) report.apply.apply_exit_code = exitCode;
  } catch (error) {
    // Any failure past the capture point still emits a structured report; the apply
    // slot carries the failure so the result mapping below reports an abort.
    report.apply = { result: "retention_batch_aborted", reason: error?.code ?? "window_failed" };
  } finally {
    // Guaranteed restoration for everything past the first disable, including partial
    // disable failures and cancellations that surface as exceptions.
    try {
      restoreOutcome = await restoreStates({ gh, repo: workflowRepo, recorded, io, deadline: deadlineMs, reserveMs: 0, now, sleepImpl });
    } catch (error) {
      restoreOutcome = { confirmed: [], unconfirmed: recorded.map((row) => row.file), failed: recorded.map((row) => row.file), error: String(error?.message ?? error).slice(0, 200) };
    }
    const remainingVendored = (restoreOutcome.unconfirmed ?? []).map((file) => recorded.find((row) => row.file === file)).filter(Boolean);
    try {
      journalIssue = await upsertJournal({
        gh, number: journalIssue,
        journal: {
          ...claimedJournal,
          vendored_states: remainingVendored,
          last_restore: { at: new Date(now()).toISOString(), confirmed: restoreOutcome.confirmed?.length ?? 0, unconfirmed: remainingVendored.length },
          lease: { ...claimedJournal.lease, released_at: new Date(now()).toISOString() },
        },
        io,
      });
    } catch (error) {
      io.error(`retention-window: journal update after restore failed: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  }
  report.restore = restoreOutcome;
  const lastConfirmedRestoreAt = now();
  report.duration = {
    first_disable_at: firstDisableAt ? new Date(firstDisableAt).toISOString() : null,
    last_confirmed_restore_at: new Date(lastConfirmedRestoreAt).toISOString(),
    first_disable_to_restore_seconds: firstDisableAt ? Math.round((lastConfirmedRestoreAt - firstDisableAt) / 1000) : null,
    window_seconds: Math.round((lastConfirmedRestoreAt - startedMs) / 1000),
  };
  const restoreIncomplete = (restoreOutcome.unconfirmed?.length ?? 0) > 0 || (restoreOutcome.failed?.length ?? 0) > 0 || (restoreOutcome.missing?.length ?? 0) > 0 || (restoreOutcome.unsupported?.length ?? 0) > 0;
  const applyResult = report.apply?.result ?? null;
  if (restoreIncomplete) report.result = "retention_window_aborted";
  else if (applyResult === "retention_batch_applied" || applyResult === "retention_batch_noop") report.result = "retention_window_applied";
  else if (report.apply?.reason === "DRAIN_TIMEOUT") report.result = "retention_window_deferred";
  else if (applyResult === "retention_batch_partial") report.result = "retention_window_partial";
  else report.result = "retention_window_aborted";
  if (report.reason === null && report.result !== "retention_window_applied") {
    report.reason = report.apply?.reason ?? (restoreIncomplete ? "restore_incomplete" : "apply_not_applied");
  }
  return report;
}

// Restore only originally-active workflows; confirm against fresh state; return the
// confirmed list plus everything that could NOT be confirmed (those stay in the journal).
export async function restoreStates({ gh, repo = null, recorded, io = console, deadline = null, reserveMs = 0, now = () => Date.now(), sleepImpl } = {}) {
  if (!recorded || recorded.length === 0) return { enable: [], keepDisabled: [], missing: [], unsupported: [], failed: [], confirmed: [], unconfirmed: [] };
  const listDeadline = deadline; // restore reserve already excluded by callers
  const currentRaw = await gh.call(["workflow", "list", "--all", "--limit", "1000", "--json", "path,state"], { deadline: listDeadline });
  const current = JSON.parse(currentRaw.stdout || "[]").map((row) => ({ file: row.path ? path.basename(row.path) : "", state: row.state }));
  const plan = planRestoreFromStates({ recorded, current });
  const failed = [];
  for (const file of plan.enable) {
    const call = await gh.call(["workflow", "enable", file], { allowFailure: true, deadline: listDeadline, reserveMs });
    if (!call.ok) failed.push(file);
  }
  // Fresh-state confirmation; only confirmed entries may leave the journal.
  const afterRaw = await gh.call(["workflow", "list", "--all", "--limit", "1000", "--json", "path,state"], { deadline: listDeadline });
  const after = JSON.parse(afterRaw.stdout || "[]").map((row) => ({ file: row.path ? path.basename(row.path) : "", state: row.state }));
  const confirmed = [];
  const unconfirmed = [];
  for (const entry of recorded) {
    const fresh = after.find((row) => row.file === entry.file);
    if (!fresh) { unconfirmed.push(entry.file); continue; }
    if (entry.state === "active") {
      if (fresh.state === "active") confirmed.push(entry.file); else unconfirmed.push(entry.file);
    } else {
      // Originally disabled: success = it is still not active and was never enabled.
      if (fresh.state === "active") unconfirmed.push(entry.file); else confirmed.push(entry.file);
    }
  }
  io.error(`retention-window: restore enable=${plan.enable.length} confirmed=${confirmed.length} unconfirmed=${unconfirmed.length} failed=${failed.length}`);
  return { ...plan, failed, confirmed, unconfirmed };
}

// --- CLI ----------------------------------------------------------------------

export async function runRetentionWindowCli({ argv = process.argv.slice(2), env = process.env, io = console } = {}) {
  const args = {
    command: argv[0] ?? "run",
    hardDeadlineEpochSeconds: null,
    plan: null, workflowsDir: ".github/workflows", repo: null, preflightOnly: false, keysOut: null, skipManifests: false,
  };
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("--plan=")) args.plan = arg.slice("--plan=".length);
    else if (arg.startsWith("--workflows-dir=")) args.workflowsDir = arg.slice("--workflows-dir=".length);
    else if (arg.startsWith("--repo=")) args.repo = arg.slice("--repo=".length);
    else if (arg.startsWith("--keys-out=")) args.keysOut = arg.slice("--keys-out=".length);
    else if (arg.startsWith("--hard-deadline-epoch-seconds=")) args.hardDeadlineEpochSeconds = Number(arg.slice("--hard-deadline-epoch-seconds=".length));
    else if (arg === "--preflight-only") args.preflightOnly = true;
    else if (arg === "--skip-manifests") args.skipManifests = true;
    else fail("ARGS_INVALID", arg);
  }
  const repo = args.repo ?? env.GITHUB_REPOSITORY ?? null;
  if (args.command === "restore") {
    const gh = createGhDriver({ repo });
    const { number, journal } = await readJournal({ gh });
    const lease = journal?.lease ?? null;
    const leaseLive = Boolean(lease) && !lease.released_at && Date.parse(lease.expires_at) > Date.now();
    if (!journal?.vendored_states?.length) {
      io.log(JSON.stringify({ result: "retention_window_noop", reason: "no_vendored_states" }));
      return 0;
    }
    if (leaseLive) {
      io.log(JSON.stringify({ result: "retention_window_noop", reason: "live_lease", vendored: journal.vendored_states.length }));
      return 0;
    }
    const outcome = await restoreStates({ gh, recorded: journal.vendored_states, io });
    const remaining = outcome.unconfirmed.map((file) => journal.vendored_states.find((row) => row.file === file)).filter(Boolean);
    await notifyRecovery({gh, journal, confirmed: outcome.confirmed, unconfirmed: outcome.unconfirmed});
    await upsertJournal({ gh, number, journal: { ...journal, vendored_states: remaining }, io });
    io.log(JSON.stringify({ result: remaining.length > 0 ? "retention_window_restore_incomplete" : "retention_window_restored", confirmed: outcome.confirmed.length, unconfirmed: outcome.unconfirmed }));
    return remaining.length > 0 ? 1 : 0;
  }
  if (args.command !== "run") fail("ARGS_INVALID", `unknown command ${args.command}`);
  if (!args.plan && !args.preflightOnly) fail("ARGS_INVALID", "run requires --plan=<path>");
  const report = await runWindow({
    hardDeadlineEpochSeconds: args.hardDeadlineEpochSeconds,
    planPath: args.plan, repo, workflowsDir: args.workflowsDir, preflightOnly: args.preflightOnly, keysOut: args.keysOut, skipManifests: args.skipManifests, env, io,
  });
  io.log(JSON.stringify(report));
  if (report.result === "retention_window_aborted") return 1;
  if (report.result === "retention_window_partial") return 2;
  return 0;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    process.exitCode = await runRetentionWindowCli();
  } catch (error) {
    console.error(`retention-window: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  }
}
