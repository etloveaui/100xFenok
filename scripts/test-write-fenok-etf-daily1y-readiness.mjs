#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createEffectiveEtfDetailReader,
  EffectiveEtfDetailIntegrityError,
} from "./effective-etf-detail-reader.mjs";
import {
  buildScoredEtfDaily1yFetchablePlan,
  buildEtfDaily1yReadiness,
  classifyDaily1yGap,
  etfInceptionDate,
} from "./write-fenok-etf-daily1y-readiness.mjs";
import {
  DAILY_1Y_HISTORY_EVIDENCE_POLICY,
  classifyDaily1yShortHistory,
  daily1yClassificationProjection,
  daily1ySeriesEvidence,
} from "./lib/etf-daily1y-history-classifier.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const historyGapScript = path.resolve(scriptDir, "../100xfenok-next/scripts/report-stockanalysis-history-gap.mjs");

const currentNow = new Date("2026-07-09T00:00:00Z");

function weekdayRows(count, start = "2026-06-01") {
  const rows = [];
  for (let cursor = Date.parse(`${start}T00:00:00Z`); rows.length < count; cursor += 86_400_000) {
    const date = new Date(cursor);
    if (![0, 6].includes(date.getUTCDay())) {
      rows.push({ date: date.toISOString().slice(0, 10), Close: 100 + rows.length });
    }
  }
  return rows;
}

function classificationBucket(gap) {
  if (gap.complete) return "complete";
  if (gap.inceptionLimited.length > 0) return "inception_limited";
  if (gap.terminalLimited.length > 0) return "terminal_limited";
  return "fetchable";
}

function pythonDaily1yClassifications(cases) {
  const code = String.raw`
import importlib.util
import json
import sys
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location("fetch_stockanalysis", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.loads(sys.argv[2])
now_dt = datetime.fromisoformat(sys.argv[3].replace("Z", "+00:00")).astimezone(timezone.utc)
rows = []
for case in cases:
    result = module.history_gap_classification(
        case["payload"],
        ("daily_1y",),
        now_dt,
        yf_rows=case.get("yf_rows"),
        pending_entry=case.get("pending_entry"),
    )
    if result["inception_limited_history_periods"]:
        bucket = "inception_limited"
    elif result["terminal_limited_history_periods"]:
        bucket = "terminal_limited"
    else:
        bucket = "fetchable"
    rows.append({
        "id": case["id"],
        "bucket": bucket,
        "reason": result.get("daily_1y_classification_reason"),
        "effective_start_date": result.get("effective_history_start_date"),
        "effective_start_source": result.get("effective_history_start_source"),
        "declared_valid": result.get("declared_inception_valid"),
        "declared_invalid_future": result.get("declared_inception_invalid_future"),
        "provider_truncated": result.get("provider_truncated_suspected"),
        "stable_confirmed": result.get("stable_observation_confirmed"),
        "stable_pinned_start": result.get("stable_observation_pinned_start"),
        "valid_unique_date_count": (result.get("daily_1y_series_evidence") or {}).get("valid_unique_date_count"),
        "earliest_observation": (result.get("daily_1y_series_evidence") or {}).get("earliest_observation"),
        "latest_observation": (result.get("daily_1y_series_evidence") or {}).get("latest_observation"),
        "density": (result.get("daily_1y_series_evidence") or {}).get("density"),
        "evidence_pass": (result.get("daily_1y_series_evidence") or {}).get("evidence_pass"),
    })
print(json.dumps({"policy": module.DAILY_1Y_HISTORY_EVIDENCE_POLICY, "rows": rows}, sort_keys=True))
`;
  const run = spawnSync(
    "python3",
    ["-c", code, path.join(scriptDir, "fetch-stockanalysis.py"), JSON.stringify(cases), currentNow.toISOString()],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}
assert.throws(
  () => buildScoredEtfDaily1yFetchablePlan({
    signalSummary: { rows: [] },
    historyGap: { classification_as_of: null, daily_1y_gap: { scored_etfs: {} } },
    coverageIndex: null,
    generatedAt: currentNow,
    classificationAsOf: null,
  }),
  /classificationAsOf must be a valid timestamp/,
);
const recentYahooFallback = {
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: {
    history_periods: {
      daily_1y: [
        ...weekdayRows(25, "2026-06-01"),
      ],
    },
  },
};
const oldYahooFallback = {
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: {
    history_periods: {
      daily_1y: [
        ...weekdayRows(25, "2025-01-03"),
      ],
    },
  },
};
const recentStockAnalysisShortRows = {
  asset_type: "etf",
  source_provider: "stockanalysis",
  fetched_at: "2026-07-08T00:00:00Z",
  normalized: {
    overview: {
      inception: "Jan 1, 2020",
    },
    history_periods: {
      daily_1y: [
        { date: "2026-07-08", Close: 25.7 },
      ],
    },
  },
};
const recentProviderFailure = {
  last_attempt_utc: "2026-07-08T18:00:00Z",
  failure_reason: "ValueError: Yahoo fallback quoteType is not ETF/MUTUALFUND: EQUITY",
};

function writeFixture(rootDir, relPath, payload) {
  const target = path.join(rootDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function dailyRows(count, start = "2025-01-02") {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(startMs + index * 86_400_000).toISOString().slice(0, 10),
    Close: 100 + index,
  }));
}

function seedR2State(rootDir, entries) {
  const code = String.raw`
import json
import sys
from pathlib import Path

repo = Path(sys.argv[1])
script_dir = Path(sys.argv[2])
entries = json.loads(sys.argv[3])
sys.path.insert(0, str(script_dir))
from migrate_data_supply_r2_3 import LegacyYahooMigration

(repo / "data/stockanalysis/etfs").mkdir(parents=True, exist_ok=True)
(repo / "data/yf/finance").mkdir(parents=True, exist_ok=True)
for entry in entries:
    ticker = entry["ticker"]
    fetched_at = entry["fetched_at"]
    legacy = {
        "schema_version": "stockanalysis/v1",
        "source": "yahoo_finance",
        "source_provider": "yahoo_finance",
        "detail_status": "yf_fallback",
        "asset_type": "etf",
        "ticker": ticker,
        "fetched_at": fetched_at,
        "normalized": {"quote": {"p": 10.0}},
    }
    raw = {
        "schema_version": "yf-finance/v2",
        "ticker": ticker,
        "fetched_at": fetched_at,
        "profile": "etf",
        "source": "yahoo_finance",
        "data": {
            "info": {"quoteType": "ETF", "currentPrice": 10.0},
            "funds_data": {"top_holdings": []},
            "history_1y": entry["history"],
        },
    }
    (repo / f"data/stockanalysis/etfs/{ticker}.json").write_text(json.dumps(legacy, indent=2) + "\n", encoding="utf-8")
    (repo / f"data/yf/finance/{ticker}.json").write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")

state = repo / "data/admin/data-supply-state/v1"
migration = LegacyYahooMigration(repo, state)
manifest = migration.plan(expected_count=len(entries), created_at="2026-07-11T00:00:00Z")
result = migration.apply(manifest, decided_at="2026-07-11T00:00:00Z", delete_legacy=True)
print(json.dumps(result, sort_keys=True))
`;
  const run = spawnSync(
    "python3",
    ["-c", code, rootDir, scriptDir, JSON.stringify(entries)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function activeSelection(rootDir, ticker) {
  const stateRoot = path.join(rootDir, "data/admin/data-supply-state/v1");
  const active = JSON.parse(fs.readFileSync(path.join(stateRoot, "domains/etf_detail/active.json"), "utf8"));
  const current = JSON.parse(fs.readFileSync(
    path.join(stateRoot, `domains/etf_detail/generations/${active.transaction_id}/current.json`),
    "utf8",
  ));
  return { stateRoot, active, selection: current[ticker] };
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-etf-daily1y-readiness-"));
const fixtureGeneratedAt = "2026-07-09T00:00:00.000Z";
writeFixture(fixtureRoot, "data/computed/fenok_etf_signals_summary.json", { rows: [{ ticker: "AAA" }] });
writeFixture(fixtureRoot, "data/stockanalysis/backfill/history_gap_report_latest.json", {
  generated_at: fixtureGeneratedAt,
  classification_as_of: fixtureGeneratedAt,
  required_history_periods: ["daily_1y"],
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: fixtureGeneratedAt,
    classification_as_of: fixtureGeneratedAt,
  },
  daily_1y_gap: {
    scored_etfs: {
      scored_etf_count: 1,
      complete: 1,
      fetchable: 0,
      inception_limited: 0,
      terminal_limited: 0,
      classification_projection: daily1yClassificationProjection({ complete: [{ ticker: "AAA" }] }),
    },
  },
  recommended_dispatch: null,
});
writeFixture(fixtureRoot, "data/stockanalysis/etfs/AAA.json", {
  schema_version: "stockanalysis/v1",
  ticker: "AAA",
  asset_type: "etf",
  source: "stockanalysis",
  normalized: { history_periods: { daily_1y: weekdayRows(200, "2025-09-01") } },
});
writeFixture(fixtureRoot, "data/admin/fenok-edge-coverage-index.json", {
  public_scoring_readiness: {
    tracks: [{
      id: "etf_scoring_lane",
      stage: "PUBLIC",
      requirements: { public: true, daily: true, gated: true },
      evidence_based_readiness: {
        classification_as_of: fixtureGeneratedAt,
        public_ready: true,
        daily_ready: true,
        gated_ready: true,
        counts: {
          scored_public_etf: 1,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 0,
          terminal_limited_daily_1y_gap: 0,
        },
        daily_checks: [{
          id: "etf_no_fetchable_daily_1y_gap",
          classification_as_of: fixtureGeneratedAt,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 0,
          terminal_limited_daily_1y_gap: 0,
        }],
      },
    }],
  },
});

assert.equal(etfInceptionDate(recentYahooFallback).toISOString().slice(0, 10), "2026-06-01");
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).inceptionLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).fetchable, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).inceptionLimited, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimitSource, "stockanalysis_recent_short_rows");
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimitSource, "provider_rejected_non_etf");

const denseRecentRows = weekdayRows(25, "2026-06-01");
const denseRecentYfRows = weekdayRows(25, "2026-06-02");
const primaryNullInception = {
  asset_type: "etf",
  source: "stockanalysis",
  fetched_at: "2026-07-01T00:00:00Z",
  normalized: { overview: {}, history_periods: { daily_1y: denseRecentRows } },
};
const primaryStaleDeclared = {
  ...primaryNullInception,
  normalized: {
    overview: { inception: "Jan 1, 2020" },
    history_periods: { daily_1y: denseRecentRows },
  },
};
const corroboratedRecent = classifyDaily1yGap(
  primaryNullInception,
  currentNow,
  null,
  denseRecentYfRows,
);
assert.deepEqual(corroboratedRecent.inceptionLimited, ["daily_1y"]);
assert.equal(corroboratedRecent.classificationReason, "inception_limited_observation_derived");
assert.equal(corroboratedRecent.classificationEvidence.cross_provider_start_confirmed, true);
assert.equal(corroboratedRecent.inceptionDate, "2026-06-01");

const staleDeclaredConversion = classifyDaily1yGap(
  primaryStaleDeclared,
  currentNow,
  null,
  denseRecentYfRows,
);
assert.deepEqual(staleDeclaredConversion.terminalLimited, ["daily_1y"]);
assert.equal(staleDeclaredConversion.terminalLimitSource, "provider_history_start_limited");
assert.equal(staleDeclaredConversion.classificationEvidence.declared_inception_date, "2020-01-01");
assert.equal(staleDeclaredConversion.classificationEvidence.effective_start_date, "2026-06-01");

const unconfirmedRecent = classifyDaily1yGap(primaryNullInception, currentNow);
assert.deepEqual(unconfirmedRecent.fetchable, ["daily_1y"]);
assert.equal(unconfirmedRecent.classificationReason, "unconfirmed_short_history");

const stableRecent = classifyDaily1yGap(
  primaryNullInception,
  currentNow,
  {
    stable_observation_count: 2,
    short_history_evidence: { earliest_date: "2026-06-01" },
  },
);
assert.deepEqual(stableRecent.inceptionLimited, ["daily_1y"]);
assert.equal(stableRecent.classificationEvidence.stable_observation_confirmed, true);

const mismatchedStable = classifyDaily1yGap(
  primaryNullInception,
  currentNow,
  {
    stable_observation_count: 2,
    short_history_evidence: { earliest_date: "2026-06-15" },
  },
);
assert.deepEqual(mismatchedStable.fetchable, ["daily_1y"]);
assert.equal(mismatchedStable.classificationEvidence.stable_observation_confirmed, false);

const rollingStable = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: weekdayRows(25, "2026-06-03") } },
}, currentNow, {
  stable_observation_count: 2,
  confirmed_history_start_date: "2026-05-04",
  short_history_evidence: { earliest_date: "2026-06-03" },
});
assert.deepEqual(rollingStable.inceptionLimited, ["daily_1y"]);
assert.equal(rollingStable.inceptionDate, "2026-05-04");
assert.equal(rollingStable.classificationEvidence.stable_observation_pinned_start, "2026-05-04");

const providerTruncated = classifyDaily1yGap(
  primaryNullInception,
  currentNow,
  null,
  weekdayRows(200, "2025-01-03"),
);
assert.deepEqual(providerTruncated.fetchable, ["daily_1y"]);
assert.equal(providerTruncated.classificationReason, "provider_truncated_suspected");
assert.equal(providerTruncated.classificationEvidence.provider_truncation_suspected, true);

const providerTruncated47h = classifyDaily1yGap({
  ...primaryNullInception,
  fetched_at: "2026-07-07T01:00:00Z",
}, currentNow, null, weekdayRows(200, "2025-01-03"));
const providerTruncated49h = classifyDaily1yGap({
  ...primaryNullInception,
  fetched_at: "2026-07-06T23:00:00Z",
}, currentNow, null, weekdayRows(200, "2025-01-03"));
assert.deepEqual(providerTruncated47h.terminalLimited, ["daily_1y"]);
assert.equal(providerTruncated47h.terminalLimitSource, "provider_truncated_suspected");
assert.deepEqual(providerTruncated49h.fetchable, ["daily_1y"]);

const successfulShortCooldown = {
  failure_class: "successful_short_history",
  failure_reason: "successful StockAnalysis primary fetch still has short daily_1y history",
  last_attempt_utc: "2026-07-03T00:00:00Z",
  next_attempt_after_utc: "2026-07-10T00:00:00Z",
};
const providerTruncated6d = classifyDaily1yGap({
  ...primaryNullInception,
  fetched_at: "2026-07-03T00:00:00Z",
}, currentNow, successfulShortCooldown, weekdayRows(200, "2025-01-03"));
const providerTruncated8d = classifyDaily1yGap({
  ...primaryNullInception,
  fetched_at: "2026-07-01T00:00:00Z",
}, currentNow, {
  ...successfulShortCooldown,
  last_attempt_utc: "2026-07-01T00:00:00Z",
  next_attempt_after_utc: "2026-07-08T00:00:00Z",
}, weekdayRows(200, "2025-01-03"));
assert.deepEqual(providerTruncated6d.terminalLimited, ["daily_1y"]);
assert.equal(providerTruncated6d.terminalLimitSource, "provider_truncated_suspected");
assert.deepEqual(providerTruncated8d.fetchable, ["daily_1y"]);
const genericSuccessfulCooldown = classifyDaily1yGap({
  ...primaryNullInception,
  fetched_at: "2026-07-03T00:00:00Z",
}, currentNow, successfulShortCooldown);
assert.deepEqual(genericSuccessfulCooldown.terminalLimited, ["daily_1y"]);
assert.equal(genericSuccessfulCooldown.terminalLimitSource, "successful_short_history_cooldown");

const sparseFullSpanRows = [
  ...weekdayRows(95, "2025-07-07"),
  ...weekdayRows(95, "2026-02-25"),
];
const sparseFullSpan = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: sparseFullSpanRows } },
}, currentNow);
assert.deepEqual(sparseFullSpan.fetchable, ["daily_1y"]);
assert.equal(sparseFullSpan.classificationReason, "full_span_sparse_history");
assert.equal(sparseFullSpan.classificationEvidence.daily_1y_evidence_pass, false);

const tinyDense = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: weekdayRows(12, "2026-06-23") } },
}, currentNow, null, weekdayRows(12, "2026-06-23"));
assert.deepEqual(tinyDense.fetchable, ["daily_1y"]);
assert.equal(tinyDense.classificationEvidence.daily_1y_evidence_pass, false);

const staleLatest = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: weekdayRows(25, "2026-04-01") } },
}, currentNow, null, weekdayRows(25, "2026-04-01"));
assert.deepEqual(staleLatest.fetchable, ["daily_1y"]);
assert.equal(staleLatest.classificationEvidence.daily_1y_evidence_pass, false);

const futureDeclared = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: {
    overview: { inception: "Aug 1, 2026" },
    history_periods: { daily_1y: denseRecentRows },
  },
}, currentNow, null, denseRecentYfRows);
assert.deepEqual(futureDeclared.inceptionLimited, ["daily_1y"]);
assert.equal(futureDeclared.classificationEvidence.declared_inception_invalid_future, true);

const boundaryRows = weekdayRows(25, "2026-06-01");
const boundary364 = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: boundaryRows } },
}, currentNow, {
  stable_observation_count: 2,
  confirmed_history_start_date: "2025-07-10",
});
const boundary365 = classifyDaily1yGap({
  ...primaryNullInception,
  normalized: { overview: {}, history_periods: { daily_1y: boundaryRows } },
}, currentNow, {
  stable_observation_count: 2,
  confirmed_history_start_date: "2025-07-09",
});
assert.deepEqual(boundary364.inceptionLimited, ["daily_1y"]);
assert.deepEqual(boundary365.fetchable, ["daily_1y"]);

const parityPayload = (rows, inception = null, extra = {}) => ({
  asset_type: "etf",
  source: "stockanalysis",
  ...extra,
  normalized: {
    overview: inception ? { inception } : {},
    history_periods: { daily_1y: rows },
  },
});
const parityCases = [
  { id: "dense_unconfirmed", payload: parityPayload(denseRecentRows) },
  { id: "dense_cross_provider", payload: parityPayload(denseRecentRows), yf_rows: denseRecentYfRows },
  { id: "declared_accurate", payload: parityPayload(denseRecentRows, "Jun 1, 2026") },
  { id: "declared_stale", payload: parityPayload(denseRecentRows, "Jan 1, 2020"), yf_rows: denseRecentYfRows },
  { id: "declared_future", payload: parityPayload(denseRecentRows, "Aug 1, 2026"), yf_rows: denseRecentYfRows },
  { id: "sparse_full_span", payload: parityPayload(sparseFullSpanRows) },
  {
    id: "provider_truncated",
    payload: parityPayload(denseRecentRows),
    yf_rows: weekdayRows(200, "2025-01-03"),
  },
  {
    id: "stable_nested",
    payload: parityPayload(denseRecentRows),
    pending_entry: {
      stable_observation_count: 2,
      short_history_evidence: { earliest_date: "2026-06-01" },
    },
  },
  {
    id: "rolling_pinned",
    payload: parityPayload(weekdayRows(25, "2026-06-03")),
    pending_entry: {
      stable_observation_count: 2,
      confirmed_history_start_date: "2026-05-04",
      short_history_evidence: { earliest_date: "2026-06-03" },
    },
  },
  { id: "tiny", payload: parityPayload(weekdayRows(12, "2026-06-23")) },
  { id: "stale_latest", payload: parityPayload(weekdayRows(25, "2026-04-01")) },
  { id: "tiny_declared", payload: parityPayload(weekdayRows(1, "2026-06-23"), "Jun 23, 2026") },
  { id: "stale_declared", payload: parityPayload(weekdayRows(25, "2026-04-01"), "Apr 1, 2026") },
  { id: "impossible_declared", payload: parityPayload(denseRecentRows, "Feb 30, 2026"), yf_rows: denseRecentYfRows },
  { id: "invalid_history_date", payload: parityPayload([...denseRecentRows, { date: "2026-02-30" }]) },
  {
    id: "offset_timestamps",
    payload: parityPayload(denseRecentRows.map((row) => ({
      ...row,
      date: `${row.date}T23:00:00-05:00`,
    }))),
  },
  { id: "duplicate_200", payload: parityPayload(Array.from({ length: 200 }, () => ({ date: "2026-06-01" }))) },
  {
    id: "self_authoritative",
    payload: parityPayload(denseRecentRows, null, {
      source: "yahoo_finance",
      source_provider: "yahoo_finance",
      detail_status: "yf_fallback",
    }),
  },
  {
    id: "tiny_self_authoritative",
    payload: parityPayload(weekdayRows(12, "2026-06-23"), null, {
      source: "yahoo_finance",
      source_provider: "yahoo_finance",
      detail_status: "yf_fallback",
    }),
  },
  {
    id: "stale_self_authoritative",
    payload: parityPayload(weekdayRows(25, "2026-04-01"), null, {
      source: "yahoo_finance",
      source_provider: "yahoo_finance",
      detail_status: "yf_fallback",
    }),
  },
];
const jsParity = parityCases.map((testCase) => {
  const gap = classifyDaily1yGap(
    testCase.payload,
    currentNow,
    testCase.pending_entry ?? null,
    testCase.yf_rows ?? [],
  );
  const evidence = gap.classificationEvidence ?? {};
  return {
    id: testCase.id,
    bucket: classificationBucket(gap),
    reason: gap.classificationReason,
    effective_start_date: gap.inceptionDate,
    effective_start_source: evidence.effective_start_source,
    declared_valid: evidence.declared_inception_valid,
    declared_invalid_future: evidence.declared_inception_invalid_future,
    provider_truncated: evidence.provider_truncation_suspected,
    stable_confirmed: evidence.stable_observation_confirmed,
    stable_pinned_start: evidence.stable_observation_pinned_start,
    valid_unique_date_count: evidence.daily_1y_valid_unique_date_count,
    earliest_observation: evidence.daily_1y_earliest_observation,
    latest_observation: evidence.daily_1y_latest_observation,
    density: evidence.daily_1y_density,
    evidence_pass: evidence.daily_1y_evidence_pass,
  };
});
const pythonParity = pythonDaily1yClassifications(parityCases);
assert.deepEqual(pythonParity.policy, DAILY_1Y_HISTORY_EVIDENCE_POLICY);
assert.deepEqual(pythonParity.rows, jsParity);
const duplicate200 = classifyDaily1yGap(parityCases.find((row) => row.id === "duplicate_200").payload, currentNow);
assert.equal(duplicate200.complete, false);
assert.equal(duplicate200.actualRows, 1);
assert.deepEqual(duplicate200.fetchable, ["daily_1y"]);

const denseEvidence = daily1ySeriesEvidence(denseRecentRows, currentNow);
assert.equal(denseEvidence.evidence_pass, true);
assert.ok(denseEvidence.density >= 0.8);
assert.ok(denseEvidence.max_internal_gap_days <= 3);
assert.equal(
  daily1yClassificationProjection({
    complete: [{ ticker: "AAA" }],
    fetchable: [{ ticker: "BBB", classification_reason: "unconfirmed_short_history" }],
  }).row_count,
  2,
);

const boundaryPayload = {
  ...recentStockAnalysisShortRows,
  fetched_at: "2026-07-10T00:00:00.000Z",
};
const boundaryPending = {
  last_attempt_utc: "2026-07-10T00:00:00.000Z",
  failure_reason: "HTTP Error 500: transient upstream failure",
};
const justUnder48h = new Date("2026-07-11T23:59:56.400Z");
const exactly48h = new Date("2026-07-12T00:00:00.000Z");
const justOver48h = new Date("2026-07-12T00:00:00.001Z");
assert.deepEqual(classifyDaily1yGap(boundaryPayload, justUnder48h).terminalLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(boundaryPayload, exactly48h).terminalLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(boundaryPayload, justOver48h).fetchable, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, justUnder48h, boundaryPending).terminalLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, exactly48h, boundaryPending).terminalLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, justOver48h, boundaryPending).fetchable, ["daily_1y"]);

const payload = buildEtfDaily1yReadiness({ rootDir: fixtureRoot, now: currentNow });
const plan = payload.fetchable_plan;
const readiness = payload.daily_1y_readiness;
const breakdownTotal = Object.values(readiness.fetchable_breakdown?.counts || readiness.fetchable_breakdown || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);
const planBreakdownTotal = Object.values(plan.fetchable_breakdown?.counts || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);

assert.equal(payload.ok, true, JSON.stringify(payload.errors));
assert.equal(payload.classification_as_of, fixtureGeneratedAt);
assert.equal(plan.classification_as_of, fixtureGeneratedAt);
assert.ok(readiness.denominator > 0);
assert.equal(
  readiness.daily_1y_complete
    + readiness.daily_1y_fetchable
    + readiness.inception_limited_daily_1y_gap
    + readiness.terminal_limited_daily_1y_gap,
  readiness.denominator,
);
assert.equal(
  readiness.daily_1y_missing,
  readiness.daily_1y_fetchable
    + readiness.inception_limited_daily_1y_gap
    + readiness.terminal_limited_daily_1y_gap,
);
assert.equal(readiness.count_equation_ok, true);
assert.equal(breakdownTotal, readiness.daily_1y_fetchable);
assert.equal(payload.public_done_claim_allowed, true);
assert.equal(payload.readiness_status, "ready");

assert.equal(Object.keys(payload).includes("fetchable_plan"), false);
assert.equal(payload.exact_fetchable_plan.fetchable_count, readiness.daily_1y_fetchable);
assert.equal(payload.exact_fetchable_plan.can_drive_bounded_ticker_batches, true);
assert.equal(payload.exact_fetchable_plan.batch_count, Math.ceil(readiness.daily_1y_fetchable / 120));

assert.equal(plan.counts.scored_etf_count, readiness.denominator);
assert.equal(plan.counts.complete, readiness.daily_1y_complete);
assert.equal(plan.counts.fetchable, readiness.daily_1y_fetchable);
assert.equal(plan.counts.inception_limited, readiness.inception_limited_daily_1y_gap);
assert.equal(plan.counts.terminal_limited, readiness.terminal_limited_daily_1y_gap);
assert.equal(plan.counts.missing, readiness.daily_1y_missing);
assert.equal(plan.counts.equation_ok, true);
assert.equal(typeof plan.counts.matches_history_gap_report, "boolean");
assert.equal(plan.counts.matches_coverage_index, true);
assert.equal(plan.counts.matches_coverage_index_daily_check, true);
assert.equal(plan.counts.history_gap_classification_clock_match, true);
assert.equal(plan.counts.coverage_index_classification_clock_match, true);
assert.equal(plan.counts.coverage_index_daily_check_classification_clock_match, true);
assert.equal(plan.tickers.length, readiness.daily_1y_fetchable);
assert.equal(new Set(plan.tickers).size, readiness.daily_1y_fetchable);
assert.deepEqual(plan.tickers, [...plan.tickers].sort());
assert.equal(planBreakdownTotal, readiness.daily_1y_fetchable);

assert.equal(plan.bounded_batches.can_drive_bounded_ticker_batches, true);
assert.equal(plan.bounded_batches.default_batch_size, 120);
assert.equal(plan.bounded_batches.batch_count, Math.ceil(readiness.daily_1y_fetchable / 120));
assert.equal(plan.bounded_batches.first_batch_tickers.length, Math.min(120, readiness.daily_1y_fetchable));

assert.equal(plan.yf_local_crosscheck.matches_exact_fetchable_selector, false);
assert.ok(plan.yf_local_crosscheck.missing_or_lt_min_rows > plan.counts.fetchable);

const fixtureCoveragePath = path.join(fixtureRoot, "data/admin/fenok-edge-coverage-index.json");
const fixtureCoverage = JSON.parse(fs.readFileSync(fixtureCoveragePath, "utf8"));
fixtureCoverage.public_scoring_readiness.tracks[0].evidence_based_readiness.classification_as_of = "2026-07-08T23:59:59.000Z";
writeFixture(fixtureRoot, "data/admin/fenok-edge-coverage-index.json", fixtureCoverage);
const coverageClockMismatch = buildEtfDaily1yReadiness({ rootDir: fixtureRoot, now: currentNow });
assert.equal(coverageClockMismatch.ok, false);
assert.equal(coverageClockMismatch.public_done_claim_allowed, false);
assert.equal(coverageClockMismatch.readiness_status, "not_ready");
assert.equal(coverageClockMismatch.fetchable_plan.counts.coverage_index_classification_clock_match, false);
assert.equal(coverageClockMismatch.fetchable_plan.bounded_batches.can_drive_bounded_ticker_batches, false);

fixtureCoverage.public_scoring_readiness.tracks[0].evidence_based_readiness.classification_as_of = fixtureGeneratedAt;
writeFixture(fixtureRoot, "data/admin/fenok-edge-coverage-index.json", fixtureCoverage);
const fixtureHistoryPath = path.join(fixtureRoot, "data/stockanalysis/backfill/history_gap_report_latest.json");
const fixtureHistory = JSON.parse(fs.readFileSync(fixtureHistoryPath, "utf8"));
fixtureHistory.daily_1y_gap.scored_etfs.complete = 0;
writeFixture(fixtureRoot, "data/stockanalysis/backfill/history_gap_report_latest.json", fixtureHistory);
const historyCountMismatch = buildEtfDaily1yReadiness({ rootDir: fixtureRoot, now: currentNow });
assert.equal(historyCountMismatch.ok, false);
assert.equal(historyCountMismatch.public_done_claim_allowed, false);
assert.equal(historyCountMismatch.readiness_status, "not_ready");
assert.equal(historyCountMismatch.fetchable_plan.counts.matches_history_gap_report, false);
assert.ok(historyCountMismatch.errors.some((error) => error.id === "fetchable_plan_history_gap_report_match"));

fs.rmSync(fixtureRoot, { recursive: true, force: true });

const effectiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-etf-effective-detail-"));
seedR2State(effectiveRoot, [
  { ticker: "FBC", fetched_at: "2026-07-10T00:00:00Z", history: dailyRows(200) },
  { ticker: "FBI", fetched_at: "2026-07-01T00:00:00Z", history: weekdayRows(25, "2026-06-01") },
  { ticker: "PRI", fetched_at: "2026-07-10T00:00:00Z", history: weekdayRows(25, "2026-06-01") },
  { ticker: "UNAV", fetched_at: "2026-06-18T00:00:00Z", history: dailyRows(200) },
]);
const completePrimary = {
  schema_version: "stockanalysis/v1",
  ticker: "PRI",
  asset_type: "etf",
  source: "stockanalysis",
  normalized: { history_periods: { daily_1y: dailyRows(200) } },
};
writeFixture(effectiveRoot, "data/stockanalysis/etfs/PRI.json", completePrimary);
writeFixture(effectiveRoot, "data/yf/etf-details/MISS.json", {
  schema_version: "yf-etf-detail/v1",
  ticker: "MISS",
  asset_type: "etf",
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: { history_periods: { daily_1y: dailyRows(200) } },
});

const effectiveReader = createEffectiveEtfDetailReader({ rootDir: effectiveRoot });
assert.equal(effectiveReader.resolve("PRI").sourceKind, "r2_active_selection");
assert.equal(effectiveReader.resolve("PRI").payload.source_provider, "yahoo_finance");
assert.equal(effectiveReader.resolve("PRI").primaryPresent, false);
assert.equal(effectiveReader.resolve("FBC").sourceKind, "r2_active_selection");
assert.equal(effectiveReader.resolve("FBC").payload.detail_status, "yf_fallback");
assert.equal(effectiveReader.resolve("UNAV").status, "unavailable");
assert.equal(effectiveReader.resolve("UNAV").payload, null);
assert.equal(effectiveReader.resolve("MISS").status, "missing");
assert.equal(effectiveReader.resolve("MISS").payload, null);
assert.deepEqual(effectiveReader.listSelectedTickers(), ["FBC", "FBI", "PRI"]);

for (const [caseName, mutateObject, expectedPattern] of [
  ["corrupt", (objectPath) => fs.appendFileSync(objectPath, " "), /payload digest mismatch/],
  ["missing", (objectPath) => fs.rmSync(objectPath), /payload is missing|read failed/],
]) {
  const badRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fenok-etf-effective-${caseName}-`));
  seedR2State(badRoot, [
    { ticker: "BAD", fetched_at: "2026-07-10T00:00:00Z", history: dailyRows(200) },
  ]);
  const bad = activeSelection(badRoot, "BAD");
  mutateObject(path.join(bad.stateRoot, bad.selection.payload_ref.path));
  const badReader = createEffectiveEtfDetailReader({ rootDir: badRoot });
  assert.throws(
    () => badReader.resolve("BAD"),
    (error) => error instanceof EffectiveEtfDetailIntegrityError && expectedPattern.test(error.message),
  );
  fs.rmSync(badRoot, { recursive: true, force: true });
}

writeFixture(effectiveRoot, "data/computed/fenok_etf_signals_summary.json", {
  rows: ["FBC", "FBI", "PRI", "UNAV"].map((ticker) => ({ ticker })),
});
const effectiveNextRoot = path.join(effectiveRoot, "100xfenok-next");
fs.mkdirSync(effectiveNextRoot, { recursive: true });
const reportRun = spawnSync(
  process.execPath,
  [historyGapScript, "--write-report", "--required-history-periods", "daily_1y"],
  { cwd: effectiveNextRoot, encoding: "utf8" },
);
assert.equal(reportRun.status, 0, reportRun.stderr || reportRun.stdout);
const effectiveHistoryGap = JSON.parse(fs.readFileSync(
  path.join(effectiveRoot, "data/stockanalysis/backfill/history_gap_report_latest.json"),
  "utf8",
));
const effectiveScored = effectiveHistoryGap.daily_1y_gap.scored_etfs;
assert.deepEqual(
  {
    scored_etf_count: effectiveScored.scored_etf_count,
    complete: effectiveScored.complete,
    fetchable: effectiveScored.fetchable,
    inception_limited: effectiveScored.inception_limited,
    terminal_limited: effectiveScored.terminal_limited,
  },
  { scored_etf_count: 4, complete: 1, fetchable: 0, inception_limited: 2, terminal_limited: 1 },
);
assert.deepEqual(effectiveScored.samples.fetchable, []);
assert.equal(
  effectiveScored.samples.inception_limited.find((row) => row.ticker === "PRI")?.detail_source_kind,
  "r2_active_selection",
);
assert.deepEqual(effectiveScored.samples.terminal_limited.map((row) => row.ticker), ["UNAV"]);
assert.equal(effectiveScored.samples.terminal_limited[0].daily_1y_gap_source, "data_supply_unavailable");

writeFixture(effectiveRoot, "data/admin/fenok-edge-coverage-index.json", {
  public_scoring_readiness: {
    tracks: [{
      id: "etf_scoring_lane",
      stage: "PUBLIC",
      requirements: { public: true, daily: true, gated: true },
      evidence_based_readiness: {
        classification_as_of: effectiveHistoryGap.classification_as_of,
        public_ready: true,
        daily_ready: true,
        gated_ready: true,
        counts: {
          scored_public_etf: 4,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 2,
          terminal_limited_daily_1y_gap: 1,
        },
        daily_checks: [{
          id: "etf_no_fetchable_daily_1y_gap",
          classification_as_of: effectiveHistoryGap.classification_as_of,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 2,
          terminal_limited_daily_1y_gap: 1,
        }],
      },
    }],
  },
});
const effectiveReadiness = buildEtfDaily1yReadiness({
  rootDir: effectiveRoot,
  now: new Date(Date.parse(effectiveHistoryGap.generated_at) + 7 * 60_000),
});
const effectivePlan = effectiveReadiness.fetchable_plan;
assert.equal(effectiveReadiness.ok, true);
assert.equal(effectiveReadiness.classification_as_of, effectiveHistoryGap.classification_as_of);
assert.equal(effectivePlan.classification_as_of, effectiveHistoryGap.classification_as_of);
assert.ok(Date.parse(effectiveReadiness.generated_at) > Date.parse(effectiveHistoryGap.generated_at));
assert.deepEqual(
  {
    complete: effectivePlan.counts.complete,
    fetchable: effectivePlan.counts.fetchable,
    inception_limited: effectivePlan.counts.inception_limited,
    terminal_limited: effectivePlan.counts.terminal_limited,
  },
  {
    complete: effectiveScored.complete,
    fetchable: effectiveScored.fetchable,
    inception_limited: effectiveScored.inception_limited,
    terminal_limited: effectiveScored.terminal_limited,
  },
);
assert.deepEqual(effectivePlan.tickers, []);
assert.equal(effectivePlan.counts.matches_history_gap_report, true);
assert.equal(effectivePlan.counts.matches_coverage_index, true);
assert.equal(effectivePlan.counts.matches_coverage_index_daily_check, true);
assert.equal(effectivePlan.classification_evidence.row_count, 2);
for (const row of effectivePlan.classification_evidence.rows) {
  assert.equal(Object.hasOwn(row, "daily_1y_classification"), false);
  for (const key of [
    "ticker",
    "classification_bucket",
    "classification_reason",
    "payload_fetched_at",
    "classification_as_of",
    "declared_inception_date",
    "declared_inception_source_field",
    "daily_1y_earliest_observation",
    "daily_1y_latest_observation",
    "daily_1y_density",
    "effective_start_date",
    "effective_start_source",
    "provider_truncation_suspected",
  ]) assert.equal(Object.hasOwn(row, key), true, `${row.ticker} missing ${key}`);
}

fs.rmSync(effectiveRoot, { recursive: true, force: true });
console.log("test-write-fenok-etf-daily1y-readiness: ok");
