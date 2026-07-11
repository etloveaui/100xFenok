#!/usr/bin/env node
/**
 * Report daily accumulation truth for Fenok Edge S0/S1/S3 without fetching.
 *
 * This gate is intentionally honest rather than aspirational: bounded daily
 * jobs may accumulate inputs, but only PUBLIC + DAILY + GATED can be reported
 * as done.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const JSON_MODE = process.argv.includes("--json");
const CHECK_MODE = process.argv.includes("--check");

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

function requirementsDone(requirements) {
  return Boolean(requirements?.public && requirements?.daily && requirements?.gated)
    && Object.values(requirements ?? {}).every(Boolean);
}

function missingRequirements(requirements) {
  return Object.entries(requirements ?? {})
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
}

function findTrack(index, id) {
  return asArray(index?.public_scoring_readiness?.tracks).find((track) => track?.id === id) ?? null;
}

function freshnessById(index) {
  return Object.fromEntries(asArray(index?.freshness_gate?.checks).map((check) => [check.id, check]));
}

function summarizeFreshness(check) {
  if (!check) return null;
  return {
    source_date: check.source_date ?? null,
    generated_at: check.generated_at ?? null,
    age_days: check.age_days ?? null,
    status: check.status ?? null,
    caveat: check.caveat ?? null,
  };
}

function compactSources(sources) {
  return Object.entries(sources)
    .filter(([, value]) => value != null)
    .map(([key, value]) => {
      if (typeof value === "string") return `${key}=${value}`;
      const date = value.source_date ?? value.generated_at ?? "unknown";
      const status = value.status ? ` ${value.status}` : "";
      const age = value.age_days != null ? ` age=${value.age_days}d` : "";
      return `${key}=${date}${status}${age}`;
    })
    .join("; ");
}

function add(list, message, extra = {}) {
  list.push({ message, ...extra });
}

function buildReport() {
  const coverageIndex = readJson("data/admin/fenok-edge-coverage-index.json");
  const marketFacts = readJson("data/computed/market_facts/index.json");
  const signals = readJson("data/computed/fenok_signals.json");
  const etfSignals = readJsonOrNull("data/computed/fenok_etf_signals.json");
  const etfSummary = readJsonOrNull("data/computed/fenok_etf_signals_summary.json");
  const historyGap = readJsonOrNull("data/stockanalysis/backfill/history_gap_report_latest.json");
  const incrementalPlan = readJsonOrNull("data/stockanalysis/backfill/incremental_plan_latest.json");
  const yfSummary = readJsonOrNull("data/yf/finance/_summary.json");
  const freshness = freshnessById(coverageIndex);

  const s0Track = findTrack(coverageIndex, "active_stock_scoring_current");
  const s1Track = findTrack(coverageIndex, "expanded_stock_candidates");
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const s0BlockingEvidenceIds = [
    ...asArray(s0Track?.blocking_evidence?.checks),
    ...asArray(s0Track?.blocking_evidence?.blockers),
  ].map((row) => row?.id).filter(Boolean);
  const s0 = coverageIndex.active_scoring_universe ?? {};
  const s1 = coverageIndex.expanded_stock_candidate_universe ?? {};
  const s3 = coverageIndex.etf_universe ?? {};
  const s1Evidence = s1Track?.promotion_gate_readiness ?? s1.promotion_gate_readiness ?? null;
  const historyPlan = historyGap?.incremental_plan ?? null;
  const coverageIndexEtfScored = asNumber(s3.scored_public_etf);
  const computedEtfScored = asNumber(etfSignals?.coverage?.scored_public_etf, coverageIndexEtfScored);
  const summaryEtfScored = asNumber(etfSummary?.coverage?.scored_public_etf, computedEtfScored);
  const actualEtfScored = Math.max(coverageIndexEtfScored, computedEtfScored, summaryEtfScored);
  const s3Evidence = s3Track?.evidence_based_readiness ?? s3.evidence_based_readiness ?? null;

  const tracks = {
    s0_active_stock_scoring: {
      layer: "S0",
      stage: s0Track?.stage ?? null,
      readiness_status: s0Track?.readiness_status ?? null,
      public_done_claim_allowed: s0Track?.public_done_claim_allowed === true,
      public_daily_gated: requirementsDone(s0Track?.requirements),
      denominator: asNumber(s0.total),
      scored_public_stock: asNumber(signals?.coverage?.row_count, asArray(signals?.rows).length),
      cadence: {
        workflow: "fenok-edge-krx-daily.yml + fenok-edge-daily.yml",
        schedule: "KRX KST Mon-Fri 19:30 bounded daily fetch; FINRA/OCC KST Tue-Sat 09:30; US_CLASS/non-plain and Asia HKEX/SSE/SZSE via YF daily stock shards",
        truth: "S0 is public-scored and done only when every active stock bucket has current counted daily sources plus strict gated evidence.",
      },
      remaining_blockers: missingRequirements(s0Track?.requirements),
      blocking_evidence_ids: s0BlockingEvidenceIds,
      caveat: s0Track?.caveat ?? null,
      operator_status: {
        last_sources: {
          korea: summarizeFreshness(freshness.korea_counted_source_date),
          us_flow: summarizeFreshness(freshness.us_flow_source_date),
          us_occ: summarizeFreshness(freshness.us_occ_source_date),
          us_class_yf: summarizeFreshness(freshness.us_class_yf_source_date),
          asia_yf: summarizeFreshness(freshness.asia_ex_taiwan_yf_source_date),
          signals_generated_at: signals?.generated_at ?? null,
        },
        blocking_gates: missingRequirements(s0Track?.requirements),
        blocking_evidence_ids: s0BlockingEvidenceIds,
        done_claim_allowed: s0Track?.public_done_claim_allowed === true,
      },
    },
    s1_stock_candidates: {
      layer: "S1",
      stage: s1Track?.stage ?? s1.stage ?? null,
      readiness_status: s1Track?.readiness_status ?? null,
      public_done_claim_allowed: s1Track?.public_done_claim_allowed === true,
      public_daily_gated: requirementsDone(s1Track?.requirements),
      denominator: asNumber(s1.collected_stock_candidates, asNumber(marketFacts?.coverage?.stock)),
      scored_public_stock: asNumber(s1.scored_public_stock, asNumber(signals?.coverage?.row_count, asArray(signals?.rows).length)),
      backlog: {
        stock_promotion_audit_gap: asNumber(s1.stock_promotion_audit_gap),
        blocked_excluded_rows: asNumber(s1Evidence?.counts?.blocked_excluded_rows),
        promotion_rows_remaining: asNumber(s1Evidence?.counts?.promotion_rows),
      },
      cadence: {
        yf_finance: "scheduled branch uses one rolling shard per run, cap 140, max_age_hours=18, history_gaps_only=true",
        stockanalysis: "scheduled branch is ETF/surface incremental only; stock financial statement fetches are disabled on schedule",
        truth: s1Evidence?.gated_ready
          ? "S1 is closed by current public S0 daily/gated rows plus an explicit blocked/excluded ledger."
          : "S1 stocks can accumulate source data, but are not joined/scored/public/daily/gated as expanded stock coverage.",
      },
      remaining_blockers: missingRequirements(s1Track?.requirements),
      caveat: s1.caveat ?? s1Track?.caveat ?? null,
      operator_status: {
        last_sources: {
          market_facts_generated_at: marketFacts?.generated_at ?? null,
          yf_summary_generated_at: yfSummary?.generated_at ?? null,
          signals_generated_at: signals?.generated_at ?? null,
        },
        blocking_gates: missingRequirements(s1Track?.requirements),
        done_claim_allowed: s1Track?.public_done_claim_allowed === true,
      },
    },
    s3_etf_lane: {
      layer: "S3",
      stage: s3Track?.stage ?? s3.stage ?? null,
      computed_stage: s3Evidence?.public_ready
        ? "PUBLIC_SURFACE_VERIFIED"
        : actualEtfScored > 0 ? "SCORED_ARTIFACT_PRESENT" : "NORMALIZED_ONLY",
      readiness_status: s3Track?.readiness_status ?? null,
      public_done_claim_allowed: s3Track?.public_done_claim_allowed === true,
      public_daily_gated: requirementsDone(s3Track?.requirements),
      denominator: asNumber(s3.collected_etf_candidates, asNumber(marketFacts?.coverage?.etf)),
      scored_public_etf: actualEtfScored,
      evidence_based_readiness: s3Evidence,
      scored_public_etf_sources: {
        coverage_index: coverageIndexEtfScored,
        fenok_etf_signals: computedEtfScored,
        fenok_etf_signals_summary: summaryEtfScored,
      },
      computed_artifact: etfSignals
        ? {
            generated_at: etfSignals.generated_at ?? null,
            formula_version: etfSignals.formula_version ?? null,
            rows: asArray(etfSignals.rows).length,
          }
        : null,
      history_gap: historyGap
        ? {
            report_generated_at: historyGap.generated_at ?? null,
            classification_as_of: historyGap.classification_as_of ?? null,
            required_history_periods: asArray(historyGap.required_history_periods),
            complete_required_history: asNumber(historyGap.complete_required_history),
            missing_required_history: asNumber(historyGap.missing_required_history),
            fetchable_required_history: asNumber(historyGap.fetchable_required_history),
            inception_limited_required_history: asNumber(historyGap.inception_limited_required_history),
            missing_by_period: historyGap.missing_by_period ?? {},
            fetchable_by_period: historyGap.fetchable_by_period ?? {},
            incremental_plan_counts: historyPlan?.counts ?? incrementalPlan?.counts ?? null,
            next_fetchable_first5: asArray(historyPlan?.first5 ?? incrementalPlan?.etfs).slice(0, 5),
            daily_1y_gap: historyGap.daily_1y_gap?.scored_etfs ?? historyGap.daily_1y_gap ?? null,
            exact_daily_1y_gap: s3Evidence?.counts
              ? {
                  classification_as_of: s3Evidence.classification_as_of ?? null,
                  fetchable: s3Evidence.counts.fetchable_daily_1y_gap ?? null,
                  inception_limited: s3Evidence.counts.inception_limited_daily_1y_gap ?? null,
                  history_gap_report_match: s3Evidence.counts.history_gap_report_match ?? null,
                }
              : null,
          }
        : null,
      cadence: {
        yf_finance: "scheduled branch processes ETF history gaps through one rolling shard per run, cap 140",
        stockanalysis: "weekday scheduled branches are split: KST 07:50 scored-ETF daily_1y continuity backfill cap 120; KST 08:50 Core Basket + surface incremental refresh with Core Basket priority and incremental cap 40",
        truth: actualEtfScored > 0
          ? "ETF scores exist in the separate ETF artifact. Daily readiness now also requires StockAnalysis ETF detail daily 1Y continuity (no fetchable gaps)."
          : "ETF inputs are normalized and accumulated separately, but ETF scoring/public/daily gate is not done.",
      },
      remaining_blockers: missingRequirements(s3Track?.requirements),
      caveat: s3.caveat ?? s3Track?.caveat ?? null,
      operator_status: {
        last_sources: {
          market_facts_generated_at: marketFacts?.generated_at ?? null,
          etf_signals_generated_at: etfSignals?.generated_at ?? etfSummary?.generated_at ?? null,
          history_gap_report_generated_at: historyGap?.generated_at ?? null,
          history_gap_classification_as_of: historyGap?.classification_as_of ?? null,
          history_gap_plan_generated_at: historyGap?.incremental_plan?.generated_at ?? incrementalPlan?.generated_at ?? null,
          public_surface: s3Evidence?.public_ready ? "ready" : s3Evidence ? "blocked" : null,
        },
        blocking_gates: missingRequirements(s3Track?.requirements),
        done_claim_allowed: s3Track?.public_done_claim_allowed === true,
      },
    },
  };

  const errors = [];
  const warnings = [];
  for (const [key, track] of Object.entries(tracks)) {
    if (track.public_done_claim_allowed && !track.public_daily_gated) {
      add(errors, `${key}: public_done_claim_allowed requires PUBLIC+DAILY+GATED`);
    }
    if (track.readiness_status === "ready" && !track.public_daily_gated) {
      add(errors, `${key}: readiness_status=ready requires PUBLIC+DAILY+GATED`);
    }
  }
  if (tracks.s1_stock_candidates.scored_public_stock !== tracks.s0_active_stock_scoring.scored_public_stock) {
    add(warnings, "S1 scored_public_stock differs from S0 current scored stock count; verify whether promotion changed the S0 denominator.", {
      s0: tracks.s0_active_stock_scoring.scored_public_stock,
      s1: tracks.s1_stock_candidates.scored_public_stock,
    });
  }
  if (tracks.s3_etf_lane.scored_public_etf > 0 && !tracks.s3_etf_lane.public_daily_gated) {
    add(warnings, `S3 ETF scored artifact is present (${tracks.s3_etf_lane.scored_public_etf}) but DAILY+GATED readiness is still false; report as public-surfaced/not-done only when public proof is true.`);
  }
  if (tracks.s3_etf_lane.stage === "PUBLIC" && tracks.s3_etf_lane.evidence_based_readiness?.public_ready !== true) {
    add(errors, "S3 ETF stage=PUBLIC requires evidence_based_readiness.public_ready=true");
  }
  if (
    tracks.s3_etf_lane.scored_public_etf_sources.coverage_index !== tracks.s3_etf_lane.scored_public_etf_sources.fenok_etf_signals
    || tracks.s3_etf_lane.scored_public_etf_sources.coverage_index !== tracks.s3_etf_lane.scored_public_etf_sources.fenok_etf_signals_summary
  ) {
    add(errors, "S3 ETF scored count mismatch between coverage index and ETF signal artifacts", tracks.s3_etf_lane.scored_public_etf_sources);
  }
  if (!historyGap) {
    add(warnings, "S3 StockAnalysis history gap report is missing; ETF backlog counts are incomplete.");
  }

  return {
    ok: errors.length === 0,
    schema_version: "fenok-daily-accumulation-truth/v0.1",
    generated_at: new Date().toISOString(),
    sources: {
      coverage_index_generated_at: coverageIndex.generated_at ?? null,
      market_facts_generated_at: marketFacts.generated_at ?? null,
      fenok_signals_generated_at: signals.generated_at ?? null,
      fenok_etf_signals_generated_at: etfSignals?.generated_at ?? null,
      history_gap_report_generated_at: historyGap?.generated_at ?? null,
      history_gap_classification_as_of: historyGap?.classification_as_of ?? null,
    },
    tracks,
    warning_count: warnings.length,
    warnings,
    error_count: errors.length,
    errors,
  };
}

function printHuman(report) {
  console.log(`Fenok daily accumulation truth: ${report.ok ? "PASS" : "FAIL"}`);
  console.log(`generated_at: ${report.generated_at}`);
  const s0 = report.tracks.s0_active_stock_scoring;
  const s1 = report.tracks.s1_stock_candidates;
  const s3 = report.tracks.s3_etf_lane;
  console.log(`- S0 active stock scoring: stage=${s0.stage} denominator=${s0.denominator} scored_public_stock=${s0.scored_public_stock} public_daily_gated=${s0.public_daily_gated} cadence="${s0.cadence.schedule}" blockers=${s0.remaining_blockers.join(",") || "none"}`);
  console.log(`  status: sources=[${compactSources(s0.operator_status.last_sources)}] blocking_gates=${s0.operator_status.blocking_gates.join(",") || "none"} done_claim_allowed=${s0.operator_status.done_claim_allowed}`);
  const s1LedgerText = s1.backlog.blocked_excluded_rows != null
    ? ` blocked_excluded=${s1.backlog.blocked_excluded_rows} promotion_rows_remaining=${s1.backlog.promotion_rows_remaining}`
    : "";
  console.log(`- S1 stock candidates: stage=${s1.stage} denominator=${s1.denominator} promotion_gap=${s1.backlog.stock_promotion_audit_gap}${s1LedgerText} public_daily_gated=${s1.public_daily_gated} cadence="YF one shard/140 per scheduled run; promotion gate closes via public S0 + blocked ledger" blockers=${s1.remaining_blockers.join(",") || "none"}`);
  console.log(`  status: sources=[${compactSources(s1.operator_status.last_sources)}] blocking_gates=${s1.operator_status.blocking_gates.join(",") || "none"} done_claim_allowed=${s1.operator_status.done_claim_allowed}`);
  const gap = s3.history_gap;
  const daily1y = gap?.exact_daily_1y_gap ?? gap?.daily_1y_gap;
  const daily1yText = daily1y
    ? ` daily_1y_fetchable=${daily1y.fetchable} daily_1y_inception_limited=${daily1y.inception_limited}`
    : "";
  const historyMatchText = gap?.exact_daily_1y_gap?.history_gap_report_match === false ? " history_gap_report_match=false" : "";
  const historyText = gap
    ? `history_missing=${gap.missing_required_history} fetchable=${gap.fetchable_required_history} inception_limited=${gap.inception_limited_required_history}${daily1yText}${historyMatchText}`
    : "history_gap_report=missing";
  const scoredSources = s3.scored_public_etf_sources;
  const sourceText = `coverage_index=${scoredSources.coverage_index},artifact=${scoredSources.fenok_etf_signals},summary=${scoredSources.fenok_etf_signals_summary}`;
  const s3EvidenceText = s3.evidence_based_readiness
    ? ` evidence_ready={public:${s3.evidence_based_readiness.public_ready},daily:${s3.evidence_based_readiness.daily_ready},gated:${s3.evidence_based_readiness.gated_ready}}`
    : "";
  console.log(`- S3 ETF lane: stage=${s3.stage} computed_stage=${s3.computed_stage} denominator=${s3.denominator} scored_public_etf=${s3.scored_public_etf} scored_sources=[${sourceText}] ${historyText} public_daily_gated=${s3.public_daily_gated}${s3EvidenceText} cadence="YF one shard/140; StockAnalysis daily1y 120/run + Core Basket priority 40 incremental/run" blockers=${s3.remaining_blockers.join(",") || "none"}`);
  console.log(`  status: sources=[${compactSources(s3.operator_status.last_sources)}] blocking_gates=${s3.operator_status.blocking_gates.join(",") || "none"} done_claim_allowed=${s3.operator_status.done_claim_allowed}`);
  for (const warning of report.warnings) console.log(`WARN: ${warning.message}`);
  for (const error of report.errors) console.error(`ERROR: ${error.message}`);
}

const report = buildReport();
if (JSON_MODE) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else printHuman(report);

process.exitCode = CHECK_MODE && !report.ok ? 1 : 0;
