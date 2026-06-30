#!/usr/bin/env node
/**
 * Fenok ETF daily 1Y dispatch-plan gate.
 *
 * Builds the owner-gated private dispatch plan in memory, validates it against
 * the exact admin fetchable plan, and confirms no public mirror exists.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildEtfDaily1yDispatchPlan,
  validateEtfDaily1yDispatchPlan,
} from "../../scripts/build-fenok-etf-daily1y-dispatch-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const SOURCE_REL = "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json";
const PRIVATE_REL = "_private/admin/fenok-etf-daily1y-dispatch-plan.json";
const PUBLIC_REL = "100xfenok-next/public/data/admin/fenok-etf-daily1y-dispatch-plan.json";

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function fileExists(relPath) {
  return fs.existsSync(path.join(REPO_ROOT, relPath));
}

export function runEtfDaily1yDispatchPlanChecks() {
  const errors = [];
  const source = readJson(SOURCE_REL);
  const generated = buildEtfDaily1yDispatchPlan({ sourcePlan: source });
  const existing = readJsonOrNull(PRIVATE_REL);
  const payload = existing ?? generated;
  const validation = validateEtfDaily1yDispatchPlan(payload, source);
  errors.push(...validation.errors);

  if (existing) {
    const comparableExisting = { ...existing, generated_at: null };
    const comparableGenerated = { ...generated, generated_at: null };
    if (JSON.stringify(comparableExisting) !== JSON.stringify(comparableGenerated)) {
      errors.push("existing private dispatch plan differs from clean-base regenerated payload");
    }
  }

  if (fileExists(PUBLIC_REL)) errors.push("public ETF daily1y dispatch-plan mirror must not exist");

  return {
    ok: errors.length === 0,
    errors,
    counts: {
      fetchable: payload.counts?.fetchable ?? null,
      shard_count: payload.counts?.shard_count ?? null,
      source_fetchable: source.counts?.fetchable ?? null,
    },
    privacy_proof: {
      private_file_present: Boolean(existing),
      public_mirror_absent: !fileExists(PUBLIC_REL),
      owner_gated: payload.owner_gated === true,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEtfDaily1yDispatchPlanChecks();
  if (!result.ok) {
    console.error("[fenok-etf-daily1y-dispatch-plan-gate] FAIL");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[fenok-etf-daily1y-dispatch-plan-gate] ok (fetchable=${result.counts.fetchable}, shards=${result.counts.shard_count}, owner_gated=${result.privacy_proof.owner_gated})`);
}
