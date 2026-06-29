#!/usr/bin/env node
/**
 * Persist the admin-only readiness manifest for explicit S1 public mutation.
 *
 * This does not run the enabled public write path. It reuses the default-off
 * dry-run guard in no-write mode and turns the would-change surface into a
 * reviewable admin artifact.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const OUT_REL = "data/admin/fenok-s1-public-mutation-enable-readiness.json";
const SCHEMA_VERSION = "fenok-s1-public-mutation-enable-readiness/v0.1";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_s1_stock_promotion_scoring_v0_1_20260630.md";
const DRY_RUN_SCRIPT = "scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs";
const DRY_RUN_COMMAND = `node ${DRY_RUN_SCRIPT} --check --enable-public-mutation --no-write --json`;
const STOCK_ACTION_INDEX_REL = "data/computed/stock_action_index.json";
const FENOK_SIGNALS_REL = "data/computed/fenok_signals.json";
const FENOK_SIGNALS_SUMMARY_REL = "data/computed/fenok_signals_summary.json";
const PUBLIC_FENOK_SIGNALS_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_signals_summary.json";
const PUBLIC_FENOK_SIGNALS_REL = "100xfenok-next/public/data/computed/fenok_signals.json";
const EXPECTED_TARGETS = [
  STOCK_ACTION_INDEX_REL,
  FENOK_SIGNALS_REL,
  FENOK_SIGNALS_SUMMARY_REL,
  PUBLIC_FENOK_SIGNALS_SUMMARY_REL,
];
const SCORE_FIELD_MAP = [
  ["action_score", "actionScore"],
  ["signal_score", "signalScore"],
  ["coverage_ratio", "coverageRatio"],
  ["confidence_label", "confidenceLabel"],
  ["action_bucket", "actionBucket"],
  ["action_label", "actionLabel"],
  ["action_reasons", "actionReasons"],
  ["families", "families"],
];

function parseArgs(argv) {
  const args = {
    check: false,
    noWrite: false,
    json: false,
    out: OUT_REL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--out") {
      const value = argv[++i];
      if (!value || path.isAbsolute(value) || value.includes("..")) {
        throw new Error(`Expected --out to be a repo-relative safe path, got: ${value}`);
      }
      args.out = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8"));
}

function writeJson(relPath, payload) {
  const absPath = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relPath;
}

function runDryRunGuard() {
  const result = spawnSync(process.execPath, [
    DRY_RUN_SCRIPT,
    "--check",
    "--enable-public-mutation",
    "--no-write",
    "--json",
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 32,
  });

  if (result.status !== 0) {
    throw new Error(`${DRY_RUN_COMMAND} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function rowCount(payload) {
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (typeof payload?.coverage?.row_count === "number") return payload.coverage.row_count;
  return null;
}

function countAxes(rows, field) {
  const counts = {};
  for (const row of rows) {
    for (const axis of row[field] ?? []) {
      const key = axis?.key ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function scoreFamilyCounts(rows) {
  const counts = {};
  for (const row of rows) {
    for (const [family, value] of Object.entries(row.score_preview_summary?.families ?? {})) {
      if (!counts[family]) counts[family] = { eligible: 0, present: 0 };
      if (value?.eligible === true) counts[family].eligible += 1;
      if (value?.present === true) counts[family].present += 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function targetDeltas({ plan, beforeCounts, afterRows }) {
  return plan.exact_targets.map((relPath) => {
    const publicFile = relPath.startsWith("100xfenok-next/public/");
    return {
      path: relPath,
      would_change: true,
      public_file: publicFile,
      before_rows: beforeCounts[relPath] ?? null,
      after_rows_if_enabled: afterRows,
      row_delta_if_enabled: beforeCounts[relPath] == null ? null : afterRows - beforeCounts[relPath],
      generated_by: relPath === STOCK_ACTION_INDEX_REL
        ? DRY_RUN_SCRIPT
        : "scripts/build-fenok-signals.mjs",
      rollback_required: true,
    };
  });
}

function buildReadinessArtifact({ outRel, noWrite }) {
  const dryRun = runDryRunGuard();
  const source = dryRun.artifact;
  const plan = source.write_plan?.public_mutation_plan_if_enabled;
  if (!dryRun.ok || !source || !plan) {
    throw new Error("S1 public mutation dry-run guard did not produce a valid mutation plan");
  }

  const stockActionIndex = readJson(STOCK_ACTION_INDEX_REL);
  const fenokSignals = readJson(FENOK_SIGNALS_REL);
  const fenokSignalsSummary = readJson(FENOK_SIGNALS_SUMMARY_REL);
  const publicFenokSignalsSummary = readJson(PUBLIC_FENOK_SIGNALS_SUMMARY_REL);
  const existingTickers = new Set((stockActionIndex.rows ?? []).map((row) => row.symbol).filter(Boolean));
  const additions = source.promotion_rows.map((row) => row.ticker).sort((a, b) => a.localeCompare(b));
  const removals = [];
  const duplicateAdditions = additions.filter((ticker) => existingTickers.has(ticker));
  const blockedTickers = source.blocked_rows.map((row) => row.ticker).sort((a, b) => a.localeCompare(b));
  const beforeCounts = {
    [STOCK_ACTION_INDEX_REL]: rowCount(stockActionIndex),
    [FENOK_SIGNALS_REL]: rowCount(fenokSignals),
    [FENOK_SIGNALS_SUMMARY_REL]: rowCount(fenokSignalsSummary),
    [PUBLIC_FENOK_SIGNALS_SUMMARY_REL]: rowCount(publicFenokSignalsSummary),
  };
  const afterRows = source.counts.public_s0_after_if_enabled;
  const axisCounts = {
    missing: countAxes(source.promotion_rows, "missing_scoring_axes"),
    unsupported: countAxes(source.promotion_rows, "unsupported_scoring_axes"),
  };
  const targetSet = targetDeltas({ plan, beforeCounts, afterRows });
  const targetPaths = targetSet.map((target) => target.path);
  const acceptanceChecks = [
    {
      id: "enable_readiness_source_guard_passed",
      ok: source.acceptance_checks.every((check) => check.ok === true),
      detail: `source_checks=${source.acceptance_checks.length}`,
    },
    {
      id: "enable_readiness_no_actual_public_mutation",
      ok: source.counts.files_written === 0
        && source.counts.public_files_written === 0
        && dryRun.wrote === null,
      detail: `files_written=${source.counts.files_written}, public_files_written=${source.counts.public_files_written}`,
    },
    {
      id: "enable_readiness_exact_target_set",
      ok: arraysEqual(targetPaths, EXPECTED_TARGETS)
        && arraysEqual(plan.exact_targets, EXPECTED_TARGETS),
      detail: JSON.stringify(targetPaths),
    },
    {
      id: "enable_readiness_full_public_signal_forbidden",
      ok: plan.forbidden_targets.includes(PUBLIC_FENOK_SIGNALS_REL)
        && !targetPaths.includes(PUBLIC_FENOK_SIGNALS_REL),
      detail: JSON.stringify(plan.forbidden_targets),
    },
    {
      id: "enable_readiness_ticker_delta_matches_counts",
      ok: additions.length === source.counts.promotion_rows
        && removals.length === 0
        && duplicateAdditions.length === 0
        && blockedTickers.length === source.counts.excluded_blocked_rows,
      detail: `add=${additions.length}, remove=${removals.length}, duplicate=${duplicateAdditions.length}, blocked=${blockedTickers.length}`,
    },
    {
      id: "enable_readiness_no_etf_or_non_stock",
      ok: source.counts.etf_rows === 0
        && source.counts.non_stock_rows === 0
        && source.promotion_rows.every((row) => row.asset_type === "stock"),
      detail: `etf_rows=${source.counts.etf_rows}, non_stock_rows=${source.counts.non_stock_rows}`,
    },
    {
      id: "enable_readiness_no_fake_scores",
      ok: source.counts.fake_score_rows === 0
        && source.promotion_rows.every((row) => row.score_source === "scripts/stock-action-score-core.mjs"),
      detail: `fake_score_rows=${source.counts.fake_score_rows}`,
    },
    {
      id: "enable_readiness_missing_axes_remain_null",
      ok: source.promotion_rows.every((row) => [
        ...(row.missing_scoring_axes ?? []),
        ...(row.unsupported_scoring_axes ?? []),
      ].every((axis) => axis.value === null && axis.display === "미확인")),
      detail: JSON.stringify(axisCounts),
    },
    {
      id: "enable_readiness_rollback_targets_exact",
      ok: arraysEqual(plan.rollback_targets, EXPECTED_TARGETS),
      detail: JSON.stringify(plan.rollback_targets),
    },
  ];
  const filesWritten = noWrite ? [] : [outRel];

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    purpose: "Admin-only S1 public mutation enable-readiness manifest; no enabled public write is executed.",
    contract_doc: CONTRACT_DOC,
    source_guard_command: DRY_RUN_COMMAND,
    source_guard_schema_version: source.schema_version,
    public_mutation_executed: false,
    default_fail_closed: true,
    enable_flag_required: plan.enabled_by_flag,
    dry_run_safe_command: plan.dry_run_safe_command,
    counts: {
      public_s0_before: source.counts.public_s0_before,
      promotion_rows: source.counts.promotion_rows,
      excluded_blocked_rows: source.counts.excluded_blocked_rows,
      public_s0_after_if_enabled: source.counts.public_s0_after_if_enabled,
      s0_overlap_rows: source.counts.s0_overlap_rows,
      etf_rows: source.counts.etf_rows,
      non_stock_rows: source.counts.non_stock_rows,
      fake_score_rows: source.counts.fake_score_rows,
      files_written: filesWritten.length,
      public_files_written: 0,
      would_change_target_files: targetSet.length,
    },
    target_set: targetSet,
    forbidden_targets: plan.forbidden_targets,
    rollback_plan: {
      all_or_none: true,
      restore_previous_payloads: true,
      rollback_targets: plan.rollback_targets,
      partial_keep_promoted_rows_allowed: false,
    },
    ticker_delta: {
      additions_count: additions.length,
      removals_count: removals.length,
      duplicate_current_symbols_count: duplicateAdditions.length,
      additions,
      removals,
      duplicate_current_symbols: duplicateAdditions,
      blocked_excluded: blockedTickers,
    },
    score_field_policy: {
      score_source: "scripts/stock-action-score-core.mjs",
      score_contract_version: source.source_score_contract_version,
      source_preview_fields: SCORE_FIELD_MAP.map(([field]) => field),
      stock_action_output_field_map: Object.fromEntries(SCORE_FIELD_MAP),
      excluded_or_null_axes: axisCounts,
      score_family_counts: scoreFamilyCounts(source.promotion_rows),
      missing_value_policy: "Missing or unsupported axes stay null / unavailable; no placeholder, inferred, or copied score fields.",
    },
    write_plan: {
      command: `node scripts/write-fenok-s1-public-mutation-enable-readiness.mjs --check${noWrite ? " --no-write" : ""}`,
      output_file: outRel,
      files_written: filesWritten,
      public_files_written: [],
    },
    acceptance_checks: acceptanceChecks,
  };
}

const args = parseArgs(process.argv.slice(2));
const artifact = buildReadinessArtifact({ outRel: args.out, noWrite: args.noWrite });
const ok = artifact.acceptance_checks.every((check) => check.ok === true);
let wrote = null;

if (!args.noWrite) {
  wrote = writeJson(args.out, artifact);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({ ok, wrote, artifact }, null, 2)}\n`);
} else {
  console.log(`Fenok S1 public mutation enable-readiness: ${ok ? "PASS" : "FAIL"}`);
  console.log(`output: ${args.noWrite ? "(no-write)" : wrote}`);
  console.log(`target_files: ${artifact.counts.would_change_target_files}`);
  console.log(`ticker_additions: ${artifact.ticker_delta.additions_count}`);
  console.log(`public_s0_after_if_enabled: ${artifact.counts.public_s0_after_if_enabled}`);
  console.log(`public_mutation_executed: ${artifact.public_mutation_executed}`);
  console.log(`public_files_written: ${artifact.counts.public_files_written}`);
}

process.exitCode = args.check && !ok ? 1 : 0;
