#!/usr/bin/env node

// The writer-queue observer measured a real breach every 15 minutes and told
// nobody: its permissions were read-only, it had no notification step, and the
// signal existed solely in the run log. A 31-hour StockAnalysis outage was
// therefore visible in three places that did not talk to each other.
//
// This pins the notification contract: ONE upserted OPS state comment, issue
// write only, and no repo write. Every guard is mutation-proven below, because a
// guard that cannot fail is not a guard. Assertions are text-based to match the
// existing workflow-manifest tests; the repo ships no YAML parser for scripts/.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_REL = ".github/workflows/global-writer-queue-observer.yml";
const workflow = fs.readFileSync(path.join(root, WORKFLOW_REL), "utf8");
const COMMENT_STEP = "Upsert queue state comment";

function stepBlock(source, name) {
  // The exact six-space delimiter is intentionally fail-closed: if step
  // indentation drifts, the block over-runs and the exact assertions fail.
  const marker = `- name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} step must exist`);
  const next = source.indexOf("\n      - name:", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function assertNoRepoWrite(source) {
  assert.doesNotMatch(
    source,
    /contents: write/,
    "the observer must never gain repo write; it watches a blocked writer queue and must not join it",
  );
  assert.doesNotMatch(
    source,
    /git (?:add|commit|push)/,
    "the observer must make no repo write",
  );
}

function assertIssueNotification(source) {
  assert.match(
    source,
    /issues: write/,
    "the observer must hold issues: write or it cannot notify at all",
  );

  const block = stepBlock(source, COMMENT_STEP);
  assert.match(
    block,
    /--edit-last/,
    "the state comment must be upserted, not appended; appending is the 136-comment failure mode",
  );
  assert.match(
    block,
    /--create-if-none/,
    "the first observation must still create the state comment",
  );
  // `--edit-last` edits the current user's last comment, so this must NOT target
  // the shared failure-alarm issue: it would overwrite the alarm's own alerts.
  // A dedicated state issue keeps the upsert target unambiguous, and bootstrapping
  // it must be guarded by an existence check so it is created once, never per run.
  assert.doesNotMatch(
    block,
    /100xFenok pipeline job failure alarm/,
    "queue state must not upsert into the failure-alarm issue; --edit-last would clobber its alerts",
  );
  const createIndex = block.indexOf("gh issue create");
  if (createIndex !== -1) {
    const guard = block.slice(0, createIndex);
    assert.match(
      guard,
      /gh issue list[\s\S]*?--search/,
      "bootstrapping the state issue must be guarded by an existence search, never unconditional",
    );
  }
}

assertNoRepoWrite(workflow);
assertIssueNotification(workflow);

// --- Mutation proofs: every guard above must be able to fail ---
assert.throws(
  () => assertNoRepoWrite(workflow.replace(/contents: read/, "contents: write")),
  /must never gain repo write/,
  "granting contents: write must fail the guard",
);
assert.throws(
  () => assertNoRepoWrite(`${workflow}\n          git push origin HEAD:main\n`),
  /must make no repo write/,
  "adding a repo write must fail the guard",
);
assert.throws(
  () => assertIssueNotification(workflow.replace(/issues: write/g, "issues: read")),
  /must hold issues: write/,
  "downgrading the issue permission must fail the guard",
);
assert.throws(
  () => assertIssueNotification(workflow.replace(/--edit-last/g, "")),
  /must be upserted, not appended/,
  "turning the upsert into a blind append must fail the guard",
);
assert.throws(
  () => assertIssueNotification(workflow.replace(`- name: ${COMMENT_STEP}`, "- name: Post something else")),
  /must exist/,
  "removing the notification step must fail the guard",
);
assert.throws(
  () => assertIssueNotification(workflow.replace(/gh issue list[\s\S]*?--search[^\n]*\n/, "")),
  /guarded by an existence search/,
  "an unguarded issue create must fail the guard",
);
assert.throws(
  () => assertIssueNotification(workflow.replace(/QUEUE_STATE_TITLE="[^"]*"/, 'QUEUE_STATE_TITLE="100xFenok pipeline job failure alarm"')),
  /would clobber its alerts/,
  "retargeting the upsert at the failure-alarm issue must fail the guard",
);

console.log("test-global-writer-queue-manifest: ok");
