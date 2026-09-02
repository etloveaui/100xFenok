#!/usr/bin/env node

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
export const DEFAULT_ENROLLMENT_OUTPUT_PATH = path.join(
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

async function readCurrent(outputPath = DEFAULT_ENROLLMENT_OUTPUT_PATH) {
  try {
    return await readFile(outputPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export function buildCloudDataPlaneEnrollment() {
  const schema = derivePublicPlaneEnrollment(FAMILIES);
  const privateDeny = derivePrivatePlaneDeny(derivedPrivateFileOutputs());
  return { schema, contents: renderPlaneEnrollmentModule(schema, privateDeny) };
}

export async function emitCloudDataPlaneEnrollment({ outputPath = DEFAULT_ENROLLMENT_OUTPUT_PATH } = {}) {
  const built = buildCloudDataPlaneEnrollment();
  await atomicWrite(outputPath, built.contents);
  return built;
}

async function main() {
  const mode = modeFromArgs(process.argv.slice(2));
  const built = buildCloudDataPlaneEnrollment();
  const current = await readCurrent();
  if (mode === "check") {
    if (current === built.contents) {
      console.log(`cloud-data-plane enrollment is current (${built.schema.exact.length} exact, ${built.schema.prefixes.length} prefix)`);
    } else {
      console.error("cloud-data-plane enrollment is stale or missing.");
      console.error(`Regenerate with: ${REGENERATION_COMMAND}`);
      process.exitCode = 1;
    }
  } else {
    await emitCloudDataPlaneEnrollment();
    console.log(`wrote cloud-data-plane enrollment (${built.schema.exact.length} exact, ${built.schema.prefixes.length} prefix)`);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) await main();
