#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const ROOT = process.cwd();
const PUBLIC_ROOT = `${ROOT}/public/data/edgar-korean-summaries`;
const SOURCE_ROOT = `${ROOT}/../data/edgar-korean-summaries`;
const INDEX_PATH = `${PUBLIC_ROOT}/index.json`;
const SOURCE_INDEX_PATH = `${SOURCE_ROOT}/index.json`;
const SUMMARY_SECTIONS = ["keyPoints", "riskChanges", "businessChanges", "financialHighlights", "watchItems"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(errors) {
  console.error("edgar summary evidence check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

function publicPathFromDataPath(dataPath) {
  return `${ROOT}/public${dataPath}`;
}

function sourcePathFromDataPath(dataPath) {
  return `${ROOT}/..${dataPath}`;
}

function canonical(text) {
  return String(text)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/points?/g, "포인트")
    .replace(/％/g, "%");
}

function numericTokens(text) {
  const cleaned = String(text)
    .replace(/\d{4}\s*회계연도/g, "")
    .replace(/FY\s*\d{4}/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/상위\s*\d+\s*개/g, "")
    .replace(/Item\s*\d+[A-Z]?/gi, "");
  return [...cleaned.matchAll(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|%p|포인트|points?|억|만|달러|B)?/g)]
    .map((match) => match[0].replace(/\s+/g, ""))
    .filter(Boolean);
}

function evidenceDigestFor(ids, evidenceById) {
  return ids.map((id) => evidenceById.get(id)?.sourceTextDigest ?? "").join(" ");
}

function checkMirror(publicPath, sourcePath, errors) {
  if (!existsSync(publicPath)) errors.push(`${publicPath}: missing public file`);
  if (!existsSync(sourcePath)) errors.push(`${sourcePath}: missing source mirror`);
  if (existsSync(publicPath) && existsSync(sourcePath)) {
    const publicRaw = readFileSync(publicPath, "utf8");
    const sourceRaw = readFileSync(sourcePath, "utf8");
    if (publicRaw !== sourceRaw) errors.push(`${basename(publicPath)}: public/source mirror mismatch`);
  }
}

const errors = [];
checkMirror(INDEX_PATH, SOURCE_INDEX_PATH, errors);

const index = existsSync(INDEX_PATH) ? readJson(INDEX_PATH) : { tickers: [], byTicker: {} };
const tickers = Array.isArray(index.tickers) ? index.tickers.map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean) : [];
const byTicker = index.byTicker && typeof index.byTicker === "object" ? index.byTicker : {};

if (tickers.length === 0) errors.push("index.json: tickers must not be empty");

let filingCount = 0;
let bulletCount = 0;
let evidenceCount = 0;

for (const ticker of tickers) {
  const manifestDataPath = byTicker[ticker];
  if (!manifestDataPath) {
    errors.push(`${ticker}: missing byTicker path`);
    continue;
  }
  const publicManifestPath = publicPathFromDataPath(manifestDataPath);
  const sourceManifestPath = sourcePathFromDataPath(manifestDataPath);
  checkMirror(publicManifestPath, sourceManifestPath, errors);
  if (!existsSync(publicManifestPath)) continue;

  const manifest = readJson(publicManifestPath);
  const filings = Array.isArray(manifest.filings) ? manifest.filings : [];
  if (filings.length === 0) errors.push(`${ticker}: manifest has no filings`);

  for (const filing of filings) {
    filingCount += 1;
    if (!filing.sourceUrl) errors.push(`${ticker}/${filing.accession}: missing sourceUrl`);
    if (!filing.summaryPath) continue;

    const publicArtifactPath = publicPathFromDataPath(filing.summaryPath);
    const sourceArtifactPath = sourcePathFromDataPath(filing.summaryPath);
    checkMirror(publicArtifactPath, sourceArtifactPath, errors);
    if (!existsSync(publicArtifactPath)) continue;

    const artifact = readJson(publicArtifactPath);
    const evidenceRows = Array.isArray(artifact.evidence) ? artifact.evidence : [];
    const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
    evidenceCount += evidenceRows.length;

    for (const evidence of evidenceRows) {
      if (!evidence.id) errors.push(`${ticker}/${filing.accession}: evidence row missing id`);
      if (!evidence.sourceUrl) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing sourceUrl`);
      if (!evidence.anchor) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing anchor`);
      if (!evidence.sourceTextDigest) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing sourceTextDigest`);
    }

    const oneLineDigest = canonical(evidenceRows.map((row) => row.sourceTextDigest ?? "").join(" "));
    for (const token of numericTokens(artifact.summaryKo?.oneLine ?? "")) {
      if (!oneLineDigest.includes(canonical(token))) {
        errors.push(`${ticker}/${filing.accession}/oneLine: numeric token '${token}' missing from artifact evidence digests`);
      }
    }

    for (const section of SUMMARY_SECTIONS) {
      const rows = artifact.summaryKo?.[section];
      if (!Array.isArray(rows)) {
        errors.push(`${ticker}/${filing.accession}: summaryKo.${section} must be an array`);
        continue;
      }
      for (const [index, bullet] of rows.entries()) {
        bulletCount += 1;
        const evidenceIds = Array.isArray(bullet.evidence) ? bullet.evidence : [];
        if (evidenceIds.length === 0) errors.push(`${ticker}/${filing.accession}/${section}[${index}]: missing evidence ids`);
        for (const id of evidenceIds) {
          if (!evidenceById.has(id)) errors.push(`${ticker}/${filing.accession}/${section}[${index}]: broken evidence id ${id}`);
        }
        const digest = canonical(evidenceDigestFor(evidenceIds, evidenceById));
        for (const token of numericTokens(bullet.text ?? "")) {
          if (!digest.includes(canonical(token))) {
            errors.push(`${ticker}/${filing.accession}/${section}[${index}]: numeric token '${token}' missing from cited evidence digest`);
          }
        }
      }
    }
  }
}

if (errors.length > 0) fail(errors);

console.log(`edgar summary evidence check passed (${tickers.length} tickers, ${filingCount} filings, ${bulletCount} bullets, ${evidenceCount} evidence rows)`);
