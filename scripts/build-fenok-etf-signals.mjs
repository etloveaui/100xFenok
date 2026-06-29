#!/usr/bin/env node
/**
 * Minimal separate ETF signal builder for Fenok Edge.
 *
 * This script establishes the ETF lane gate. It does NOT compute ETF scores
 * yet; it emits the public schema, candidate denominator, and scored_public_etf=0
 * so downstream consumers can detect the lane without mixing ETFs into the
 * stock signal lens.
 *
 * Raw rows stay private; this public artifact exposes only derived metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const FORMULA_VERSION = "fenok-etf-signals-v0.1-gate";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md";
const PUBLIC_SURFACE_STATUS = "phase_b_v0_1_etf_signal_gate_separate_lane_no_scores";
const SOURCE_FILE = "stockanalysis/etf_universe.json";
const OUTPUT_FILE = "computed/fenok_etf_signals.json";
const SUMMARY_OUTPUT_FILE = "computed/fenok_etf_signals_summary.json";

const SIGNAL_KEYS = [
  "cost_efficiency",
  "liquidity",
  "tracking_quality",
  "momentum_trend",
  "risk_adjusted_momentum",
  "income",
  "diversification",
  "classification_risk",
];

function readJson(relPath) {
  const abs = path.join(dataRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`read ${relPath}: ${error.message}`);
  }
}

function readOptionalJson(relPath) {
  const abs = path.join(dataRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const abs = path.join(root, relPath);
    ensureDir(abs);
    fs.writeFileSync(abs, body, "utf8");
  }
}

function parseArgs(argv) {
  return {
    noWrite: argv.includes("--no-write"),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();

  const etfUniverse = readJson(SOURCE_FILE);
  const marketFacts = readOptionalJson("computed/market_facts/index.json") ?? {};
  const candidates = Array.isArray(etfUniverse?.records) ? etfUniverse.records : [];
  const candidateCount = candidates.length;

  // Filter to vanilla ETF candidates; leveraged/inverse/single-stock remain
  // catalogued but excluded from the vanilla score denominator until approved.
  const eligibleCandidates = candidates.filter((row) => {
    const classification = row?.classification;
    if (!classification || typeof classification !== "object") return true;
    return !classification.is_leveraged && !classification.is_inverse && !classification.is_single_stock;
  });

  const payload = {
    schema_version: 1,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    source_generated_at: etfUniverse.generated_at ?? null,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    raw_policy: {
      external_collection: false,
      full_public_mirror: false,
      third_party_raw_public: false,
      private_proxy_sources: true,
      direct_corpus_tone_public: false,
      public_payload: SUMMARY_OUTPUT_FILE,
    },
    signal_keys: SIGNAL_KEYS,
    coverage: {
      candidate_etf_count: candidateCount,
      eligible_etf_count: eligibleCandidates.length,
      scored_public_etf: 0,
      market_facts_etf_count: marketFacts.coverage?.etf ?? null,
    },
    // No scored rows until the scoring formulas are implemented.
    rows: [],
  };

  const summary = {
    schema_version: 1,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    formula_version: FORMULA_VERSION,
    asset_type: "etf",
    coverage: {
      candidate_etf_count: candidateCount,
      eligible_etf_count: eligibleCandidates.length,
      scored_public_etf: 0,
    },
    fields: ["ticker", "company", "asset_type", "category", "aum", "expense_ratio", "dividend_yield", "beta"],
    rows: [],
  };

  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, payload, [dataRoot]);
    writeJson(SUMMARY_OUTPUT_FILE, summary, [dataRoot, publicDataRoot]);
  }

  console.log(JSON.stringify({
    generated_at: generatedAt,
    candidate_etf_count: candidateCount,
    eligible_etf_count: eligibleCandidates.length,
    scored_public_etf: 0,
    output: args.noWrite ? "(not written)" : OUTPUT_FILE,
    summary_output: args.noWrite ? "(not written)" : SUMMARY_OUTPUT_FILE,
  }, null, 2));
}

main();
