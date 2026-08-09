#!/usr/bin/env node

// Owner-ordered current research line for FENO RIM upside — durable artifact.
//
// One place owns the combination of the two existing repo functions and the
// published floors:
//   - raw centers are imported unmodified from
//     buildCurrentYooLogicSharedInferredRanges (SPX, NDX, KOSPI, SOX) and
//     buildCurrentExtendedYooLogicProxyRanges (CCMP) in
//     fenok-rim-rule-calibration.mjs; no parameter refit, no re-derivation;
//   - published floors are loaded from
//     scripts/fixtures/fenok-rim-calibration-evidence.json by exact
//     evidence_id and parsed only to their percentage lower edge;
//   - selected = max(raw_center, floor) with the owner-ordered normalization
//     SPX < CCMP < NDX < SOXX < KOSPI, hard-validated (positive, unique,
//     strictly ordered, adjacent gaps >= 2 percentage points).
// No order projection: rows are never shifted to satisfy the ordering.
// This is an owner-constrained research line: exact_yoo=false, no public
// promotion, Yoo status NOT_IDENTIFIED, public surface QUARANTINED.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildCurrentYooLogicSharedInferredRanges,
  buildCurrentExtendedYooLogicProxyRanges,
} from "./fenok-rim-rule-calibration.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/computed/rim-index/FENO_RIM_OWNER_ORDERED_CURRENT.json");

export const OWNER_ORDER = Object.freeze(["SPX", "CCMP", "NDX", "SOXX", "KOSPI"]);
export const MIN_ADJACENT_GAP = 0.02;

// evidence_id -> per-row parse notes. Floors themselves are never restated as
// numbers here; they are read from the fixture and parsed at runtime.
const FLOOR_EVIDENCE = Object.freeze({
  SPX: Object.freeze({ evidence_id: "rim-ccea4d31accf70a35d5a095e", parse_note: "lower edge of 19~29" }),
  CCMP: Object.freeze({
    evidence_id: "rim-694e999c6f76b4d205ede3c2",
    parse_note: "fixture asset is NASDAQ; CCMP mapping is FENO_MAPPING, not independently explicit",
  }),
  NDX: Object.freeze({ evidence_id: "rim-00269321d964013833efea9f", parse_note: "minimum of 36%" }),
  SOXX: Object.freeze({ evidence_id: "rim-1d69c85650aa0c41e37616c7", parse_note: "63%" }),
  KOSPI: Object.freeze({ evidence_id: "rim-7041d3d1604bd6d9b5683c04", parse_note: "published 49.5" }),
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function finite(value) {
  return Number.isFinite(value);
}

function parseFloor(rawValue) {
  const match = String(rawValue).match(/\d+(?:\.\d+)?/);
  if (!match) throw new Error(`cannot parse percentage floor from raw_value "${rawValue}"`);
  const percent = Number(match[0]);
  if (!finite(percent) || percent <= 0) throw new Error(`invalid percentage floor ${percent} from "${rawValue}"`);
  return percent / 100;
}

export function validateOwnerOrderedSelection(rows) {
  if (rows.length !== OWNER_ORDER.length) {
    throw new Error(`expected ${OWNER_ORDER.length} rows, got ${rows.length}`);
  }
  const byAsset = new Map(rows.map((row) => [row.asset, row]));
  const selected = [];
  for (const asset of OWNER_ORDER) {
    const row = byAsset.get(asset);
    if (!row) throw new Error(`missing row for ${asset}`);
    const value = row.selected;
    if (!finite(value) || value <= 0) {
      throw new Error(`${asset}: selected must be positive and finite, got ${value}`);
    }
    selected.push(value);
  }
  if (new Set(selected).size !== selected.length) {
    throw new Error("selected values must be distinct (no duplicates)");
  }
  for (let i = 1; i < selected.length; i += 1) {
    if (!(selected[i] > selected[i - 1])) {
      throw new Error(
        `selected not strictly ordered at ${OWNER_ORDER[i - 1]} -> ${OWNER_ORDER[i]}: ${selected[i - 1]} vs ${selected[i]}`,
      );
    }
  }
  for (let i = 1; i < selected.length; i += 1) {
    const gap = selected[i] - selected[i - 1];
    if (gap < MIN_ADJACENT_GAP - 1e-12) {
      throw new Error(
        `adjacent gap ${OWNER_ORDER[i - 1]} -> ${OWNER_ORDER[i]} is ${gap} (< ${MIN_ADJACENT_GAP})`,
      );
    }
  }
  return selected;
}

export function buildOwnerOrderedCurrent(root = ROOT, options = {}) {
  const shared = buildCurrentYooLogicSharedInferredRanges(root);
  const extended = buildCurrentExtendedYooLogicProxyRanges(root);
  const fixture = readJson(path.join(root, "scripts/fixtures/fenok-rim-calibration-evidence.json"));
  const input = readJson(path.join(root, "data/computed/rim-index/inputs.json"));
  const soxx = readJson(path.join(root, "data/yf/finance/SOXX.json"));
  const qqqFinal = readJson(path.join(root, "data/computed/rim-index/FENO_RIM_FINAL_CURRENT_QQQ.json"));

  const claims = new Map(fixture.claims.map((claim) => [claim.evidence_id, claim]));
  const sharedById = new Map(shared.rows.map((row) => [row.id, row]));
  const extendedById = new Map(extended.rows.map((row) => [row.id, row]));

  const modelRow = (asset) => {
    if (asset === "CCMP") {
      return { row: extendedById.get("CCMP"), source: "buildCurrentExtendedYooLogicProxyRanges" };
    }
    const id = asset === "SOXX" ? "SOX" : asset;
    return { row: sharedById.get(id), source: "buildCurrentYooLogicSharedInferredRanges" };
  };

  const rawCenterOf = (asset) => {
    const { row, source } = modelRow(asset);
    if (!row || row.status === "blocked") {
      throw new Error(`${asset}: model raw range unavailable (${row?.status ?? "missing"})`);
    }
    const center = row.price_context?.center_upside;
    if (!finite(center)) throw new Error(`${asset}: non-finite raw center`);
    return { center, source, status: row.status, identity_blockers: row.identity_blockers ?? [] };
  };

  const rows = OWNER_ORDER.map((asset, index) => {
    const { evidence_id, parse_note } = FLOOR_EVIDENCE[asset];
    const claim = claims.get(evidence_id);
    if (!claim) throw new Error(`missing evidence ${evidence_id} in fixture`);
    const floor = parseFloor(claim.raw_value);
    const { center: rawCenter, source: modelSource, status: modelStatus, identity_blockers } = rawCenterOf(asset);

    let spot;
    let spotAsOf;
    if (asset === "SOXX") {
      spot = soxx?.data?.fast_info?.lastPrice;
      spotAsOf = soxx.source_as_of;
      if (!finite(spot) || spot <= 0) {
        throw new Error("SOXX: full-precision lastPrice missing from data/yf/finance/SOXX.json");
      }
    } else {
      const observed = input.indices[asset]?.observed?.price;
      spot = observed?.value;
      spotAsOf = observed?.as_of;
      if (!finite(spot) || spot <= 0) {
        throw new Error(`${asset}: observed price missing from data/computed/rim-index/inputs.json`);
      }
    }

    const selected = Math.max(rawCenter, floor);
    const determinedBy = selected === rawCenter ? "model_center" : "published_floor";
    const caveats = [];
    if (asset === "SOXX") {
      caveats.push(
        "raw center is SOX (Philadelphia Semiconductor index) based; selected is floor-determined on ETF (SOXX) basis",
      );
    }
    if (asset === "CCMP") caveats.push(parse_note);
    caveats.push(...identity_blockers);

    return {
      asset,
      order_position: index + 1,
      raw_center: rawCenter,
      raw_center_instrument: asset === "SOXX" ? "SOX (Philadelphia Semiconductor index)" : asset,
      raw_center_source: modelSource,
      model_status: modelStatus,
      floor,
      floor_evidence: {
        evidence_id,
        date: claim.date,
        asset: claim.asset,
        metric: claim.metric,
        raw_value: claim.raw_value,
        source: claim.source,
        parse: parse_note,
      },
      selected,
      determined_by: determinedBy,
      spot,
      as_of: spotAsOf,
      fair_value: spot * (1 + selected),
      gap_to_next: null,
      caveats,
    };
  });

  const ordered = validateOwnerOrderedSelection(rows);
  for (let i = 0; i < rows.length - 1; i += 1) {
    const gap = ordered[i + 1] - ordered[i];
    rows[i].gap_to_next = { next: rows[i + 1].asset, gap, gap_pp: gap * 100 };
  }

  const ndxSelected = rows.find((row) => row.asset === "NDX").selected;
  const qqq = qqqFinal.current * (1 + ndxSelected);

  const floorDetermined = rows.filter((row) => row.determined_by === "published_floor").map((row) => row.asset);
  const modelDetermined = rows.filter((row) => row.determined_by === "model_center").map((row) => row.asset);

  return {
    schema_version: "fenok_rim_owner_ordered_current.v1",
    generated_at: options.generatedAt ?? new Date().toISOString(),
    classification: "OWNER_CONSTRAINED_ACTIONABLE_RESEARCH_LINE",
    exact_yoo: false,
    public_promotion: false,
    yoo_status: "NOT_IDENTIFIED",
    public_surface: {
      status: "QUARANTINED",
      rule: "owner-constrained research line; quarantined from public promotion until separate owner approval",
    },
    normalization: {
      order: OWNER_ORDER,
      rule: "selected = max(raw_center, floor); raw centers imported unmodified from existing repo functions; floors loaded by evidence_id; no parameter refit; no order projection",
      min_adjacent_gap_pp: MIN_ADJACENT_GAP * 100,
    },
    determination_split: {
      floor_determined: floorDetermined.length,
      model_center_determined: modelDetermined.length,
      order_adjusted: 0,
      floor_determined_rows: floorDetermined,
      model_center_determined_rows: modelDetermined,
    },
    adjacent_gaps: rows.slice(0, -1).map((row) => row.gap_to_next),
    input_clocks: {
      rim_inputs_generated_at: input.generated_at,
      payout_history_generated_at: shared.payout_generated_at,
      soxx_quote_source_as_of: soxx.source_as_of,
      fixture_source_ledger: fixture.source_ledger,
    },
    qqq_equivalent: {
      asset: "QQQ",
      formula: "FENO_RIM_FINAL_CURRENT_QQQ.current * (1 + NDX selected)",
      current: qqqFinal.current,
      as_of: qqqFinal.as_of,
      fair_value: qqq,
      label: "NDX-ratio indicative equivalent, not a reconstructed ETF NAV fair value",
      caveats: qqqFinal.caveats ?? [],
    },
    rows,
  };
}

function writeJsonAtomic(destination, payload) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const payload = buildOwnerOrderedCurrent();
  writeJsonAtomic(OUT, payload);
  process.stdout.write(`wrote ${OUT}\n`);
}
