#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { materializeSiteMetadata } from "./materialize-site-metadata.mjs";

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

console.log("test-materialize-site-metadata: ok");
