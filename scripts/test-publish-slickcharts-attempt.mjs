#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
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
  /stage_manifest_paths\nstage_owned_paths "\$@"/,
  "manifest staging must run before the retained positional-path parity defense",
);

console.log("test-publish-slickcharts-attempt: ok");
