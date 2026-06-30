#!/usr/bin/env node
/**
 * Fenok ETF action-index preview gate.
 *
 * Validates the generated internal ETF action index without requiring a public
 * mirror. If the internal file is absent, the gate builds the payload in memory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildEtfActionIndex,
  validateEtfActionIndex,
} from "../../scripts/build-fenok-etf-action-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const INTERNAL_REL = "data/computed/etf_action_index.json";
const PUBLIC_REL = "100xfenok-next/public/data/computed/etf_action_index.json";
const SOURCE_REL = "data/computed/fenok_etf_signals_summary.json";

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

export function runEtfActionIndexChecks() {
  const errors = [];
  const source = readJson(SOURCE_REL);
  const generated = buildEtfActionIndex({ sourcePayload: source });
  const existing = readJsonOrNull(INTERNAL_REL);
  const payload = existing ?? generated;
  const validation = validateEtfActionIndex(payload, source);
  errors.push(...validation.errors);

  if (existing) {
    const comparableExisting = { ...existing, generated_at: null };
    const comparableGenerated = { ...generated, generated_at: null };
    if (JSON.stringify(comparableExisting) !== JSON.stringify(comparableGenerated)) {
      errors.push("existing internal ETF action index differs from clean-base regenerated payload");
    }
  }

  if (fileExists(PUBLIC_REL)) errors.push("public ETF action-index mirror must not exist");

  return {
    ok: errors.length === 0,
    errors,
    counts: {
      total_etf_count: payload.coverage?.total_etf_count ?? null,
      indexed_count: payload.coverage?.indexed_count ?? null,
      source_scored_public_etf: source.coverage?.scored_public_etf ?? null,
    },
    privacy_proof: {
      internal_file_present: Boolean(existing),
      public_mirror_absent: !fileExists(PUBLIC_REL),
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEtfActionIndexChecks();
  if (!result.ok) {
    console.error("[fenok-etf-action-index-gate] FAIL");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[fenok-etf-action-index-gate] ok (total_etf_count=${result.counts.total_etf_count}, public_mirror_absent=${result.privacy_proof.public_mirror_absent})`);
}
