#!/usr/bin/env node
// P2 — append-only input archival for the live FENO Index RIM inputs.
// Archives the exact live source semantics: FY1/FY2/FY3 consensus path, both payout routes
// with yield observations, and the live Damodaran country-premium ERP. Append-only; dedup by
// stable key (source_class + source_as_of + derived_hash); a revision is a new vintage with
// provenance, never a silent replacement. Current live readers keep resolving the latest valid
// vintage from the live files — this archive is a history estate, not the reader.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const ARCHIVE_DIR = path.join(dataRoot, "computed", "rim-index", "archive");
const LIVE = {
  stockAction: path.join(dataRoot, "computed", "stock_action_index.json"),
  spxYield: path.join(dataRoot, "slickcharts", "sp500-yield.json"),
  ndxYield: path.join(dataRoot, "slickcharts", "nasdaq100-yield.json"),
  erp: path.join(dataRoot, "damodaran", "erp.json"),
  benchmarks: path.join(dataRoot, "benchmarks", "us.json"),
};

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function loadHistory(name, archiveDir = ARCHIVE_DIR) {
  const p = path.join(archiveDir, name);
  return fs.existsSync(p) ? readJson(p) : [];
}
function round(x, d = 4) { return Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : x; }

// The dedup key must hash ONLY the economic content of an observation. Collection timestamps and
// whole-file hashes belong in the record as provenance, never in the key: a scrape that changes
// nothing but its own timestamp would otherwise mint a "revision" on every refresh, and an
// append-only archive that appends an identical observation forever is not deduplicating at all.
function economicHash(projection) {
  return crypto.createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

// ---- forecast vintage: FY1/FY2/FY3 consensus path per index ----
function buildForecastVintage(inputsPayload) {
  const collectedAt = new Date().toISOString();
  const entries = [];
  for (const idx of ["SPX", "NDX"]) {
    const entry = inputsPayload.indices[idx];
    const grid = entry?.derived?.forecast_grid_v1;
    // Skipping an index here would archive a one-index vintage as if it were a genuine
    // observation, and the next healthy run would append again — a fabricated revision. Fail
    // the lane instead; a gap in the source is not a new vintage.
    if (!grid?.periods) {
      throw new Error(`forecast lane: ${idx} has no forecast_grid_v1 periods; refusing to archive a partial observation`);
    }
    const eps = grid.periods.map((p) => p.earnings_proxy?.value ?? null);
    const growth = grid.periods.map((p) => p.eps_growth?.value ?? null);
    entries.push({
      index: idx,
      fy1: round(eps[0], 4), fy2: round(eps[1], 4), fy3: round(eps[2], 4),
      eps_growth: growth.map((g) => round(g, 6)),
      coverage: grid.coverage ?? null,
      label: "PROXY-free live forecast path (forecast_grid_v1)",
    });
  }
  const rawHash = sha256File(LIVE.stockAction);
  const derivedHash = crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const sourceAsOf = (() => {
    const sa = readJson(LIVE.stockAction);
    return sa.source_date ?? sa.updated ?? sa.generated_at ?? null;
  })();
  return {
    vintage_id: null, // set on append
    kind: "forecast",
    collected_at: collectedAt,
    source_as_of: sourceAsOf,
    source_class: "stock_action_index.json forecast_grid_v1 consensus path (live semantics)",
    raw_source_hash: rawHash,
    derived_aggregate_hash: derivedHash,
    entries,
  };
}

// ---- payout vintage: both routes + underlying yield observations ----
export function buildPayoutVintage(inputsPayload, { yieldFiles } = {}) {
  const files = yieldFiles ?? { SPX: LIVE.spxYield, NDX: LIVE.ndxYield };
  const collectedAt = new Date().toISOString();
  const entries = [];
  for (const idx of ["SPX", "NDX"]) {
    const entry = inputsPayload.indices[idx];
    const routeA = entry?.derived?.payout_ratio;
    const routeB = entry?.derived?.legacy_payout_ratio_qa;
    const yieldFile = files[idx];
    const y = readJson(yieldFile);
    if (!Number.isFinite(routeA?.value) || !Number.isFinite(routeB?.value)) {
      throw new Error(`payout lane: ${idx} is missing a payout route; refusing to archive a partial observation`);
    }
    entries.push({
      index: idx,
      payout_route_a: round(routeA.value, 6),
      payout_route_b: round(routeB.value, 6),
      payout_route_a_formula: routeA?.formula ?? null,
      payout_route_b_formula: routeB?.formula ?? null,
      yield_observation: { yield_pct: y.yield ?? null, updated: y.updated ?? null, source: y.source ?? null },
      yield_file: path.relative(dataRoot, yieldFile),
      yield_source_hash: sha256File(yieldFile),
    });
  }
  return {
    vintage_id: null,
    kind: "payout",
    collected_at: collectedAt,
    // The SlickCharts yield files carry only a scrape timestamp, never a provider source date.
    // Naming that timestamp source_as_of would make every scrape a new economic as-of.
    source_as_of: null,
    source_as_of_kind: "collected_at — provider publishes no source date for the index yield observation",
    source_class: "slickcharts index yield files -> derived payout routes A (weighted) and B (index-level)",
    raw_source_hash: {
      sp500_yield: sha256File(files.SPX),
      nasdaq100_yield: sha256File(files.NDX),
    },
    derived_aggregate_hash: economicHash(entries.map((e) => ({
      index: e.index,
      payout_route_a: e.payout_route_a,
      payout_route_b: e.payout_route_b,
      yield_pct: e.yield_observation.yield_pct,
    }))),
    entries,
  };
}

// ---- ERP vintage: exact live source class (Damodaran country premium) ----
function buildErpVintage() {
  const erp = readJson(LIVE.erp);
  const collectedAt = new Date().toISOString();
  const us = erp.countries?.["United States"] ?? {};
  return {
    vintage_id: null,
    kind: "erp",
    collected_at: collectedAt,
    source_as_of: erp.metadata?.source_date ?? null,
    source_class: "Damodaran country-premium file (ctrypremApr26.xlsx / ERPs by country) — the exact live ERP source class",
    source_url: erp.metadata?.url ?? null,
    raw_source_hash: sha256File(LIVE.erp),
    derived_aggregate_hash: crypto.createHash("sha256").update(JSON.stringify({
      us_erp: us.equity_risk_premium, source_date: erp.metadata?.source_date,
    })).digest("hex"),
    value: { us_erp: round(us.equity_risk_premium, 6), source_date: erp.metadata?.source_date },
  };
}

export function stableKey(v) {
  return `${v.kind}|${v.source_as_of}|${v.derived_aggregate_hash}`;
}

export function appendVintage(historyName, vintage, { archiveDir = ARCHIVE_DIR } = {}) {
  const history = loadHistory(historyName, archiveDir);
  const key = stableKey(vintage);
  const existing = history.find((h) => h.stable_key === key);
  if (existing) {
    return { appended: false, deduped: true, vintage_id: existing.vintage_id, stable_key: key };
  }
  const vintageId = `${vintage.kind}-${vintage.collected_at.replace(/[:.]/g, "-")}-${vintage.derived_aggregate_hash.slice(0, 10)}`;
  const record = { ...vintage, vintage_id: vintageId, stable_key: key };
  history.push(record);
  // Write through a temp file and rename. appendVintage is a read-modify-write of the whole
  // history array and runs on a refresh cadence; a torn or interleaved write is the one failure
  // an append-only archive cannot absorb. rename() is atomic within a filesystem.
  const target = path.join(archiveDir, historyName);
  const tmp = `${target}.tmp-${process.pid}-${vintage.derived_aggregate_hash.slice(0, 8)}`;
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify(history, null, 1)}\n`, { flag: "wx" });
  fs.renameSync(tmp, target);
  return { appended: true, deduped: false, vintage_id: vintageId, stable_key: key, count: history.length };
}

export function archiveAll(inputsPayload, { archiveDir = ARCHIVE_DIR } = {}) {
  const results = {};
  results.forecast = appendVintage("forecast_history.json", buildForecastVintage(inputsPayload), { archiveDir });
  results.payout = appendVintage("payout_history.json", buildPayoutVintage(inputsPayload), { archiveDir });
  results.erp = appendVintage("erp_history.json", buildErpVintage(), { archiveDir });
  return results;
}

// Robust main-module check: string-comparing a file:// URL breaks on any path needing escaping
// (spaces, non-ASCII), which would silently turn this script into a no-op.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildRimIndexInputs } = await import("./build-rim-index.mjs");
  const payload = buildRimIndexInputs({ dataRootOverride: dataRoot });
  const results = archiveAll(payload);
  console.log(JSON.stringify(results, null, 1));
  for (const [k, r] of Object.entries(results)) {
    console.log(`${k}: ${r.appended ? `appended ${r.vintage_id}` : `deduped -> ${r.vintage_id}`} (${r.count ?? "?"} vintages)`);
  }
}
