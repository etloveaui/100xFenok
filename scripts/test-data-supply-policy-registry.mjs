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
const expected = JSON.parse(fs.readFileSync(EXPECTED_PATH, "utf8"));
assert.equal(registry.schema_version, "data-supply-policy-registry/v1");
assert.equal(policyRegistryDigest(registry), expected.policy_digest);
assert.deepEqual(Object.keys(registry.domains).sort(), ["etf_detail", "stock_detail"]);
assert.deepEqual(
  JSON.parse(fs.readFileSync(APP_PROJECTION_PATH, "utf8")),
  registry,
  "application projection must exactly match the policy SSOT",
);

const packageScripts = JSON.parse(fs.readFileSync(APP_PACKAGE_PATH, "utf8")).scripts;
assert.equal(
  packageScripts["qa:data-supply-policy-registry"],
  "node ../scripts/test-data-supply-policy-registry.mjs",
  "package QA command must execute the strict parity contract",
);
for (const buildPath of ["build:runtime:steps", "build:static:steps", "cf:build:steps"]) {
  assert.match(
    packageScripts[buildPath],
    /(?:^|&& )npm run qa:data-supply-policy-registry(?: &&|$)/,
    `${buildPath} must fail closed on policy projection drift`,
  );
}

const etf = getDataSupplyDomainPolicy(registry, "etf_detail", "scripts.effective_etf_detail_reader");
assert.deepEqual(etf.providers.map((provider) => provider.name), ["stockanalysis", "yahoo_finance"]);
assert.equal(etf.resolution_scope, "domain_atomic");
assert.equal(etf.fresh_ttl_hours, 168);
assert.equal(etf.emergency_lkg_ttl_days, 14);
assert.equal(etf.recovery_green_required, 3);

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
