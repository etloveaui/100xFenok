#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fenok-edge-krx-daily.yml
// (#366 step 4). KRX is an emitter-first shadow lane: every non-plan run emits
// attempt evidence, while successful fetches additionally stage the public-safe
// aggregate artifacts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fenok-edge-krx-daily.yml", import.meta.url), "utf8");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fenok-edge-krx-daily.yml",
  repoRoot,
});
assert.deepEqual(gate.lanes, ["krx"], "KRX must be attributed to its shadow lane");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.allowlist_count, 4,
  "the KRX workflow commits attempt, bridge, recovery index, and retained bridge LKG on its admin allowlist");

// Slice 1 (owner grant 2026-07-19): the workflow also commits the public-safe
// aggregate index closes and stages it manifest-natively alongside the hand list.
assert.match(workflowText, /data\/computed\/fenok-edge-korea-krx-index-daily\.json/,
  "the KRX workflow must commit the Slice 1 public index closes");
assert.match(workflowText, /data\/computed\/fenok-edge-korea-krx-kosdaq-market-cap-aggregate\.json/,
  "the KRX workflow must commit the aggregate-only Slice 2 KOSDAQ market-cap summary");
assert.match(workflowText, /scripts\/stage-lane-manifest\.sh/,
  "the KRX workflow must stage via the lane manifest (parity defense)");
assert.match(workflowText, /controlled_failure:/,
  "the KRX workflow must expose dispatch-only failure injection");
assert.match(workflowText, /INPUT_CONTROLLED_FAILURE/);
assert.match(workflowText, /--controlled-failure/);
assert.match(workflowText, /--stage always_if_exists/);
assert.match(workflowText, /--stage success_if_exists/);
assert.match(workflowText, /git add -- data\/admin\/krx\/index\.json/,
  "recovery state must persist on failed and successful attempts");
assert.match(workflowText, /git add -- data\/admin\/krx\/lkg\/bridge\.json/,
  "retained bridge bytes must persist on the always path");
assert.match(workflowText, /emit-fenok-krx-attempt\.mjs/);
assert.match(workflowText, /steps\.krx_fetch\.outputs\.attempt_outcome \|\| steps\.krx_fetch\.outcome/,
  "degraded LKG retention must emit failure evidence even when the fetch step exits zero");
assert.match(workflowText, /CANDIDATE_OUTCOME.*success.*CANDIDATE_UPDATED.*true/,
  "walkback may stop only after a candidate reports a promoted success");
assert.match(workflowText, /CANDIDATE_UPDATED.*true.*CANDIDATE_EXIT_CODE.*-eq 0.*NODE_EXIT_CODE.*-eq 0/,
  "walkback success must require both producer recovery and process exit codes to be zero");
assert.match(workflowText, /if \[ "\$KRX_FETCH_OUTCOME" = "success" \]; then/,
  "canonical/computed outputs must only be staged after a promotable success");
assert.match(workflowText, /detection-attempts\/krx\.json/);
assert.match(workflowText, /if: \$\{\{ always\(\)/,
  "KRX failure attempts must still reach the emitter and commit path");
assert.doesNotMatch(workflowText, /git add -A/);

function workflowRunBlock(stepName, nextStepName) {
  const stepStart = workflowText.indexOf(`      - name: ${stepName}`);
  const stepEnd = workflowText.indexOf(`      - name: ${nextStepName}`, stepStart);
  assert.ok(stepStart >= 0 && stepEnd > stepStart, `workflow steps are missing: ${stepName} -> ${nextStepName}`);
  const section = workflowText.slice(stepStart, stepEnd);
  const marker = "        run: |\n";
  const runStart = section.indexOf(marker);
  assert.ok(runStart >= 0, `workflow run block is missing: ${stepName}`);
  return section.slice(runStart + marker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

function outputValues(outputPath) {
  return Object.fromEntries(
    fs.readFileSync(outputPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt), line.slice(splitAt + 1)];
      }),
  );
}

function executeWalkbackScenario({ allDegraded = false, contradictorySuccess = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krx-workflow-walkback-"));
  const binDir = path.join(root, "bin");
  const scriptsDir = path.join(root, "scripts");
  const stepOutput = path.join(root, "step-output.txt");
  const callLog = path.join(root, "calls.txt");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "date"), [
    "#!/usr/bin/env bash",
    "case \"$*\" in",
    "  *\"-0 day\"*) echo 20260715 ;;",
    "  *\"-1 day\"*) echo 20260714 ;;",
    "  *) exit 2 ;;",
    "esac",
    "",
  ].join("\n"), { mode: 0o755 });
  fs.writeFileSync(path.join(scriptsDir, "fetch-fenok-krx-daily-private.mjs"), [
    "import fs from 'node:fs';",
    "const dateIndex = process.argv.indexOf('--end-date');",
    "const candidate = process.argv[dateIndex + 1];",
    "fs.appendFileSync(process.env.KRX_TEST_CALL_LOG, `${candidate}\\n`);",
    "const contradictory = process.env.KRX_TEST_CONTRADICTORY_SUCCESS === 'true';",
    "const degraded = process.env.KRX_TEST_ALL_DEGRADED === 'true' || candidate === '20260715';",
    "fs.appendFileSync(process.env.GITHUB_OUTPUT, [",
    "  `attempt_outcome=${contradictory ? 'success' : degraded ? 'failure' : 'success'}`,",
    "  `recovery_updated=${contradictory ? 'true' : degraded ? 'false' : 'true'}`,",
    "  `recovery_exit_code=${contradictory ? '2' : '0'}`,",
    "  `recovery_reason=${contradictory ? 'unexpected_error' : degraded ? 'http_error' : 'ok'}`,",
    "  '',",
    "].join('\\n'));",
    "process.exitCode = 0;",
    "",
  ].join("\n"));
  fs.writeFileSync(stepOutput, "");
  fs.writeFileSync(callLog, "");

  const expressions = {
    krx_days: "1",
    krx_concurrency: "1",
    krx_max_calls: "40",
    krx_sleep_ms: "0",
    krx_fail_threshold: "0",
    krx_end_date: "20260715",
    krx_auto_walkback_days: "1",
  };
  const script = workflowRunBlock("Refresh KRX private daily source", "Emit KRX detection attempt")
    .replace(/\$\{\{ steps\.window\.outputs\.([a-z_]+) \}\}/gu, (_, key) => {
      assert.ok(Object.hasOwn(expressions, key), `unmapped workflow expression: ${key}`);
      return expressions[key];
    });
  const result = spawnSync("bash", [
    "--noprofile",
    "--norc",
    "-e",
    "-u",
    "-o",
    "pipefail",
    "-c",
    script,
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GITHUB_OUTPUT: stepOutput,
      FENOK_KRX_ALLOW_EMPTY_DAILY: "false",
      FENOK_KRX_CONTROLLED_FAILURE: "false",
      FENOK_KRX_NO_FETCH: "false",
      FENOK_KRX_PLAN_ONLY: "false",
      KRX_TEST_ALL_DEGRADED: String(allDegraded),
      KRX_TEST_CONTRADICTORY_SUCCESS: String(contradictorySuccess),
      KRX_TEST_CALL_LOG: callLog,
    },
  });
  const calls = fs.readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean);
  const outputs = outputValues(stepOutput);
  fs.rmSync(root, { recursive: true, force: true });
  return { ...result, calls, outputs };
}

{
  const recovered = executeWalkbackScenario();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(recovered.calls, ["20260715", "20260714"],
    "an exit-0 degraded candidate must not terminate walkback before the promoted candidate");
  assert.equal(recovered.outputs.attempt_outcome, "success");
  assert.equal(recovered.outputs.recovery_updated, "true");
  assert.match(recovered.stdout, /Resolved KRX basDd=20260714/);
}

{
  const retained = executeWalkbackScenario({ allDegraded: true });
  assert.equal(retained.status, 0, retained.stderr);
  assert.deepEqual(retained.calls, ["20260715", "20260714"]);
  assert.equal(retained.outputs.attempt_outcome, "failure");
  assert.equal(retained.outputs.recovery_updated, "false");
  assert.equal(retained.outputs.recovery_exit_code, "0");
  assert.match(retained.stdout, /walkback exhausted with retained LKG/);
}

{
  const contradictory = executeWalkbackScenario({ contradictorySuccess: true });
  assert.equal(contradictory.status, 2, contradictory.stderr);
  assert.deepEqual(contradictory.calls, ["20260715", "20260714"],
    "a contradictory success output must continue through the full walkback");
  assert.equal(contradictory.outputs.attempt_outcome, "failure");
  assert.equal(contradictory.outputs.recovery_updated, "false");
  assert.equal(contradictory.outputs.recovery_exit_code, "2");
  assert.equal(contradictory.outputs.recovery_reason, "contradictory_success_exit_code");
  assert.doesNotMatch(contradictory.stdout, /Resolved KRX basDd=/,
    "non-zero producer recovery output must never declare a resolved candidate");
}

console.log("test-fenok-edge-krx-daily-workflow: ok");
