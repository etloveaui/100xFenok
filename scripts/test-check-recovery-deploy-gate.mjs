#!/usr/bin/env node
// Deterministic unit tests for scripts/check-recovery-deploy-gate.mjs (Luna v3).
// GH_RUN_LIST_CMD and GH_COMPARE_CMD are stubbed; no real gh call is made.
// Push payloads model REAL Actions events: commit objects carry no path arrays;
// changed paths come exclusively from the compare resolver.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(__dirname, "check-recovery-deploy-gate.mjs");

function writeShim(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

function runGate(args, env) {
  const fullEnv = { ...process.env, ...env };
  return execFileSync(process.execPath, [GATE, ...args], { encoding: "utf8", env: fullEnv }).trim();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rdg-test-"));
// Status shims: respond per --status ($6): the named status returns 1, others 0.
const statusShim = (activeStatus) => writeShim(tmp, `gh-${activeStatus}`, `case "$6" in ${activeStatus}) echo 1;; *) echo 0;; esac`);
// Sibling shim: the second (dummy) recovery workflow has an in_progress run, slickcharts-history is clear.
const siblingActiveShim = writeShim(tmp, "gh-sibling", `case "$4/$6" in "example-recovery.yml/in_progress") echo 1;; *) echo 0;; esac`);
const idleShim = writeShim(tmp, "gh-idle", "echo 0");
const malformedShim = writeShim(tmp, "gh-malformed", "echo garbage");
const emptyShim = writeShim(tmp, "gh-empty", "exit 0");
const failingShim = writeShim(tmp, "gh-fail", "exit 1");
// Compare shims (GH_COMPARE_CMD): print the given JSON regardless of args.
const compareShim = (json) => writeShim(tmp, `cmp-${json.length}`, `echo '${json}'`);
const compareFailShim = writeShim(tmp, "cmp-fail", "exit 1");
const compareMalformedShim = writeShim(tmp, "cmp-malformed", "echo not-json");

const WF = "--recovery-workflows slickcharts-history.yml,example-recovery.yml";
const WF_ONE = "--recovery-workflows slickcharts-history.yml";

// Realistic Actions push payload: commit objects WITHOUT modified/added/removed.
function pushEvent(extra = {}) {
  return {
    ref: "refs/heads/main",
    before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    after: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    repository: { full_name: "etloveaui/100xFenok" },
    commits: [{ id: "a1", message: "m1" }, { id: "a2", message: "m2" }],
    head_commit: { id: "a2", message: "m2" },
    ...extra,
  };
}
function writeEvent(name, obj) {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}
const evPush = writeEvent("ev-push.json", pushEvent());
const evPushNoRepo = writeEvent("ev-push-norepo.json", pushEvent({ repository: undefined }));
const evPushNoRange = writeEvent("ev-push-norange.json", pushEvent({ before: undefined }));
const evRunSuccess = writeEvent("ev-run-success.json", { workflow_run: { conclusion: "success", name: "SlickCharts History" } });
const evRunFailure = writeEvent("ev-run-fail.json", { workflow_run: { conclusion: "failure", name: "Example Recovery" } });
const evRunCancel = writeEvent("ev-run-cancel.json", { workflow_run: { conclusion: "cancelled", name: "SlickCharts History" } });
const evRunNoConcl = writeEvent("ev-run-noconcl.json", { workflow_run: { name: "SlickCharts History" } });

const CMP_DATA = compareShim('{"total_commits":2,"files":["100xfenok-next/public/data/slickcharts/history.json","100xfenok-next/app/page.tsx"]}');
const CMP_UI = compareShim('{"total_commits":2,"files":["100xfenok-next/app/page.tsx","100xfenok-next/lib/utils.ts"]}');
// Rename: flattened compare output carries BOTH current and previous_filename;
// the previous path under data-serving must classify as data-touching.
const CMP_RENAME_FROM_DATA = compareShim('{"total_commits":1,"files":["100xfenok-next/lib/moved.json","100xfenok-next/public/data/old.json"]}');
const CMP_RENAME_NONDATA = compareShim('{"total_commits":1,"files":["100xfenok-next/lib/a.js","100xfenok-next/lib/b.js"]}');
const CMP_CAP = compareShim(`{"total_commits":400,"files":${JSON.stringify(Array.from({ length: 300 }, (_, i) => `100xfenok-next/public/data/f${i}.json`))}}`);

let passed = 0;
function check(name, args, env, expected) {
  const got = runGate(args, env);
  assert.equal(got, expected, `${name}: expected ${expected}, got ${got}`);
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
function checkExit2(name, args, env) {
  let threw = false;
  try {
    runGate(args, env);
  } catch (err) {
    threw = err.status === 2;
  }
  assert.equal(threw, true, `${name}: must exit 2`);
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

// --- status matrix (dispatch mode, per-status limit-1 queries) ---
for (const st of ["queued", "requested", "waiting", "pending", "in_progress"]) {
  check(`dispatch + ${st} active -> skip`, [`--mode`, `dispatch`, ...WF_ONE.split(" ")], { GH_RUN_LIST_CMD: statusShim(st) }, "skip");
}
check("dispatch + all statuses idle -> proceed", [`--mode`, `dispatch`, ...WF_ONE.split(" ")], { GH_RUN_LIST_CMD: idleShim }, "proceed");
check("dispatch + empty zero-exit stdout -> proceed-uncertain (Number('')===0 guard)", [`--mode`, `dispatch`, ...WF_ONE.split(" ")], { GH_RUN_LIST_CMD: emptyShim }, "proceed-uncertain");
check("dispatch + malformed status output -> proceed-uncertain", [`--mode`, `dispatch`, ...WF_ONE.split(" ")], { GH_RUN_LIST_CMD: malformedShim }, "proceed-uncertain");
check("dispatch + status query failure -> proceed-uncertain", [`--mode`, `dispatch`, ...WF_ONE.split(" ")], { GH_RUN_LIST_CMD: failingShim }, "proceed-uncertain");

// --- push classification via compare resolver (realistic payload, no commit paths) ---
const ACTIVE = { GH_RUN_LIST_CMD: statusShim("in_progress") };
check("push + compare shows data path + recovery active -> skip", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: CMP_DATA }, "skip");
check("push + compare shows UI-only + recovery active -> proceed", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: CMP_UI }, "proceed");
check("push + rename from data-serving path + recovery active -> skip", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: CMP_RENAME_FROM_DATA }, "skip");
check("push + rename within non-data paths + recovery active -> proceed", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: CMP_RENAME_NONDATA }, "proceed");
check("push + compare hits 300 cap + recovery active -> skip (uncertain)", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: CMP_CAP }, "skip");
check("push + data path + no recovery -> proceed", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { GH_RUN_LIST_CMD: idleShim, GH_COMPARE_CMD: CMP_DATA }, "proceed");
check("push + compare failure -> proceed-uncertain", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: compareFailShim }, "proceed-uncertain");
check("push + malformed compare output -> proceed-uncertain", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPush, ...WF.split(" ")], { ...ACTIVE, GH_COMPARE_CMD: compareMalformedShim }, "proceed-uncertain");
check("push + event missing repository -> proceed-uncertain", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPushNoRepo, ...WF.split(" ")], ACTIVE, "proceed-uncertain");
check("push + event missing before/after -> proceed-uncertain", [`--mode`, `push`, `--event-name`, `push`, `--event-json`, evPushNoRange, ...WF.split(" ")], ACTIVE, "proceed-uncertain");

// --- workflow_run: sibling gating + final requeue guarantee ---
check("workflow_run success + sibling nonterminal -> skip", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunSuccess, ...WF.split(" ")], { GH_RUN_LIST_CMD: siblingActiveShim }, "skip");
check("workflow_run success + no sibling nonterminal -> proceed", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunSuccess, ...WF.split(" ")], { GH_RUN_LIST_CMD: idleShim }, "proceed");
// Final requeue: B fails/cancels AFTER A succeeded while B was active; once no
// recovery remains, the last completion proceeds regardless of conclusion.
check("workflow_run failure + no sibling nonterminal -> proceed (final requeue)", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunFailure, ...WF.split(" ")], { GH_RUN_LIST_CMD: idleShim }, "proceed");
check("workflow_run cancelled + no sibling nonterminal -> proceed (final requeue)", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunCancel, ...WF.split(" ")], { GH_RUN_LIST_CMD: idleShim }, "proceed");
check("workflow_run missing conclusion + no sibling -> proceed (warning surfaced)", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunNoConcl, ...WF.split(" ")], { GH_RUN_LIST_CMD: idleShim }, "proceed");
check("workflow_run + status query uncertainty -> proceed-uncertain", [`--mode`, `push`, `--event-name`, `workflow_run`, `--event-json`, evRunSuccess, ...WF.split(" ")], { GH_RUN_LIST_CMD: failingShim }, "proceed-uncertain");

// --- non-push / hard errors ---
check("non-push event + recovery active -> proceed", [`--mode`, `push`, `--event-name`, `schedule`, `--event-json`, evPush, ...WF.split(" ")], ACTIVE, "proceed");
checkExit2("invalid mode exits 2", [`--mode`, `bogus`], { GH_RUN_LIST_CMD: idleShim });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
