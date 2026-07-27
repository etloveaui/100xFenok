#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(root, "scripts", "publish-slickcharts-attempt.sh"), "utf8");

assert.match(script, /data\/admin\/data-supply-state\/detection-attempts\/slickcharts\.json/);
assert.match(script, /git diff --name-only --diff-filter=U/);
assert.match(script, /git checkout --ours -- "\$shard_path"/);
assert.match(script, /--row-in "\$row_path"/);
assert.ok((script.match(/merge_saved_row/g) ?? []).length >= 4, "the saved row must be reapplied before commit and push");
assert.doesNotMatch(script, /git add (?:-A|--all)/);
assert.match(script, /git push origin HEAD:main/);
assert.match(script, /SLICKCHARTS_RECOVERY_STATUS_PATH/);
assert.match(script, /data\/admin\/slickcharts-daily-delivery/);
assert.match(script, /publish_data/);
assert.match(script, /recovery_exit/);
assert.match(script, /composite_stage=false/);
assert.match(script, /restore_composite_index_from_head/);
assert.match(script, /slickcharts-composite-recovery\.mjs validate --index "\$composite_index"/);
assert.match(script, /slickcharts-composite-recovery\.mjs validate-live/);
assert.ok((script.match(/verify_live_composite/g) ?? []).length >= 3,
  "live composite bytes must be checked before the initial commit and every post-rebase push");
assert.match(script, /"\$composite_stage" == "true"/);
assert.match(script, /\[--manifest-workflow <workflow> --manifest-always <stage> \[--manifest-data <stage>\] --\]/);
assert.match(script, /expected_workflow="\.github\/workflows\/slickcharts-\$\{member\}\.yml"/);
assert.match(script, /scripts\/stage-lane-manifest\.sh/);
assert.match(script, /--stage "\$manifest_always"/);
assert.match(
  script,
  /if \[\[ "\$publish_data" == "true" && -n "\$manifest_data" \]\][\s\S]*?--stage "\$manifest_data"/,
  "manifest success outputs must stay behind the existing publish_data gate",
);
assert.match(
  script,
  /stage_manifest_paths\nverify_live_composite\nstage_owned_paths "\$@"/,
  "manifest staging and live composite verification must precede owned-path staging",
);

// Missing composite status must fail closed without committing a newly written
// composite index. The attempt shard may still be published for observability.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "slickcharts-publisher-"));
const repository = path.join(sandbox, "repo");
const origin = path.join(sandbox, "origin.git");
fs.mkdirSync(path.join(repository, "scripts"), { recursive: true });
fs.copyFileSync(path.join(root, "scripts", "publish-slickcharts-attempt.sh"), path.join(repository, "scripts", "publish-slickcharts-attempt.sh"));
fs.chmodSync(path.join(repository, "scripts", "publish-slickcharts-attempt.sh"), 0o755);
fs.writeFileSync(path.join(repository, "scripts", "emit-slickcharts-attempt.mjs"), `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const shard = process.argv[process.argv.indexOf("--shard") + 1];
fs.mkdirSync(path.dirname(shard), { recursive: true });
fs.writeFileSync(shard, "{\\"attempt\\":true}\\n");
`);
fs.mkdirSync(path.join(repository, "data/admin/slickcharts-composite-recovery"), { recursive: true });
fs.mkdirSync(path.join(repository, "rows"), { recursive: true });
fs.writeFileSync(path.join(repository, "data/admin/slickcharts-composite-recovery/index.json"), "{\"baseline\":true}\n");
fs.writeFileSync(path.join(repository, "rows/weekly.json"), "{\"lane_id\":\"slickcharts\",\"member_id\":\"weekly\"}\n");
execFileSync("git", ["init", "--bare", origin], { stdio: "ignore" });
execFileSync("git", ["init", "-b", "main"], { cwd: repository, stdio: "ignore" });
execFileSync("git", ["config", "user.name", "SlickCharts Test"], { cwd: repository });
execFileSync("git", ["config", "user.email", "slickcharts@example.invalid"], { cwd: repository });
execFileSync("git", ["remote", "add", "origin", origin], { cwd: repository });
execFileSync("git", ["add", "."], { cwd: repository });
execFileSync("git", ["commit", "-m", "baseline"], { cwd: repository, stdio: "ignore" });
execFileSync("git", ["push", "-u", "origin", "main"], { cwd: repository, stdio: "ignore" });
fs.writeFileSync(path.join(repository, "data/admin/slickcharts-composite-recovery/index.json"), "{\"candidate\":true}\n");
let publisherStatus = 0;
try {
  execFileSync("bash", [
    "scripts/publish-slickcharts-attempt.sh",
    "weekly",
    "rows/weekly.json",
    "publish attempt",
  ], {
    cwd: repository,
    env: {
      ...process.env,
      GH_TOKEN: "",
      SLICKCHARTS_COMPOSITE_STATUS_PATH: path.join(sandbox, "missing-status.json"),
    },
    stdio: "pipe",
  });
} catch (error) {
  publisherStatus = error.status;
}
assert.equal(publisherStatus, 2);
assert.equal(
  fs.readFileSync(path.join(repository, "data/admin/slickcharts-composite-recovery/index.json"), "utf8"),
  "{\"baseline\":true}\n",
);
assert.doesNotMatch(
  execFileSync("git", ["show", "--format=", "--name-only", "HEAD"], { cwd: repository, encoding: "utf8" }),
  /slickcharts-composite-recovery\/index\.json/,
);
fs.rmSync(sandbox, { recursive: true, force: true });

console.log("test-publish-slickcharts-attempt: ok");
