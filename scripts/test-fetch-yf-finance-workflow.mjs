#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fetch-yf-finance.yml
// (#366 step 4). The lane's bounded store root is the only admin path this
// workflow commits; the gate keeps it that way in both directions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const input of [
  "untracked_only", "retry_limit", "regular_limit", "untracked_limit",
  "shard_cycle_index", "scheduled_weekday", "stable_shards",
]) {
  assert.match(workflowText, new RegExp(`^      ${input}:\\n`, "m"),
    `workflow_dispatch must expose bounded recovery input ${input}`);
}
assert.match(
  workflowText,
  /bounded untracked recovery requires stable_shards=true, shard=i\/6, shard_cycle_index, and scheduled_weekday/,
  "untracked recovery must fail closed without deterministic shard controls",
);
assert.match(
  workflowText,
  /bounded untracked recovery requires limit, retry_limit, regular_limit, and untracked_limit/,
  "untracked recovery must fail closed without explicit budgets",
);
assert.match(workflowText, /INPUT_UNTRACKED_LIMIT: \$\{\{ github\.event\.inputs\.untracked_limit \|\| '' \}\}/);
assert.match(workflowText, /INPUT_STABLE_SHARDS: \$\{\{ github\.event\.inputs\.stable_shards \|\| 'false' \}\}/);
assert.match(
  workflowText,
  /if \[ "\$EVENT_NAME" = "schedule" \] \|\| \[ "\$INPUT_UNTRACKED_ONLY" = "true" \]; then ARGS="\$ARGS --natural-run"; fi/,
  "bounded manual recovery must claim the natural retry queue while ordinary dispatches stay unchanged",
);
// The untracked recovery branch must bind the core ETF scope before ARGS is
// built: force the core daily basket and keep StockAnalysis ETF expansion
// false. The assertion anchors the assignments between the dispatch-branch
// header and the schedule-branch header, so the pair cannot satisfy it from
// inside the scheduled lane or from outside the branch. Lazy spans keep it
// resilient to re-indentation while the shell tokens stay exact.
assert.match(
  workflowText,
  /if \[ "\$EVENT_NAME" = "workflow_dispatch" \] && \[ "\$INPUT_UNTRACKED_ONLY" = "true" \]; then[\s\S]*?INPUT_CORE_DAILY_BASKET="true"[\s\S]*?INPUT_STOCKANALYSIS_ETFS="false"[\s\S]*?fi[\s\S]*?if \[ "\$EVENT_NAME" = "schedule" \]; then/,
  "untracked recovery must force the core daily basket and keep StockAnalysis ETF expansion false inside its dispatch branch, before ARGS is built",
);
assert.match(
  workflowText,
  /if \[ "\$INPUT_CORE_DAILY_BASKET" = "true" \]; then ARGS="\$ARGS --core-daily-basket"; fi/,
  "the forced core basket flag must reach the fetch ARGS",
);
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fetch-yf-finance.yml",
  repoRoot,
});
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.lanes, ["yahoo_batch_quote_history"], "the registry must attribute this lane to fetch-yf-finance.yml");
assert.match(
  workflowText,
  /- name: Emit Yahoo batch detection attempt[\s\S]*?if: \$\{\{ always\(\) && env\.YF_PLAN_ONLY != 'true' \}\}[\s\S]*?node scripts\/emit-yahoo-batch-quote-history-attempt\.mjs[\s\S]*?- name: Refresh owned Yahoo quarter-close source/,
  "the standard attempt shard must be emitted after the batch and before downstream refresh work",
);
assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/);
assert.match(workflowText, /--stage always_if_exists/);
assert.match(
  workflowText,
  /if: \$\{\{ always\(\) && env\.YF_PLAN_ONLY != 'true' \}\}[\s\S]*?scripts\/stage-lane-manifest\.sh[\s\S]*?--stage always_if_exists[\s\S]*?git add --[\s\S]*?git restore --staged --worktree -- data\/yf\/finance\/_summary\.json/,
  "manifest staging must remain inside the non-plan persist step, alongside the legacy hand list and before the summary exclusion",
);

console.log("test-fetch-yf-finance-workflow: ok");
