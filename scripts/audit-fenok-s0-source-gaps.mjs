#!/usr/bin/env node
/**
 * Audit S0 US source gaps without fetching or writing.
 *
 * This turns the remaining FINRA/OCC S0 blockers into a repeatable action
 * list: which rows are real collection candidates and which rows are universe
 * mapping/denominator policy issues.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = "fenok-s0-source-gap-audit/v0.1";
const SAMPLE_LIMIT = 25;
const ACTIVE_S0_TRACK_ID = "active_stock_scoring_current";

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    check: args.has("--check"),
    full: args.has("--full"),
    json: args.has("--json"),
    help: args.has("--help") || args.has("-h"),
  };
}

function usage() {
  return [
    "Usage: node scripts/audit-fenok-s0-source-gaps.mjs [--check] [--json] [--full]",
    "",
    "Reads existing derived JSON only. Does not fetch, write, or publish raw rows.",
  ].join("\n");
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

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normTicker(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function relTickerPath(ticker) {
  return normTicker(ticker).replace(/[^A-Z0-9_-]/g, "-");
}

function rowTicker(row) {
  return normTicker(row?.ticker_normalized ?? row?.ticker);
}

function pct(count, total) {
  if (!Number(total)) return null;
  return Number(((Number(count) / Number(total)) * 100).toFixed(2));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function sourceDateFromRows(payload) {
  const dates = uniqueSorted(asArray(payload?.rows).map((row) => row?.source_date ?? row?.as_of));
  return dates.at(-1) ?? null;
}

function tickerSet(payload) {
  return new Set(asArray(payload?.rows).map(rowTicker).filter(Boolean));
}

function tickerMap(payload) {
  return new Map(asArray(payload?.rows).map((row) => [rowTicker(row), row]).filter(([ticker]) => ticker));
}

function countBy(rows, getter) {
  const counts = {};
  for (const row of rows) {
    const key = getter(row) ?? "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function getSourceRow(index, id) {
  return asArray(index?.source_availability?.sources).find((row) => row?.id === id) ?? null;
}

function getActiveTrack(index) {
  return asArray(index?.public_scoring_readiness?.tracks).find((track) => track?.id === ACTIVE_S0_TRACK_ID) ?? null;
}

function getBlockingEvidence(activeTrack, blockerId) {
  return asArray(activeTrack?.blocking_evidence?.blockers).find((blocker) => blocker?.id === blockerId) ?? null;
}

function plainUsOccEligible(row) {
  const ticker = rowTicker(row);
  return row?.market === "US" && /^[A-Z][A-Z0-9]{0,11}$/.test(ticker);
}

function classShareTicker(row) {
  return /^BRK-[AB]$/.test(rowTicker(row));
}

function hasNonPlainOrForeignSuffix(row) {
  const ticker = rowTicker(row);
  return row?.market === "US_CLASS"
    || ticker.includes("-")
    || ticker.includes("/")
    || /\d/.test(ticker[0] ?? "");
}

function classifyFinraGap(row) {
  if (hasNonPlainOrForeignSuffix(row)) {
    return "non_plain_or_foreign_suffix_requires_universe_mapping";
  }
  return "plain_us_finra_collection_gap";
}

function classifyOccGap(row) {
  if (classShareTicker(row)) {
    return "class_share_symbol_normalization_or_source_gap";
  }
  if (!plainUsOccEligible(row)) {
    return "non_plain_or_foreign_suffix_requires_universe_mapping";
  }
  return "plain_us_collection_or_no_options_policy_required";
}

function finraMetricReady(row) {
  return Boolean(row)
    && row.confidence === "high"
    && Number(row.coverage_ratio) > 0
    && row.short_pressure_proxy?.score_0_100 != null
    && row.off_exchange_activity_proxy?.score_0_100 != null;
}

function classifyFinraStrictGap(row, flowRow) {
  if (!flowRow) return classifyFinraGap(row);
  if (classShareTicker(row)) {
    return "class_share_placeholder_requires_finra_symbol_policy";
  }
  if (hasNonPlainOrForeignSuffix(row)) {
    return "non_plain_placeholder_requires_universe_mapping";
  }
  return "plain_us_finra_metric_gap";
}

function localEvidence(ticker) {
  const safeTicker = relTickerPath(ticker);
  const yfPath = `data/yf/finance/${safeTicker}.json`;
  const factsPath = `data/computed/market_facts/tickers/${safeTicker}.json`;
  const facts = readJsonOrNull(factsPath);
  return {
    yf_finance_file: fs.existsSync(abs(yfPath)) ? yfPath : null,
    market_facts_file: facts ? factsPath : null,
    market_facts_asset_type: facts?.asset_type ?? null,
    exchange: facts?.identity?.exchange ?? null,
    currency: facts?.identity?.currency ?? null,
    country: facts?.identity?.country ?? null,
    sector: facts?.identity?.sector ?? null,
  };
}

function compactRow(row, category) {
  const ticker = rowTicker(row);
  return {
    ticker,
    company: row?.company ?? null,
    market: row?.market ?? null,
    market_scope: row?.market_scope ?? null,
    category,
    local_evidence: localEvidence(ticker),
  };
}

function sampleRows(rows, categoryFn) {
  return rows.slice(0, SAMPLE_LIMIT).map((row) => compactRow(row, categoryFn(row)));
}

function buildCategorySummary(rows, categoryFn) {
  const rowsWithCategory = rows.map((row) => ({ row, category: categoryFn(row) }));
  return Object.fromEntries(
    Object.entries(countBy(rowsWithCategory, (item) => item.category)).map(([category, count]) => [
      category,
      {
        count,
        sample_tickers: rowsWithCategory
          .filter((item) => item.category === category)
          .slice(0, SAMPLE_LIMIT)
          .map((item) => rowTicker(item.row)),
      },
    ]),
  );
}

function checkEqual(errors, id, actual, expected, detail = {}) {
  if (expected == null) return;
  if (Number(actual) !== Number(expected)) {
    errors.push({
      id,
      message: `${id}: expected ${expected}, got ${actual}`,
      actual,
      expected,
      ...detail,
    });
  }
}

function buildAudit({ full }) {
  const signals = readJson("data/computed/fenok_signals.json");
  const flowProxies = readJson("data/computed/fenok_flow_proxies.json");
  const occOptions = readJson("data/computed/fenok_occ_options_volume.json");
  const coverageIndex = readJson("data/admin/fenok-edge-coverage-index.json");
  const backfillIndex = readJsonOrNull("data/admin/fenok-flow-backfill-index.json");

  const activeUsRows = asArray(signals?.rows)
    .filter((row) => row?.market === "US" || row?.market === "US_CLASS")
    .sort((a, b) => rowTicker(a).localeCompare(rowTicker(b)));
  const activeUsTickers = new Set(activeUsRows.map(rowTicker).filter(Boolean));
  const finraTickers = tickerSet(flowProxies);
  const finraRowsByTicker = tickerMap(flowProxies);
  const occTickers = tickerSet(occOptions);

  const finraPresent = activeUsRows.filter((row) => finraTickers.has(rowTicker(row)));
  const finraMissing = activeUsRows.filter((row) => !finraTickers.has(rowTicker(row)));
  const finraStrictPresent = activeUsRows.filter((row) => finraMetricReady(finraRowsByTicker.get(rowTicker(row))));
  const finraStrictMissing = activeUsRows.filter((row) => !finraMetricReady(finraRowsByTicker.get(rowTicker(row))));
  const finraPlaceholderRows = activeUsRows.filter((row) => {
    const flowRow = finraRowsByTicker.get(rowTicker(row));
    return Boolean(flowRow) && !finraMetricReady(flowRow);
  });
  const occPresent = activeUsRows.filter((row) => occTickers.has(rowTicker(row)));
  const occMissing = activeUsRows.filter((row) => !occTickers.has(rowTicker(row)));
  const bothMissing = activeUsRows.filter((row) => !finraTickers.has(rowTicker(row)) && !occTickers.has(rowTicker(row)));
  const occPlainMissing = occMissing.filter(plainUsOccEligible);
  const occClassShareMissing = occMissing.filter(classShareTicker);
  const finraPlainMissing = finraMissing.filter((row) => !hasNonPlainOrForeignSuffix(row));
  const noRecordAttempts = new Set(asArray(occOptions?.attempts)
    .filter((attempt) => attempt?.status === "failed" && /No record\(s\) found/i.test(String(attempt?.error ?? "")))
    .map((attempt) => normTicker(attempt?.ticker)));
  const occPlainMissingNoRecord = occPlainMissing.filter((row) => noRecordAttempts.has(rowTicker(row)));
  const occPlainMissingUnattempted = occPlainMissing.filter((row) => !noRecordAttempts.has(rowTicker(row)));

  const activeTrack = getActiveTrack(coverageIndex);
  const finraSource = getSourceRow(coverageIndex, "us_finra_flow_proxy");
  const occSource = getSourceRow(coverageIndex, "us_occ_options_proxy");
  const finraEvidence = getBlockingEvidence(activeTrack, "finra_full_us_source_ready");
  const occEvidence = getBlockingEvidence(activeTrack, "occ_full_us_source_ready");
  const errors = [];

  checkEqual(errors, "active_us_bucket_matches_rows", activeUsRows.length, coverageIndex?.active_scoring_universe?.buckets?.us);
  checkEqual(errors, "finra_present_matches_source_row", finraPresent.length, finraSource?.covered_count);
  checkEqual(errors, "finra_strict_present_matches_payload_coverage", finraStrictPresent.length, flowProxies?.coverage?.with_finra);
  checkEqual(errors, "finra_denominator_matches_source_row", activeUsRows.length, finraSource?.denominator);
  checkEqual(errors, "occ_present_matches_source_row", occPresent.length, occSource?.covered_count);
  checkEqual(errors, "occ_denominator_matches_source_row", activeUsRows.length, occSource?.denominator);
  checkEqual(errors, "finra_missing_matches_blocking_evidence", finraMissing.length, finraEvidence?.missing_count);
  checkEqual(errors, "occ_missing_matches_blocking_evidence", occMissing.length, occEvidence?.missing_count);
  checkEqual(errors, "finra_partition_matches_denominator", finraPresent.length + finraMissing.length, activeUsRows.length);
  checkEqual(errors, "occ_partition_matches_denominator", occPresent.length + occMissing.length, activeUsRows.length);

  const warnings = [];
  if (finraPlainMissing.length > 0) {
    warnings.push({
      id: "finra_plain_us_gap_present",
      message: "FINRA has plain US missing rows; treat as collection failure, not only universe mapping.",
      count: finraPlainMissing.length,
    });
  }
  if (finraStrictPresent.length !== finraPresent.length) {
    warnings.push({
      id: "finra_row_count_differs_from_metric_ready_count",
      message: "FINRA row-existence coverage is higher than strict metric-ready coverage.",
      row_existence_count: finraPresent.length,
      metric_ready_count: finraStrictPresent.length,
      placeholder_count: finraPresent.length - finraStrictPresent.length,
    });
  }
  if (occPlainMissing.length > 0 && !backfillIndex?.operationalization?.safe_daily_command_template) {
    warnings.push({
      id: "occ_plain_us_gap_without_backfill_template",
      message: "OCC plain US gaps exist and no backfill command template was found.",
      count: occPlainMissing.length,
    });
  }

  const audit = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    purpose: "Read-only S0 source-gap audit for current active US denominator. Classifies FINRA/OCC missing rows into collection candidates vs universe mapping policy work.",
    raw_policy: {
      fetches_external_data: false,
      writes_files: false,
      raw_rows_included_by_default: false,
      private_artifact_paths_included: false,
    },
    input_files: {
      active_signals: "data/computed/fenok_signals.json",
      finra_flow_proxy: "data/computed/fenok_flow_proxies.json",
      occ_options_proxy: "data/computed/fenok_occ_options_volume.json",
      coverage_index: "data/admin/fenok-edge-coverage-index.json",
      flow_backfill_index: backfillIndex ? "data/admin/fenok-flow-backfill-index.json" : null,
    },
    source_dates: {
      signals_generated_at: signals?.generated_at ?? null,
      finra_source_date: sourceDateFromRows(flowProxies),
      occ_source_date: sourceDateFromRows(occOptions),
      coverage_index_generated_at: coverageIndex?.generated_at ?? null,
      flow_backfill_index_generated_at: backfillIndex?.generated_at ?? null,
    },
    denominator: {
      active_s0_total: asNumber(coverageIndex?.active_scoring_universe?.total, asArray(signals?.rows).length),
      active_us_bucket: activeUsRows.length,
      active_us_by_market: countBy(activeUsRows, (row) => row?.market),
      current_only: coverageIndex?.active_scoring_universe?.current_only === true,
      explicit_taiwan_bucket: asNumber(coverageIndex?.active_scoring_universe?.buckets?.explicit_taiwan),
      taiwan_ticker_anomalies: asArray(coverageIndex?.active_scoring_universe?.taiwan_ticker_anomalies),
    },
    counts: {
      active_us_total: activeUsRows.length,
      finra_present: finraPresent.length,
      finra_missing: finraMissing.length,
      finra_coverage_pct: pct(finraPresent.length, activeUsRows.length),
      finra_metric_ready_present: finraStrictPresent.length,
      finra_metric_ready_missing_or_placeholder: finraStrictMissing.length,
      finra_metric_ready_coverage_pct: pct(finraStrictPresent.length, activeUsRows.length),
      finra_placeholder_low_confidence_rows: finraPlaceholderRows.length,
      occ_present: occPresent.length,
      occ_missing: occMissing.length,
      occ_coverage_pct: pct(occPresent.length, activeUsRows.length),
      both_finra_and_occ_missing: bothMissing.length,
    },
    classification: {
      finra_missing: buildCategorySummary(finraMissing, classifyFinraGap),
      finra_strict_missing_or_placeholder: buildCategorySummary(finraStrictMissing, (row) => classifyFinraStrictGap(row, finraRowsByTicker.get(rowTicker(row)))),
      occ_missing: buildCategorySummary(occMissing, classifyOccGap),
    },
    action_slices: [
      {
        id: "finra_readiness_semantics",
        source: "FINRA",
        current_gap_count: finraStrictMissing.length,
        collectable_plain_us_count: finraStrictMissing.filter((row) => classifyFinraStrictGap(row, finraRowsByTicker.get(rowTicker(row))) === "plain_us_finra_metric_gap").length,
        mapping_or_denominator_policy_count: finraStrictMissing.filter((row) => classifyFinraStrictGap(row, finraRowsByTicker.get(rowTicker(row))) !== "plain_us_finra_metric_gap").length,
        next_action: "Choose and encode S0 FINRA criterion: row-existence=587 or metric-ready with_finra/coverage_ratio>0=579. If strict, update coverage index blocker counts.",
      },
      {
        id: "finra_us_class_mapping_policy",
        source: "FINRA",
        current_gap_count: finraMissing.length,
        collectable_plain_us_count: finraPlainMissing.length,
        mapping_or_denominator_policy_count: finraMissing.length - finraPlainMissing.length,
        next_action: "Do not fetch first. Fix active universe mapping/denominator for US_CLASS foreign-suffix rows or map them to reviewed US ADR/listing tickers before requiring FINRA.",
      },
      {
        id: "occ_plain_us_collection_or_no_options_policy",
        source: "OCC",
        current_gap_count: occMissing.length,
        collectable_plain_us_count: occPlainMissing.length,
        no_record_attempt_count: occPlainMissingNoRecord.length,
        unattempted_plain_us_count: occPlainMissingUnattempted.length,
        mapping_or_denominator_policy_count: occMissing.length - occPlainMissing.length,
        next_action: "Run bounded OCC batches for plain US rows or introduce explicit no-listed-options evidence before clearing occ_full_us_source_ready.",
      },
      {
        id: "occ_non_plain_mapping_policy",
        source: "OCC",
        current_gap_count: occMissing.length - occPlainMissing.length,
        collectable_plain_us_count: 0,
        mapping_or_denominator_policy_count: occMissing.length - occPlainMissing.length,
        next_action: "Keep non-plain/foreign/class rows out of OCC plain-underlying denominator until owner-reviewed mappings exist.",
      },
      {
        id: "occ_class_share_normalization",
        source: "OCC",
        current_gap_count: occClassShareMissing.length,
        collectable_plain_us_count: 0,
        mapping_or_denominator_policy_count: occClassShareMissing.length,
        next_action: "Test OCC accepted forms for BRK.A/BRK.B/BRK-A/BRK-B before marking class-share underlyings unavailable.",
      },
    ],
    samples: {
      finra_missing: sampleRows(finraMissing, classifyFinraGap),
      finra_strict_missing_or_placeholder: sampleRows(finraStrictMissing, (row) => classifyFinraStrictGap(row, finraRowsByTicker.get(rowTicker(row)))),
      finra_placeholder_low_confidence_rows: sampleRows(finraPlaceholderRows, (row) => classifyFinraStrictGap(row, finraRowsByTicker.get(rowTicker(row)))),
      occ_missing: sampleRows(occMissing, classifyOccGap),
      occ_plain_us_collection_or_no_options_policy_required: sampleRows(occPlainMissing, classifyOccGap),
      occ_plain_no_record_attempts: sampleRows(occPlainMissingNoRecord, classifyOccGap),
      occ_plain_unattempted: sampleRows(occPlainMissingUnattempted, classifyOccGap),
      occ_class_share_symbol_normalization_or_source_gap: sampleRows(occClassShareMissing, classifyOccGap),
      both_finra_and_occ_missing: sampleRows(bothMissing, (row) => `${classifyFinraGap(row)} + ${classifyOccGap(row)}`),
    },
    backfill_status: {
      daily_accumulation_status: backfillIndex?.operationalization?.automatic_daily_accumulation_status ?? null,
      latest_us_daily_smoke_ticker_count: backfillIndex?.latest_us_daily_smoke?.target_universe?.ticker_count ?? null,
      latest_us_daily_run_ticker_count: backfillIndex?.latest_us_daily_run?.target_universe?.ticker_count ?? null,
      safe_daily_command_template_present: Boolean(backfillIndex?.operationalization?.safe_daily_command_template),
      caveat: "Backfill index proves bounded run shape only. This audit does not read private raw cache and does not mark missing OCC rows as no-options underlyings.",
    },
    acceptance_checks: {
      ok: errors.length === 0,
      errors,
      warnings,
    },
  };

  if (full) {
    audit.missing_rows = {
      finra: finraMissing.map((row) => compactRow(row, classifyFinraGap(row))),
      occ: occMissing.map((row) => compactRow(row, classifyOccGap(row))),
    };
  }

  return audit;
}

function renderText(audit) {
  const finraClasses = Object.entries(audit.classification.finra_missing)
    .map(([category, value]) => `${category}=${value.count}`)
    .join(", ");
  const occClasses = Object.entries(audit.classification.occ_missing)
    .map(([category, value]) => `${category}=${value.count}`)
    .join(", ");
  const warnings = audit.acceptance_checks.warnings.map((warning) => `${warning.id}: ${warning.message}`).join("; ");
  const errors = audit.acceptance_checks.errors.map((error) => `${error.id}: ${error.message}`).join("; ");
  return [
    `Fenok S0 source gap audit: ${audit.acceptance_checks.ok ? "PASS" : "FAIL"}`,
    `active US denominator: ${audit.counts.active_us_total} (${Object.entries(audit.denominator.active_us_by_market).map(([market, count]) => `${market}=${count}`).join(", ")})`,
    `FINRA: present=${audit.counts.finra_present} missing=${audit.counts.finra_missing} coverage=${audit.counts.finra_coverage_pct}%`,
    `FINRA strict metric-ready: present=${audit.counts.finra_metric_ready_present} missing_or_placeholder=${audit.counts.finra_metric_ready_missing_or_placeholder} coverage=${audit.counts.finra_metric_ready_coverage_pct}%`,
    `FINRA missing classes: ${finraClasses || "none"}`,
    `OCC: present=${audit.counts.occ_present} missing=${audit.counts.occ_missing} coverage=${audit.counts.occ_coverage_pct}%`,
    `OCC missing classes: ${occClasses || "none"}`,
    `Next FINRA action: ${audit.action_slices.find((slice) => slice.id === "finra_us_class_mapping_policy").next_action}`,
    `Next OCC action: ${audit.action_slices.find((slice) => slice.id === "occ_plain_us_collection_or_no_options_policy").next_action}`,
    warnings ? `Warnings: ${warnings}` : null,
    errors ? `Errors: ${errors}` : null,
  ].filter(Boolean).join("\n");
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log(usage());
  process.exit(0);
}

try {
  const audit = buildAudit(options);
  if (options.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    console.log(renderText(audit));
  }
  if (options.check && !audit.acceptance_checks.ok) {
    process.exit(1);
  }
} catch (error) {
  console.error(`audit-fenok-s0-source-gaps: ${error.message}`);
  process.exit(1);
}
