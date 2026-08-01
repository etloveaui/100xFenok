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

const guardSource = fs.readFileSync(GUARD, "utf8");
assert.match(guardSource, /remote_suite_for_command/, "high-load dispatch needs an explicit closed suite selector");
assert.doesNotMatch(guardSource, /MAX_WAIT_STEPS|proceeding without lock|then proceed anyway/,
  "the guard must not retain the thirty-minute local fail-open path");

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

const fakeGit = writeExecutable("git", `#!/usr/bin/env bash
set -eu
args=("$@")
subcommand=""
for arg in "\${args[@]}"; do
  case "$arg" in rev-parse|diff|merge-base) subcommand="$arg"; break;; esac
done
case "$subcommand" in
  rev-parse)
    if [[ " $* " == *" --show-toplevel "* ]]; then echo "$FAKE_REPO"; else echo "$FAKE_HEAD"; fi
    ;;
  diff)
    if [[ "\${FAKE_DIRTY:-0}" = "1" ]]; then exit 1; fi
    ;;
  merge-base)
    if [[ "\${FAKE_UNPUSHED:-0}" = "1" ]]; then exit 1; fi
    ;;
  *) echo "unexpected git: $*" >&2; exit 64;;
esac
`);
const fakeGh = writeExecutable("gh", `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$DISPATCH_LOG"
`);
const fakeSysctl = writeExecutable("sysctl", `#!/usr/bin/env bash
set -eu
if [[ "$*" = "-n vm.loadavg" ]]; then
  echo "{ $FAKE_LOAD 0.00 0.00 }"
  exit 0
fi
exit 64
`);
for (const name of ["git", "sysctl"]) fs.copyFileSync(path.join(bin, name), path.join(baseBin, name));

function runGuard({ load = "12", extraEnv = {}, withoutGh = false, command = ["npm", "run", "build:runtime:steps"] } = {}) {
  return spawnSync("bash", [GUARD, ...command], {
    cwd: APP_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${withoutGh ? baseBin : bin}:/usr/bin:/bin`,
      FAKE_LOAD: load,
      FAKE_REPO: REPO_ROOT,
      FAKE_HEAD: "0123456789abcdef0123456789abcdef01234567",
      DISPATCH_LOG: dispatchLog,
      ...extraEnv,
    },
  });
}

const remote = runGuard();
assert.equal(remote.status, 0, remote.stderr);
assert.match(remote.stdout, /REMOTE_HEAVY_VERIFICATION_DISPATCHED suite=runtime-build/);
assert.equal(fs.existsSync(localMarker), false, "high load must not execute the local heavy command");
assert.equal(
  fs.readFileSync(dispatchLog, "utf8").trim(),
  "workflow run remote-heavy-verification.yml --ref main -f suite=runtime-build -f revision=0123456789abcdef0123456789abcdef01234567",
);

for (const [label, extraEnv, expectedAction] of [
  ["dirty", { FAKE_DIRTY: "1" }, "next_action=commit_or_revert_local_changes"],
  ["unpushed", { FAKE_UNPUSHED: "1" }, "next_action=push_HEAD_to_origin_main"],
  ["gh unavailable", {}, "next_action=install_or_authenticate_gh"],
]) {
  fs.rmSync(dispatchLog, { force: true });
  const result = runGuard({ extraEnv, withoutGh: label === "gh unavailable" });
  assert.equal(result.status, 75, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, new RegExp(`REMOTE_HEAVY_VERIFICATION_BLOCKED reason=.* ${expectedAction}`));
  assert.equal(fs.existsSync(dispatchLog), false, `${label} must not dispatch`);
  assert.equal(fs.existsSync(localMarker), false, `${label} must not run locally`);
}

const unsupported = runGuard({ command: ["bash", "-c", `printf local > ${JSON.stringify(localMarker)}`] });
assert.equal(unsupported.status, 75, unsupported.stderr);
assert.match(unsupported.stderr, /REMOTE_HEAVY_VERIFICATION_BLOCKED reason=remote_suite_not_allowlisted next_action=use_an_allowlisted_heavy_npm_script/);
assert.equal(fs.existsSync(localMarker), false, "an unallowlisted high-load command must not run locally");

const ci = runGuard({
  extraEnv: { CI: "true" },
  command: ["bash", "-c", `printf local > ${JSON.stringify(localMarker)}`],
});
assert.equal(ci.status, 0, ci.stderr);
assert.equal(fs.existsSync(localMarker), true, "CI keeps the guard as a local no-op");
assert.equal(fs.existsSync(dispatchLog), false, "CI must not dispatch a second workflow");
fs.rmSync(localMarker, { force: true });

const lowLoad = runGuard({
  load: "0",
  command: ["bash", "-c", `printf local > ${JSON.stringify(localMarker)}`],
});
assert.equal(lowLoad.status, 0, lowLoad.stderr);
assert.equal(fs.existsSync(localMarker), true, "below the threshold, the guarded command remains local");

const packageJson = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8"));
assert.equal(packageJson.scripts["build:runtime"], "bash scripts/load-guard.sh npm run build:runtime:steps");
assert.equal(packageJson.scripts["build:static"], "bash scripts/load-guard.sh npm run build:static:steps");
assert.equal(packageJson.scripts["cf:build"], "bash scripts/load-guard.sh npm run cf:build:steps");
assert.equal(packageJson.scripts["verify:contracts"], "bash scripts/load-guard.sh npm run qa:registry-contracts");

const workflow = fs.readFileSync(WORKFLOW, "utf8");
assert.match(workflow, /workflow_dispatch:[\s\S]*?suite:[\s\S]*?type: choice[\s\S]*?options:[\s\S]*?- runtime-build[\s\S]*?- static-build[\s\S]*?- cloudflare-build[\s\S]*?- contracts/);
assert.match(workflow, /revision:[\s\S]*?required: true[\s\S]*?type: string/);
assert.match(workflow, /uses: actions\/checkout@v4[\s\S]*?ref: \$\{\{ inputs\.revision \}\}/);
assert.match(workflow, /runs-on: ubuntu-latest/);
assert.match(workflow, /timeout-minutes: 45/);
assert.match(workflow, /concurrency:/);
assert.match(workflow, /permissions:\s+contents: read/);
assert.doesNotMatch(workflow, /actions\/upload-artifact|cache:|npm run cf:deploy|wrangler deploy|run:\s*\$\{\{ inputs\./);
assert.match(workflow, /runtime-build\) npm run build:runtime:steps;;/);
assert.match(workflow, /static-build\) npm run build:static:steps;;/);
assert.match(workflow, /cloudflare-build\) npm run cf:build:steps;;/);
assert.match(workflow, /contracts\) npm run qa:registry-contracts;;/);

fs.rmSync(root, { recursive: true, force: true });
process.stdout.write("test-load-guard-remote-dispatch: ok\n");
