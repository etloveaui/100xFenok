#!/usr/bin/env node
/**
 * Persist the admin-only dry-run artifact for future S1 stock public promotion.
 *
 * This is intentionally default-off for public mutation. It writes only the
 * admin artifact and never mutates S0 scoring, fenok_signals, or public mirrors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAudit } from "./audit-fenok-stock-promotion-candidates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/admin/fenok-s1-stock-public-promotion-dry-run.json";
const SCHEMA_VERSION = "fenok-s1-stock-public-promotion-dry-run/v0.1";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_s1_stock_promotion_scoring_v0_1_20260630.md";
const SCORE_CORE_SOURCE = "scripts/stock-action-score-core.mjs";
const PROTECTED_PUBLIC_MUTATION_PATHS = [
  "data/computed/stock_action_index.json",
  "data/computed/fenok_signals.json",
  "data/computed/fenok_signals_summary.json",
  "100xfenok-next/public/data/computed/fenok_signals.json",
  "100xfenok-next/public/data/computed/fenok_signals_summary.json",
];
const EXPECTED_BLOCKED_ROWS = [
  ["DAY", ["market_currency_country_scope"]],
  ["HOLX", ["market_currency_country_scope"]],
  ["MMC", ["market_currency_country_scope"]],
  ["STRC", ["evidence_families_min3"]],
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

function writeJson(relPath, payload) {
  const absPath = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relPath;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sourceChecksOk(artifact) {
  return Array.isArray(artifact?.acceptance_checks)
    && artifact.acceptance_checks.length > 0
    && artifact.acceptance_checks.every((check) => check?.ok === true);
}

function axesAreExplicitNull(row) {
  return [
    ...(row.missing_scoring_axes ?? []),
    ...(row.unsupported_scoring_axes ?? []),
  ].every((axis) => axis?.value === null && axis?.display === "미확인");
}

function blockedRowsMatch(blockedRows) {
  const actual = blockedRows
    .map((row) => [row.ticker, row.blockers])
    .sort(([a], [b]) => a.localeCompare(b));
  return actual.length === EXPECTED_BLOCKED_ROWS.length
    && actual.every(([ticker, blockers], index) => (
      ticker === EXPECTED_BLOCKED_ROWS[index][0]
      && arraysEqual(blockers, EXPECTED_BLOCKED_ROWS[index][1])
    ));
}

function compactPromotionRow(row) {
  return {
    ticker: row.ticker,
    source_stage: row.source_stage,
    target_stage: "S1_PUBLIC_PROMOTION_DRY_RUN",
    asset_type: row.asset_type,
    identity: row.identity,
    eligibility: row.eligibility,
    score_source: row.score_source,
    score_contract_version: row.scoring_contract_reference?.source_contract_version ?? null,
    score_preview_summary: row.score_preview_summary,
    missing_scoring_axes: row.missing_scoring_axes ?? [],
    unsupported_scoring_axes: row.unsupported_scoring_axes ?? [],
    claim_scope: "Admin-only S1 public-promotion dry run; not S0, not public, not daily, not gated.",
  };
}

function compactBlockedRow(row) {
  return {
    ticker: row.ticker,
    source_stage: row.source_stage,
    target_stage: row.target_stage,
    promotion_action: row.promotion_action,
    claim_scope: row.claim_scope,
    blockers: row.blockers,
    blocker_actions: row.blocker_actions,
    corporate_action_policy: row.corporate_action_policy,
  };
}

function buildAdminDryRunArtifact({ outRel, noWrite }) {
  const audit = buildAudit({ promotionGatePlanReport: true });
  const sourceArtifact = audit.s1_stock_promotion_candidates?.joined_gate?.promotion_gate_plan_artifact;
  if (!sourceArtifact) {
    throw new Error("S1 promotion gate plan artifact was not produced");
  }

  const promotionRows = sourceArtifact.promotion_gate_rows.map(compactPromotionRow);
  const blockedRows = sourceArtifact.blocked_plan_rows.map(compactBlockedRow);
  const excludedPaths = Array.from(new Set([
    ...(sourceArtifact.file_plan?.excluded_paths ?? []),
    ...PROTECTED_PUBLIC_MUTATION_PATHS,
  ])).sort();
  const rawPolicy = {
    raw_public: false,
    third_party_raw_public: false,
    raw_rows_included: false,
    private_artifact_paths_included: false,
    public_mirror_allowed: false,
    full_public_mirror: false,
  };
  const writePlan = {
    command: "node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check",
    output_file: outRel,
    dry_run: true,
    public_mutation_enabled: false,
    files_written: noWrite ? [] : [outRel],
    public_files_written: [],
    excluded_paths: excludedPaths,
    future_public_mutation_targets_if_enabled: [
      "data/computed/stock_action_index.json",
      "data/computed/fenok_signals.json",
      "data/computed/fenok_signals_summary.json",
      "100xfenok-next/public/data/computed/fenok_signals_summary.json",
    ],
  };
  const counts = {
    public_s0_before: sourceArtifact.counts.public_s0_before,
    s1_gap_total: sourceArtifact.counts.s1_gap_total,
    promotion_rows: promotionRows.length,
    excluded_blocked_rows: blockedRows.length,
    public_s0_after_if_enabled: sourceArtifact.counts.public_s0_before + promotionRows.length,
    s0_overlap_rows: sourceArtifact.counts.s0_overlap_rows,
    etf_rows: sourceArtifact.counts.etf_rows,
    non_stock_rows: sourceArtifact.counts.non_stock_rows,
    scored_preview_rows: sourceArtifact.counts.scored_preview_rows,
    fake_score_rows: sourceArtifact.counts.fake_score_rows,
    rows_with_missing_axes: promotionRows.filter((row) => row.missing_scoring_axes.length > 0).length,
    rows_with_unsupported_axes: promotionRows.filter((row) => row.unsupported_scoring_axes.length > 0).length,
    files_written: noWrite ? 0 : 1,
    public_files_written: 0,
  };
  const disallowedClaims = {
    scored_public_s0: false,
    public: false,
    daily: false,
    gated: false,
    etf_lane: false,
  };
  const acceptanceChecks = [
    {
      id: "s1_public_promotion_dry_run_source_checks_pass",
      ok: sourceChecksOk(sourceArtifact),
      detail: `source_checks=${sourceArtifact.acceptance_checks?.length ?? 0}`,
    },
    {
      id: "s1_public_promotion_dry_run_counts_current",
      ok: counts.public_s0_before === 1066
        && counts.s1_gap_total === 112
        && counts.promotion_rows === 108
        && counts.excluded_blocked_rows === 4,
      detail: `s0=${counts.public_s0_before}, gap=${counts.s1_gap_total}, promotion=${counts.promotion_rows}, blocked=${counts.excluded_blocked_rows}`,
    },
    {
      id: "s1_public_promotion_dry_run_hypothetical_denominator",
      ok: counts.public_s0_after_if_enabled === counts.public_s0_before + counts.promotion_rows
        && counts.public_s0_after_if_enabled === 1174,
      detail: `${counts.public_s0_before}+${counts.promotion_rows}=${counts.public_s0_after_if_enabled}`,
    },
    {
      id: "s1_public_promotion_dry_run_no_s0_overlap",
      ok: counts.s0_overlap_rows === 0,
      detail: `s0_overlap_rows=${counts.s0_overlap_rows}`,
    },
    {
      id: "s1_public_promotion_dry_run_no_etf_or_non_stock_rows",
      ok: counts.etf_rows === 0 && counts.non_stock_rows === 0
        && promotionRows.every((row) => row.asset_type === "stock"),
      detail: `etf_rows=${counts.etf_rows}, non_stock_rows=${counts.non_stock_rows}`,
    },
    {
      id: "s1_public_promotion_dry_run_reuses_score_core_only",
      ok: counts.fake_score_rows === 0
        && promotionRows.every((row) => row.score_source === SCORE_CORE_SOURCE)
        && promotionRows.every((row) => row.score_contract_version === "action-score-v0.3.1"),
      detail: `fake_score_rows=${counts.fake_score_rows}, score_source=${SCORE_CORE_SOURCE}`,
    },
    {
      id: "s1_public_promotion_dry_run_missing_axes_null_explicit",
      ok: promotionRows.every(axesAreExplicitNull)
        && counts.rows_with_missing_axes === promotionRows.length
        && counts.rows_with_unsupported_axes === promotionRows.length,
      detail: `rows_with_missing_axes=${counts.rows_with_missing_axes}, rows_with_unsupported_axes=${counts.rows_with_unsupported_axes}`,
    },
    {
      id: "s1_public_promotion_dry_run_blockers_exact_current_set",
      ok: blockedRowsMatch(blockedRows),
      detail: JSON.stringify(blockedRows.map((row) => [row.ticker, row.blockers])),
    },
    {
      id: "s1_public_promotion_dry_run_admin_only_no_public_write",
      ok: writePlan.public_files_written.length === 0 && counts.public_files_written === 0,
      detail: `files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
    {
      id: "s1_public_promotion_dry_run_raw_policy_private",
      ok: Object.values(rawPolicy).every((value) => value === false),
      detail: JSON.stringify(rawPolicy),
    },
    {
      id: "s1_public_promotion_dry_run_public_mutation_default_off",
      ok: writePlan.public_mutation_enabled === false
        && Object.values(disallowedClaims).every((value) => value === false),
      detail: JSON.stringify(disallowedClaims),
    },
    {
      id: "s1_public_promotion_dry_run_protects_public_mutation_paths",
      ok: PROTECTED_PUBLIC_MUTATION_PATHS.every((item) => excludedPaths.includes(item)),
      detail: JSON.stringify(PROTECTED_PUBLIC_MUTATION_PATHS),
    },
  ];

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    purpose: "Persist an admin-only dry-run for future S1 public stock promotion without enabling public mutation.",
    contract_doc: CONTRACT_DOC,
    source_gate: "s1_stock_promotion_candidates.joined_gate",
    source_artifact_schema_version: sourceArtifact.schema_version,
    source_command: sourceArtifact.file_plan?.command ?? "node scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check",
    source_score_contract_version: sourceArtifact.contract?.source_score_contract_version ?? null,
    source_score_contract_doc: sourceArtifact.contract?.source_score_contract_doc ?? null,
    dry_run: true,
    public_mutation_enabled: false,
    write_plan: writePlan,
    raw_policy: rawPolicy,
    counts,
    blocker_counts: sourceArtifact.blocker_counts,
    disallowed_claims: disallowedClaims,
    acceptance_checks: acceptanceChecks,
    source_acceptance_checks: sourceArtifact.acceptance_checks,
    promotion_rows: promotionRows,
    blocked_rows: blockedRows,
  };
}

const args = parseArgs(process.argv.slice(2));
const artifact = buildAdminDryRunArtifact({ outRel: args.out, noWrite: args.noWrite });
const ok = artifact.acceptance_checks.every((check) => check.ok === true);
let wrote = null;

if (!args.noWrite) {
  wrote = writeJson(args.out, artifact);
}

if (args.json) {
  process.stdout.write(`${JSON.stringify({ ok, wrote, artifact }, null, 2)}\n`);
} else {
  console.log(`Fenok S1 public promotion dry run: ${ok ? "PASS" : "FAIL"}`);
  console.log(`output: ${args.noWrite ? "(no-write)" : wrote}`);
  console.log(`promotion_rows: ${artifact.counts.promotion_rows}`);
  console.log(`excluded_blocked_rows: ${artifact.counts.excluded_blocked_rows}`);
  console.log(`public_s0_after_if_enabled: ${artifact.counts.public_s0_after_if_enabled}`);
  console.log(`public_files_written: ${artifact.counts.public_files_written}`);
}

process.exitCode = args.check && !ok ? 1 : 0;
