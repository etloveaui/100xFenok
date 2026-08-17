#!/usr/bin/env node

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FAMILIES } from "./publish-cloud-data-generation.mjs";
import { derivedPrivateFileOutputs } from "./lib/derived-asset-registry.mjs";
import {
  derivePrivatePlaneDeny,
  derivePublicPlaneEnrollment,
  renderPlaneEnrollmentModule,
} from "./lib/plane-enrollment-derivation.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  "100xfenok-next",
  "scripts",
  "cloud-data-plane",
  "cloud-data-plane-enrollment.generated.mjs",
);
const REGENERATION_COMMAND = "node scripts/build-cloud-data-plane-enrollment.mjs --write";

function modeFromArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--check")) return "check";
  if (args.length === 1 && args[0] === "--write") return "write";
  throw new Error("usage: node scripts/build-cloud-data-plane-enrollment.mjs [--check|--write]");
}

async function readCurrent() {
  try {
    return await readFile(OUTPUT_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

const mode = modeFromArgs(process.argv.slice(2));
const schema = derivePublicPlaneEnrollment(FAMILIES);
const privateDeny = derivePrivatePlaneDeny(derivedPrivateFileOutputs());
const expected = renderPlaneEnrollmentModule(schema, privateDeny);
const current = await readCurrent();

if (mode === "check") {
  if (current === expected) {
    console.log(`cloud-data-plane enrollment is current (${schema.exact.length} exact, ${schema.prefixes.length} prefix)`);
  } else {
    console.error("cloud-data-plane enrollment is stale or missing.");
    console.error(`Regenerate with: ${REGENERATION_COMMAND}`);
    process.exitCode = 1;
  }
} else {
  await atomicWrite(OUTPUT_PATH, expected);
  console.log(`wrote cloud-data-plane enrollment (${schema.exact.length} exact, ${schema.prefixes.length} prefix)`);
}
