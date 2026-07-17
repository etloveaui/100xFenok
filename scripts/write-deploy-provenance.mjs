#!/usr/bin/env node

// write-deploy-provenance — stamp the CI run's identity into the built bundle
// as data/admin/deploy-provenance.json so that any later run can ask: "which
// run shipped the currently-live bundle, and did its smokes pass?" (BACKLOG #361)
//
// Runs AFTER cf:build, BEFORE wrangler deploy. Writes into the bundle assets
// tree only (.open-next is gitignored build output) — never into tracked paths.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEPLOY_PROVENANCE_PUBLIC_PATH,
  buildDeployProvenance,
  isDeployProvenance,
} from "./lib/deploy-provenance.mjs";

function parseArgs(argv) {
  const args = { assetsDir: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--assets-dir" && i + 1 < argv.length) {
      args.assetsDir = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  if (!args.assetsDir) {
    throw new Error("usage: node scripts/write-deploy-provenance.mjs --assets-dir <path>");
  }
  return args;
}

export function writeDeployProvenance({ assetsDir, env = process.env, now = null }) {
  const buildIdPath = path.join(assetsDir, "BUILD_ID");
  if (!fs.existsSync(buildIdPath)) {
    throw new Error(`bundle BUILD_ID not found at ${buildIdPath}`);
  }
  const buildId = fs.readFileSync(buildIdPath, "utf8").replace(/[\r\n]/g, "");
  const provenance = buildDeployProvenance({
    buildId,
    builtAt: now ?? new Date().toISOString(),
    repository: env.GITHUB_REPOSITORY ?? "local/local",
    runAttempt: env.GITHUB_RUN_ATTEMPT ?? "1",
    runId: env.GITHUB_RUN_ID ?? "local",
    runNumber: env.GITHUB_RUN_NUMBER ?? "0",
    serverUrl: env.GITHUB_SERVER_URL ?? "https://github.com",
    sha: env.GITHUB_SHA ?? "local",
  });
  if (!isDeployProvenance(provenance)) {
    throw new Error("internal error: built provenance failed its own contract");
  }
  const outPath = path.join(assetsDir, DEPLOY_PROVENANCE_PUBLIC_PATH);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(provenance, null, 2)}\n`);
  return { outPath, provenance };
}

function main() {
  const { assetsDir } = parseArgs(process.argv);
  const { outPath, provenance } = writeDeployProvenance({ assetsDir });
  console.log(
    `::notice::Deploy provenance stamped: build_id=${provenance.build_id} `
    + `run_id=${provenance.run_id} attempt=${provenance.run_attempt} sha=${provenance.sha} -> ${outPath}`,
  );
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
