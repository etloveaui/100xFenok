#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  DATA_SUPPLY_POLICY_REGISTRY_PATH,
  getDataSupplyDomainPolicy,
  loadDataSupplyPolicyRegistry,
  policyRegistryDigest,
} from "./data-supply-policy-registry.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(SCRIPT_DIR, "fixtures", "data_supply", "policy_registry");
const EXPECTED_PATH = path.join(FIXTURE_DIR, "registry.expected.json");
const APP_PROJECTION_PATH = path.join(
  SCRIPT_DIR,
  "..",
  "100xfenok-next",
  "src",
  "generated",
  "data-supply-policy-registry.json",
);
const APP_PACKAGE_PATH = path.join(SCRIPT_DIR, "..", "100xfenok-next", "package.json");

const registry = loadDataSupplyPolicyRegistry(DATA_SUPPLY_POLICY_REGISTRY_PATH);
for (const name of fs.readdirSync(FIXTURE_DIR).filter((name) => name.startsWith("invalid-")).sort()) {
  assert.throws(
    () => loadDataSupplyPolicyRegistry(path.join(FIXTURE_DIR, name)),
    /data-supply-policy-registry/,
    `must reject ${name}`,
  );
}
assert.throws(
  () => getDataSupplyDomainPolicy(registry, "etf_detail", "scripts.not_authorized"),
  /not authorized/,
);
assert.throws(
  () => getDataSupplyDomainPolicy(registry, "unknown_detail", "scripts.effective_etf_detail_reader"),
  /not registered/,
);

const python = spawnSync(
  process.env.PYTHON || "python3",
  ["-c", String.raw`
import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from data_supply_policy import policy_registry_digest
print(policy_registry_digest())
`, SCRIPT_DIR],
  { encoding: "utf8" },
);
assert.equal(python.status, 0, python.stderr || python.stdout);
assert.equal(python.stdout.trim(), policyRegistryDigest(registry), "Python/Node canonical digest parity");

for (const modulePath of ["./data-supply-policy-registry.mjs", "./effective-etf-detail-reader.mjs"]) {
  const invalid = spawnSync(
    process.execPath,
    ["-e", `import(${JSON.stringify(modulePath)})`],
    {
      cwd: SCRIPT_DIR,
      env: {
        ...process.env,
        DATA_SUPPLY_POLICY_REGISTRY_PATH: path.join(FIXTURE_DIR, "invalid-wrong-digest.json"),
      },
      encoding: "utf8",
    },
  );
  assert.notEqual(invalid.status, 0, `${modulePath} must fail in a fresh process`);
  assert.match(invalid.stderr, /data-supply-policy-registry/);
}

console.log("data-supply policy registry tests: ok");
