#!/usr/bin/env node
/**
 * Persist the admin-only dry-run artifact for future S1 stock public promotion.
 *
 * This is intentionally default-off for public mutation. It writes only the
 * admin artifact and never mutates S0 scoring, fenok_signals, or public mirrors.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildAudit } from "./audit-fenok-stock-promotion-candidates.mjs";
import { marketScopeFromMarket, normalizeTicker, num } from "./stock-action-score-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/admin/fenok-s1-stock-public-promotion-dry-run.json";
const SCHEMA_VERSION = "fenok-s1-stock-public-promotion-dry-run/v0.1";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_s1_stock_promotion_scoring_v0_1_20260630.md";
const SCORE_CORE_SOURCE = "scripts/stock-action-score-core.mjs";
const STOCK_ACTION_INDEX_REL = "data/computed/stock_action_index.json";
const FENOK_SIGNALS_REL = "data/computed/fenok_signals.json";
const FENOK_SIGNALS_SUMMARY_REL = "data/computed/fenok_signals_summary.json";
const PUBLIC_FENOK_SIGNALS_REL = "100xfenok-next/public/data/computed/fenok_signals.json";
const PUBLIC_FENOK_SIGNALS_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_signals_summary.json";
const PUBLIC_MUTATION_TARGETS = [
  STOCK_ACTION_INDEX_REL,
  FENOK_SIGNALS_REL,
  FENOK_SIGNALS_SUMMARY_REL,
  PUBLIC_FENOK_SIGNALS_SUMMARY_REL,
];
const PROTECTED_PUBLIC_MUTATION_PATHS = [
  STOCK_ACTION_INDEX_REL,
  FENOK_SIGNALS_REL,
  FENOK_SIGNALS_SUMMARY_REL,
  PUBLIC_FENOK_SIGNALS_REL,
  PUBLIC_FENOK_SIGNALS_SUMMARY_REL,
];
function parseArgs(argv) {
  const args = {
    check: false,
    noWrite: false,
    json: false,
    out: OUT_REL,
    enablePublicMutation: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") args.check = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--enable-public-mutation") args.enablePublicMutation = true;
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
  const absPath = path.join(REPO_ROOT, relPath);
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function writeJson(relPath, payload) {
  const absPath = path.join(REPO_ROOT, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relPath;
}

function readTextOrNull(relPath) {
  const absPath = path.join(REPO_ROOT, relPath);
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf8") : null;
}

function restoreTextBackups(backups) {
  for (const [relPath, text] of backups) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (text === null) {
      if (fs.existsSync(absPath)) fs.rmSync(absPath);
      continue;
    }
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, text, "utf8");
  }
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function factValue(detail, key) {
  return num(detail?.facts?.[key]?.value);
}

function percentPointToRatio(value) {
  const numeric = num(value);
  return numeric === null ? null : numeric / 100;
}

function dividendYieldToRatio(value) {
  const numeric = num(value);
  if (numeric === null) return null;
  return numeric >= 0.5 && numeric <= 100 ? numeric / 100 : numeric;
}

function marketCountryFromScope(marketScope, identity = {}) {
  const countryScope = String(identity.country_scope ?? "").trim().toUpperCase();
  if (countryScope === "US") return "US";
  if (countryScope === "KR" || countryScope === "KOREA") return "KR";
  if (marketScope === "us") return "US";
  if (marketScope === "korea") return "KR";
  return countryScope || null;
}

function missingAxisQualityFlags(row) {
  const missing = (row.missing_scoring_axes ?? []).map((axis) => `missing_${axis.key}`);
  const unsupported = (row.unsupported_scoring_axes ?? []).map((axis) => `unsupported_${axis.key}`);
  return [...new Set([...missing, ...unsupported])].sort();
}

function stockActionRowFromPromotionRow(row) {
  const detail = readJsonOrNull(`data/computed/market_facts/tickers/${row.ticker}.json`);
  const normalized = normalizeTicker(row.ticker);
  const marketScope = marketScopeFromMarket(normalized.market);
  const score = row.score_preview_summary ?? {};
  return {
    asset_type: "stock",
    symbol: row.ticker,
    ticker_normalized: normalized.ticker_normalized,
    market: normalized.market,
    marketScope,
    company: row.identity?.name ?? row.ticker,
    sector: row.identity?.sector ?? null,
    canonicalSector: "Other",
    country: marketCountryFromScope(marketScope, row.identity),
    price: factValue(detail, "price"),
    marketCap: factValue(detail, "market_cap"),
    per: factValue(detail, "trailing_pe"),
    peForward: factValue(detail, "forward_pe"),
    dividendYield: dividendYieldToRatio(factValue(detail, "dividend_yield")),
    return12m: percentPointToRatio(factValue(detail, "return_1y")),
    ret1y: null,
    ret3y: null,
    ret5y: null,
    indexMembership: [],
    indexWeights: [],
    guruHolders: null,
    consensus: null,
    conviction: null,
    sectorSmartMoney: null,
    estimateSnapshot: null,
    profitabilitySnapshot: null,
    revision: null,
    slickReturn: null,
    dividendHistory: null,
    quarterCloseHistory: null,
    quality_flags: missingAxisQualityFlags(row),
    detailHref: `/stock/${row.ticker}`,
    actionScore: num(score.action_score),
    signalScore: num(score.signal_score),
    coverageRatio: num(score.coverage_ratio),
    confidenceLabel: score.confidence_label ?? null,
    eligibleFamilyCount: Object.values(score.families ?? {}).filter((family) => family?.eligible === true).length,
    presentFamilyCount: Object.values(score.families ?? {}).filter((family) => family?.present === true).length,
    actionLabel: score.action_label ?? null,
    actionBucket: score.action_bucket ?? null,
    actionReasons: Array.isArray(score.action_reasons) ? score.action_reasons : [],
    families: score.families ?? {},
    perBandPct: null,
    perBandLabel: "미확인",
    s1_public_promotion: {
      schema_version: "fenok-s1-stock-public-promotion-row/v0.1",
      source_stage: row.source_stage,
      target_stage: "S1_PUBLIC_PROMOTION_ENABLED",
      score_source: row.score_source,
      score_contract_version: row.score_contract_version,
      missing_scoring_axes: row.missing_scoring_axes ?? [],
      unsupported_scoring_axes: row.unsupported_scoring_axes ?? [],
      source_artifact: OUT_REL,
      market_facts_detail: detail ? `data/computed/market_facts/tickers/${row.ticker}.json` : null,
      claim_scope: "Explicitly enabled S1 stock public promotion row; missing or unsupported axes remain null/unavailable.",
    },
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function familyCoverage(rows) {
  const families = ["valuation", "momentum_revision", "income", "index_structure", "smart_money", "sector_smart_money"];
  return families.map((family) => {
    const eligibleCount = rows.filter((row) => row.families?.[family]?.eligible === true).length;
    const presentCount = rows.filter((row) => row.families?.[family]?.present === true).length;
    return {
      family,
      eligibleCount,
      presentCount,
      presentRatio: eligibleCount > 0 ? Number((presentCount / eligibleCount).toFixed(4)) : 0,
    };
  });
}

function buildPublicMutationStockActionIndex(artifact) {
  const stockActionIndex = readJson(STOCK_ACTION_INDEX_REL);
  const currentRows = Array.isArray(stockActionIndex.rows) ? stockActionIndex.rows : [];
  const currentSymbols = new Set(currentRows.map((row) => row.symbol).filter(Boolean));
  const promotedRows = artifact.promotion_rows.map(stockActionRowFromPromotionRow);
  const promotedSymbols = promotedRows.map((row) => row.symbol);
  const duplicateSymbols = promotedSymbols.filter((symbol) => currentSymbols.has(symbol));
  const allRows = [...currentRows, ...promotedRows];
  const generatedAt = new Date().toISOString();

  return {
    payload: {
      ...stockActionIndex,
      generated_at: generatedAt,
      coverage: {
        ...stockActionIndex.coverage,
        source_stock_count: allRows.length,
        indexed_stock_count: allRows.length,
        market_scope_counts: countBy(allRows, (row) => row.marketScope),
        bucket_counts: countBy(allRows, (row) => row.actionBucket),
        confidence_counts: countBy(allRows, (row) => row.confidenceLabel),
        low_evidence_count: allRows.filter((row) => row.confidenceLabel === "low").length,
        family_coverage: familyCoverage(allRows),
      },
      source_files: Array.from(new Set([
        ...(stockActionIndex.source_files ?? []),
        "data/computed/market_facts/index.json",
        "data/computed/market_facts/tickers/*.json",
        OUT_REL,
      ])),
      component_as_of: {
        ...(stockActionIndex.component_as_of ?? {}),
        s1_public_promotion_generated_at: generatedAt,
      },
      s1_public_promotion: {
        schema_version: "fenok-s1-stock-public-promotion/v0.1",
        enabled_by_flag: "--enable-public-mutation",
        source_artifact: OUT_REL,
        promoted_rows: promotedRows.length,
        blocked_rows_excluded: artifact.blocked_rows.length,
        rollback_targets: PUBLIC_MUTATION_TARGETS,
      },
      rows: allRows,
    },
    promotedRows,
    duplicateSymbols,
    currentRows,
  };
}

function buildPublicMutationPlan(artifact) {
  const stockActionPlan = buildPublicMutationStockActionIndex(artifact);
  const plannedAfterCount = stockActionPlan.currentRows.length + stockActionPlan.promotedRows.length;
  return {
    mutation_schema_version: "fenok-s1-stock-public-mutation-plan/v0.1",
    enabled_by_flag: "--enable-public-mutation",
    dry_run_safe_command: "node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check --enable-public-mutation --no-write",
    exact_targets: PUBLIC_MUTATION_TARGETS,
    forbidden_targets: [PUBLIC_FENOK_SIGNALS_REL],
    rollback_targets: PUBLIC_MUTATION_TARGETS,
    write_sequence: [
      STOCK_ACTION_INDEX_REL,
      "node scripts/build-fenok-signals.mjs",
      FENOK_SIGNALS_REL,
      FENOK_SIGNALS_SUMMARY_REL,
      PUBLIC_FENOK_SIGNALS_SUMMARY_REL,
    ],
    before_counts: {
      public_s0_rows: stockActionPlan.currentRows.length,
    },
    after_counts_if_enabled: {
      public_s0_rows: plannedAfterCount,
      promoted_rows: stockActionPlan.promotedRows.length,
      blocked_rows_excluded: artifact.blocked_rows.length,
      duplicate_symbols: stockActionPlan.duplicateSymbols.length,
    },
    validation: {
      no_s0_overlap: stockActionPlan.duplicateSymbols.length === 0,
      no_etf_or_non_stock_rows: stockActionPlan.promotedRows.every((row) => row.asset_type === "stock"),
      missing_axes_null_explicit: artifact.promotion_rows.every(axesAreExplicitNull),
      blocked_rows_excluded: artifact.blocked_rows.every((row) => !stockActionPlan.promotedRows.some((promoted) => promoted.symbol === row.ticker)),
      full_public_signal_file_forbidden: !PUBLIC_MUTATION_TARGETS.includes(PUBLIC_FENOK_SIGNALS_REL),
    },
    stock_action_index_payload: stockActionPlan.payload,
  };
}

function mutationPlanOk(plan, artifact) {
  return plan.after_counts_if_enabled.public_s0_rows === artifact.counts.public_s0_after_if_enabled
    && plan.after_counts_if_enabled.promoted_rows === artifact.counts.promotion_rows
    && plan.after_counts_if_enabled.duplicate_symbols === 0
    && Object.values(plan.validation).every((value) => value === true)
    && arraysEqual(plan.exact_targets, PUBLIC_MUTATION_TARGETS)
    && arraysEqual(plan.rollback_targets, PUBLIC_MUTATION_TARGETS);
}

function writePublicMutationTargets(artifact) {
  const plan = buildPublicMutationPlan(artifact);
  if (!mutationPlanOk(plan, artifact)) {
    throw new Error("Public mutation plan failed validation before writes");
  }

  const backups = PUBLIC_MUTATION_TARGETS.map((relPath) => [relPath, readTextOrNull(relPath)]);
  try {
    writeJson(STOCK_ACTION_INDEX_REL, plan.stock_action_index_payload);
    const buildResult = spawnSync(process.execPath, ["scripts/build-fenok-signals.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (buildResult.status !== 0) {
      throw new Error(`build-fenok-signals failed: ${buildResult.stderr || buildResult.stdout}`);
    }
    if (fs.existsSync(path.join(REPO_ROOT, PUBLIC_FENOK_SIGNALS_REL))) {
      throw new Error(`${PUBLIC_FENOK_SIGNALS_REL} must remain absent`);
    }
    const summary = readJson(FENOK_SIGNALS_SUMMARY_REL);
    if (summary.coverage?.row_count !== artifact.counts.public_s0_after_if_enabled) {
      throw new Error(`Unexpected fenok_signals_summary row_count=${summary.coverage?.row_count}`);
    }
    return {
      files_written: PUBLIC_MUTATION_TARGETS,
      public_files_written: [PUBLIC_FENOK_SIGNALS_SUMMARY_REL],
    };
  } catch (error) {
    restoreTextBackups(backups);
    throw error;
  }
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

function blockedRowsMatch(blockedRows, sourceArtifact) {
  const actual = blockedRows
    .map((row) => [row.ticker, row.blockers])
    .sort(([a], [b]) => a.localeCompare(b));
  const expected = (sourceArtifact?.blocked_plan_rows ?? [])
    .map((row) => [row.ticker, row.blockers])
    .sort(([a], [b]) => a.localeCompare(b));
  return actual.length === expected.length
    && actual.every(([ticker, blockers], index) => (
      ticker === expected[index][0]
      && arraysEqual(blockers, expected[index][1])
    ));
}

function countsMatchExpectedMutationState(counts) {
  return Number(counts.public_s0_before) > 0
    && counts.s1_gap_total === counts.promotion_rows + counts.excluded_blocked_rows
    && counts.public_s0_after_if_enabled === counts.public_s0_before + counts.promotion_rows;
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

function buildAdminDryRunArtifact({ outRel, noWrite, enablePublicMutation }) {
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
  const mutationPlan = buildPublicMutationPlan({
    counts: {
      public_s0_after_if_enabled: sourceArtifact.counts.public_s0_before + promotionRows.length,
      promotion_rows: promotionRows.length,
    },
    promotion_rows: promotionRows,
    blocked_rows: blockedRows,
  });
  const plannedFilesWritten = enablePublicMutation && !noWrite
    ? [outRel, ...PUBLIC_MUTATION_TARGETS]
    : noWrite ? [] : [outRel];
  const plannedPublicFilesWritten = enablePublicMutation && !noWrite
    ? [PUBLIC_FENOK_SIGNALS_SUMMARY_REL]
    : [];
  const writePlan = {
    command: `node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check${enablePublicMutation ? " --enable-public-mutation" : ""}${noWrite ? " --no-write" : ""}`,
    output_file: outRel,
    dry_run: noWrite || !enablePublicMutation,
    public_mutation_enabled: enablePublicMutation,
    files_written: plannedFilesWritten,
    public_files_written: plannedPublicFilesWritten,
    excluded_paths: excludedPaths,
    future_public_mutation_targets_if_enabled: PUBLIC_MUTATION_TARGETS,
    public_mutation_plan_if_enabled: {
      mutation_schema_version: mutationPlan.mutation_schema_version,
      enabled_by_flag: mutationPlan.enabled_by_flag,
      exact_targets: mutationPlan.exact_targets,
      forbidden_targets: mutationPlan.forbidden_targets,
      rollback_targets: mutationPlan.rollback_targets,
      write_sequence: mutationPlan.write_sequence,
      before_counts: mutationPlan.before_counts,
      after_counts_if_enabled: mutationPlan.after_counts_if_enabled,
      validation: mutationPlan.validation,
    },
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
    files_written: plannedFilesWritten.length,
    public_files_written: plannedPublicFilesWritten.length,
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
      ok: countsMatchExpectedMutationState(counts),
      detail: `s0=${counts.public_s0_before}, gap=${counts.s1_gap_total}, promotion=${counts.promotion_rows}, blocked=${counts.excluded_blocked_rows}`,
    },
    {
      id: "s1_public_promotion_dry_run_hypothetical_denominator",
      ok: counts.public_s0_after_if_enabled === counts.public_s0_before + counts.promotion_rows
        && counts.public_s0_after_if_enabled + counts.excluded_blocked_rows === counts.public_s0_before + counts.s1_gap_total,
      detail: `${counts.public_s0_before}+${counts.promotion_rows}=${counts.public_s0_after_if_enabled}; blocked=${counts.excluded_blocked_rows}; gap=${counts.s1_gap_total}`,
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
      ok: blockedRowsMatch(blockedRows, sourceArtifact),
      detail: JSON.stringify(blockedRows.map((row) => [row.ticker, row.blockers])),
    },
    {
      id: "s1_public_promotion_dry_run_admin_only_no_public_write",
      ok: enablePublicMutation
        ? (noWrite
          ? counts.files_written === 0 && counts.public_files_written === 0
          : writePlan.public_files_written.length === 1 && counts.public_files_written === 1)
        : writePlan.public_files_written.length === 0 && counts.public_files_written === 0,
      detail: `enable_public_mutation=${enablePublicMutation}, no_write=${noWrite}, files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
    {
      id: "s1_public_promotion_dry_run_raw_policy_private",
      ok: Object.values(rawPolicy).every((value) => value === false),
      detail: JSON.stringify(rawPolicy),
    },
    {
      id: "s1_public_promotion_dry_run_public_mutation_default_off",
      ok: enablePublicMutation
        ? writePlan.public_mutation_enabled === true
        : writePlan.public_mutation_enabled === false
          && Object.values(disallowedClaims).every((value) => value === false),
      detail: `enable_public_mutation=${enablePublicMutation}, disallowed_claims=${JSON.stringify(disallowedClaims)}`,
    },
    {
      id: "s1_public_promotion_dry_run_protects_public_mutation_paths",
      ok: PROTECTED_PUBLIC_MUTATION_PATHS.every((item) => excludedPaths.includes(item)),
      detail: JSON.stringify(PROTECTED_PUBLIC_MUTATION_PATHS),
    },
    {
      id: "s1_public_mutation_targets_exact_if_enabled",
      ok: arraysEqual(writePlan.future_public_mutation_targets_if_enabled, PUBLIC_MUTATION_TARGETS)
        && arraysEqual(writePlan.public_mutation_plan_if_enabled.exact_targets, PUBLIC_MUTATION_TARGETS)
        && writePlan.public_mutation_plan_if_enabled.forbidden_targets.includes(PUBLIC_FENOK_SIGNALS_REL),
      detail: JSON.stringify(writePlan.public_mutation_plan_if_enabled.exact_targets),
    },
    {
      id: "s1_public_mutation_plan_fail_closed_with_rollback",
      ok: mutationPlanOk(mutationPlan, { counts, promotion_rows: promotionRows, blocked_rows: blockedRows }),
      detail: JSON.stringify({
        after: mutationPlan.after_counts_if_enabled,
        rollback_targets: mutationPlan.rollback_targets,
        validation: mutationPlan.validation,
      }),
    },
    {
      id: "s1_public_mutation_no_write_check_mode",
      ok: noWrite ? counts.files_written === 0 && counts.public_files_written === 0 : true,
      detail: `no_write=${noWrite}, files_written=${counts.files_written}, public_files_written=${counts.public_files_written}`,
    },
  ];

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    purpose: "Persist an admin-only dry-run and fail-closed explicit-enable plan for future S1 public stock promotion.",
    contract_doc: CONTRACT_DOC,
    source_gate: "s1_stock_promotion_candidates.joined_gate",
    source_artifact_schema_version: sourceArtifact.schema_version,
    source_command: sourceArtifact.file_plan?.command ?? "node scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check",
    source_score_contract_version: sourceArtifact.contract?.source_score_contract_version ?? null,
    source_score_contract_doc: sourceArtifact.contract?.source_score_contract_doc ?? null,
    dry_run: writePlan.dry_run,
    public_mutation_enabled: enablePublicMutation,
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
const artifact = buildAdminDryRunArtifact({
  outRel: args.out,
  noWrite: args.noWrite,
  enablePublicMutation: args.enablePublicMutation,
});
const ok = artifact.acceptance_checks.every((check) => check.ok === true);
let wrote = null;

if (!args.noWrite) {
  if (!ok) {
    throw new Error("Refusing to write S1 public promotion dry-run artifacts because acceptance checks failed");
  }
  if (args.enablePublicMutation) {
    writePublicMutationTargets(artifact);
  }
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
  console.log(`public_mutation_enabled: ${artifact.public_mutation_enabled}`);
  console.log(`public_files_written: ${artifact.counts.public_files_written}`);
}

process.exitCode = ok ? 0 : 1;
