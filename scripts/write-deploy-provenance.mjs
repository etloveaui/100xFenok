#!/usr/bin/env node

// Stamp the actual built bundle with its build ID and source SHA.
// Writes only into the build assets; built_at is diagnostic.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEPLOY_PROVENANCE_PUBLIC_PATH,
  buildDeployProvenance,
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
    sha: env.GITHUB_SHA,
  });
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
    + `sha=${provenance.sha} -> ${outPath}`,
  );
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
