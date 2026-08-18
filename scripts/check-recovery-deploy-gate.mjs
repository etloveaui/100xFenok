#!/usr/bin/env node
// Recovery deploy gate — decide whether a data-serving deploy may proceed while
// SlickCharts recovery-family workflows are in a nonterminal state.
//
// Modes:
//   --mode push      deploy-worker push/workflow_run guard:
//                    - push: skip when a recovery run is nonterminal AND the
//                      triggering push touches data-serving paths
//                      (100xfenok-next/public/data/**). Changed paths come from
//                      a bounded GitHub compare API query (before...after) —
//                      real Actions push commit objects do NOT reliably carry
//                      added/removed/modified. UI-only pushes proceed; the
//                      compare 300-file cap and unresolvable ranges are
//                      demonstrated uncertainty -> conservative skip.
//                    - workflow_run: while ANY recovery workflow has a
//                      nonterminal run, every completion (success or not) is
//                      gated. Once no recovery remains nonterminal, the final
//                      completion proceeds regardless of its conclusion —
//                      a non-success conclusion is surfaced as a warning and
//                      strict KPI remains the fail-close backstop. This
//                      guarantees the requeue even when the last sibling fails
//                      or is cancelled.
//   --mode dispatch  update-manifest dispatch guard: skip when any recovery
//                    workflow has a nonterminal run.
//
// Nonterminal detection: per (workflow, status) query with limit 1 for every
// status in {queued, requested, waiting, pending, in_progress} — no windowed
// scan that could blind-spot a status class. GH_RUN_LIST_CMD overrides the gh
// binary; GH_COMPARE_CMD overrides the gh binary for the compare query.
//
// Output tokens (stdout): "skip" | "proceed" | "proceed-uncertain".
// Exit code 2 on hard argument errors ONLY — callers must fail the step on
// any non-zero exit (never silently convert to proceed).

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const DATA_SERVING_PREFIXES = ["100xfenok-next/public/data/"];
const NONTERMINAL_STATUSES = ["queued", "requested", "waiting", "pending", "in_progress"];
// Pre-start only, deliberately excluding in_progress: a run already executing
// may have checked out before our push, so suppressing on it could leave the
// commit unshipped until the next dispatch.
const PRE_START_STATUSES = ["queued", "requested", "waiting", "pending"];
const DEPLOY_WORKFLOW = "deploy-worker.yml";
// GitHub compare API caps the files array at 300 entries; reaching the cap is
// demonstrated truncation evidence.
const COMPARE_FILES_CAP = 300;

function parseArgs(argv) {
  const args = { mode: null, eventJson: null, eventName: null, recoveryWorkflows: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") args.mode = argv[++i];
    else if (a === "--pushed-sha") args.pushedSha = argv[++i];
    else if (a === "--event-json") args.eventJson = argv[++i];
    else if (a === "--event-name") args.eventName = argv[++i];
    else if (a === "--recovery-workflows")
      args.recoveryWorkflows = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  }
  return args;
}

// Returns a non-negative integer count, or null on provider failure /
// malformed output (caller surfaces uncertainty — never silently filtered).
function queryStatusCount(workflow, status) {
  const cmd = process.env.GH_RUN_LIST_CMD || "gh";
  try {
    const out = execFileSync(
      cmd,
      ["run", "list", "--workflow", workflow, "--status", status, "--limit", "1", "--json", "databaseId", "--jq", "length"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    // Empty/whitespace stdout must NOT be read as 0 (Number("") === 0): require
    // canonical non-negative integer text before conversion.
    if (!/^\d+$/.test(out)) throw new Error(`malformed status count: ${JSON.stringify(out)}`);
    return Number(out);
  } catch (err) {
    console.error(`[recovery-deploy-gate] warning: status query failed for ${workflow} ${status} (${err.message.split("\n")[0]}); uncertainty must be surfaced`);
    return null;
  }
}

// Returns true / false / null (null = uncertainty -> caller dispatches).
// True only when this repository already has a deploy run for main, still
// pre-start, whose head commit is exactly the SHA we just pushed. Such a run
// checks out at start and therefore carries our commit, so a second dispatch
// would only supersede and cancel it.
function duplicateDeployPending(sha) {
  if (!/^[0-9a-f]{40}$/.test(sha ?? "")) return null;
  const cmd = process.env.GH_RUN_LIST_CMD || "gh";
  let uncertain = false;
  for (const st of PRE_START_STATUSES) {
    try {
      const out = execFileSync(
        cmd,
        ["run", "list", "--workflow", DEPLOY_WORKFLOW, "--status", st, "--branch", "main", "--limit", "20",
         "--json", "headSha", "--jq", `[.[] | select(.headSha == "${sha}")] | length`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim();
      if (!/^\d+$/.test(out)) throw new Error(`malformed duplicate count: ${JSON.stringify(out)}`);
      if (Number(out) > 0) return true;
    } catch (err) {
      console.error(`[recovery-deploy-gate] warning: duplicate-deploy query failed for ${st} (${err.message.split("\n")[0]}); dispatching rather than suppressing`);
      uncertain = true;
    }
  }
  return uncertain ? null : false;
}

// Returns true / false / null (null = provider uncertainty).
function recoveryActive(workflows) {
  if (workflows.length === 0) return false;
  let uncertain = false;
  for (const wf of workflows) {
    for (const st of NONTERMINAL_STATUSES) {
      const count = queryStatusCount(wf, st);
      if (count === null) {
        uncertain = true;
        continue;
      }
      if (count > 0) return true;
    }
  }
  return uncertain ? null : false;
}

function readEvent(eventPath) {
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch (err) {
    console.error(`[recovery-deploy-gate] warning: event json unreadable (${err.message.split("\n")[0]}); uncertainty must be surfaced`);
    return null;
  }
}

// Resolves the changed paths of a push via a bounded compare API query.
// Returns { dataTouching, uncertain } — uncertain=true means demonstrated
// truncation/range evidence (conservative skip); null means the provider query
// itself failed (proceed-uncertain).
function resolvePushPaths(repo, before, after) {
  const cmd = process.env.GH_COMPARE_CMD || "gh";
  try {
    const out = execFileSync(
      cmd,
      ["api", `repos/${repo}/compare/${before}...${after}`, "--jq", "{total_commits, files: [.files[] | .filename, (.previous_filename // empty)]}"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`malformed compare output: ${JSON.stringify(out.slice(0, 80))}`);
    }
    const files = Array.isArray(parsed.files) ? parsed.files : [];
    if (files.length >= COMPARE_FILES_CAP) {
      console.error(`[recovery-deploy-gate] note: compare hit the ${COMPARE_FILES_CAP}-file cap; treating as truncated (documented uncertainty)`);
      return { dataTouching: true, uncertain: true };
    }
    const dataTouching = files.some((p) => DATA_SERVING_PREFIXES.some((prefix) => p.startsWith(prefix)));
    return { dataTouching, uncertain: false };
  } catch (err) {
    console.error(`[recovery-deploy-gate] warning: compare query failed for ${before}...${after} (${err.message.split("\n")[0]}); uncertainty must be surfaced`);
    return null;
  }
}

function decide(args) {
  const active = recoveryActive(args.recoveryWorkflows);

  if (args.mode === "dispatch") {
    if (active === null) return "proceed-uncertain";
    if (active) return "skip";
    // Fail open: only an affirmative exact-SHA pre-start match suppresses.
    return duplicateDeployPending(args.pushedSha) === true ? "skip-duplicate" : "proceed";
  }

  // push mode
  if (!args.eventJson || !args.eventName) {
    console.error("[recovery-deploy-gate] warning: push mode without --event-json/--event-name; uncertainty must be surfaced");
    return "proceed-uncertain";
  }
  const event = readEvent(args.eventJson);
  if (event === null) return "proceed-uncertain";

  if (args.eventName === "workflow_run") {
    // Gate every completion while ANY sibling recovery is nonterminal. Once no
    // recovery remains, proceed regardless of the last completion's conclusion
    // (final requeue guarantee); surface non-success as a warning.
    if (active === null) return "proceed-uncertain";
    if (active) return "skip";
    const conclusion = event.workflow_run?.conclusion;
    if (conclusion !== "success") {
      console.error(`[recovery-deploy-gate] warning: last recovery completion concluded ${conclusion ?? "missing"}; no recovery remains nonterminal so the deploy proceeds; strict KPI is the fail-close backstop`);
    }
    return "proceed";
  }

  if (args.eventName !== "push") return "proceed"; // dispatch/schedule etc.

  const repo = event.repository?.full_name;
  const before = event.before;
  const after = event.after;
  if (!repo || !before || !after) {
    console.error("[recovery-deploy-gate] warning: push event lacks repository/before/after; uncertainty must be surfaced");
    return "proceed-uncertain";
  }
  if (active === null) return "proceed-uncertain";
  if (!active) return "proceed";
  const resolved = resolvePushPaths(repo, before, after);
  if (resolved === null) return "proceed-uncertain";
  if (resolved.uncertain) return "skip"; // demonstrated truncation/range uncertainty -> conservative skip
  return resolved.dataTouching ? "skip" : "proceed";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode !== "push" && args.mode !== "dispatch") {
    console.error("usage: check-recovery-deploy-gate.mjs --mode push|dispatch [--event-json <path>] [--event-name <name>] --recovery-workflows <a.yml,b.yml>");
    process.exit(2);
  }
  process.stdout.write(`${decide(args)}\n`);
}

main();
