#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { materializeSiteMetadata } from "./materialize-site-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "site-metadata-test-"));
const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
};

{
  const temp = makeRoot();
  const daily = path.join(temp, "daily");
  const alpha = path.join(temp, "alpha");
  const output = path.join(temp, "canonical");
  writeJson(path.join(daily, "a.json"), { a: 1 });
  writeJson(path.join(daily, "shared.json"), { shared: true });
  writeJson(path.join(alpha, "b.json"), { b: 2 });
  fs.copyFileSync(path.join(daily, "shared.json"), path.join(alpha, "shared.json"));
  writeJson(path.join(output, "stale.json"), { stale: true });
  assert.throws(() => materializeSiteMetadata({ dailyWrapRoot: daily, alphaScoutRoot: alpha, destinationRoot: output }), /canonical drift/);
  const result = materializeSiteMetadata({ dailyWrapRoot: daily, alphaScoutRoot: alpha, destinationRoot: output, write: true });
  assert.deepEqual(result.files, ["a.json", "b.json", "shared.json"]);
  assert.equal(result.count, 3);
  assert.deepEqual(fs.readdirSync(output).sort(), result.files);
  assert.equal(materializeSiteMetadata({ dailyWrapRoot: daily, alphaScoutRoot: alpha, destinationRoot: output }).changed, false);
  fs.rmSync(temp, { recursive: true, force: true });
}

{
  const temp = makeRoot();
  const daily = path.join(temp, "daily");
  const alpha = path.join(temp, "alpha");
  const output = path.join(temp, "canonical");
  writeJson(path.join(daily, "same.json"), { owner: "daily" });
  writeJson(path.join(alpha, "same.json"), { owner: "alpha" });
  assert.throws(
    () => materializeSiteMetadata({ dailyWrapRoot: daily, alphaScoutRoot: alpha, destinationRoot: output, write: true }),
    /conflicting source bytes/,
  );
  assert.equal(fs.existsSync(output), false, "collision must fail before destination mutation");
  fs.writeFileSync(path.join(alpha, "not-json.txt"), "no");
  assert.throws(
    () => materializeSiteMetadata({ dailyWrapRoot: daily, alphaScoutRoot: alpha, destinationRoot: output, write: true }),
    /non-JSON regular file/,
  );
  fs.rmSync(temp, { recursive: true, force: true });
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, "100xfenok-next/package.json"), "utf8"));
assert.match(packageJson.scripts["build:data-supply-public"], /^node \.\.\/scripts\/materialize-site-metadata\.mjs --write && /);
const syncStatic = packageJson.scripts["sync-static"];
assert.ok(syncStatic.indexOf("npm run build:data-supply-public") < syncStatic.indexOf("node scripts/sync-public-data.mjs --write"));
assert.doesNotMatch(syncStatic, /100x\/data\/\*|alpha-scout\/data\/metadata/,
  "legacy metadata roots must never copy directly into public/data");

const runner = fs.readFileSync(path.join(root, "scripts/update-manifest-projections.sh"), "utf8");
const writerCall = "node scripts/materialize-site-metadata.mjs --write";
assert.equal(runner.split(writerCall).length - 1, 1, "Update Manifest runner must materialize canonical metadata once");
assert.ok(runner.indexOf(writerCall) < runner.indexOf("# --- S1:"), "canonical metadata must materialize before S1");

const workflow = fs.readFileSync(path.join(root, ".github/workflows/update-manifest.yml"), "utf8");
for (const trigger of ["100x/data/metadata/**", "alpha-scout/data/metadata/**", "scripts/materialize-site-metadata.mjs"]) {
  assert.match(workflow, new RegExp(trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing Update Manifest trigger: ${trigger}`);
}
assert.match(workflow, /- '!data\/metadata\/\*\*'/, "canonical bot commits must not retrigger Update Manifest");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "data/admin/lane-commit-manifest.json"), "utf8"));
assert.ok(manifest.update_manifest.central_commit_paths.includes("data/metadata"),
  "Update Manifest central staging must own canonical metadata");

const live = materializeSiteMetadata({
  dailyWrapRoot: path.join(root, "100x/data/metadata"),
  alphaScoutRoot: path.join(root, "alpha-scout/data/metadata"),
  destinationRoot: path.join(root, "data/metadata"),
});
assert.equal(live.count, 52, "current source union must contain exactly 52 files");
assert.equal(live.changed, false, "current canonical metadata must equal the source union");

console.log("test-materialize-site-metadata: ok");
