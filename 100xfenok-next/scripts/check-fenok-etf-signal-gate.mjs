#!/usr/bin/env node
/**
 * Fenok ETF signal gate check.
 *
 * Validates that the ETF lane emits real scored rows in its own artifact and
 * does not leak into the stock signal lens. Missing signal scores are allowed
 * (reported as null), but the row shape and counts must be consistent.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const ETF_SIGNALS_REL = "data/computed/fenok_etf_signals.json";
const ETF_SUMMARY_REL = "data/computed/fenok_etf_signals_summary.json";
const PUBLIC_ETF_SUMMARY_REL = "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json";
const PUBLIC_ETF_SIGNALS_REL = "100xfenok-next/public/data/computed/fenok_etf_signals.json";
const ETF_UNIVERSE_REL = "data/stockanalysis/etf_universe.json";
const STOCK_SIGNALS_REL = "data/computed/fenok_signals.json";
const PUBLIC_SUMMARY_FIELDS = [
  "ticker",
  "company",
  "asset_type",
  "category",
  "aum",
  "expense_ratio",
  "dividend_yield",
  "beta",
];
const PUBLIC_SUMMARY_TOP_LEVEL_KEYS = [
  "asset_type",
  "coverage",
  "fields",
  "formula_version",
  "generated_at",
  "rows",
  "schema_version",
  "source_file",
];
const PUBLIC_SUMMARY_ROW_KEYS = [
  ...PUBLIC_SUMMARY_FIELDS,
  "scored_signal_count",
  "scores",
];

function readJsonArtifact(root, relPath, errors) {
  const abs = path.join(root, relPath);
  try {
    const raw = fs.readFileSync(abs, "utf8");
    return { exists: true, value: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, value: null };
    errors.push(`read ${relPath}: ${error.message}`);
    return { exists: true, value: null };
  }
}

const nonVanillaPatterns = [
  /ultrashort/i,
  /ultrapro/i,
  /\b[23]x\b/i,
  /\b-[123]x\b/i,
  /\binverse\b/i,
  /\bleveraged\b/i,
  /\bdaily\s+(bull|bear)\b/i,
  /\/leveraged-and-inverse\//i,
  /\bsingle[-\s]?stock\b/i,
];
function isNonVanilla(row) {
  const classification = row?.classification;
  if (classification && typeof classification === "object"
    && (classification.is_leveraged || classification.is_inverse || classification.is_single_stock)) {
    return true;
  }
  const text = [row?.ticker, row?.name, row?.etf_website, row?.provider_page].filter(Boolean).join(" ");
  return nonVanillaPatterns.some((pattern) => pattern.test(text));
}

function fileExists(root, relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function fileContains(root, relPath, needles) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return false;
  const text = fs.readFileSync(abs, "utf8");
  return needles.every((needle) => text.includes(needle));
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

export function checkEtfSignalPayload(
  payload,
  name,
  excludedVanillaTickers = new Set(),
  errors = [],
  warnings = [],
  options = {},
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push(`${name} must be a JSON object`);
    return;
  }
  if (payload?.asset_type !== "etf") {
    errors.push(`${name} asset_type must be etf, got ${payload?.asset_type}`);
  }
  if (!Number.isInteger(payload.schema_version) || payload.schema_version < 1) {
    errors.push(`${name} schema_version must be a positive integer`);
  }
  if (typeof payload.generated_at !== "string" || payload.generated_at.trim() === "") {
    errors.push(`${name} generated_at must be a non-empty string`);
  }
  if (!payload.coverage || typeof payload.coverage !== "object" || Array.isArray(payload.coverage)) {
    errors.push(`${name} coverage must be an object`);
  }

  const candidate = payload?.coverage?.candidate_etf_count;
  const eligible = payload?.coverage?.eligible_etf_count;
  const scored = payload?.coverage?.scored_public_etf;
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  const candidateIsCount = Number.isInteger(candidate) && candidate >= 0;
  const eligibleIsCount = Number.isInteger(eligible) && eligible >= 0;
  const scoredIsCount = Number.isInteger(scored) && scored >= 0;
  if (!Array.isArray(payload.rows)) errors.push(`${name} rows must be an array`);
  if (!candidateIsCount) {
    errors.push(`${name} candidate_etf_count must be a non-negative integer, got ${candidate}`);
  }
  if (!eligibleIsCount) {
    errors.push(`${name} eligible_etf_count must be a non-negative integer, got ${eligible}`);
  }
  if (!scoredIsCount) {
    errors.push(`${name} scored_public_etf must be a non-negative integer, got ${scored}`);
  }
  if (eligibleIsCount && scoredIsCount && scored === 0) {
    warnings.push(`${name} is DEGRADED: scored_public_etf=0`);
  } else if (eligibleIsCount && scoredIsCount && scored < eligible) {
    warnings.push(`${name} is DEGRADED: partial signal coverage ${scored}/${eligible}`);
  }
  if (eligibleIsCount && scoredIsCount && scored > eligible) {
    errors.push(`${name} scored_public_etf (${scored}) cannot exceed eligible_etf_count (${eligible})`);
  }
  if (candidateIsCount && eligibleIsCount && eligible > candidate) {
    errors.push(`${name} eligible_etf_count (${eligible}) cannot exceed candidate_etf_count (${candidate})`);
  }
  if (scoredIsCount && rows.length !== scored) {
    errors.push(`${name} rows length (${rows.length}) must equal scored_public_etf (${scored})`);
  }

  if (payload.signal_keys !== undefined && !Array.isArray(payload.signal_keys)) {
    errors.push(`${name} signal_keys must be an array when present`);
  }
  const signalCoverage = payload?.coverage?.signal_coverage;
  if (!signalCoverage || typeof signalCoverage !== "object" || Array.isArray(signalCoverage)) {
    errors.push(`${name} coverage.signal_coverage must be an object`);
  }
  const expectedSignalKeys = Array.isArray(options.expectedSignalKeys) && options.expectedSignalKeys.length > 0
    ? options.expectedSignalKeys
    : Array.isArray(payload.signal_keys) && payload.signal_keys.length > 0
      ? payload.signal_keys
      : Object.keys(signalCoverage ?? {});
  if (expectedSignalKeys.length === 0) errors.push(`${name} must declare signal keys`);
  for (const duplicate of duplicateValues(expectedSignalKeys)) errors.push(`${name} duplicate signal key '${duplicate}'`);
  if (payload.signal_keys && !sameJson(payload.signal_keys, expectedSignalKeys)) {
    errors.push(`${name} signal_keys differ from the expected signal contract`);
  }
  if (signalCoverage && !sameJson(Object.keys(signalCoverage).sort(), [...expectedSignalKeys].sort())) {
    errors.push(`${name} signal_coverage keys differ from the expected signal contract`);
  }

  if (options.publicSummary === true) {
    if (!sameKeys(payload, PUBLIC_SUMMARY_TOP_LEVEL_KEYS)) {
      errors.push(`${name} contains an unexpected or missing public top-level field`);
    }
    if (!sameJson(payload.fields, PUBLIC_SUMMARY_FIELDS)) {
      errors.push(`${name} fields differ from the public summary allowlist`);
    }
  }

  const actualSignalCoverage = Object.fromEntries(expectedSignalKeys.map((key) => [key, 0]));
  const tickers = [];
  let honestNullScores = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`${name} rows must contain objects`);
      continue;
    }
    const ticker = tickerOf(row.ticker);
    tickers.push(ticker);
    if (!ticker) errors.push(`${name} row missing ticker identity`);
    if (row.asset_type !== "etf") errors.push(`${name} ${ticker || "<missing>"} asset_type must be etf`);
    if (excludedVanillaTickers.has(ticker)) {
      errors.push(`${name} contains leveraged/inverse/single-stock ETF row '${ticker}'`);
    }
    if (!row.scores || typeof row.scores !== "object" || Array.isArray(row.scores)) {
      errors.push(`${name} ${ticker || "<missing>"} must include a scores object`);
      continue;
    }
    if (!sameJson(Object.keys(row.scores).sort(), [...expectedSignalKeys].sort())) {
      errors.push(`${name} ${ticker || "<missing>"} score keys differ from the signal contract`);
    }
    if (options.publicSummary === true && !sameKeys(row, PUBLIC_SUMMARY_ROW_KEYS)) {
      errors.push(`${name} ${ticker || "<missing>"} contains an unexpected or missing public field`);
    }

    const reasonRow = options.reasonRowsByTicker?.get(ticker) ?? row;
    const rowCoverage = reasonRow?.coverage;
    if (options.publicSummary !== true
      && (!rowCoverage || typeof rowCoverage !== "object" || Array.isArray(rowCoverage))) {
      errors.push(`${name} ${ticker || "<missing>"} must include a coverage reason map`);
    } else if (options.publicSummary !== true
      && !sameJson(Object.keys(rowCoverage).sort(), [...expectedSignalKeys].sort())) {
      errors.push(`${name} ${ticker || "<missing>"} coverage keys differ from the signal contract`);
    }
    let finiteScoreCount = 0;
    for (const key of expectedSignalKeys) {
      const hasScore = Object.prototype.hasOwnProperty.call(row.scores, key);
      const value = row.scores[key];
      const coverageReason = rowCoverage?.[key];
      if (!hasScore) continue;
      if (value == null) {
        const globalPartialReason = Number.isInteger(signalCoverage?.[key]) && signalCoverage[key] < rows.length;
        const hasReason = options.publicSummary === true
          ? coverageReason === false || globalPartialReason
          : coverageReason === false;
        if (!hasReason) {
          errors.push(`${name} ${ticker}.${key} null score lacks an existing coverage reason`);
        } else {
          honestNullScores += 1;
        }
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${name} ${ticker}.${key} must be null or 0..100 number`);
        continue;
      }
      finiteScoreCount += 1;
      actualSignalCoverage[key] += 1;
      if (coverageReason === false) errors.push(`${name} ${ticker}.${key} false-ready: finite score has coverage=false`);
      if (options.publicSummary !== true && coverageReason !== true) {
        errors.push(`${name} ${ticker}.${key} finite score must have coverage=true`);
      }
    }
    if (!Number.isInteger(row.scored_signal_count) || row.scored_signal_count < 0) {
      errors.push(`${name} ${ticker || "<missing>"}.scored_signal_count must be a non-negative integer`);
    } else if (row.scored_signal_count !== finiteScoreCount) {
      errors.push(`${name} ${ticker || "<missing>"} count reconciliation failed: scored_signal_count=${row.scored_signal_count}, finite scores=${finiteScoreCount}`);
    }
  }

  for (const duplicate of duplicateValues(tickers.filter(Boolean))) errors.push(`${name} duplicate ticker '${duplicate}'`);
  for (const key of expectedSignalKeys) {
    const declared = signalCoverage?.[key];
    if (!Number.isInteger(declared) || declared < 0 || declared > rows.length) {
      errors.push(`${name} signal_coverage.${key} must be a reconciled non-negative integer`);
    } else if (declared !== actualSignalCoverage[key]) {
      errors.push(`${name} count reconciliation failed: signal_coverage.${key}=${declared}, actual=${actualSignalCoverage[key]}`);
    }
  }
  if (honestNullScores > 0) {
    warnings.push(`${name} is DEGRADED: ${honestNullScores} null signal score(s) retain coverage reasons`);
  }
}

function countPayload(payload) {
  return {
    generated_at: payload?.generated_at ?? null,
    rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
    scored_public_etf: Number.isInteger(payload?.coverage?.scored_public_etf) ? payload.coverage.scored_public_etf : null,
    eligible_etf_count: Number.isInteger(payload?.coverage?.eligible_etf_count) ? payload.coverage.eligible_etf_count : null,
  };
}

export function runEtfSignalGateChecks(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const errors = [];
  const warnings = [];
  const etfSignalsArtifact = readJsonArtifact(root, ETF_SIGNALS_REL, errors);
  const etfSummaryArtifact = readJsonArtifact(root, ETF_SUMMARY_REL, errors);
  const publicSummaryArtifact = readJsonArtifact(root, PUBLIC_ETF_SUMMARY_REL, errors);
  const etfUniverseArtifact = readJsonArtifact(root, ETF_UNIVERSE_REL, errors);
  const stockSignalsArtifact = readJsonArtifact(root, STOCK_SIGNALS_REL, errors);
  for (const [artifact, name] of [
    [etfSignalsArtifact, ETF_SIGNALS_REL],
    [etfSummaryArtifact, ETF_SUMMARY_REL],
    [publicSummaryArtifact, PUBLIC_ETF_SUMMARY_REL],
    [etfUniverseArtifact, ETF_UNIVERSE_REL],
    [stockSignalsArtifact, STOCK_SIGNALS_REL],
  ]) {
    if (artifact.exists && !isObject(artifact.value)) errors.push(`${name} must be a JSON object`);
  }
  const etfSignals = etfSignalsArtifact.value;
  const etfSummary = etfSummaryArtifact.value;
  const publicSummary = publicSummaryArtifact.value;
  const etfUniverse = etfUniverseArtifact.value;

  if (!etfSignalsArtifact.exists) warnings.push(`Fenok ETF signals are DEGRADED: ${ETF_SIGNALS_REL} is missing`);
  if (!etfSummaryArtifact.exists && !publicSummaryArtifact.exists) {
    warnings.push("Fenok ETF signals are DEGRADED: root and public summary artifacts are both missing");
  } else if (etfSummaryArtifact.exists !== publicSummaryArtifact.exists) {
    errors.push("ETF signal summary mirror is one-sided between root and public");
  } else if (etfSummary && publicSummary && !sameJson(etfSummary, publicSummary)) {
    errors.push("public ETF signal summary mirror differs from internal summary");
  }
  if (!etfUniverseArtifact.exists) warnings.push(`Fenok ETF signals are DEGRADED: ${ETF_UNIVERSE_REL} is missing`);
  if (!stockSignalsArtifact.exists) warnings.push(`Fenok ETF signals are DEGRADED: ${STOCK_SIGNALS_REL} is missing`);

  if (etfUniverse && !Array.isArray(etfUniverse.records)) errors.push("etf_universe.records must be an array");
  const universeTickers = (Array.isArray(etfUniverse?.records) ? etfUniverse.records : [])
    .map((row) => tickerOf(row?.ticker));
  if (universeTickers.some((ticker) => !ticker)) errors.push("etf_universe contains a record without ticker identity");
  for (const duplicate of duplicateValues(universeTickers.filter(Boolean))) errors.push(`etf_universe duplicate ticker '${duplicate}'`);

  const excludedVanillaTickers = new Set(
    (Array.isArray(etfUniverse?.records) ? etfUniverse.records : [])
      .filter(isNonVanilla)
      .map((row) => String(row?.ticker ?? "").trim().toUpperCase())
      .filter(Boolean),
  );

  const expectedSignalKeys = Array.isArray(etfSignals?.signal_keys)
    ? etfSignals.signal_keys
    : Object.keys(etfSummary?.coverage?.signal_coverage ?? {});
  const fullRowsByTicker = new Map(
    (Array.isArray(etfSignals?.rows) ? etfSignals.rows : []).map((row) => [tickerOf(row?.ticker), row]),
  );
  if (etfSignals) {
    checkEtfSignalPayload(etfSignals, "fenok_etf_signals.json", excludedVanillaTickers, errors, warnings, { expectedSignalKeys });
  }
  if (etfSummary) {
    checkEtfSignalPayload(etfSummary, "fenok_etf_signals_summary.json", excludedVanillaTickers, errors, etfSignals ? [] : warnings, {
      expectedSignalKeys,
      publicSummary: true,
      reasonRowsByTicker: fullRowsByTicker,
    });
  }
  if (publicSummary) {
    checkEtfSignalPayload(publicSummary, "public fenok_etf_signals_summary.json", excludedVanillaTickers, errors, [], {
      expectedSignalKeys,
      publicSummary: true,
      reasonRowsByTicker: fullRowsByTicker,
    });
  }

  if (etfSignals && etfSummary) {
    if (etfSignals.generated_at !== etfSummary.generated_at) {
      warnings.push("Fenok ETF signals are DEGRADED: full payload and summary generation times are behind one another");
    }
    if (etfSignals.schema_version !== etfSummary.schema_version
      || etfSignals.formula_version !== etfSummary.formula_version
      || etfSignals.source_file !== etfSummary.source_file) {
      errors.push("full/summary ETF build identity diverges");
    }
    for (const key of ["candidate_etf_count", "eligible_etf_count", "scored_public_etf", "signal_coverage"]) {
      if (!sameJson(etfSignals.coverage?.[key], etfSummary.coverage?.[key])) {
        errors.push(`full/summary count reconciliation failed for coverage.${key}`);
      }
    }
    const fullTickers = (Array.isArray(etfSignals.rows) ? etfSignals.rows : []).map((row) => tickerOf(row?.ticker));
    const summaryTickers = (Array.isArray(etfSummary.rows) ? etfSummary.rows : []).map((row) => tickerOf(row?.ticker));
    if (!sameJson(fullTickers, summaryTickers)) errors.push("full/summary ETF ticker identities diverge");
    for (const summaryRow of Array.isArray(etfSummary.rows) ? etfSummary.rows : []) {
      const ticker = tickerOf(summaryRow?.ticker);
      const fullRow = fullRowsByTicker.get(ticker);
      if (!fullRow) continue;
      for (const key of PUBLIC_SUMMARY_FIELDS) {
        if (!sameJson(summaryRow?.[key], fullRow?.[key])) {
          errors.push(`full/summary ETF projection diverges for ${ticker}.${key}`);
        }
      }
      if (!sameJson(summaryRow?.scores, fullRow?.scores)
        || summaryRow?.scored_signal_count !== fullRow?.scored_signal_count) {
        errors.push(`full/summary ETF score projection diverges for ${ticker}`);
      }
    }
  }

  const internalCounts = countPayload(etfSummary);
  const publicCounts = countPayload(publicSummary);
  const publicMirrorExists = publicSummaryArtifact.exists;
  const publicFullLeak = fileExists(root, PUBLIC_ETF_SIGNALS_REL);
  const publicMirrorMatches = Boolean(etfSummary && publicSummary && sameJson(etfSummary, publicSummary));
  const apiRouteReady = fileContains(root, "100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts", [
    "fenok_etf_signals_summary.json",
    "fields?: string[]",
    "normalizeEtfSignalRow",
    "Array.isArray(rawRow)",
    "FENOK_ETF_SIGNAL_NOT_FOUND",
  ]);
  const detailUiReady = fileContains(root, "100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx", [
    "/api/data/fenok-etf-signals/",
    "Fenok Edge ETF 시그널",
    "ETF_SIGNAL_SCORE_FIELDS",
  ]);

  if (publicFullLeak) errors.push("public full ETF signal payload must not exist: public/data/computed/fenok_etf_signals.json");
  if (!apiRouteReady) errors.push("ETF signal API route proof is missing or incomplete");
  if (!detailUiReady) errors.push("ETF detail UI signal card proof is missing or incomplete");

  const stockSignals = stockSignalsArtifact.value;
  if (stockSignals && !Array.isArray(stockSignals.rows)) errors.push("fenok_signals.json rows must be an array");
  const stockRows = Array.isArray(stockSignals?.rows) ? stockSignals.rows : [];
  for (const [index, row] of stockRows.entries()) {
    if (!isObject(row)) errors.push(`fenok_signals.json row ${index} must be an object`);
  }
  const stockTickers = stockRows.map((row) => tickerOf(row?.ticker ?? row?.symbol));
  if (stockTickers.some((ticker) => !ticker)) errors.push("fenok_signals.json contains a row without ticker identity");
  for (const duplicate of duplicateValues(stockTickers.filter(Boolean))) errors.push(`fenok_signals.json duplicate ticker '${duplicate}'`);
  const leakedEtfRows = stockRows.filter((row) => row?.asset_type != null && row.asset_type !== "stock");
  if (leakedEtfRows.length > 0) {
    const tickers = leakedEtfRows.slice(0, 5).map((row) => row.symbol ?? row.ticker).join(", ");
    errors.push(`fenok_signals.json contains ${leakedEtfRows.length} non-stock row(s); first 5: ${tickers}`);
  }
  const etfTickerSet = new Set((Array.isArray(etfSignals?.rows) ? etfSignals.rows : []).map((row) => tickerOf(row?.ticker)).filter(Boolean));
  const crossLaneCollisions = [...new Set(stockTickers.filter((ticker) => etfTickerSet.has(ticker)))].sort();
  if (crossLaneCollisions.length > 0) {
    errors.push(`stock/ETF identity collision(s): ${crossLaneCollisions.slice(0, 8).join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
    errors,
    warnings,
    counts: {
      internal_full: countPayload(etfSignals),
      internal_summary: internalCounts,
      public_summary: publicCounts,
      stock_lens_rows: stockRows.length,
      stock_lens_etf_leaks: leakedEtfRows.length,
    },
    public_surface_proof: {
      ready: publicMirrorExists && !publicFullLeak && publicMirrorMatches && apiRouteReady && detailUiReady,
      public_mirror_exists: publicMirrorExists,
      public_full_payload_absent: !publicFullLeak,
      public_mirror_matches_internal_summary: publicMirrorMatches,
      api_route_ready: apiRouteReady,
      detail_ui_card_ready: detailUiReady,
      files: {
        public_summary: "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json",
        api_route: "100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts",
        detail_ui: "100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx",
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runEtfSignalGateChecks();
  if (!result.ok) {
    console.error("[fenok-etf-signal-gate] FAIL");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  for (const warning of result.warnings) console.warn(`- ${warning}`);
  console.log(`[fenok-etf-signal-gate] ${result.status === "degraded" ? "DEGRADED" : "ok"} (scored_public_etf=${result.counts.internal_full.scored_public_etf}, no ETF rows in stock lens, public_surface=${result.public_surface_proof.ready})`);
}
