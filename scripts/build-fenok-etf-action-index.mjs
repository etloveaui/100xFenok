#!/usr/bin/env node
/**
 * Internal ETF action-index preview builder.
 *
 * The source ETF signal summary is already a compact public-safe payload. This
 * builder derives an internal action index for the separate ETF lane and keeps
 * the result out of public mirrors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_ROOT = path.join(REPO_ROOT, "data");

const FORMULA_VERSION = "fenok-etf-action-index-v0.2-seven-signal-source";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md";
const SOURCE_REL = "computed/fenok_etf_signals_summary.json";
const OUTPUT_REL = "computed/etf_action_index.json";

export const ETF_ACTION_INDEX_CONFIG = Object.freeze({
  schema_version: 3,
  signalWeight: 0.7,
  coverageWeight: 0.3,
  minPresentSignals: 3,
  lowEvidenceCap: 49,
  highCoverageThreshold: 0.75,
  mediumCoverageThreshold: 0.5,
});

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
    noWrite: argv.includes("--no-write"),
    json: argv.includes("--json"),
  };
}

function readJson(relPath) {
  const abs = path.join(DATA_ROOT, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
}

function writeJson(relPath, payload) {
  const abs = path.join(DATA_ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 2) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function average(values) {
  const nums = values.filter(finite);
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function summarize(rows, key) {
  const nums = rows.map((row) => row[key]).filter(finite);
  if (nums.length === 0) return { min: null, max: null, avg: null };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return { min: round(min), max: round(max), avg: round(avg) };
}

function confidenceLabel({ lowEvidence, coverageRatio }) {
  if (lowEvidence) return "low";
  if (coverageRatio >= ETF_ACTION_INDEX_CONFIG.highCoverageThreshold) return "high";
  if (coverageRatio >= ETF_ACTION_INDEX_CONFIG.mediumCoverageThreshold) return "medium";
  return "low";
}

export function buildEtfActionIndex({ sourcePayload = null, generatedAt = new Date() } = {}) {
  const source = sourcePayload ?? readJson(SOURCE_REL);
  const signalKeys = Array.isArray(source?.fields?.score_fields)
    ? source.fields.score_fields
    : Array.isArray(source?.signal_keys)
      ? source.signal_keys
      : Object.keys(source?.rows?.[0]?.scores ?? {});
  const totalSignals = signalKeys.length || 7;
  const sourceRows = Array.isArray(source?.rows) ? source.rows : [];

  const rows = sourceRows.map((row) => {
    const scores = row?.scores ?? {};
    const presentScores = signalKeys
      .map((key) => scores[key])
      .filter((value) => value !== null && value !== undefined && finite(value));
    const scoredSignalCount = presentScores.length;
    const coverageRatio = totalSignals > 0 ? scoredSignalCount / totalSignals : 0;
    const signalScore = average(presentScores);
    const rawActionScore = signalScore === null
      ? null
      : signalScore * (
        ETF_ACTION_INDEX_CONFIG.signalWeight
        + ETF_ACTION_INDEX_CONFIG.coverageWeight * coverageRatio
      );
    const lowEvidence = scoredSignalCount < ETF_ACTION_INDEX_CONFIG.minPresentSignals;
    const actionScore = rawActionScore === null
      ? null
      : lowEvidence
        ? Math.min(rawActionScore, ETF_ACTION_INDEX_CONFIG.lowEvidenceCap)
        : rawActionScore;

    return {
      ticker: String(row.ticker ?? "").trim().toUpperCase(),
      company: row.company ?? null,
      asset_type: "etf",
      category: row.category ?? null,
      aum: finite(row.aum) ? row.aum : null,
      expense_ratio: finite(row.expense_ratio) ? row.expense_ratio : null,
      dividend_yield: finite(row.dividend_yield) ? row.dividend_yield : null,
      beta: finite(row.beta) ? row.beta : null,
      scored_signal_count: scoredSignalCount,
      coverage_ratio: round(coverageRatio, 4),
      signal_score: round(signalScore),
      action_score: round(actionScore),
      confidence_label: confidenceLabel({ lowEvidence, coverageRatio }),
      low_evidence: lowEvidence,
      scores: Object.fromEntries(signalKeys.map((key) => [key, finite(scores[key]) ? scores[key] : null])),
    };
  }).filter((row) => row.ticker);

  const indexedRows = rows.filter((row) => !row.low_evidence);
  const confidenceCounts = rows.reduce((acc, row) => {
    acc[row.confidence_label] = (acc[row.confidence_label] ?? 0) + 1;
    return acc;
  }, {});
  const sortedRows = rows
    .filter((row) => finite(row.action_score))
    .sort((a, b) => b.action_score - a.action_score || a.ticker.localeCompare(b.ticker));

  return {
    schema_version: ETF_ACTION_INDEX_CONFIG.schema_version,
    generated_at: generatedAt.toISOString(),
    source_file: SOURCE_REL,
    source_generated_at: source.generated_at ?? null,
    source_formula_version: source.formula_version ?? null,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    asset_type: "etf",
    raw_policy: {
      public: false,
      public_mirror: false,
      internal_payload: `data/${OUTPUT_REL}`,
      source_payload: `data/${SOURCE_REL}`,
    },
    config: ETF_ACTION_INDEX_CONFIG,
    signal_keys: signalKeys,
    coverage: {
      total_etf_count: rows.length,
      indexed_count: indexedRows.length,
      low_evidence_count: rows.length - indexedRows.length,
      signal_score_summary: summarize(rows, "signal_score"),
      action_score_summary: summarize(rows, "action_score"),
      confidence_counts: Object.fromEntries(Object.entries(confidenceCounts).sort(([a], [b]) => a.localeCompare(b))),
      top_20: sortedRows.slice(0, 20).map((row) => ({ ticker: row.ticker, action_score: row.action_score })),
      bottom_20: sortedRows.slice(-20).reverse().map((row) => ({ ticker: row.ticker, action_score: row.action_score })),
    },
    rows,
  };
}

export function validateEtfActionIndex(payload, sourcePayload = null) {
  const errors = [];
  const source = sourcePayload ?? readJson(SOURCE_REL);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const sourceScored = Number(source?.coverage?.scored_public_etf ?? source?.rows?.length);

  if (payload?.schema_version !== ETF_ACTION_INDEX_CONFIG.schema_version) errors.push("schema_version mismatch");
  if (payload?.formula_version !== FORMULA_VERSION) errors.push("formula_version mismatch");
  if (payload?.source_formula_version !== source?.formula_version) errors.push("source_formula_version mismatch");
  if (payload?.asset_type !== "etf") errors.push("asset_type must be etf");
  if (payload?.raw_policy?.public !== false || payload?.raw_policy?.public_mirror !== false) errors.push("raw_policy must stay non-public");
  if (payload?.source_file !== SOURCE_REL) errors.push(`source_file must be ${SOURCE_REL}`);
  if (rows.length !== payload?.coverage?.total_etf_count) errors.push("rows length must equal coverage.total_etf_count");
  if (Number.isFinite(sourceScored) && rows.length !== sourceScored) errors.push(`rows length ${rows.length} != source scored_public_etf ${sourceScored}`);

  for (const row of rows) {
    if (row.asset_type !== "etf") errors.push(`${row.ticker ?? "?"}: asset_type must be etf`);
    if (row.scored_signal_count === 0) {
      if (row.signal_score !== null || row.action_score !== null || row.low_evidence !== true) {
        errors.push(`${row.ticker}: zero-signal row must retain null scores and low_evidence=true`);
      }
    } else if (!finite(row.signal_score) || row.signal_score < 0 || row.signal_score > 100) {
      errors.push(`${row.ticker}: signal_score out of range`);
    } else if (!finite(row.action_score) || row.action_score < 0 || row.action_score > 100) {
      errors.push(`${row.ticker}: action_score out of range`);
    }
    if (!finite(row.coverage_ratio) || row.coverage_ratio < 0 || row.coverage_ratio > 1) errors.push(`${row.ticker}: coverage_ratio out of range`);
    if (!Number.isInteger(row.scored_signal_count) || row.scored_signal_count < 0 || row.scored_signal_count > payload.signal_keys.length) errors.push(`${row.ticker}: scored_signal_count out of range`);
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const source = readJson(SOURCE_REL);
  const payload = buildEtfActionIndex({ sourcePayload: source });
  const validation = validateEtfActionIndex(payload, source);
  if (!args.noWrite && validation.ok) writeJson(OUTPUT_REL, payload);

  const summary = {
    ok: validation.ok,
    generated_at: payload.generated_at,
    total_etf_count: payload.coverage.total_etf_count,
    indexed_count: payload.coverage.indexed_count,
    low_evidence_count: payload.coverage.low_evidence_count,
    action_score_summary: payload.coverage.action_score_summary,
    output: args.noWrite ? "(no-write)" : `data/${OUTPUT_REL}`,
    errors: validation.errors,
  };

  if (args.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    console.log(`Fenok ETF action index: ${validation.ok ? "PASS" : "FAIL"}`);
    console.log(`output: ${summary.output}`);
    console.log(`total_etf_count: ${summary.total_etf_count}`);
    console.log(`indexed_count: ${summary.indexed_count}`);
    console.log(`low_evidence_count: ${summary.low_evidence_count}`);
  }

  process.exitCode = args.check && !validation.ok ? 1 : 0;
}
