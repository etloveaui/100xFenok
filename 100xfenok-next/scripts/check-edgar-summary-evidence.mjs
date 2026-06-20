#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const ROOT = process.cwd();
const PUBLIC_ROOT = `${ROOT}/public/data/edgar-korean-summaries`;
const SOURCE_ROOT = `${ROOT}/../data/edgar-korean-summaries`;
const INDEX_PATH = `${PUBLIC_ROOT}/index.json`;
const SOURCE_INDEX_PATH = `${SOURCE_ROOT}/index.json`;
const SUMMARY_SECTIONS = ["keyPoints", "riskChanges", "businessChanges", "financialHighlights", "watchItems"];
const SUMMARY_STANCES = new Set(["fact", "management_claim", "feno_interpretation"]);
const MAX_EVIDENCE_DIGEST_CHARS = 1000;
const COMMA_GROUPED_NUMBER_RE = /(?:^|[^\d,])(\d+(?:,\d+)+)(?![\d,])/g;
const VALID_COMMA_GROUPED_NUMBER_RE = /^\d{1,3}(?:,\d{3})*$/;

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

function malformedCommaNumbers(text) {
  return [...String(text ?? "").matchAll(COMMA_GROUPED_NUMBER_RE)]
    .map((match) => match[1])
    .filter((token) => !VALID_COMMA_GROUPED_NUMBER_RE.test(token));
}

function checkNoMalformedCommaNumbers(label, text, errors) {
  for (const token of malformedCommaNumbers(text)) {
    errors.push(`${label}: malformed comma-grouped number '${token}'`);
  }
}

function evidenceDigestFor(ids, evidenceById) {
  return ids.map((id) => evidenceById.get(id)?.sourceTextDigest ?? "").join(" ");
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function expectEqual(actual, expected, label, errors) {
  if (actual !== expected) errors.push(`${label}: expected '${expected}', got '${actual}'`);
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
    expectEqual(artifact.schemaVersion, 1, `${ticker}/${filing.accession}: artifact.schemaVersion`, errors);
    expectEqual(
      artifact.artifactType,
      "edgar_korean_summary_pilot",
      `${ticker}/${filing.accession}: artifact.artifactType`,
      errors,
    );
    expectEqual(normalizeTicker(artifact.company?.ticker), ticker, `${ticker}/${filing.accession}: company.ticker`, errors);
    expectEqual(artifact.company?.cik, filing.cik, `${ticker}/${filing.accession}: company.cik`, errors);
    expectEqual(artifact.filing?.form, filing.form, `${ticker}/${filing.accession}: filing.form`, errors);
    expectEqual(artifact.filing?.accession, filing.accession, `${ticker}/${filing.accession}: filing.accession`, errors);
    expectEqual(artifact.filing?.filingDate, filing.filingDate, `${ticker}/${filing.accession}: filing.filingDate`, errors);
    expectEqual(artifact.filing?.periodEnd, filing.periodEnd, `${ticker}/${filing.accession}: filing.periodEnd`, errors);
    expectEqual(artifact.filing?.sourceUrl, filing.sourceUrl, `${ticker}/${filing.accession}: filing.sourceUrl`, errors);
    if (filing.summaryStatus !== "ready") errors.push(`${ticker}/${filing.accession}: summaryPath requires summaryStatus='ready'`);

    if (!artifact.summaryKo?.oneLine) errors.push(`${ticker}/${filing.accession}: summaryKo.oneLine is required`);
    checkNoMalformedCommaNumbers(`${ticker}/${filing.accession}/oneLine`, artifact.summaryKo?.oneLine ?? "", errors);
    if (filing.summaryOneLine && artifact.summaryKo?.oneLine !== filing.summaryOneLine) {
      errors.push(`${ticker}/${filing.accession}: manifest summaryOneLine must match artifact summaryKo.oneLine`);
    }
    if (!Array.isArray(artifact.sourceStatus?.sectionsRequested)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.sectionsRequested must be an array`);
    }
    if (!Array.isArray(artifact.sourceStatus?.sectionsExtracted)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.sectionsExtracted must be an array`);
    } else if (["10-K", "10-Q"].includes(String(filing.form ?? "").toUpperCase()) && artifact.sourceStatus.sectionsExtracted.length === 0) {
      errors.push(`${ticker}/${filing.accession}: ready ${filing.form} summary must include at least one extracted SEC filing section`);
    }
    if (!Array.isArray(artifact.sourceStatus?.missingSections)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.missingSections must be an array`);
    }
    if (!artifact.generation?.generatedAtUtc) errors.push(`${ticker}/${filing.accession}: generation.generatedAtUtc is required`);
    if (!artifact.generation?.promptVersion) errors.push(`${ticker}/${filing.accession}: generation.promptVersion is required`);
    if (!artifact.generation?.model) errors.push(`${ticker}/${filing.accession}: generation.model is required`);
    if (Number(artifact.generation?.costUsedUsd) !== 0) {
      errors.push(`${ticker}/${filing.accession}: generation.costUsedUsd must be 0`);
    }
    if (artifact.generation?.paidQuotaUsed !== false) {
      errors.push(`${ticker}/${filing.accession}: generation.paidQuotaUsed must be false`);
    }

    const evidenceRows = Array.isArray(artifact.evidence) ? artifact.evidence : [];
    const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
    evidenceCount += evidenceRows.length;
    if (["10-K", "10-Q"].includes(String(filing.form ?? "").toUpperCase())) {
      const filingDigestCount = evidenceRows.filter((row) => row.kind === "filing_digest").length;
      if (filingDigestCount === 0) {
        errors.push(`${ticker}/${filing.accession}: ready ${filing.form} summary must include filing_digest evidence`);
      }
    }

    for (const evidence of evidenceRows) {
      if (!evidence.id) errors.push(`${ticker}/${filing.accession}: evidence row missing id`);
      if (!evidence.sourceUrl) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing sourceUrl`);
      if (!evidence.anchor) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing anchor`);
      if (!evidence.sourceTextDigest) errors.push(`${ticker}/${filing.accession}/${evidence.id}: missing sourceTextDigest`);
      if (String(evidence.sourceTextDigest ?? "").length > MAX_EVIDENCE_DIGEST_CHARS) {
        errors.push(`${ticker}/${filing.accession}/${evidence.id}: sourceTextDigest exceeds ${MAX_EVIDENCE_DIGEST_CHARS} chars`);
      }
      checkNoMalformedCommaNumbers(`${ticker}/${filing.accession}/${evidence.id}`, evidence.sourceTextDigest ?? "", errors);
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
        if (!bullet?.text) errors.push(`${ticker}/${filing.accession}/${section}[${index}]: missing text`);
        checkNoMalformedCommaNumbers(`${ticker}/${filing.accession}/${section}[${index}]`, bullet?.text ?? "", errors);
        if (!SUMMARY_STANCES.has(bullet?.stance)) {
          errors.push(`${ticker}/${filing.accession}/${section}[${index}]: invalid stance '${bullet?.stance}'`);
        }
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
