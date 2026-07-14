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

console.log("test-publish-slickcharts-attempt: ok");
