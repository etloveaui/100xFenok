#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const GUARD = path.join(APP_ROOT, "scripts", "load-guard.sh");
const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "remote-heavy-verification.yml");
const VALID_HEAD = "0123456789abcdef0123456789abcdef01234567";
const STALE_HEAD = "fedcba9876543210fedcba9876543210fedcba98";
const NESTED_MARKER = "FENOK_REMOTE_HEAVY_NESTED_EXECUTION";

const guardSource = fs.readFileSync(GUARD, "utf8");
assert.match(guardSource, /remote_suite_for_command/, "the guard needs an explicit closed suite selector");
assert.match(guardSource, /status --porcelain=v1 --untracked-files=all/, "untracked files must block dispatch");
assert.match(guardSource, /ls-remote --exit-code origin refs\/heads\/main/, "dispatch must read the actual remote main revision");
assert.match(guardSource, /\^\[0-9a-f\]\{40\}\$/, "remote revisions must be exact lowercase 40-hex commits");
assert.match(guardSource, /\"status\":\"queued\"/, "dispatch must emit a queued receipt");
assert.match(guardSource, new RegExp(NESTED_MARKER), "hosted execution needs an explicit nested marker");
assert.match(guardSource, /GITHUB_ACTIONS/);
assert.match(guardSource, /GITHUB_RUN_ID/);
assert.match(guardSource, /GITHUB_SHA/);
assert.match(guardSource, /FENOK_REMOTE_HEAVY_EXPECTED_REVISION/);
assert.doesNotMatch(guardSource, /MAX_WAIT_STEPS|proceeding without lock|then proceed anyway|LOAD_GUARD_ACTIVE/,
  "the guard must not retain a local fail-open or CI bypass path");
assert.doesNotMatch(guardSource, /\$\{CI:-\}/, "CI=true alone must not bypass remote dispatch");
assert.doesNotMatch(guardSource, /rev-parse --verify origin\/main|merge-base/,
  "cached origin/main ancestry must not decide remote admission");
assert.doesNotMatch(guardSource, /gh run|gh workflow view|watch/, "the dispatcher must not poll hosted runs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-load-guard-"));
const bin = path.join(root, "bin");
const baseBin = path.join(root, "base-bin");
const dispatchLog = path.join(root, "dispatch.log");
const localMarker = path.join(root, "local-marker");
fs.mkdirSync(bin, { recursive: true });
fs.mkdirSync(baseBin, { recursive: true });

function writeExecutable(name, body) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

const fakeGit = writeExecutable("git", `#!/bin/bash
set -eu
subcommand=""
for arg in "$@"; do
  case "$arg" in rev-parse|status|ls-remote) subcommand="$arg"; break;; esac
done
case "$subcommand" in
  rev-parse)
    if [[ " $* " == *" --show-toplevel "* ]]; then
      echo "$FAKE_REPO"
    elif [[ " $* " == *" origin/main"* ]]; then
      echo "cached origin/main must not be queried" >&2
      exit 64
    else
      echo "$FAKE_HEAD"
    fi
    ;;
  status)
    if [[ "\${FAKE_STATUS_ERROR:-0}" = "1" ]]; then exit 1; fi
    printf '%s' "\${FAKE_STATUS:-}"
    ;;
  ls-remote)
    if [[ "\${FAKE_REMOTE_UNAVAILABLE:-0}" = "1" ]]; then exit 1; fi
    if [[ "\${FAKE_REMOTE_MULTIPLE:-0}" = "1" ]]; then
      printf '%s\\trefs/heads/main\\n' "\${FAKE_REMOTE_HEAD:-$FAKE_HEAD}"
      printf '%s\\trefs/heads/main\\n' "\${FAKE_REMOTE_SECOND_HEAD:-fedcba9876543210fedcba9876543210fedcba98}"
    elif [[ "\${FAKE_REMOTE_MALFORMED:-0}" = "1" ]]; then
      printf 'not-a-40-hex-revision\\trefs/heads/main\\n'
    else
      printf '%s\\trefs/heads/main\\n' "\${FAKE_REMOTE_HEAD:-$FAKE_HEAD}"
    fi
    ;;
  *) echo "unexpected git: $*" >&2; exit 64;;
esac
`);
const fakeGh = writeExecutable("gh", `#!/bin/bash
set -eu
if [[ "\${FAKE_GH_FAILURE:-0}" = "1" ]]; then exit 1; fi
printf '%s\\n' "$*" >> "$DISPATCH_LOG"
`);
const fakeNpm = writeExecutable("npm", `#!/bin/bash
set -eu
printf local > "$LOCAL_MARKER"
`);
for (const name of ["git"]) fs.copyFileSync(path.join(bin, name), path.join(baseBin, name));

function runGuard({ extraEnv = {}, withoutGh = false, withoutNpm = false, command = ["npm", "run", "build:runtime:steps"] } = {}) {
  const inheritedEnv = { ...process.env };
  delete inheritedEnv.CI;
  delete inheritedEnv[NESTED_MARKER];
  const env = {
    ...inheritedEnv,
    PATH: withoutGh || withoutNpm ? baseBin : `${bin}:/usr/bin:/bin`,
    FAKE_REPO: REPO_ROOT,
    FAKE_HEAD: VALID_HEAD,
    FAKE_REMOTE_HEAD: VALID_HEAD,
    DISPATCH_LOG: dispatchLog,
    LOCAL_MARKER: localMarker,
    ...extraEnv,
  };
  return spawnSync("/bin/bash", [GUARD, ...command], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env,
  });
}

function readQueuedReceipt(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const receipt = JSON.parse(result.stdout.trim());
  assert.deepEqual(receipt, {
    status: "queued",
    suite: "runtime-build",
    revision: VALID_HEAD,
  });
  return receipt;
}

const remote = runGuard();
readQueuedReceipt(remote);
assert.equal(fs.existsSync(localMarker), false, "the default path must not execute locally");
assert.equal(
  fs.readFileSync(dispatchLog, "utf8").trim(),
  "workflow run remote-heavy-verification.yml --ref main -f suite=runtime-build -f revision=0123456789abcdef0123456789abcdef01234567",
);

fs.rmSync(dispatchLog, { force: true });
const lowLoad = runGuard({ extraEnv: { FAKE_LOAD: "0" } });
readQueuedReceipt(lowLoad);
assert.equal(fs.existsSync(localMarker), false, "low load must still queue the registered suite remotely");

for (const [label, extraEnv, expectedReason, expectedAction] of [
  ["tracked dirty", { FAKE_STATUS: " M tracked.js\\n" }, "dirty_worktree", "use_a_clean_current_origin_checkout"],
  ["untracked", { FAKE_STATUS: "?? generated.txt\\n" }, "dirty_worktree", "use_a_clean_current_origin_checkout"],
  ["remote stale", { FAKE_REMOTE_HEAD: STALE_HEAD }, "HEAD_stale_against_origin_main", "use_a_clean_current_origin_checkout"],
  ["remote unavailable", { FAKE_REMOTE_UNAVAILABLE: "1" }, "origin_main_unavailable", "use_a_clean_current_origin_checkout"],
  ["remote malformed", { FAKE_REMOTE_MALFORMED: "1" }, "origin_main_revision_invalid", "use_a_clean_current_origin_checkout"],
  ["remote multiple", { FAKE_REMOTE_MULTIPLE: "1" }, "origin_main_revision_invalid", "use_a_clean_current_origin_checkout"],
  ["gh unavailable", {}, "gh_unavailable", "install_or_authenticate_gh"],
  ["dispatch failure", { FAKE_GH_FAILURE: "1" }, "workflow_dispatch_failed", "retry_gh_workflow_dispatch"],
]) {
  fs.rmSync(dispatchLog, { force: true });
  const result = runGuard({
    extraEnv,
    withoutGh: label === "gh unavailable",
  });
  assert.equal(result.status, 75, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, new RegExp(`reason=${expectedReason} next_action=${expectedAction}`));
  assert.equal(fs.existsSync(dispatchLog), false, `${label} must not dispatch`);
  assert.equal(fs.existsSync(localMarker), false, `${label} must not run locally`);
}

const invalidRevision = runGuard({ extraEnv: { FAKE_HEAD: "short" } });
assert.equal(invalidRevision.status, 75, invalidRevision.stderr);
assert.match(invalidRevision.stderr, /reason=HEAD_revision_invalid next_action=use_a_clean_current_origin_checkout/);

const unsupported = runGuard({
  extraEnv: { CI: "true" },
  command: ["bash", "-c", `printf local > ${JSON.stringify(localMarker)}`],
});
assert.equal(unsupported.status, 75, unsupported.stderr);
assert.match(unsupported.stderr, /reason=remote_suite_not_allowlisted next_action=use_an_allowlisted_heavy_npm_script/);
assert.equal(fs.existsSync(localMarker), false, "an unsupported command must never run locally");

fs.rmSync(dispatchLog, { force: true });
const ci = runGuard({ extraEnv: { CI: "true" } });
readQueuedReceipt(ci);
assert.equal(fs.existsSync(localMarker), false, "CI=true alone must not bypass dispatch");

for (const [label, identity, expectedReason, expectedAction] of [
  ["missing actions identity", { GITHUB_ACTIONS: "", GITHUB_RUN_ID: "123", GITHUB_SHA: VALID_HEAD, FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD }, "nested_execution_identity_invalid", "run_only_inside_the_hosted_verification_workflow"],
  ["non-numeric run id", { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "run", GITHUB_SHA: VALID_HEAD, FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD }, "nested_execution_identity_invalid", "run_only_inside_the_hosted_verification_workflow"],
  ["invalid workflow sha", { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "123", GITHUB_SHA: "short", FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD }, "nested_execution_identity_invalid", "run_only_inside_the_hosted_verification_workflow"],
  ["invalid expected revision", { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "123", GITHUB_SHA: VALID_HEAD, FENOK_REMOTE_HEAVY_EXPECTED_REVISION: "short" }, "nested_execution_identity_invalid", "run_only_inside_the_hosted_verification_workflow"],
  ["workflow sha mismatch", { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "123", GITHUB_SHA: STALE_HEAD, FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD }, "nested_revision_mismatch", "run_the_requested_revision_from_the_hosted_workflow"],
]) {
  const result = runGuard({
    extraEnv: { [NESTED_MARKER]: "1", ...identity },
  });
  assert.equal(result.status, 75, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, new RegExp(`reason=${expectedReason} next_action=${expectedAction}`));
  assert.equal(fs.existsSync(localMarker), false, `${label} must not execute locally`);
}

fs.rmSync(dispatchLog, { force: true });
const nested = runGuard({
  extraEnv: {
    [NESTED_MARKER]: "1",
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ID: "123456",
    GITHUB_SHA: VALID_HEAD,
    FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD,
  },
});
assert.equal(nested.status, 0, `${nested.stdout}\n${nested.stderr}`);
assert.equal(fs.existsSync(localMarker), true, "only the explicit hosted nested marker may run steps");
assert.equal(fs.existsSync(dispatchLog), false, "nested execution must not dispatch recursively");
fs.rmSync(localMarker, { force: true });

fs.rmSync(dispatchLog, { force: true });
const nestedExecUnavailable = runGuard({
  withoutNpm: true,
  extraEnv: {
    [NESTED_MARKER]: "1",
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ID: "123456",
    GITHUB_SHA: VALID_HEAD,
    FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD,
  },
});
assert.equal(nestedExecUnavailable.status, 75, nestedExecUnavailable.stderr);
assert.match(nestedExecUnavailable.stderr, /reason=nested_exec_failed next_action=hosted_command_could_not_execute/);
assert.equal(fs.existsSync(dispatchLog), false, "a failed nested command must not dispatch remotely");
assert.equal(fs.existsSync(localMarker), false, "a failed nested command must not leave a local marker");

const nestedUnsupported = runGuard({
  extraEnv: {
    [NESTED_MARKER]: "1",
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ID: "123456",
    GITHUB_SHA: VALID_HEAD,
    FENOK_REMOTE_HEAVY_EXPECTED_REVISION: VALID_HEAD,
  },
  command: ["bash", "-c", `printf local > ${JSON.stringify(localMarker)}`],
});
assert.equal(nestedUnsupported.status, 75, nestedUnsupported.stderr);
assert.equal(fs.existsSync(localMarker), false, "the nested marker must not open an arbitrary shell");

const packageJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
assert.equal(packageJson.scripts.predev, "npm run build:version", "dev may refresh only its version metadata");
assert.doesNotMatch(packageJson.scripts.predev, /sync-static/, "dev must not run static projection automatically");
assert.equal(packageJson.scripts.dev, "next dev");
assert.equal(packageJson.scripts["dev:refresh"], undefined, "do not add a cosmetic refresh alias");
assert.equal(packageJson.scripts["build:runtime"], "bash scripts/load-guard.sh npm run build:runtime:steps");
assert.equal(packageJson.scripts["build:static"], "bash scripts/load-guard.sh npm run build:static:steps");
assert.equal(packageJson.scripts["cf:build"], "bash scripts/load-guard.sh npm run cf:build:steps");
assert.equal(packageJson.scripts["verify:contracts"], "bash scripts/load-guard.sh npm run qa:registry-contracts");
assert.equal(packageJson.scripts["qa:sec13f-contract"], "bash scripts/load-guard.sh npm run qa:sec13f-contract:steps");

const workflow = fs.readFileSync(WORKFLOW, "utf8");
assert.match(workflow, /workflow_dispatch:[\s\S]*?suite:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- runtime-build[\s\S]*?- static-build[\s\S]*?- cloudflare-build[\s\S]*?- contracts[\s\S]*?- sec13f-contract/);
assert.match(workflow, /revision:[\s\S]*?required: true[\s\S]*?type: string/);
assert.match(workflow, /name: Validate requested revision[\s\S]*?working-directory: \./);
assert.match(workflow, /REVISION: \$\{\{ inputs\.revision \}\}/);
assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
assert.match(workflow, /uses: actions\/checkout@v4[\s\S]*?ref: \$\{\{ inputs\.revision \}\}/);
assert.match(workflow, /persist-credentials:\s+false/);
assert.match(workflow, new RegExp(`${NESTED_MARKER}:\\s+"1"`));
assert.match(workflow, /FENOK_REMOTE_HEAVY_EXPECTED_REVISION: \$\{\{ inputs\.revision \}\}/);
assert.match(workflow, /id: verification/);
assert.match(workflow, /name: Emit completion receipt[\s\S]*?if: always\(\)/);
assert.match(workflow, /STATUS: \$\{\{ job\.status \}\}/);
assert.match(workflow, /CONCLUSION: \$\{\{ steps\.verification\.conclusion \}\}/);
assert.match(workflow, /RUN_ID: \$\{\{ github\.run_id \}\}/);
assert.match(workflow, /RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/);
assert.match(workflow, /RUN_URL: \$\{\{ github\.server_url \}\}\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/);
assert.match(workflow, /SUITE: \$\{\{ inputs\.suite \}\}/);
assert.match(workflow, /REVISION: \$\{\{ inputs\.revision \}\}/);
assert.match(workflow, /WORKFLOW: \$\{\{ github\.workflow \}\}/);
assert.match(workflow, /WORKFLOW_REF: \$\{\{ github\.workflow_ref \}\}/);
assert.match(workflow, /WORKFLOW_SHA: \$\{\{ github\.sha \}\}/);
assert.match(workflow, /node_version=.*node --version/);
assert.match(workflow, /npm_version=.*npm --version/);
assert.match(workflow, /GITHUB_STEP_SUMMARY/);
assert.match(workflow, /runs-on: ubuntu-latest/);
assert.match(workflow, /timeout-minutes: 45/);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /permissions:\s+contents: read/);
assert.match(workflow, /runtime-build\) npm run build:runtime;;/);
assert.match(workflow, /static-build\) npm run build:static;;/);
assert.match(workflow, /cloudflare-build\) npm run cf:build;;/);
assert.match(workflow, /contracts\) npm run verify:contracts;;/);
assert.match(workflow, /sec13f-contract\) npm run qa:sec13f-contract;;/);
assert.doesNotMatch(workflow, /secrets\.|actions\/upload-artifact|cache:|npm run cf:deploy|wrangler deploy|run:\s*\$\{\{ inputs\./);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("test-load-guard-remote-dispatch: ok\n");
