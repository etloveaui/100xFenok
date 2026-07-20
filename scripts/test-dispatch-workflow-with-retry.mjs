#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCRIPT = path.join(SCRIPT_DIR, "dispatch-workflow-with-retry.sh");
const WORKFLOW = path.join(REPO_ROOT, ".github/workflows/update-manifest.yml");

assert.equal(fs.existsSync(SCRIPT), true, "dispatch retry helper must exist");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-workflow-retry-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const fakeGh = path.join(bin, "gh");
  fs.writeFileSync(fakeGh, `#!/usr/bin/env bash
set -u
count=0
if [ -f "$GH_FAKE_COUNTER" ]; then count="$(cat "$GH_FAKE_COUNTER")"; fi
count=$((count + 1))
printf '%s\\n' "$*" >> "$GH_FAKE_LOG"
printf '%s\\n' "$count" > "$GH_FAKE_COUNTER"
if [ "$count" -le "$GH_FAKE_FAILURES" ]; then exit 1; fi
`, { mode: 0o755 });
  return {
    root,
    log: path.join(root, "gh.log"),
    counter: path.join(root, "counter"),
    bin,
  };
}

function run(failures, extraArgs = []) {
  const row = fixture();
  const result = spawnSync("bash", [
    SCRIPT,
    "--workflow", "deploy-worker.yml",
    "--ref", "main",
    "--attempts", "3",
    "--delay-seconds", "0",
    ...extraArgs,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${row.bin}:${process.env.PATH}`,
      GH_FAKE_COUNTER: row.counter,
      GH_FAKE_LOG: row.log,
      GH_FAKE_FAILURES: String(failures),
    },
  });
  const calls = fs.existsSync(row.log)
    ? fs.readFileSync(row.log, "utf8").trim().split("\n").filter(Boolean)
    : [];
  return { ...result, calls };
}

{
  const result = run(0);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, ["workflow run deploy-worker.yml --ref main"]);
  assert.match(result.stdout, /succeeded on attempt 1\/3/);
  assert.doesNotMatch(result.stdout, /::warning::/);
}

{
  const result = run(2);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 3);
  assert.ok(result.calls.every((call) => call === "workflow run deploy-worker.yml --ref main"));
  assert.match(result.stdout, /failed on attempt 1\/3; retrying/);
  assert.match(result.stdout, /failed on attempt 2\/3; retrying/);
  assert.match(result.stdout, /succeeded on attempt 3\/3/);
}

{
  const result = run(3);
  assert.equal(result.status, 0, "exhausted dispatch retries must not fail an already-pushed manifest job");
  assert.equal(result.calls.length, 3);
  assert.match(result.stdout, /::warning::Worker deploy dispatch failed after 3 attempts/);
  assert.match(result.stdout, /scheduled deploy remains the safety net/);
}

for (const extraArgs of [
  ["--attempts", "0"],
  ["--delay-seconds", "61"],
  ["--workflow", "../unsafe.yml"],
  ["--ref", "bad ref"],
]) {
  const result = run(0, extraArgs);
  assert.notEqual(result.status, 0, `invalid arguments must fail: ${extraArgs.join(" ")}`);
  assert.equal(result.calls.length, 0, "argument validation must happen before gh dispatch");
}

const workflowText = fs.readFileSync(WORKFLOW, "utf8");
assert.match(workflowText, /bash scripts\/dispatch-workflow-with-retry\.sh/);
assert.match(workflowText, /--workflow deploy-worker\.yml/);
assert.match(workflowText, /--ref main/);
assert.match(workflowText, /--attempts 3/);
assert.match(workflowText, /--delay-seconds 5/);

console.log("test-dispatch-workflow-with-retry: ok");
