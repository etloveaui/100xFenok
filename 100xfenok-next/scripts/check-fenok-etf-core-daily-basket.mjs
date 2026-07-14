#!/usr/bin/env node
/**
 * ETF Core Daily Basket gate.
 *
 * Requires the generated admin artifact and public-safe summary to match a
 * clean regeneration. Honest stale/not-ready basket evidence is lane-local
 * degradation; malformed, divergent, contaminated, or false-ready evidence
 * still fails closed.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADMIN_REL,
  SUMMARY_REL,
  buildEtfCoreDailyBasket,
  normalizeGenerated,
  validateEtfCoreDailyBasket,
} from "../../scripts/build-fenok-etf-core-daily-basket.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const PUBLIC_ADMIN_REL = "100xfenok-next/public/data/admin/fenok-etf-core-daily-basket.json";
const PUBLIC_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_core_daily_basket_summary.json";
const PUBLIC_SUMMARY_TOP_LEVEL_KEYS = [
  "asset_type",
  "basket_id",
  "contract_doc",
  "coverage",
  "daily_refresh_universe",
  "generated_at",
  "raw_policy",
  "readiness",
  "rows",
  "schema_version",
  "source_generated_at",
];
const PUBLIC_SUMMARY_ROW_KEYS = [
  "action_score",
  "aum",
  "average_dollar_volume_5d",
  "beta",
  "category",
  "company",
  "confidence_label",
  "core_candidate_allowed",
  "coverage_ratio",
  "daily_1y_rows",
  "dividend_yield",
  "expense_ratio",
  "freshness_blockers",
  "quote_age_days",
  "quote_date",
  "scored_signal_count",
  "signal_score",
  "status",
  "ticker",
];
const CORE_EXCLUDED_DERIVATIVE_INCOME_PATTERN = /\b(YieldMax|WeeklyPay|YieldBOOST|Option Income Strategy ETF|Performance\s*&\s*Distribution\s*Target)\b/i;

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJsonArtifact(relPath, errors) {
  try {
    const raw = fs.readFileSync(abs(relPath), "utf8");
    return { exists: true, value: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: null };
    errors.push(`read ${relPath}: ${error.message}`);
    return { exists: true, value: null };
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, expected) {
  return isObject(value)
    && sameJson(Object.keys(value).sort(), [...expected].sort());
}

function tickerOf(value) {
  return String(value ?? "").trim().toUpperCase();
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function finiteOrNull(value) {
  return value == null || (typeof value === "number" && Number.isFinite(value));
}

function validateCorePayloadShape(payload, name, errors, options = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push(`${name} must be a JSON object`);
    return;
  }
  if (!Array.isArray(payload.rows)) {
    errors.push(`${name}.rows must be an array`);
    return;
  }

  const rows = payload.rows;
  const tickers = rows.map((row) => tickerOf(row?.ticker));
  for (const ticker of tickers) {
    if (!ticker) errors.push(`${name} row missing ticker identity`);
  }
  for (const duplicate of duplicateValues(tickers.filter(Boolean))) {
    errors.push(`${name} duplicate ticker '${duplicate}'`);
  }

  const selectedCount = payload.coverage?.selected_count;
  const freshCount = payload.coverage?.fresh_selected_count;
  const staleCount = payload.coverage?.stale_selected_count;
  if (!Number.isInteger(selectedCount) || selectedCount < 0) {
    errors.push(`${name} coverage.selected_count must be a non-negative integer`);
  } else if (selectedCount !== rows.length) {
    errors.push(`${name} count reconciliation failed: coverage.selected_count=${selectedCount}, rows=${rows.length}`);
  }
  if (!Number.isInteger(freshCount) || freshCount < 0) errors.push(`${name} coverage.fresh_selected_count must be a non-negative integer`);
  if (!Number.isInteger(staleCount) || staleCount < 0) errors.push(`${name} coverage.stale_selected_count must be a non-negative integer`);
  if (Number.isInteger(freshCount) && Number.isInteger(staleCount) && Number.isInteger(selectedCount)
    && freshCount + staleCount !== selectedCount) {
    errors.push(`${name} count reconciliation failed: fresh_selected_count + stale_selected_count != selected_count`);
  }
  const actualFreshCount = rows.filter((row) => row?.status === "fresh").length;
  const actualStaleCount = rows.filter((row) => row?.status === "needs_refresh").length;
  if (Number.isInteger(freshCount) && freshCount !== actualFreshCount) {
    errors.push(`${name} count reconciliation failed: fresh_selected_count=${freshCount}, actual=${actualFreshCount}`);
  }
  if (Number.isInteger(staleCount) && staleCount !== actualStaleCount) {
    errors.push(`${name} count reconciliation failed: stale_selected_count=${staleCount}, actual=${actualStaleCount}`);
  }

  for (const key of ["selected_count", "fresh_selected_count", "stale_selected_count"]) {
    const readinessCount = payload.readiness?.[key];
    const coverageCount = payload.coverage?.[key];
    if (!Number.isInteger(readinessCount) || readinessCount < 0) {
      errors.push(`${name} readiness.${key} must be a non-negative integer`);
    } else if (Number.isInteger(coverageCount) && readinessCount !== coverageCount) {
      errors.push(`${name} count reconciliation failed: readiness.${key} != coverage.${key}`);
    }
  }

  const dailyTickers = payload.daily_refresh_universe?.tickers;
  const dailyCount = payload.daily_refresh_universe?.count;
  if (!Array.isArray(dailyTickers)) {
    errors.push(`${name} daily_refresh_universe.tickers must be an array`);
  } else {
    const normalizedDaily = dailyTickers.map(tickerOf);
    if (!sameJson(normalizedDaily, tickers)) errors.push(`${name} daily refresh ticker identities must match rows`);
    if (!Number.isInteger(dailyCount) || dailyCount !== dailyTickers.length) {
      errors.push(`${name} count reconciliation failed: daily_refresh_universe.count must equal ticker count`);
    }
  }

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${name} rows must contain objects`);
      continue;
    }
    if (!new Set(["fresh", "needs_refresh"]).has(row.status)) {
      errors.push(`${name} ${tickerOf(row.ticker) || "<missing>"} has invalid status '${row.status}'`);
    }
    if (options.admin === true) {
      if (row.asset_type !== "etf") errors.push(`${name} ${tickerOf(row.ticker) || "<missing>"}.asset_type must be etf`);
      if (row.core_candidate_allowed !== true) errors.push(`${name} ${tickerOf(row.ticker) || "<missing>"}.core_candidate_allowed must be true`);
      if (!isObject(row.proof)) errors.push(`${name} ${tickerOf(row.ticker) || "<missing>"}.proof must be an object`);
    }
    if (!Array.isArray(row.freshness_blockers)
      || row.freshness_blockers.some((reason) => typeof reason !== "string" || reason.trim() === "")) {
      errors.push(`${name} ${tickerOf(row.ticker) || "<missing>"}.freshness_blockers must contain non-empty reasons`);
    }
    if (row.status === "fresh" && row.freshness_blockers?.length > 0) {
      errors.push(`${name} ${tickerOf(row.ticker)} false-ready: fresh row has freshness blockers`);
    }
    if (row.status === "needs_refresh" && row.freshness_blockers?.length === 0) {
      errors.push(`${name} ${tickerOf(row.ticker)} needs_refresh row must include a reason`);
    }
    for (const key of ["aum", "expense_ratio", "dividend_yield", "beta", "coverage_ratio", "signal_score", "action_score"]) {
      if (!finiteOrNull(row[key])) errors.push(`${name} ${tickerOf(row.ticker)}.${key} must be null or finite`);
    }
    if (!Number.isInteger(row.scored_signal_count) || row.scored_signal_count < 0) {
      errors.push(`${name} ${tickerOf(row.ticker)}.scored_signal_count must be a non-negative integer`);
    }
    for (const key of ["quote_age_days", "daily_1y_rows", "average_dollar_volume_5d"]) {
      const value = row.proof?.[key] ?? row[key];
      if (!finiteOrNull(value)) errors.push(`${name} ${tickerOf(row.ticker)}.${key} must be null or finite`);
    }
  }
  if (options.admin === true
    && (payload.raw_policy?.public !== false || payload.raw_policy?.public_mirror !== false)) {
    errors.push(`${name} raw_policy must keep the admin payload private`);
  }
}

function validatePublicSummaryShape(summary, errors) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return;
  if (!sameKeys(summary, PUBLIC_SUMMARY_TOP_LEVEL_KEYS)) {
    errors.push("public ETF core daily basket summary contains an unexpected or missing top-level field");
  }
  if (summary.raw_policy?.public !== true || summary.raw_policy?.raw_rows_included !== false) {
    errors.push("public ETF core daily basket summary raw_policy must remain public-safe and compact");
  }
  for (const row of Array.isArray(summary.rows) ? summary.rows : []) {
    if (!sameKeys(row, PUBLIC_SUMMARY_ROW_KEYS)) {
      errors.push(`public ETF core daily basket summary ${tickerOf(row?.ticker) || "<missing>"} contains an unexpected or missing field`);
    }
  }
}

function pushUnique(target, messages) {
  for (const message of messages) {
    if (!target.includes(message)) target.push(message);
  }
}

export function classifyEtfCoreReadiness(readiness = {}, coverage = {}) {
  const errors = [];
  const warnings = [];
  const ready = readiness.core_daily_basket_ready;
  const status = readiness.readiness_status;
  const staleSelectedCount = readiness.stale_selected_count ?? coverage.stale_selected_count;
  const blockers = readiness.blockers;
  const selectedCount = readiness.selected_count;
  const freshSelectedCount = readiness.fresh_selected_count;
  const minSelectedCount = readiness.min_selected_count;

  if (typeof ready !== "boolean") errors.push("core_daily_basket_ready must be boolean");
  if (!new Set(["ready", "not_ready"]).has(status)) errors.push(`invalid readiness_status ${status}`);
  if (!Number.isInteger(staleSelectedCount) || staleSelectedCount < 0) errors.push("stale_selected_count must be a non-negative integer");
  if (!Array.isArray(blockers)) errors.push("readiness.blockers must be an array");
  for (const [key, value] of [
    ["selected_count", selectedCount],
    ["fresh_selected_count", freshSelectedCount],
    ["min_selected_count", minSelectedCount],
  ]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${key} must be a non-negative integer`);
    }
  }

  const normalizedBlockers = Array.isArray(blockers) ? blockers : [];
  if (normalizedBlockers.some((blocker) => typeof blocker !== "string" || blocker.trim() === "")) {
    errors.push("readiness.blockers must contain non-empty reasons");
  }
  if (Number.isInteger(readiness.stale_selected_count) && Number.isInteger(coverage.stale_selected_count)
    && readiness.stale_selected_count !== coverage.stale_selected_count) {
    errors.push("count reconciliation failed: readiness.stale_selected_count != coverage.stale_selected_count");
  }
  if (ready === true) {
    if (status !== "ready") errors.push(`false-ready: core_daily_basket_ready=true but readiness_status=${status}`);
    if (staleSelectedCount > 0) errors.push(`false-ready: stale_selected_count=${staleSelectedCount}`);
    if (normalizedBlockers.length > 0) errors.push(`false-ready: blockers=${normalizedBlockers.join(",")}`);
    if (Number.isInteger(selectedCount) && Number.isInteger(minSelectedCount) && selectedCount < minSelectedCount) {
      errors.push(`false-ready: selected_count=${selectedCount} below min_selected_count=${minSelectedCount}`);
    }
    if (Number.isInteger(selectedCount) && Number.isInteger(freshSelectedCount) && selectedCount !== freshSelectedCount) {
      errors.push(`false-ready: fresh_selected_count=${freshSelectedCount} != selected_count=${selectedCount}`);
    }
  } else if (ready === false) {
    if (status === "ready") errors.push("false-ready: readiness_status=ready while core_daily_basket_ready=false");
    const partialCountReason = Number.isInteger(selectedCount) && Number.isInteger(minSelectedCount)
      && selectedCount < minSelectedCount;
    if (staleSelectedCount === 0 && normalizedBlockers.length === 0 && !partialCountReason) {
      errors.push("not-ready basket must include an existing stale count or blocker reason");
    }
    warnings.push("ETF Core Basket is DEGRADED: core_daily_basket_ready=false");
    if (partialCountReason) warnings.push(`ETF Core Basket is DEGRADED: selected_count=${selectedCount}/${minSelectedCount}`);
    if (staleSelectedCount > 0) warnings.push(`ETF Core Basket is DEGRADED: stale_selected_count=${staleSelectedCount}`);
    if (normalizedBlockers.length > 0) warnings.push(`ETF Core Basket is DEGRADED: ${normalizedBlockers.join(",")}`);
  }

  return { errors, warnings };
}

export function runEtfCoreDailyBasketChecks() {
  const errors = [];
  const warnings = [];
  const adminArtifact = readJsonArtifact(ADMIN_REL, errors);
  const summaryArtifact = readJsonArtifact(SUMMARY_REL, errors);
  const publicSummaryArtifact = readJsonArtifact(PUBLIC_SUMMARY_REL, errors);
  const publicAdminArtifact = readJsonArtifact(PUBLIC_ADMIN_REL, errors);
  for (const [artifact, name] of [
    [adminArtifact, ADMIN_REL],
    [summaryArtifact, SUMMARY_REL],
    [publicSummaryArtifact, PUBLIC_SUMMARY_REL],
    [publicAdminArtifact, PUBLIC_ADMIN_REL],
  ]) {
    if (artifact.exists && !isObject(artifact.value)) errors.push(`${name} must be a JSON object`);
  }
  let regenerated = null;
  const regenerationInputs = [
    "data/computed/fenok_etf_signals_summary.json",
    "data/computed/etf_action_index.json",
    "data/stockanalysis/coverage/etf_detail.json",
    "data/stockanalysis/surfaces/new_etfs.json",
  ];
  const missingRegenerationInputs = regenerationInputs.filter((relPath) => !fs.existsSync(path.join(REPO_ROOT, relPath)));
  if (missingRegenerationInputs.length > 0) {
    warnings.push(`ETF Core Basket is DEGRADED: clean regeneration inputs are unavailable (${missingRegenerationInputs.join(", ")})`);
  } else {
    try {
      regenerated = buildEtfCoreDailyBasket();
    } catch (error) {
      errors.push(`clean regeneration failed: ${error.message}`);
    }
  }

  const existingAdmin = adminArtifact.value;
  const existingSummary = summaryArtifact.value;
  const publicSummary = publicSummaryArtifact.value;
  const admin = existingAdmin ?? regenerated?.admin ?? null;
  const summary = existingSummary ?? regenerated?.summary ?? null;

  if (!adminArtifact.exists) warnings.push(`ETF Core Basket is DEGRADED: ${ADMIN_REL} is missing`);
  if (!summaryArtifact.exists && !publicSummaryArtifact.exists) {
    warnings.push("ETF Core Basket is DEGRADED: root and public summary artifacts are both missing");
  } else if (summaryArtifact.exists !== publicSummaryArtifact.exists) {
    errors.push("ETF core daily basket summary mirror is one-sided between root and public");
  } else if (existingSummary && publicSummary && !sameJson(existingSummary, publicSummary)) {
    errors.push("public ETF core daily basket summary mirror differs from generated summary");
  }
  if (publicAdminArtifact.exists) errors.push("public admin ETF core daily basket mirror must not exist");

  if (regenerated) {
    const validationPair = existingAdmin && existingSummary
      ? { admin: existingAdmin, summary: existingSummary }
      : regenerated;
    errors.push(...validateEtfCoreDailyBasket(validationPair.admin, validationPair.summary).errors);
    if (existingAdmin && !sameJson(normalizeGenerated(existingAdmin), normalizeGenerated(regenerated.admin))) {
      warnings.push("ETF Core Basket is DEGRADED: admin artifact is behind clean-base regeneration");
    }
    if (existingSummary && !sameJson(normalizeGenerated(existingSummary), normalizeGenerated(regenerated.summary))) {
      warnings.push("ETF Core Basket is DEGRADED: summary artifact is behind clean-base regeneration");
    }
  }

  if (existingAdmin) validateCorePayloadShape(existingAdmin, "admin ETF core daily basket", errors, { admin: true });
  if (existingSummary) {
    validateCorePayloadShape(existingSummary, "summary ETF core daily basket", errors);
    validatePublicSummaryShape(existingSummary, errors);
  }
  if (publicSummary) validatePublicSummaryShape(publicSummary, errors);

  if (existingAdmin && existingSummary) {
    if (!sameJson(existingAdmin.readiness, existingSummary.readiness)) errors.push("admin/summary readiness diverges");
    if (!sameJson(existingAdmin.coverage, existingSummary.coverage)) errors.push("admin/summary coverage diverges");
    if (!sameJson(existingAdmin.daily_refresh_universe?.tickers, existingSummary.daily_refresh_universe?.tickers)) {
      errors.push("admin/summary selected ticker identities diverge");
    }
  }

  const rows = Array.isArray(admin?.rows) ? admin.rows : [];
  const summaryRows = Array.isArray(summary?.rows) ? summary.rows : [];
  const newEtfRows = rows.filter((row) => row.status === "new_etf_radar_only" || row.core_candidate_allowed === false);
  const derivativeIncomeRows = rows.filter((row) => CORE_EXCLUDED_DERIVATIVE_INCOME_PATTERN.test(`${row.ticker} ${row.company ?? ""}`));
  if (newEtfRows.length > 0) errors.push("core basket rows must not include new ETF radar-only rows");
  if (derivativeIncomeRows.length > 0) errors.push(`core basket rows must not include single-stock/concentrated derivative-income ETF strategies: ${derivativeIncomeRows.map((row) => row.ticker).join(",")}`);

  const readinessPayloads = [existingAdmin, existingSummary].filter(Boolean);
  if (readinessPayloads.length === 0 && regenerated) readinessPayloads.push(regenerated.admin);
  for (const payload of readinessPayloads) {
    const readinessVerdict = classifyEtfCoreReadiness(payload.readiness ?? {}, payload.coverage ?? {});
    pushUnique(errors, readinessVerdict.errors);
    pushUnique(warnings, readinessVerdict.warnings);
  }

  return {
    ok: errors.length === 0,
    status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
    errors,
    warnings,
    counts: {
      selected_count: rows.length,
      summary_rows: summaryRows.length,
      fresh_selected_count: admin?.coverage?.fresh_selected_count ?? null,
      stale_selected_count: admin?.coverage?.stale_selected_count ?? null,
      structural_candidate_count: admin?.coverage?.structural_candidate_count ?? null,
    },
    readiness: admin?.readiness ?? null,
    privacy_proof: {
      admin_file_present: adminArtifact.exists,
      summary_file_present: summaryArtifact.exists,
      public_admin_mirror_absent: !publicAdminArtifact.exists,
      public_summary_mirror_present: publicSummaryArtifact.exists,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEtfCoreDailyBasketChecks();
  if (!result.ok) {
    console.error("[fenok-etf-core-daily-basket-gate] FAIL");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  for (const warning of result.warnings) console.warn(`- ${warning}`);
  console.log(
    `[fenok-etf-core-daily-basket-gate] ${result.status === "degraded" ? "DEGRADED" : "ok"} `
    + `(ready=${result.readiness?.core_daily_basket_ready === true}, selected=${result.counts.selected_count}, fresh=${result.counts.fresh_selected_count}, stale=${result.counts.stale_selected_count})`
  );
}
