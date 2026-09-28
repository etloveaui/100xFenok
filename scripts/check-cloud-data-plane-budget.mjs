#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLOUD_DATA_PLANE_POLICY,
  buildCloudDataPlaneReport,
  cloudDataPlaneExitCode,
} from "./lib/cloud-data-plane-budget.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = {
    repoRoot: DEFAULT_REPO_ROOT,
    accountBaseline: null,
    requestDemand: null,
    policy: DEFAULT_CLOUD_DATA_PLANE_POLICY,
    candidateId: null,
    format: "json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--repo-root", "--account-baseline", "--request-demand", "--policy", "--candidate", "--format"].includes(flag)) {
      throw new Error(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    index += 1;
    if (flag === "--repo-root") options.repoRoot = path.resolve(value);
    // A candidate run scopes the budget to one migration input. Without it the
    // run stays estate-wide, which is the right default for ownership checks and
    // the wrong input for a migration limit.
    else if (flag === "--candidate") options.candidateId = value;
    else if (flag === "--format") {
      if (value !== "json") throw new Error("--format only supports json");
      options.format = value;
    }
    else {
      const parsed = JSON.parse(fs.readFileSync(path.resolve(value), "utf8"));
      if (flag === "--account-baseline") options.accountBaseline = parsed;
      if (flag === "--request-demand") options.requestDemand = parsed;
      if (flag === "--policy") options.policy = parsed;
    }
  }
  const { format: _format, ...reportOptions } = options;
  return reportOptions;
}

try {
  const report = buildCloudDataPlaneReport(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${canonicalJson(report)}\n`);
  process.exitCode = cloudDataPlaneExitCode(report.verdict);
} catch (error) {
  process.stderr.write(`check-cloud-data-plane-budget: ${error?.message ?? String(error)}\n`);
  process.exitCode = cloudDataPlaneExitCode("invalid");
}
