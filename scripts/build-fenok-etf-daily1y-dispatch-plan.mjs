#!/usr/bin/env node
/**
 * Owner-gated ETF daily 1Y dispatch-plan builder.
 *
 * This converts the exact admin fetchable plan into a private workflow plan.
 * It performs no network calls, does not claim DAILY/GATED readiness, and is
 * not the ETF Core Daily Basket service gate.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const SOURCE_PLAN_REL = "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json";
const OUTPUT_REL = "_private/admin/fenok-etf-daily1y-dispatch-plan.json";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md";
const FORMULA_VERSION = "fenok-etf-daily1y-dispatch-plan-v0.2";
const SHARD_SIZE = 120;

function parseArgs(argv) {
  return {
    check: argv.includes("--check"),
    noWrite: argv.includes("--no-write"),
    json: argv.includes("--json"),
  };
}

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
  } catch (error) {
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
}

function writeJson(relPath, payload) {
  const target = abs(relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function chunk(values, size) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
function readHistoryGapReport(plan) {
  const relPath = plan?.source_files?.history_gap_report;
  return relPath ? readJson(relPath) : null;
}

function sourceHash(plan, historyGapReport = readHistoryGapReport(plan)) {
  const report = historyGapReport ?? {};
  const profile = Array.isArray(report.required_history_periods)
    ? [...report.required_history_periods].map(String).sort()
    : report.profile ?? null;
  const fetchable = report.daily_1y_gap?.samples?.fetchable ?? report.fetchable ?? [];
  const fetchableTickers = fetchable
    .map((row) => typeof row === "string" ? row : row?.ticker)
    .filter(Boolean)
    .map((ticker) => String(ticker).trim().toUpperCase())
    .sort();
  const canonical = JSON.stringify({
    history_gap_report: {
      profile,
      generated_at: report.generated_at ?? null,
      scored_fetchable_list: fetchableTickers,
    },
    fetchable_plan: {
      generated_at: plan.generated_at ?? null,
      tickers: [...new Set((plan.tickers ?? []).map(String))].map((ticker) => ticker.trim().toUpperCase()).sort(),
    },
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export function buildEtfDaily1yDispatchPlan({ sourcePlan = null, historyGapReport = null, generatedAt = new Date() } = {}) {
  const plan = sourcePlan ?? readJson(SOURCE_PLAN_REL);
  const tickers = Array.isArray(plan.tickers)
    ? [...new Set(plan.tickers.map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean))].sort()
    : [];
  const shards = chunk(tickers, SHARD_SIZE).map((values, index) => ({
    shard: index + 1,
    size: values.length,
    tickers: values,
  }));

  return {
    schema_version: "fenok-etf-daily1y-dispatch-plan/v0.2",
    generated_at: generatedAt.toISOString(),
    source_file: SOURCE_PLAN_REL,
    source_generated_at: plan.generated_at ?? null,
    source_hash_algo: "sha256",
    source_hash: sourceHash(plan, historyGapReport ?? readHistoryGapReport(plan)),
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    owner_gated: true,
    status: "pending_owner_approval",
    network: "none",
    service_gate: false,
    claim_scope: "full_scored_etf_universe_diagnostic_backfill",
    workflow: "fetch-stockanalysis.yml",
    inputs: {
      history_gaps_only: "true",
      required_history_periods: "daily_1y",
      incremental_etf_limit: String(SHARD_SIZE),
    },
    counts: {
      scored_etf_count: plan.counts?.scored_etf_count ?? null,
      complete: plan.counts?.complete ?? null,
      fetchable: tickers.length,
      inception_limited: plan.counts?.inception_limited ?? null,
      shard_count: shards.length,
      source_count_equation_ok: plan.counts?.equation_ok === true,
      source_matches_history_gap_report: plan.counts?.matches_history_gap_report === true,
      source_matches_coverage_index: plan.counts?.matches_coverage_index === true,
      source_matches_coverage_index_daily_check: plan.counts?.matches_coverage_index_daily_check === true,
    },
    readiness_claims: {
      claims_done: false,
      daily_ready: false,
      gated_ready: false,
      public_done_claim_allowed: false,
    },
    shards,
    samples: {
      first_batch: shards[0]?.tickers?.slice(0, 12) ?? [],
      source_fetchable: Array.isArray(plan.samples?.fetchable) ? plan.samples.fetchable : [],
    },
    caveat: "External StockAnalysis backfill dispatch is owner-gated. This plan only selects exact full scored-ETF daily_1y diagnostic gaps, never flips daily/gated readiness, and must not be used as the ETF Core Daily Basket service gate.",
  };
}

export function validateEtfDaily1yDispatchPlan(payload, sourcePlan = null, historyGapReport = null) {
  const errors = [];
  const source = sourcePlan ?? readJson(SOURCE_PLAN_REL);
  if (payload?.source_hash_algo !== "sha256" || payload?.source_hash !== sourceHash(source, historyGapReport ?? readHistoryGapReport(source))) errors.push("source hash binding mismatch");
  const tickers = Array.isArray(source.tickers) ? source.tickers : [];
  const shards = Array.isArray(payload?.shards) ? payload.shards : [];
  const totalPlanned = shards.reduce((sum, shard) => sum + (Array.isArray(shard.tickers) ? shard.tickers.length : 0), 0);

  if (payload?.owner_gated !== true) errors.push("owner_gated must be true");
  if (payload?.status === "done" || payload?.status === "approved_for_dispatch") errors.push(`status must not claim done/approved: ${payload.status}`);
  if (payload?.network !== "none") errors.push("network must be none");
  if (payload?.workflow !== "fetch-stockanalysis.yml") errors.push("workflow must be fetch-stockanalysis.yml");
  if (payload?.inputs?.history_gaps_only !== "true") errors.push("history_gaps_only must be true");
  if (payload?.inputs?.required_history_periods !== "daily_1y") errors.push("required_history_periods must be daily_1y");
  if (payload?.inputs?.incremental_etf_limit !== String(SHARD_SIZE)) errors.push(`incremental_etf_limit must be ${SHARD_SIZE}`);
  if (payload?.readiness_claims?.claims_done || payload?.readiness_claims?.daily_ready || payload?.readiness_claims?.gated_ready || payload?.readiness_claims?.public_done_claim_allowed) {
    errors.push("dispatch plan must not claim done, daily_ready, gated_ready, or public_done_claim_allowed");
  }
  if (totalPlanned !== tickers.length) errors.push(`planned tickers ${totalPlanned} != source tickers ${tickers.length}`);
  if (payload?.counts?.fetchable !== tickers.length) errors.push(`counts.fetchable ${payload?.counts?.fetchable} != source tickers ${tickers.length}`);
  if (payload?.counts?.shard_count !== shards.length) errors.push("counts.shard_count must equal shard length");
  for (const shard of shards) {
    if (!Array.isArray(shard.tickers)) errors.push(`shard ${shard.shard ?? "?"} missing tickers`);
    else if (shard.tickers.length > SHARD_SIZE) errors.push(`shard ${shard.shard ?? "?"} exceeds ${SHARD_SIZE}`);
  }
  for (const key of ["source_count_equation_ok", "source_matches_history_gap_report", "source_matches_coverage_index", "source_matches_coverage_index_daily_check"]) {
    if (payload?.counts?.[key] !== true) errors.push(`${key} must be true`);
  }

  return { ok: errors.length === 0, errors };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = parseArgs(process.argv.slice(2));
  const source = readJson(SOURCE_PLAN_REL);
  const payload = buildEtfDaily1yDispatchPlan({ sourcePlan: source });
  const validation = validateEtfDaily1yDispatchPlan(payload, source);
  if (!args.noWrite && validation.ok) writeJson(OUTPUT_REL, payload);

  const summary = {
    ok: validation.ok,
    generated_at: payload.generated_at,
    fetchable: payload.counts.fetchable,
    shard_count: payload.counts.shard_count,
    output: args.noWrite ? "(no-write)" : OUTPUT_REL,
    errors: validation.errors,
  };

  if (args.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  else {
    console.log(`Fenok ETF daily 1Y dispatch plan: ${validation.ok ? "PASS" : "FAIL"}`);
    console.log(`output: ${summary.output}`);
    console.log(`fetchable: ${summary.fetchable}`);
    console.log(`shard_count: ${summary.shard_count}`);
  }

  process.exitCode = args.check && !validation.ok ? 1 : 0;
}
