#!/usr/bin/env node
// Build the canonical identity index: one stable internal key per security, with the
// external identifiers we already hold and the evidenced rename links.
//
// Why: our records are keyed by ticker, so a rename splits a history. This index assigns
// a key that survives a rename (`fenok_id`) and resolves any known ticker, old or new, to
// the same entity. It reads only files that already exist; it fetches nothing.
//
// Inputs
//   data/stockanalysis/etf_universe.json   ETF membership, names, inception, website
//   data/global-scouter/core/stocks_analyzer.json   analysed company universe (symbol, name)
//   data/edgar/company_tickers.json        SEC ticker -> CIK cache (operating companies)
//   data/admin/identity-renames.json       evidenced rename record (old -> new)
// Output
//   data/admin/identity-index.json         schema fenok-identity-index/v1
//
// Key rule: the seed is the CIK when known, otherwise the earliest ticker in the entity's
// rename chain, so a rebuild assigns the same key and a successor keeps its predecessor's.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const UNIVERSE_REL = "data/stockanalysis/etf_universe.json";
const SCOUTER_REL = "data/global-scouter/core/stocks_analyzer.json";
const COMPANY_TICKERS_REL = "data/edgar/company_tickers.json";
const RENAMES_REL = "data/admin/identity-renames.json";
const OUT_REL = "data/admin/identity-index.json";

function readJson(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeCik(value) {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  return digits ? digits.padStart(10, "0") : null;
}

function stableId(seed) {
  return "fk-" + crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 12);
}

const universe = readJson(UNIVERSE_REL);
const companyTickers = readJson(COMPANY_TICKERS_REL);
const renames = readJson(RENAMES_REL);

if (!universe || !Array.isArray(universe.records)) {
  throw new Error(`identity index: ${UNIVERSE_REL} is missing or malformed`);
}

const cikByTicker = new Map();
for (const row of (companyTickers?.rows ?? [])) {
  const ticker = String(row?.ticker ?? "").trim().toUpperCase();
  const cik = normalizeCik(row?.cik);
  if (ticker && cik) cikByTicker.set(ticker, cik);
}

// Group tickers into entities through the evidenced rename links.
const parent = new Map();
const find = (ticker) => {
  let current = ticker;
  while (parent.has(current) && parent.get(current) !== current) current = parent.get(current);
  return current;
};
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
};

const renamePairs = [];
for (const record of (renames?.renames ?? [])) {
  const oldTicker = String(record?.old_ticker ?? "").trim().toUpperCase();
  const newTicker = String(record?.new_ticker ?? "").trim().toUpperCase();
  if (!oldTicker || !newTicker) continue;
  renamePairs.push({ oldTicker, newTicker, record });
  if (!parent.has(oldTicker)) parent.set(oldTicker, oldTicker);
  if (!parent.has(newTicker)) parent.set(newTicker, newTicker);
  union(oldTicker, newTicker);
}

const members = new Map(); // root -> { tickers:Set, records:[] }
const addTicker = (ticker, meta = {}) => {
  const key = parent.has(ticker) ? find(ticker) : ticker;
  if (!members.has(key)) members.set(key, { tickers: new Set(), names: new Set(), inception: null, website: null, sources: new Set(), renames: [], security_type: null });
  const entity = members.get(key);
  entity.tickers.add(ticker);
  if (meta.name) entity.names.add(meta.name);
  if (meta.inception && !entity.inception) entity.inception = meta.inception;
  if (meta.website && !entity.website) entity.website = meta.website;
  if (meta.source) entity.sources.add(meta.source);
  return entity;
};

for (const record of universe.records) {
  const ticker = String(record?.ticker ?? "").trim().toUpperCase();
  if (!ticker) continue;
  const entity = addTicker(ticker, {
    name: record?.name ?? null,
    inception: record?.inceptionDate ?? null,
    website: record?.etf_website ?? record?.provider_page ?? null,
    source: UNIVERSE_REL,
  });
  entity.security_type = entity.security_type ?? "etf";
}

const scouter = readJson(SCOUTER_REL);
for (const row of (scouter?.data ?? [])) {
  const ticker = String(row?.symbol ?? "").trim().toUpperCase();
  if (!ticker) continue;
  const entity = addTicker(ticker, {
    name: row?.companyName ?? null,
    source: SCOUTER_REL,
  });
  entity.security_type = entity.security_type ?? "stock";
}

for (const { oldTicker, newTicker, record } of renamePairs) {
  const entity = addTicker(newTicker, {
    name: record?.fund_name ?? null,
    inception: record?.inception ?? null,
    source: RENAMES_REL,
  });
  entity.tickers.add(oldTicker);
  entity.renames.push({
    old_ticker: oldTicker,
    new_ticker: newTicker,
    issuer: record?.issuer ?? null,
    confidence: record?.confidence ?? null,
    effective_date: record?.effective_date ?? null,
    evidence_types: (record?.evidence ?? []).map((item) => item?.type).filter(Boolean),
    open_evidence: record?.open_evidence ?? [],
  });
}

const entities = [];
const byTicker = {};
for (const [root, entity] of [...members.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const tickers = [...entity.tickers].sort();
  const cik = tickers.map((ticker) => cikByTicker.get(ticker)).find(Boolean) ?? null;
  const seed = cik ?? tickers[0];
  const fenokId = stableId(seed);
  const name = [...entity.names][0] ?? null;
  for (const ticker of tickers) byTicker[ticker] = fenokId;
  entities.push({
    fenok_id: fenokId,
    key_seed: cik ? "cik" : "ticker",
    security_type: entity.security_type,
    current_ticker: tickers.includes(root) ? root : tickers[tickers.length - 1],
    tickers,
    name,
    inception: entity.inception,
    website: entity.website,
    cik,
    renames: entity.renames,
    sources: [...entity.sources].sort(),
  });
}

const withCik = entities.filter((entity) => entity.cik).length;
const renamed = entities.filter((entity) => entity.renames.length > 0).length;
const stocks = entities.filter((entity) => entity.security_type === "stock").length;

const payload = {
  schema_version: "fenok-identity-index/v1",
  generated_at: new Date().toISOString(),
  policy: [
    "One entity per security. fenok_id is stable across ticker renames and rebuilds.",
    "The key seed is the CIK when known, otherwise the earliest ticker in the entity's rename chain.",
    "A ticker is a label, never the identity. Rename links come only from the evidenced record.",
    "This index adds identifiers we already hold; it fetches nothing and changes no source file."
  ],
  counts: {
    entities: entities.length,
    stocks,
    etfs: entities.length - stocks,
    with_cik: withCik,
    renamed_entities: renamed,
    tickers_mapped: Object.keys(byTicker).length,
  },
  entities,
  by_ticker: byTicker,
};

fs.writeFileSync(path.join(ROOT, OUT_REL), JSON.stringify(payload, null, 2) + "\n");
console.log(
  `identity index: entities=${entities.length} stocks=${stocks} with_cik=${withCik} ` +
  `renamed=${renamed} tickers=${Object.keys(byTicker).length} -> ${OUT_REL}`,
);
