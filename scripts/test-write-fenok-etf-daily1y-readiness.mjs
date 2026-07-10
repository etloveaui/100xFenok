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
  buildEtfDaily1yReadiness,
  classifyDaily1yGap,
  etfInceptionDate,
} from "./write-fenok-etf-daily1y-readiness.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const historyGapScript = path.resolve(scriptDir, "../100xfenok-next/scripts/report-stockanalysis-history-gap.mjs");

const currentNow = new Date("2026-07-09T00:00:00Z");
const recentYahooFallback = {
  source_provider: "yahoo_finance",
  detail_status: "yf_fallback",
  normalized: {
    history_periods: {
      daily_1y: [
        { date: "2026-05-06", Close: 25.4 },
        { date: "2026-07-08", Close: 25.7 },
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
        { date: "2025-01-03", Close: 20.1 },
        { date: "2026-07-08", Close: 25.7 },
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
  required_history_periods: ["daily_1y"],
  report_profile: {
    key: "daily_1y",
    required_history_periods: ["daily_1y"],
    generated_at: fixtureGeneratedAt,
  },
  daily_1y_gap: {
    scored_etfs: {
      scored_etf_count: 1,
      complete: 1,
      fetchable: 0,
      inception_limited: 0,
      terminal_limited: 0,
    },
  },
  recommended_dispatch: null,
});
writeFixture(fixtureRoot, "data/stockanalysis/etfs/AAA.json", {
  schema_version: "stockanalysis/v1",
  ticker: "AAA",
  asset_type: "etf",
  source: "stockanalysis",
  normalized: { history_periods: { daily_1y: Array.from({ length: 200 }, (_, index) => ({ date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`, Close: index + 1 })) } },
});
writeFixture(fixtureRoot, "data/admin/fenok-edge-coverage-index.json", {
  public_scoring_readiness: {
    tracks: [{
      id: "etf_scoring_lane",
      stage: "PUBLIC",
      requirements: { public: true, daily: true, gated: true },
      evidence_based_readiness: {
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
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 0,
          terminal_limited_daily_1y_gap: 0,
        }],
      },
    }],
  },
});

assert.equal(etfInceptionDate(recentYahooFallback).toISOString().slice(0, 10), "2026-05-06");
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentYahooFallback, currentNow).inceptionLimited, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).fetchable, ["daily_1y"]);
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow).inceptionLimited, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).fetchable, []);
assert.deepEqual(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(recentStockAnalysisShortRows, currentNow).terminalLimitSource, "stockanalysis_recent_short_rows");
assert.deepEqual(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimited, ["daily_1y"]);
assert.equal(classifyDaily1yGap(oldYahooFallback, currentNow, recentProviderFailure).terminalLimitSource, "provider_rejected_non_etf");

const payload = buildEtfDaily1yReadiness({ rootDir: fixtureRoot, now: currentNow });
const plan = payload.fetchable_plan;
const readiness = payload.daily_1y_readiness;
const breakdownTotal = Object.values(readiness.fetchable_breakdown?.counts || readiness.fetchable_breakdown || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);
const planBreakdownTotal = Object.values(plan.fetchable_breakdown?.counts || {})
  .reduce((sum, value) => sum + Number(value || 0), 0);

assert.equal(payload.ok, true);
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

fs.rmSync(fixtureRoot, { recursive: true, force: true });

const effectiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-etf-effective-detail-"));
seedR2State(effectiveRoot, [
  { ticker: "FBC", fetched_at: "2026-07-10T00:00:00Z", history: dailyRows(200) },
  { ticker: "FBI", fetched_at: "2026-07-01T00:00:00Z", history: dailyRows(5, "2026-06-01") },
  { ticker: "PRI", fetched_at: "2026-07-10T00:00:00Z", history: dailyRows(5, "2026-06-01") },
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
assert.equal(effectiveReader.resolve("PRI").sourceKind, "stockanalysis_primary");
assert.equal(effectiveReader.resolve("PRI").payload.source, "stockanalysis");
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
  { scored_etf_count: 4, complete: 2, fetchable: 0, inception_limited: 1, terminal_limited: 1 },
);
assert.deepEqual(effectiveScored.samples.fetchable, []);
assert.deepEqual(effectiveScored.samples.terminal_limited.map((row) => row.ticker), ["UNAV"]);
assert.equal(effectiveScored.samples.terminal_limited[0].daily_1y_gap_source, "data_supply_unavailable");

writeFixture(effectiveRoot, "data/admin/fenok-edge-coverage-index.json", {
  public_scoring_readiness: {
    tracks: [{
      id: "etf_scoring_lane",
      stage: "PUBLIC",
      requirements: { public: true, daily: true, gated: true },
      evidence_based_readiness: {
        daily_ready: true,
        gated_ready: true,
        counts: {
          scored_public_etf: 4,
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 1,
          terminal_limited_daily_1y_gap: 1,
        },
        daily_checks: [{
          id: "etf_no_fetchable_daily_1y_gap",
          fetchable_daily_1y_gap: 0,
          inception_limited_daily_1y_gap: 1,
          terminal_limited_daily_1y_gap: 1,
        }],
      },
    }],
  },
});
const effectiveReadiness = buildEtfDaily1yReadiness({
  rootDir: effectiveRoot,
  now: new Date(effectiveHistoryGap.generated_at),
});
const effectivePlan = effectiveReadiness.fetchable_plan;
assert.equal(effectiveReadiness.ok, true);
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

fs.rmSync(effectiveRoot, { recursive: true, force: true });
console.log("test-write-fenok-etf-daily1y-readiness: ok");
