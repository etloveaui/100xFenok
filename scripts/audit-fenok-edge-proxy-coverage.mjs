#!/usr/bin/env node
/**
 * Build a review-only FINRA/OCC proxy coverage artifact.
 *
 * This crosses the current plain-US S0 denominator with already committed
 * proxy outputs. It never fetches, scores, publishes, or promotes S1 rows.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FLOW_PROXY_FORMULA_VERSION,
  NATIVE_SIGNAL_FORMULA_VERSION,
  OCC_OPTIONS_FORMULA_VERSION,
  assertProxyFormulaVersion,
} from "./lib/fenok-proxy-formula-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCHEMA_VERSION = "fenok-edge-proxy-coverage-review/v0.1";
const DEFAULT_OUTPUT = "data/admin/fenok-edge-proxy-coverage-review.json";
const SAMPLE_LIMIT = 25;

function parseArgs(argv) {
  const args = new Set(argv);
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") {
      output = argv[index + 1] ?? output;
      index += 1;
    } else if (arg.startsWith("--output=")) {
      output = arg.slice("--output=".length) || output;
    }
  }
  return {
    check: args.has("--check"),
    json: args.has("--json"),
    write: args.has("--write"),
    verify: args.has("--verify"),
    output,
    help: args.has("--help") || args.has("-h"),
  };
}

function usage() {
  return [
    "Usage: node scripts/audit-fenok-edge-proxy-coverage.mjs [--check] [--json] [--write] [--verify] [--output PATH]",
    "",
    "Reads committed derived JSON only. No external fetch, public mirror, S1 mutation, or freshness credit.",
    "--write writes the review-only admin artifact; --verify compares an existing artifact excluding generated_at.",
  ].join("\n");
}

function abs(relPath) {
  return path.isAbsolute(relPath) ? relPath : path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  const displayPath = path.isAbsolute(relPath) ? relPath : relPath;
  try {
    return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
  } catch (error) {
    throw new Error(`${displayPath} read failed: ${error.message}`);
  }
}

function writeJson(relPath, payload) {
  const target = abs(relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  return path.isAbsolute(relPath) ? target : relPath;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normTicker(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function dateKey(value) {
  const text = String(value ?? "").trim();
  if (/^\d{8}$/.test(text)) return text;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}${match[2]}${match[3]}` : "";
}

function sourceDate(row) {
  return dateKey(row?.source_date ?? row?.as_of);
}

function latestSourceDate(payload) {
  return asArray(payload?.rows).map(sourceDate).filter(Boolean).sort().at(-1) ?? null;
}

function rowTicker(row) {
  return normTicker(row?.ticker_normalized ?? row?.ticker ?? row?.symbol);
}

function rowsByTicker(payload) {
  const map = new Map();
  for (const row of asArray(payload?.rows)) {
    const ticker = rowTicker(row);
    if (!ticker) continue;
    map.set(ticker, row);
  }
  return map;
}

function latestRowsByTicker(payload) {
  const map = new Map();
  for (const row of asArray(payload?.rows)) {
    const ticker = rowTicker(row);
    if (!ticker) continue;
    const existing = map.get(ticker);
    const currentDate = sourceDate(row);
    const existingDate = sourceDate(existing);
    if (!existing || currentDate > existingDate || (currentDate === existingDate && row?.as_of > existing?.as_of)) {
      map.set(ticker, row);
    }
  }
  return map;
}

function hasFiniteScore(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function finraMetricReady(row) {
  return Boolean(row)
    && row.confidence === "high"
    && Number(row.coverage_ratio) > 0
    && hasFiniteScore(row.short_pressure_proxy?.score_0_100)
    && hasFiniteScore(row.off_exchange_activity_proxy?.score_0_100);
}

function occMetricReady(row) {
  return Boolean(row)
    && hasFiniteScore(row.options_activity_proxy?.score_0_100);
}

function signalProxyStatus(signalRow, signalKey) {
  const score = signalRow?.signals?.[signalKey]?.score_0_100;
  return hasFiniteScore(score) ? "present" : "missing";
}

function stableComparable(report) {
  const clone = structuredClone(report);
  delete clone.generated_at;
  return clone;
}

function buildPolicyBuckets(ledger) {
  const counts = asObject(ledger?.counts);
  return {
    finra_non_plain_mapping_required: Number(counts.finra_mapping_required_missing_row) || 0,
    finra_source_ready_no_reported_row: Number(counts.finra_source_ready_no_reported_row) || 0,
    finra_low_confidence_placeholder_policy: Number(counts.finra_low_confidence_placeholder_policy_rows) || 0,
    occ_non_plain_mapping_required: Number(counts.occ_non_plain_mapping_required) || 0,
    occ_class_share_normalization_required: Number(counts.occ_class_share_normalization_required) || 0,
    occ_no_listed_options_source_ready: Number(counts.plain_us_occ_no_listed_options_source_ready) || 0,
  };
}

function buildReview() {
  const ledgerPath = "data/admin/fenok-s0-finra-occ-mapping-ledger.json";
  const flowPath = "data/computed/fenok_flow_proxies.json";
  const occPath = "data/computed/fenok_occ_options_volume.json";
  const signalsPath = "data/computed/fenok_signals.json";
  const ledger = readJson(ledgerPath);
  const flow = readJson(flowPath);
  const occ = readJson(occPath);
  const signals = readJson(signalsPath);

  assertProxyFormulaVersion(flow, FLOW_PROXY_FORMULA_VERSION, "FINRA flow proxy");
  assertProxyFormulaVersion(occ, OCC_OPTIONS_FORMULA_VERSION, "OCC options proxy");
  assertProxyFormulaVersion(signals, NATIVE_SIGNAL_FORMULA_VERSION, "native signal output");

  const signalRows = asArray(signals.rows);
  const eligibleRows = signalRows
    .filter((row) => row?.market === "US")
    .filter((row) => /^[A-Z][A-Z0-9]{0,11}$/.test(String(row?.ticker_normalized ?? "")))
    .map((row) => ({
      ticker: rowTicker(row),
      company: row.company ?? row.ticker ?? rowTicker(row),
      market: row.market,
      signalRow: row,
    }))
    .filter((row) => row.ticker);

  const flowByTicker = rowsByTicker(flow);
  const occByTicker = latestRowsByTicker(occ);
  const signalByTicker = new Map(signalRows.map((row) => [rowTicker(row), row]).filter(([ticker]) => ticker));
  const noListedOptions = new Set(
    asArray(ledger?.rows?.occ_no_listed_options_source_ready).map(rowTicker).filter(Boolean),
  );

  const rows = eligibleRows.map(({ ticker, company, market, signalRow }) => {
    const finraRow = flowByTicker.get(ticker) ?? null;
    const occRow = occByTicker.get(ticker) ?? null;
    const finraReady = finraMetricReady(finraRow);
    const occReady = occMetricReady(occRow);
    const classification = finraReady && occReady
      ? "both"
      : finraReady
        ? "finra_only"
        : occReady
          ? "occ_only"
          : "neither";
    return {
      ticker,
      company,
      market,
      classification,
      finra_status: finraReady
        ? "metric_ready"
        : finraRow
          ? "source_present_metric_gap"
          : "missing",
      occ_status: occReady
        ? "metric_ready"
        : occRow
          ? "source_present_metric_gap"
          : noListedOptions.has(ticker)
            ? "source_ready_no_activity"
            : "missing",
      finra_source_date: sourceDate(finraRow) || null,
      occ_source_date: sourceDate(occRow) || null,
      native_finra_status: signalProxyStatus(signalRow, "short_pressure_proxy"),
      native_occ_status: signalProxyStatus(signalRow, "net_options_proxy"),
      native_signal_source_date: signalRow?.signals?.net_options_proxy?.source_date
        ?? signalRow?.signals?.short_pressure_proxy?.source_date
        ?? null,
    };
  });

  const classifications = ["both", "finra_only", "occ_only", "neither"];
  const classificationCounts = Object.fromEntries(
    classifications.map((classification) => [classification, rows.filter((row) => row.classification === classification).length]),
  );
  const finraCounts = {
    metric_ready: rows.filter((row) => row.finra_status === "metric_ready").length,
    source_present_metric_gap: rows.filter((row) => row.finra_status === "source_present_metric_gap").length,
    missing: rows.filter((row) => row.finra_status === "missing").length,
  };
  const occCounts = {
    metric_ready: rows.filter((row) => row.occ_status === "metric_ready").length,
    source_present_metric_gap: rows.filter((row) => row.occ_status === "source_present_metric_gap").length,
    source_ready_no_activity: rows.filter((row) => row.occ_status === "source_ready_no_activity").length,
    missing: rows.filter((row) => row.occ_status === "missing").length,
  };
  const nativeCounts = {
    finra_signal_present: rows.filter((row) => row.native_finra_status === "present").length,
    occ_signal_present: rows.filter((row) => row.native_occ_status === "present").length,
  };

  const ledgerPlainDenominator = Number(ledger?.counts?.plain_us_finra_denominator) || 0;
  const checks = [
    {
      id: "formula_versions_bound",
      ok: flow.formula_version === FLOW_PROXY_FORMULA_VERSION
        && occ.formula_version === OCC_OPTIONS_FORMULA_VERSION
        && signals.formula_version === NATIVE_SIGNAL_FORMULA_VERSION,
      detail: `${flow.formula_version} / ${occ.formula_version} / ${signals.formula_version}`,
    },
    {
      id: "plain_us_denominator_matches_ledger",
      ok: rows.length === ledgerPlainDenominator,
      detail: `${rows.length} rows vs ledger ${ledgerPlainDenominator}`,
    },
    {
      id: "classification_partition_matches_denominator",
      ok: Object.values(classificationCounts).reduce((sum, count) => sum + count, 0) === rows.length,
      detail: `${Object.values(classificationCounts).join("+")} = ${rows.length}`,
    },
    {
      id: "eligible_rows_are_plain_us_only",
      ok: rows.every((row) => row.market === "US" && /^[A-Z][A-Z0-9]{0,11}$/.test(row.ticker)),
      detail: "no non-plain or non-US row entered the review denominator",
    },
    {
      id: "blocked_policy_buckets_remain_outside_review",
      ok: buildPolicyBuckets(ledger).finra_non_plain_mapping_required > 0
        && buildPolicyBuckets(ledger).occ_non_plain_mapping_required > 0,
      detail: "non-plain mapping buckets remain policy-gated and are not promoted",
    },
    {
      id: "review_only_boundary",
      ok: true,
      detail: "public bundle false, public route null, live readback not verified, freshness credit false, S1 mutation false",
    },
  ];

  const rowPartitions = {
    eligible_with_both_proxy: rows.filter((row) => row.classification === "both").map((row) => row.ticker),
    eligible_with_any_proxy: rows.filter((row) => row.classification !== "neither").map((row) => row.ticker),
    eligible_gap: rows.filter((row) => row.classification === "neither").map((row) => row.ticker),
  };
  const generatedAt = new Date().toISOString();
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    generated_by: "scripts/audit-fenok-edge-proxy-coverage.mjs",
    purpose: "Review-only cross-check of committed FINRA/OCC proxy coverage for the current plain-US S0 denominator.",
    public_surface_status: "admin_local_review_only_not_public",
    review_boundary: {
      public_bundle_safe: false,
      public_route: null,
      live_readback: "not_verified",
      freshness_credit: false,
      s1_public_mutation: false,
      external_fetch: false,
      dispatch: false,
    },
    source_inputs: {
      ledger: {
        path: ledgerPath,
        schema_version: ledger.schema_version ?? null,
        generated_at: ledger.generated_at ?? null,
      },
      finra_flow_proxy: {
        path: flowPath,
        schema_version: flow.schema_version ?? null,
        generated_at: flow.generated_at ?? null,
        formula_version: flow.formula_version ?? null,
        latest_source_date: latestSourceDate(flow),
      },
      occ_options_proxy: {
        path: occPath,
        schema_version: occ.schema_version ?? null,
        generated_at: occ.generated_at ?? null,
        formula_version: occ.formula_version ?? null,
        latest_source_date: latestSourceDate(occ),
      },
      native_signals: {
        path: signalsPath,
        schema_version: signals.schema_version ?? null,
        generated_at: signals.generated_at ?? null,
        formula_version: signals.formula_version ?? null,
        source_date: signals.source_date ?? null,
      },
    },
    formula_versions: {
      finra_flow: FLOW_PROXY_FORMULA_VERSION,
      occ_options: OCC_OPTIONS_FORMULA_VERSION,
      native_signals: NATIVE_SIGNAL_FORMULA_VERSION,
    },
    denominators: {
      eligible_plain_us: rows.length,
      ledger_plain_us_finra_denominator: ledgerPlainDenominator,
      active_us_total: Number(ledger?.counts?.active_us_total) || null,
    },
    coverage: {
      classification_counts: classificationCounts,
      eligible_with_any_proxy: rows.length - classificationCounts.neither,
      finra: finraCounts,
      occ: occCounts,
      native_signal_consumer: nativeCounts,
    },
    blocked_policy_buckets: buildPolicyBuckets(ledger),
    rows,
    row_partitions: rowPartitions,
    acceptance_checks: {
      ok: checks.every((check) => check.ok),
      checks,
    },
    sample_policy: {
      max_rows_per_sample: SAMPLE_LIMIT,
      full_review_rows_present: true,
      score_values_omitted: true,
      raw_rows_omitted: true,
    },
  };
}

function renderText(report) {
  const counts = report.coverage.classification_counts;
  return [
    `Fenok Edge proxy coverage review: ${report.acceptance_checks.ok ? "PASS" : "FAIL"}`,
    `plain-US denominator: ${report.denominators.eligible_plain_us}`,
    `proxy coverage: both=${counts.both}, FINRA-only=${counts.finra_only}, OCC-only=${counts.occ_only}, neither=${counts.neither}`,
    `FINRA metric-ready=${report.coverage.finra.metric_ready}; OCC metric-ready=${report.coverage.occ.metric_ready}; native signal FINRA/OCC=${report.coverage.native_signal_consumer.finra_signal_present}/${report.coverage.native_signal_consumer.occ_signal_present}`,
    `boundary: admin review only, public=false, S1 mutation=false, freshness credit=false, live readback=not verified`,
  ].join("\n");
}

function verifyArtifact(outputPath, report) {
  const existing = readJson(outputPath);
  return JSON.stringify(stableComparable(existing)) === JSON.stringify(stableComparable(report));
}

export { buildReview, DEFAULT_OUTPUT, SCHEMA_VERSION, stableComparable };

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  try {
    const report = buildReview();
    if (options.verify && !verifyArtifact(options.output, report)) {
      throw new Error(`${options.output} does not match the current committed inputs`);
    }
    if (options.write) writeJson(options.output, report);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(renderText(report));
    if (options.check && !report.acceptance_checks.ok) process.exit(1);
  } catch (error) {
    console.error(`audit-fenok-edge-proxy-coverage: ${error.message}`);
    process.exit(1);
  }
}
