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

function readJson(root, relPath) {
  const abs = path.join(root, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (error) {
    throw new Error(`read ${relPath}: ${error.message}`);
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

function checkFile(payload, name, excludedVanillaTickers, errors) {
  if (payload?.asset_type !== "etf") {
    errors.push(`${name} asset_type must be etf, got ${payload?.asset_type}`);
  }
  const eligible = Number(payload?.coverage?.eligible_etf_count);
  const scored = Number(payload?.coverage?.scored_public_etf);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];

  if (!Number.isFinite(scored) || scored <= 0) {
    errors.push(`${name} scored_public_etf must be > 0, got ${payload?.coverage?.scored_public_etf}`);
  }
  if (scored > eligible) {
    errors.push(`${name} scored_public_etf (${scored}) cannot exceed eligible_etf_count (${eligible})`);
  }
  if (rows.length !== scored) {
    errors.push(`${name} rows length (${rows.length}) must equal scored_public_etf (${scored})`);
  }

  const badRows = rows.filter((row) => row?.asset_type !== "etf");
  if (badRows.length > 0) {
    const tickers = badRows.slice(0, 5).map((row) => row.ticker).join(", ");
    errors.push(`${name} contains ${badRows.length} non-etf row(s); first 5: ${tickers}`);
  }
  const excludedRows = rows.filter((row) => excludedVanillaTickers.has(String(row?.ticker ?? "").trim().toUpperCase()));
  if (excludedRows.length > 0) {
    const tickers = excludedRows.slice(0, 5).map((row) => row.ticker).join(", ");
    errors.push(`${name} contains ${excludedRows.length} leveraged/inverse/single-stock ETF row(s); first 5: ${tickers}`);
  }

  const noScores = rows.filter((row) => !row.scores || typeof row.scores !== "object");
  if (noScores.length > 0) {
    errors.push(`${name} contains ${noScores.length} row(s) without a scores object`);
  }
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.scores ?? {})) {
      if (value == null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${name} ${row.ticker}.${key} must be null or 0..100 number`);
      }
    }
  }
}

function countPayload(payload) {
  return {
    generated_at: payload?.generated_at ?? null,
    rows: Array.isArray(payload?.rows) ? payload.rows.length : 0,
    scored_public_etf: Number(payload?.coverage?.scored_public_etf) || 0,
    eligible_etf_count: Number(payload?.coverage?.eligible_etf_count) || 0,
  };
}

export function runEtfSignalGateChecks(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const errors = [];
  let etfSignals = null;
  let etfSummary = null;
  let publicSummary = null;
  let etfUniverse = null;

  try {
    etfSignals = readJson(root, "data/computed/fenok_etf_signals.json");
    etfSummary = readJson(root, "data/computed/fenok_etf_signals_summary.json");
    publicSummary = readJson(root, "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json");
    etfUniverse = readJson(root, "data/stockanalysis/etf_universe.json");
  } catch (error) {
    errors.push(error.message);
  }

  const excludedVanillaTickers = new Set(
    (Array.isArray(etfUniverse?.records) ? etfUniverse.records : [])
      .filter(isNonVanilla)
      .map((row) => String(row?.ticker ?? "").trim().toUpperCase())
      .filter(Boolean),
  );

  if (etfSignals) checkFile(etfSignals, "fenok_etf_signals.json", excludedVanillaTickers, errors);
  if (etfSummary) checkFile(etfSummary, "fenok_etf_signals_summary.json", excludedVanillaTickers, errors);
  if (publicSummary) checkFile(publicSummary, "public fenok_etf_signals_summary.json", excludedVanillaTickers, errors);

  if (Array.isArray(etfSignals?.signal_keys) && Array.isArray(etfSummary?.signal_keys)) {
    const fullKeys = etfSignals.signal_keys.join(",");
    const sumKeys = etfSummary.signal_keys.join(",");
    if (fullKeys !== sumKeys) {
      errors.push(`signal_keys mismatch: fenok_etf_signals.json=[${fullKeys}] vs summary=[${sumKeys}]`);
    }
  }

  const internalCounts = countPayload(etfSummary);
  const publicCounts = countPayload(publicSummary);
  const publicMirrorExists = fileExists(root, "100xfenok-next/public/data/computed/fenok_etf_signals_summary.json");
  const publicFullLeak = fileExists(root, "100xfenok-next/public/data/computed/fenok_etf_signals.json");
  const publicMirrorMatches = Boolean(publicSummary)
    && publicCounts.generated_at === internalCounts.generated_at
    && publicCounts.rows === internalCounts.rows
    && publicCounts.scored_public_etf === internalCounts.scored_public_etf
    && publicCounts.eligible_etf_count === internalCounts.eligible_etf_count;
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

  if (!publicMirrorExists) errors.push("public ETF signal summary mirror is missing");
  if (publicFullLeak) errors.push("public full ETF signal payload must not exist: public/data/computed/fenok_etf_signals.json");
  if (!publicMirrorMatches) errors.push("public ETF signal summary mirror does not match internal summary counts");
  if (!apiRouteReady) errors.push("ETF signal API route proof is missing or incomplete");
  if (!detailUiReady) errors.push("ETF detail UI signal card proof is missing or incomplete");

  let stockSignals = null;
  try {
    stockSignals = readJson(root, "data/computed/fenok_signals.json");
  } catch (error) {
    errors.push(error.message);
  }
  const stockRows = Array.isArray(stockSignals?.rows) ? stockSignals.rows : [];
  const leakedEtfRows = stockRows.filter((row) => (row?.asset_type ?? "stock") !== "stock");
  if (leakedEtfRows.length > 0) {
    const tickers = leakedEtfRows.slice(0, 5).map((row) => row.symbol ?? row.ticker).join(", ");
    errors.push(`fenok_signals.json contains ${leakedEtfRows.length} non-stock row(s); first 5: ${tickers}`);
  }

  return {
    ok: errors.length === 0,
    errors,
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
  console.log(`[fenok-etf-signal-gate] ok (scored_public_etf=${result.counts.internal_full.scored_public_etf}, no ETF rows in stock lens, public_surface=${result.public_surface_proof.ready})`);
}
