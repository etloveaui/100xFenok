#!/usr/bin/env node
/**
 * Persist a no-fetch S3 ETF daily 1Y readiness artifact.
 *
 * This script turns the existing StockAnalysis history-gap scan into a durable
 * admin-only readiness artifact. It does not fetch remote data and it does not
 * promote ETF coverage to DAILY/GATED while fetchable gaps remain.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL_PATH = "data/admin/fenok-edge-etf-daily1y-readiness.json";

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

function writeJson(relPath, payload) {
  const target = abs(relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function findTrack(index, id) {
  return asArray(index?.public_scoring_readiness?.tracks).find((track) => track?.id === id) ?? null;
}

function findDailyCheck(readiness, id) {
  return asArray(readiness?.daily_checks).find((check) => check?.id === id) ?? null;
}

function compactRows(rows) {
  return asArray(rows).slice(0, 10).map((row) => ({
    ticker: row?.ticker ?? null,
    actual_rows: row?.actual_rows ?? null,
    missing_file: row?.missing_file === true,
    inception_date: row?.inception_date ?? null,
  }));
}

export function buildEtfDaily1yReadiness() {
  const signalSummary = readJson("data/computed/fenok_etf_signals_summary.json");
  const historyGap = readJson("data/stockanalysis/backfill/history_gap_report_latest.json");
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json");
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const readiness = s3Track?.evidence_based_readiness ?? coverageIndex?.etf_universe?.evidence_based_readiness ?? null;
  const generatedDailyCheck = findDailyCheck(readiness, "etf_no_fetchable_daily_1y_gap");

  const scored = historyGap?.daily_1y_gap?.scored_etfs ?? {};
  const denominator = asNumber(
    scored.scored_etf_count,
    asNumber(signalSummary?.coverage?.scored_public_etf, asArray(signalSummary?.rows).length),
  );
  const daily1yComplete = asNumber(scored.complete);
  const daily1yFetchable = asNumber(scored.fetchable);
  const inceptionLimited = asNumber(scored.inception_limited);
  const daily1yMissing = asNumber(scored.missing, daily1yFetchable + inceptionLimited);
  const equationTotal = daily1yComplete + daily1yFetchable + inceptionLimited;
  const countEquationOk = equationTotal === denominator
    && daily1yMissing === daily1yFetchable + inceptionLimited;
  const summaryRows = asArray(signalSummary?.rows).length;
  const summaryCountOk = summaryRows === denominator;
  const coverageCountOk = !readiness?.counts || (
    asNumber(readiness.counts.scored_public_etf) === denominator
    && asNumber(readiness.counts.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(readiness.counts.inception_limited_daily_1y_gap) === inceptionLimited
  );
  const dailyCheckCountOk = !generatedDailyCheck || (
    asNumber(generatedDailyCheck.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(generatedDailyCheck.inception_limited_daily_1y_gap) === inceptionLimited
  );
  const noFetchableDaily1yGap = daily1yFetchable === 0;
  const publicDoneClaimAllowed = Boolean(
    s3Track?.requirements?.public
    && s3Track?.requirements?.daily
    && s3Track?.requirements?.gated
    && noFetchableDaily1yGap
  );

  const errors = [];
  if (!countEquationOk) {
    errors.push({
      id: "daily_1y_count_equation",
      detail: `complete+fetchable+inception_limited=${equationTotal}, denominator=${denominator}, missing=${daily1yMissing}`,
    });
  }
  if (!summaryCountOk) {
    errors.push({
      id: "etf_signal_summary_row_count",
      detail: `summary_rows=${summaryRows}, denominator=${denominator}`,
    });
  }
  if (!coverageCountOk) {
    errors.push({
      id: "coverage_index_etf_daily1y_count_match",
      detail: "coverage index readiness counts differ from history-gap scored ETF counts",
    });
  }
  if (!dailyCheckCountOk) {
    errors.push({
      id: "coverage_index_daily_check_count_match",
      detail: "coverage index etf_no_fetchable_daily_1y_gap check differs from history-gap scored ETF counts",
    });
  }

  return {
    ok: errors.length === 0,
    schema_version: "fenok-edge-etf-daily1y-readiness-admin/v0.1",
    generated_at: new Date().toISOString(),
    purpose: "Admin-only generated S3 ETF daily 1Y readiness evidence. Separates scored ETF public surface from DAILY/GATED readiness.",
    asset_type: "etf",
    stage: s3Track?.stage ?? null,
    readiness_status: publicDoneClaimAllowed ? "ready" : "not_ready",
    public_done_claim_allowed: publicDoneClaimAllowed,
    raw_policy: {
      raw_public: false,
      raw_rows_included: false,
      public_mirror_allowed: false,
      samples_are_diagnostic_only: true,
    },
    source_files: {
      etf_signal_summary: "data/computed/fenok_etf_signals_summary.json",
      history_gap_report: "data/stockanalysis/backfill/history_gap_report_latest.json",
      coverage_index: "data/admin/fenok-edge-coverage-index.json",
      output: OUT_REL_PATH,
    },
    daily_1y_readiness: {
      denominator,
      daily_1y_complete: daily1yComplete,
      daily_1y_missing: daily1yMissing,
      daily_1y_fetchable: daily1yFetchable,
      inception_limited_daily_1y_gap: inceptionLimited,
      etf_no_fetchable_daily_1y_gap: daily1yFetchable,
      count_equation: "daily_1y_complete + daily_1y_fetchable + inception_limited_daily_1y_gap == denominator",
      count_equation_ok: countEquationOk,
      no_fetchable_daily_1y_gap: noFetchableDaily1yGap,
      daily_ready: Boolean(readiness?.daily_ready),
      gated_ready: Boolean(readiness?.gated_ready),
      blockers: [
        ...(noFetchableDaily1yGap ? [] : ["etf_no_fetchable_daily_1y_gap"]),
        ...(readiness?.gated_ready ? [] : ["gated_ready"]),
      ],
      caveat: "Fetchable daily 1Y gaps keep ETF daily=false. Inception-limited gaps are tracked but do not block by themselves.",
    },
    generated_count_checks: {
      summary_rows: summaryRows,
      summary_count_ok: summaryCountOk,
      coverage_index_count_ok: coverageCountOk,
      coverage_index_daily_check_count_ok: dailyCheckCountOk,
      coverage_index_fetchable_daily_1y_gap: readiness?.counts?.fetchable_daily_1y_gap ?? null,
      coverage_index_inception_limited_daily_1y_gap: readiness?.counts?.inception_limited_daily_1y_gap ?? null,
    },
    samples: {
      fetchable: compactRows(scored.samples?.fetchable),
      inception_limited: compactRows(scored.samples?.inception_limited),
      complete: compactRows(scored.samples?.complete).slice(0, 5),
    },
    recommended_dispatch: historyGap.recommended_dispatch ?? null,
    errors,
  };
}

function printHuman(payload) {
  const r = payload.daily_1y_readiness;
  console.log(`Fenok Edge ETF daily 1Y readiness: ${payload.ok ? "PASS" : "FAIL"}`);
  console.log(`- denominator=${r.denominator} complete=${r.daily_1y_complete} fetchable=${r.daily_1y_fetchable} inception_limited=${r.inception_limited_daily_1y_gap}`);
  console.log(`- count_equation_ok=${r.count_equation_ok} public_done_claim_allowed=${payload.public_done_claim_allowed} blockers=${r.blockers.join(",") || "none"}`);
  for (const error of payload.errors) console.error(`ERROR: ${error.id}: ${error.detail}`);
}

const args = parseArgs(process.argv.slice(2));
const payload = buildEtfDaily1yReadiness();

if (!args.noWrite) writeJson(OUT_REL_PATH, payload);
if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
else printHuman(payload);

if (args.check && !payload.ok) process.exitCode = 1;
