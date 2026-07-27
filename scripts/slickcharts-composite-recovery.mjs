#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  finalizeSlickchartsCompositeRecovery,
  inspectSlickchartsCompositeLiveIntegrity,
  mergeSlickchartsCompositeMember,
  prepareSlickchartsCompositeSnapshot,
  validateSlickchartsCompositeIndex,
} from "./lib/slickcharts-composite-recovery.mjs";

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}

function args(argv, name) {
  return argv.flatMap((value, index) => value === name && argv[index + 1] ? [argv[index + 1]] : []);
}

function githubRun() {
  return {
    run_id: String(process.env.GITHUB_RUN_ID ?? Date.now()),
    run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1),
    event_name: process.env.GITHUB_EVENT_NAME ?? null,
    observed_at: new Date().toISOString(),
    head_sha: process.env.GITHUB_SHA ?? null,
  };
}

export function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const repoRoot = path.resolve(arg(argv, "--repo-root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")));
  const member = arg(argv, "--member");
  if (command === "prepare") {
    const bundle = prepareSlickchartsCompositeSnapshot({
      repoRoot,
      member,
      snapshotRoot: arg(argv, "--snapshot"),
    });
    process.stdout.write(`${JSON.stringify({ member, tree_sha256: bundle.tree_sha256, file_count: bundle.file_count })}\n`);
    return;
  }
  if (command === "finalize") {
    const result = finalizeSlickchartsCompositeRecovery({
      repoRoot,
      member,
      snapshotRoot: arg(argv, "--snapshot"),
      indexPath: path.resolve(repoRoot, arg(argv, "--index", "data/admin/slickcharts-composite-recovery/index.json")),
      rowPath: arg(argv, "--row"),
      receiptTargets: args(argv, "--receipts"),
      statusPath: arg(argv, "--status"),
      run: githubRun(),
      fullRun: arg(argv, "--full-run", "false") === "true",
    });
    process.stdout.write(`${JSON.stringify(result.status)}\n`);
    process.exitCode = result.status.exit_code;
    return;
  }
  if (command === "merge-member") {
    const basePath = arg(argv, "--base-index");
    const savedPath = arg(argv, "--saved-index");
    const merged = mergeSlickchartsCompositeMember({
      baseIndex: JSON.parse(fs.readFileSync(basePath, "utf8")),
      savedIndex: JSON.parse(fs.readFileSync(savedPath, "utf8")),
      member,
      generatedAt: new Date().toISOString(),
    });
    fs.writeFileSync(basePath, `${JSON.stringify(merged, null, 2)}\n`);
    return;
  }
  if (command === "validate") {
    const indexPath = arg(argv, "--index");
    validateSlickchartsCompositeIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")));
    process.stdout.write(`${JSON.stringify({ valid: true, index: indexPath })}\n`);
    return;
  }
  if (command === "validate-live") {
    const indexPath = arg(argv, "--index");
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const integrity = inspectSlickchartsCompositeLiveIntegrity(repoRoot, index);
    if (!integrity.valid) {
      throw new Error(`live composite mismatch: ${integrity.mismatches.map((row) => row.member).join(",")}`);
    }
    process.stdout.write(`${JSON.stringify({ valid: true, index: indexPath, live: true })}\n`);
    return;
  }
  throw new Error(`unknown command: ${command ?? "<missing>"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
