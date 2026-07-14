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
const ARTIFACT_STATUSES = new Set(["ready", "pending", "failed", "unavailable", "not_available"]);
const MAX_EVIDENCE_DIGEST_CHARS = 1000;
const COMMA_GROUPED_NUMBER_RE = /(?:^|[^\d,])(\d+(?:,\d+)+)(?![\d,])/g;
const VALID_COMMA_GROUPED_NUMBER_RE = /^\d{1,3}(?:,\d{3})*$/;
const FORM_SECTION_REQUESTS = {
  "10-K": ["item_1", "item_1a", "item_7"],
  "10-Q": ["item_1a", "item_7"],
  "8-K": ["item_2_02", "exhibit_99_1"],
  "20-F": ["item_3d", "item_5"],
  "40-F": ["risk_factors", "mda"],
  "6-K": ["foreign_report"],
};
const FORM_REQUIRED_EXTRACTED = {
  "10-K": ["item_1a", "item_7"],
  "10-Q": ["item_1a", "item_7"],
  "8-K": ["exhibit_99_1"],
  "20-F": ["item_3d", "item_5"],
  "40-F": ["risk_factors", "mda"],
  "6-K": ["foreign_report"],
};

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
    .replace(/\d{4}\s*년/g, "")
    .replace(/FY\s*\d{4}/gi, "")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/상위\s*\d+\s*개/g, "")
    .replace(/\b(?:8|10)\s*-\s*[KQ]\b/gi, "")
    .replace(/Item\s*\d+[A-Z]?/gi, "");
  return [...cleaned.matchAll(/(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|%p|포인트|points?|조|억|만|달러|B)?/g)]
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

function expectArrayEqual(actual, expected, label, errors) {
  const actualText = Array.isArray(actual) ? actual.join(",") : String(actual);
  const expectedText = expected.join(",");
  if (actualText !== expectedText) errors.push(`${label}: expected '${expectedText}', got '${actualText}'`);
}

function checkMirror(publicPath, sourcePath, errors, noteDegraded, label) {
  const publicExists = existsSync(publicPath);
  const sourceExists = existsSync(sourcePath);
  if (!publicExists && !sourceExists) {
    noteDegraded("missing_artifact", `${label}: source and public artifact are both unavailable`);
    return false;
  }
  if (!publicExists || !sourceExists) {
    errors.push(`${label}: root/public mirror divergence (public=${publicExists}, source=${sourceExists})`);
    return false;
  }
  if (publicExists && sourceExists) {
    const publicRaw = readFileSync(publicPath, "utf8");
    const sourceRaw = readFileSync(sourcePath, "utf8");
    if (publicRaw !== sourceRaw) errors.push(`${basename(publicPath)}: public/source mirror mismatch`);
  }
  return true;
}

function isApprovedPaidGeneration(generation) {
  return generation?.provider === "deepseek_api"
    && generation?.model === "deepseek-v4-flash"
    && generation?.paidQuotaUsed === true
    && typeof generation?.costUsedUsd === "number"
    && Number.isFinite(generation.costUsedUsd)
    && generation.costUsedUsd > 0;
}

function checkGenerationCostPolicy(generation, label, errors) {
  const isFree =
    generation?.paidQuotaUsed === false &&
    typeof generation?.costUsedUsd === "number" &&
    Number(generation.costUsedUsd) === 0;
  if (isFree || isApprovedPaidGeneration(generation)) return;
  errors.push(
    `${label}: generation cost policy must be free-tier or approved deepseek-v4-flash paid fallback`,
  );
}

const errors = [];
const degradedCounts = new Map();
const degradedSamples = new Map();
function noteDegraded(key, message) {
  degradedCounts.set(key, (degradedCounts.get(key) ?? 0) + 1);
  const samples = degradedSamples.get(key) ?? [];
  if (samples.length < 5) samples.push(message);
  degradedSamples.set(key, samples);
}

const indexAvailable = checkMirror(
  INDEX_PATH,
  SOURCE_INDEX_PATH,
  errors,
  noteDegraded,
  "EDGAR summary index",
);

const index = indexAvailable ? readJson(INDEX_PATH) : { tickers: [], byTicker: {} };
if (indexAvailable && index.schemaVersion !== 1) errors.push("index.schemaVersion must be 1");
if (indexAvailable && index.artifactType !== "edgar_korean_summary_index") errors.push("index.artifactType is invalid");
if (indexAvailable && !Array.isArray(index.tickers)) errors.push("index.tickers must be an array");
if (indexAvailable && (!index.byTicker || typeof index.byTicker !== "object" || Array.isArray(index.byTicker))) {
  errors.push("index.byTicker must be an object");
}
const tickers = Array.isArray(index.tickers) ? index.tickers.map((ticker) => String(ticker).trim().toUpperCase()) : [];
const byTicker = index.byTicker && typeof index.byTicker === "object" && !Array.isArray(index.byTicker) ? index.byTicker : {};
if (tickers.some((ticker) => !ticker)) errors.push("index.tickers contains a missing ticker identity");
if (new Set(tickers).size !== tickers.length) errors.push("index.tickers contains duplicate ticker identities");
const byTickerKeys = Object.keys(byTicker).sort();
if (indexAvailable && JSON.stringify([...tickers].sort()) !== JSON.stringify(byTickerKeys)) {
  errors.push("index.tickers and index.byTicker keys must reconcile exactly");
}

if (tickers.length === 0) noteDegraded("empty_index", "index.json has no enrolled tickers");

let filingCount = 0;
let bulletCount = 0;
let evidenceCount = 0;

for (const ticker of tickers) {
  const manifestDataPath = byTicker[ticker];
  if (typeof manifestDataPath !== "string" || !manifestDataPath.startsWith("/data/edgar-korean-summaries/")) {
    errors.push(`${ticker}: missing byTicker path`);
    continue;
  }
  const publicManifestPath = publicPathFromDataPath(manifestDataPath);
  const sourceManifestPath = sourcePathFromDataPath(manifestDataPath);
  const manifestAvailable = checkMirror(
    publicManifestPath,
    sourceManifestPath,
    errors,
    noteDegraded,
    `${ticker}: filing manifest`,
  );
  if (!manifestAvailable) continue;

  const manifest = readJson(publicManifestPath);
  if (manifest.schemaVersion !== 1) errors.push(`${ticker}: manifest.schemaVersion must be 1`);
  if (manifest.artifactType !== "edgar_korean_summary_ticker_manifest") errors.push(`${ticker}: manifest.artifactType is invalid`);
  if (normalizeTicker(manifest.ticker) !== ticker) errors.push(`${ticker}: manifest ticker identity mismatch`);
  if (!Array.isArray(manifest.filings)) errors.push(`${ticker}: manifest.filings must be an array`);
  const filings = Array.isArray(manifest.filings) ? manifest.filings : [];
  const accessions = filings.map((filing) => String(filing?.accession ?? "").trim());
  if (accessions.some((accession) => !accession)) errors.push(`${ticker}: filing missing accession identity`);
  if (new Set(accessions).size !== accessions.length) errors.push(`${ticker}: duplicate filing accession identity`);
  if (filings.length === 0) noteDegraded("empty_manifest", `${ticker}: manifest has no filings`);

  for (const filing of filings) {
    filingCount += 1;
    if (!ARTIFACT_STATUSES.has(filing.translationStatus)) errors.push(`${ticker}/${filing.accession}: invalid translationStatus '${filing.translationStatus}'`);
    if (!ARTIFACT_STATUSES.has(filing.summaryStatus)) errors.push(`${ticker}/${filing.accession}: invalid summaryStatus '${filing.summaryStatus}'`);
    if (!filing.sourceUrl) errors.push(`${ticker}/${filing.accession}: missing sourceUrl`);
    if (filing.translationStatus === "ready") {
      if (!filing.translationPath) {
        errors.push(`${ticker}/${filing.accession}: translationStatus='ready' requires translationPath`);
      } else {
        const translationAvailable = checkMirror(
          publicPathFromDataPath(filing.translationPath),
          sourcePathFromDataPath(filing.translationPath),
          errors,
          noteDegraded,
          `${ticker}/${filing.accession}: translation`,
        );
        if (!translationAvailable) {
          errors.push(`${ticker}/${filing.accession}: false-ready translation artifact is unavailable`);
        }
      }
    }
    if (filing.translationPath && filing.translationStatus !== "ready") {
      errors.push(`${ticker}/${filing.accession}: translationPath requires translationStatus='ready'`);
    }
    if (!filing.summaryPath) {
      if (filing.summaryStatus === "ready") {
        errors.push(`${ticker}/${filing.accession}: summaryStatus='ready' requires summaryPath`);
      } else {
        noteDegraded("summary_pending", `${ticker}/${filing.accession}: summary is ${filing.summaryStatus ?? "unavailable"}`);
      }
      continue;
    }

    const publicArtifactPath = publicPathFromDataPath(filing.summaryPath);
    const sourceArtifactPath = sourcePathFromDataPath(filing.summaryPath);
    const summaryAvailable = checkMirror(
      publicArtifactPath,
      sourceArtifactPath,
      errors,
      noteDegraded,
      `${ticker}/${filing.accession}: summary`,
    );
    if (!summaryAvailable) {
      if (filing.summaryStatus === "ready") {
        errors.push(`${ticker}/${filing.accession}: false-ready summary artifact is unavailable`);
      }
      continue;
    }

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
    const form = String(filing.form ?? "").toUpperCase();
    if (!Array.isArray(artifact.sourceStatus?.sectionsRequested)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.sectionsRequested must be an array`);
    } else if (form in FORM_SECTION_REQUESTS) {
      expectArrayEqual(
        artifact.sourceStatus.sectionsRequested,
        FORM_SECTION_REQUESTS[form],
        `${ticker}/${filing.accession}: sourceStatus.sectionsRequested`,
        errors,
      );
    }
    if (!Array.isArray(artifact.sourceStatus?.sectionsExtracted)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.sectionsExtracted must be an array`);
    } else if (["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"].includes(form) && artifact.sourceStatus.sectionsExtracted.length === 0) {
      errors.push(`${ticker}/${filing.accession}: ready ${filing.form} summary must include at least one extracted SEC filing section`);
    } else if (form in FORM_REQUIRED_EXTRACTED) {
      const extracted = new Set(artifact.sourceStatus.sectionsExtracted);
      const hasRequiredSection = FORM_REQUIRED_EXTRACTED[form].some((section) => extracted.has(section));
      if (!hasRequiredSection) {
        errors.push(`${ticker}/${filing.accession}: ready ${filing.form} summary must include one of ${FORM_REQUIRED_EXTRACTED[form].join(",")}`);
      }
    }
    if (!Array.isArray(artifact.sourceStatus?.missingSections)) {
      errors.push(`${ticker}/${filing.accession}: sourceStatus.missingSections must be an array`);
    }
    if (!artifact.generation?.generatedAtUtc) errors.push(`${ticker}/${filing.accession}: generation.generatedAtUtc is required`);
    if (!artifact.generation?.promptVersion) errors.push(`${ticker}/${filing.accession}: generation.promptVersion is required`);
    if (!artifact.generation?.model) errors.push(`${ticker}/${filing.accession}: generation.model is required`);
    checkGenerationCostPolicy(artifact.generation, `${ticker}/${filing.accession}`, errors);

    const evidenceRows = Array.isArray(artifact.evidence) ? artifact.evidence : [];
    if (!Array.isArray(artifact.evidence)) errors.push(`${ticker}/${filing.accession}: evidence must be an array`);
    const evidenceIds = evidenceRows.map((row) => String(row?.id ?? "").trim());
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      errors.push(`${ticker}/${filing.accession}: duplicate evidence ids`);
    }
    const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
    evidenceCount += evidenceRows.length;
    if (["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"].includes(String(filing.form ?? "").toUpperCase())) {
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

const warnings = [...degradedCounts.entries()].map(([key, count]) => ({
  key,
  count,
  samples: degradedSamples.get(key) ?? [],
}));
for (const warning of warnings) {
  console.warn(`::warning:: EDGAR lane degraded: ${warning.key}=${warning.count}; ${warning.samples.join(" | ")}`);
}
console.log(JSON.stringify({
  ok: true,
  status: warnings.length > 0 ? "degraded" : "ready",
  counts: { tickers: tickers.length, filings: filingCount, bullets: bulletCount, evidence_rows: evidenceCount },
  warnings,
}, null, 2));
