#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  recordKpiFixtureAttestation,
  verifyKpiFixtureAttestation,
} from "./kpi-fixture-attestation.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-fixture-attestation-test-"));
const attestationPath = path.join(root, "attestation.json");

function write(relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, "utf8");
}

function git(...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || `git ${args.join(" ")} failed`);
}

try {
  write(".github/workflows/update-manifest.yml", "name: fixture\n");
  write("scripts/test-build-fenok-data-health-kpi.mjs", "export const suite = 1;\n");
  write("scripts/fixtures/kpi/input.json", "{\"fixture\":1}\n");
  write("scripts/lib/kpi-fixture-hermetic-bootstrap.mjs", "export const bootstrap = 1;\n");
  write("scripts/lib/kpi-fixture-hermetic-fs-guard.mjs", "export const guard = 1;\n");
  write("scripts/build-fenok-data-health-kpi.mjs", "export const builder = 1;\n");
  write("100xfenok-next/package.json", "{\"private\":true}\n");
  write("100xfenok-next/scripts/check-fenok-data-health-kpi.mjs", "export const checker = 1;\n");
  write("100xfenok-next/sync-static-overrides.mjs", "export const sync = 1;\n");
  git("init", "-q");
  git("add", ".");

  recordKpiFixtureAttestation({ repoRoot: root, attestationPath });
  assert.equal(verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }).hit, true, "exact digest must hit");

  fs.rmSync(attestationPath);
  assert.deepEqual(
    verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }),
    { hit: false, reason: "missing" },
    "missing attestation must run the suite",
  );
  write("attestation.json", "{");
  assert.equal(
    verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }).reason,
    "unreadable_or_malformed",
    "malformed JSON must run the suite",
  );
  write("attestation.json", '{"schema_version":"wrong"}\n');
  assert.equal(
    verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }).reason,
    "invalid_shape",
    "malformed shape must run the suite",
  );

  recordKpiFixtureAttestation({ repoRoot: root, attestationPath });
  for (const [relative, label] of [
    ["scripts/test-build-fenok-data-health-kpi.mjs", "suite"],
    ["scripts/fixtures/kpi/input.json", "fixture"],
    ["scripts/lib/kpi-fixture-hermetic-bootstrap.mjs", "bootstrap"],
    ["scripts/lib/kpi-fixture-hermetic-fs-guard.mjs", "guard"],
    ["scripts/build-fenok-data-health-kpi.mjs", "source"],
  ]) {
    fs.appendFileSync(path.join(root, relative), `// ${label} mutation\n`);
    assert.equal(
      verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }).reason,
      "digest_mismatch",
      `${label} mutation must run the suite`,
    );
    recordKpiFixtureAttestation({ repoRoot: root, attestationPath });
    assert.equal(
      verifyKpiFixtureAttestation({ repoRoot: root, attestationPath }).hit,
      true,
      `${label} retry recompute must permit only the new exact digest`,
    );
  }

  console.log("test-kpi-fixture-attestation: ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
