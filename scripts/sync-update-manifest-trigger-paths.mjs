#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OUTPUT_PATH,
  REPO_ROOT,
  buildLaneCommitManifest,
  validateLaneCommitManifest,
} from "./build-lane-commit-manifest.mjs";

export const START_MARKER = "      # BEGIN GENERATED lane-commit-manifest trigger_paths";
export const END_MARKER = "      # END GENERATED lane-commit-manifest trigger_paths";
const DEFAULT_WORKFLOW = path.join(REPO_ROOT, ".github/workflows/update-manifest.yml");

function fail(message) {
  throw new Error(`update-manifest trigger paths: ${message}`);
}

function yamlSingleQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderTriggerPathsBlock(triggerPaths) {
  if (!Array.isArray(triggerPaths) || triggerPaths.length === 0) fail("trigger_paths must be non-empty");
  return [
    START_MARKER,
    ...triggerPaths.map((entry) => `      - ${yamlSingleQuote(entry)}`),
    END_MARKER,
  ].join("\n");
}

export function replaceTriggerPathsBlock(workflowText, renderedBlock) {
  const firstStart = workflowText.indexOf(START_MARKER);
  const lastStart = workflowText.lastIndexOf(START_MARKER);
  const firstEnd = workflowText.indexOf(END_MARKER);
  const lastEnd = workflowText.lastIndexOf(END_MARKER);
  if (firstStart < 0 || firstEnd < 0) fail("generated trigger_paths markers are missing");
  if (firstStart !== lastStart || firstEnd !== lastEnd || firstEnd < firstStart) fail("generated trigger_paths markers are invalid");
  const afterEnd = firstEnd + END_MARKER.length;
  return `${workflowText.slice(0, firstStart)}${renderedBlock}${workflowText.slice(afterEnd)}`;
}

function parseArgs(argv) {
  const options = { check: false, workflowPath: DEFAULT_WORKFLOW, manifestPath: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--workflow" || argument === "--manifest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a path`);
      index += 1;
      if (argument === "--workflow") options.workflowPath = path.resolve(value);
      else options.manifestPath = path.resolve(value);
    }
    else fail(`unknown argument: ${argument}`);
  }
  return options;
}

export function syncUpdateManifestTriggerPaths({ check = false, workflowPath = DEFAULT_WORKFLOW, manifestPath = DEFAULT_OUTPUT_PATH } = {}) {
  if (!fs.existsSync(workflowPath)) fail(`workflow is missing: ${workflowPath}`);
  if (!fs.existsSync(manifestPath)) fail(`manifest is missing: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateLaneCommitManifest(manifest);
  const built = buildLaneCommitManifest();
  if (JSON.stringify(manifest.update_manifest.trigger_paths) !== JSON.stringify(built.update_manifest.trigger_paths)) {
    fail("manifest trigger_paths are stale");
  }
  const workflowText = fs.readFileSync(workflowPath, "utf8");
  const renderedBlock = renderTriggerPathsBlock(manifest.update_manifest.trigger_paths);
  const updated = replaceTriggerPathsBlock(workflowText, renderedBlock);
  if (check) {
    if (updated !== workflowText) fail("generated trigger_paths block is stale");
    return { changed: false, count: manifest.update_manifest.trigger_paths.length };
  }
  if (updated !== workflowText) fs.writeFileSync(workflowPath, updated);
  return { changed: updated !== workflowText, count: manifest.update_manifest.trigger_paths.length };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = syncUpdateManifestTriggerPaths({
      check: options.check,
      workflowPath: options.workflowPath,
      manifestPath: options.manifestPath,
    });
    console.log(`update-manifest trigger paths: ${options.check ? "ok" : result.changed ? "wrote" : "unchanged"} (${result.count} paths)`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
