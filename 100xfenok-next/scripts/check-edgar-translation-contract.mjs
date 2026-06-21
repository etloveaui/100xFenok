#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

const ROOT = process.cwd();
const INDEX_PATH = `${ROOT}/public/data/edgar-korean-summaries/index.json`;
const SOURCE_INDEX_PATH = `${ROOT}/../data/edgar-korean-summaries/index.json`;
const TRANSLATION_ARTIFACT_TYPE = "edgar_korean_translation";
const DISALLOWED_SOURCE_TEXT_KEYS = new Set(["sourceText", "sourceTextRaw", "originalText", "englishText"]);
const COMMA_GROUPED_NUMBER_RE = /(?:^|[^\d,])(\d+(?:,\d+)+)(?![\d,])/g;
const VALID_COMMA_GROUPED_NUMBER_RE = /^\d{1,3}(?:,\d{3})*$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(errors) {
  console.error("edgar translation contract check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

function publicPathFromDataPath(dataPath) {
  return `${ROOT}/public${dataPath}`;
}

function sourcePathFromDataPath(dataPath) {
  return `${ROOT}/..${dataPath}`;
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function safePathSlug(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function canonicalTranslationPath(ticker, form, accession) {
  const slug = `${safePathSlug(ticker)}-${safePathSlug(form)}-${safePathSlug(accession)}`;
  return `/data/edgar-korean-summaries/translations/${slug}.json`;
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
  return ids.map((id) => evidenceById?.get(id)?.sourceTextDigest ?? "").join(" ");
}

function expectEqual(actual, expected, label, errors) {
  if (actual !== expected) errors.push(`${label}: expected '${expected}', got '${actual}'`);
}

function requireText(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${label}: required text is empty`);
}

function requireMeaningfulScopeNote(value, label, errors) {
  requireText(value, label, errors);
  const note = String(value ?? "");
  if (!/(AI|인공지능)/i.test(note)) errors.push(`${label}: must state that the Korean rendering is AI-generated`);
  if (!/(공식|법률|법적|비공식|원문)/.test(note)) errors.push(`${label}: must state official/legal/verbatim translation limits`);
}

function requireIsoUtc(value, label, errors) {
  requireText(value, label, errors);
  if (!ISO_UTC_RE.test(String(value ?? "")) || Number.isNaN(Date.parse(value))) {
    errors.push(`${label}: must be ISO UTC timestamp ending with Z`);
  }
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

function assertNoEmbeddedSourceText(value, label, errors) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const childLabel = `${label}.${key}`;
    if (DISALLOWED_SOURCE_TEXT_KEYS.has(key) && typeof child === "string" && child.trim().length > 0) {
      errors.push(`${childLabel}: do not embed long SEC source text in translation artifacts`);
    }
    if (Array.isArray(child)) {
      child.forEach((item, index) => assertNoEmbeddedSourceText(item, `${childLabel}[${index}]`, errors));
    } else if (child && typeof child === "object") {
      assertNoEmbeddedSourceText(child, childLabel, errors);
    }
  }
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

function validateTranslationArtifact(artifact, filing, ticker, label, errors, sourceEvidenceById = null) {
  expectEqual(artifact.schemaVersion, 1, `${label}: schemaVersion`, errors);
  expectEqual(artifact.artifactType, TRANSLATION_ARTIFACT_TYPE, `${label}: artifactType`, errors);
  expectEqual(normalizeTicker(artifact.company?.ticker), ticker, `${label}: company.ticker`, errors);
  expectEqual(artifact.company?.cik, filing.cik, `${label}: company.cik`, errors);
  expectEqual(artifact.filing?.form, filing.form, `${label}: filing.form`, errors);
  expectEqual(artifact.filing?.accession, filing.accession, `${label}: filing.accession`, errors);
  expectEqual(artifact.filing?.filingDate, filing.filingDate, `${label}: filing.filingDate`, errors);
  expectEqual(artifact.filing?.periodEnd, filing.periodEnd, `${label}: filing.periodEnd`, errors);
  expectEqual(artifact.filing?.sourceUrl, filing.sourceUrl, `${label}: filing.sourceUrl`, errors);
  if (filing.summaryPath) {
    if (!artifact.sourceSummaryPath) {
      errors.push(`${label}: sourceSummaryPath is required when the manifest has summaryPath`);
    } else {
      expectEqual(artifact.sourceSummaryPath, filing.summaryPath, `${label}: sourceSummaryPath`, errors);
    }
  }

  requireText(artifact.translationKo?.title, `${label}: translationKo.title`, errors);
  requireMeaningfulScopeNote(artifact.translationKo?.scopeNote, `${label}: translationKo.scopeNote`, errors);
  const sections = Array.isArray(artifact.translationKo?.sections) ? artifact.translationKo.sections : [];
  if (sections.length === 0) errors.push(`${label}: translationKo.sections must not be empty`);
  for (const [index, section] of sections.entries()) {
    requireText(section?.id, `${label}: translationKo.sections[${index}].id`, errors);
    requireText(section?.sourceSection, `${label}: translationKo.sections[${index}].sourceSection`, errors);
    requireText(section?.titleKo, `${label}: translationKo.sections[${index}].titleKo`, errors);
    requireText(section?.bodyKo, `${label}: translationKo.sections[${index}].bodyKo`, errors);
    checkNoMalformedCommaNumbers(`${label}: translationKo.sections[${index}].bodyKo`, section?.bodyKo ?? "", errors);
    if (!Array.isArray(section?.sourceAnchors) || section.sourceAnchors.length === 0) {
      errors.push(`${label}: translationKo.sections[${index}].sourceAnchors must not be empty`);
    } else {
      section.sourceAnchors.forEach((anchor, anchorIndex) => {
        requireText(anchor, `${label}: translationKo.sections[${index}].sourceAnchors[${anchorIndex}]`, errors);
        if (sourceEvidenceById && !sourceEvidenceById.has(anchor)) {
          errors.push(`${label}: translationKo.sections[${index}].sourceAnchors[${anchorIndex}] broken evidence id ${anchor}`);
        }
      });
      if (sourceEvidenceById) {
        const digest = canonical(evidenceDigestFor(section.sourceAnchors, sourceEvidenceById));
        for (const token of numericTokens(section.bodyKo ?? "")) {
          if (!digest.includes(canonical(token))) {
            errors.push(`${label}: translationKo.sections[${index}].bodyKo numeric token '${token}' missing from cited evidence digest`);
          }
        }
      }
    }
  }

  requireIsoUtc(artifact.generation?.generatedAtUtc, `${label}: generation.generatedAtUtc`, errors);
  requireText(artifact.generation?.promptVersion, `${label}: generation.promptVersion`, errors);
  requireText(artifact.generation?.model, `${label}: generation.model`, errors);
  if (typeof artifact.generation?.paidQuotaUsed !== "boolean") {
    errors.push(`${label}: generation.paidQuotaUsed must be boolean`);
  }
  if (typeof artifact.generation?.costUsedUsd !== "number" || !Number.isFinite(artifact.generation.costUsedUsd)) {
    errors.push(`${label}: generation.costUsedUsd must be finite number`);
  } else if (artifact.generation.costUsedUsd < 0) {
    errors.push(`${label}: generation.costUsedUsd must not be negative`);
  }
  checkGenerationCostPolicy(artifact.generation, label, errors);
  assertNoEmbeddedSourceText(artifact, label, errors);
}

function validateFixtureSmoke(errors) {
  const filing = {
    ticker: "NVDA",
    cik: "0001045810",
    form: "10-K",
    accession: "0001045810-26-000021",
    filingDate: "2026-02-25",
    periodEnd: "2026-01-25",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/",
    summaryPath: "/data/edgar-korean-summaries/pilot/nvda-10-k-0001045810-26-000021.json",
  };
  const artifact = {
    schemaVersion: 1,
    artifactType: TRANSLATION_ARTIFACT_TYPE,
    company: { ticker: "NVDA", cik: "0001045810", name: "NVIDIA Corporation" },
    filing: {
      form: "10-K",
      accession: "0001045810-26-000021",
      filingDate: "2026-02-25",
      periodEnd: "2026-01-25",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/",
    },
    sourceSummaryPath: "/data/edgar-korean-summaries/pilot/nvda-10-k-0001045810-26-000021.json",
    translationKo: {
      title: "NVIDIA 10-K 한글 번역",
      scopeNote: "AI가 선택 섹션을 한국어로 재구성한 비공식 참고 번역이며, 공식 법률 번역이나 원문 대체물이 아닙니다.",
      sections: [
        {
          id: "item_7",
          sourceSection: "Item 7 · MD&A",
          titleKo: "경영진 논의와 분석",
          bodyKo: "Data Center 매출은 68% 증가했습니다.",
          sourceAnchors: ["item7_growth_01"],
        },
      ],
    },
    generation: {
      generatedAtUtc: "2026-06-21T00:00:00Z",
      promptVersion: "fixture",
      model: "fixture",
      costUsedUsd: 0,
      paidQuotaUsed: false,
    },
  };
  const sourceEvidenceById = new Map([
    [
      "item7_growth_01",
      {
        id: "item7_growth_01",
        sourceTextDigest: "FY2026 revenue rose 65%; Data Center revenue rose 68%; AI and accelerated computing drove growth.",
      },
    ],
  ]);
  validateTranslationArtifact(artifact, filing, "NVDA", "fixture", errors, sourceEvidenceById);
}

const errors = [];
validateFixtureSmoke(errors);
checkMirror(INDEX_PATH, SOURCE_INDEX_PATH, errors);

const index = existsSync(INDEX_PATH) ? readJson(INDEX_PATH) : { tickers: [], byTicker: {} };
const tickers = Array.isArray(index.tickers) ? index.tickers.map(normalizeTicker).filter(Boolean) : [];
const byTicker = index.byTicker && typeof index.byTicker === "object" ? index.byTicker : {};

if (tickers.length === 0) errors.push("index.json: tickers must not be empty");

let filingCount = 0;
let translationCount = 0;

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
    if (!filing.translationPath) continue;
    translationCount += 1;
    if (filing.translationStatus !== "ready") {
      errors.push(`${ticker}/${filing.accession}: translationPath requires translationStatus='ready'`);
      continue;
    }
    const expectedTranslationPath = canonicalTranslationPath(ticker, filing.form, filing.accession);
    if (filing.translationPath !== expectedTranslationPath) {
      errors.push(`${ticker}/${filing.accession}: translationPath must be '${expectedTranslationPath}'`);
    }
    const publicTranslationPath = publicPathFromDataPath(filing.translationPath);
    const sourceTranslationPath = sourcePathFromDataPath(filing.translationPath);
    checkMirror(publicTranslationPath, sourceTranslationPath, errors);
    if (!existsSync(publicTranslationPath)) continue;
    const artifact = readJson(publicTranslationPath);
    let sourceEvidenceById = null;
    const summaryPath = artifact.sourceSummaryPath || filing.summaryPath;
    if (summaryPath) {
      const publicSummaryPath = publicPathFromDataPath(summaryPath);
      const sourceSummaryPath = sourcePathFromDataPath(summaryPath);
      checkMirror(publicSummaryPath, sourceSummaryPath, errors);
      if (existsSync(publicSummaryPath)) {
        const summaryArtifact = readJson(publicSummaryPath);
        const evidenceRows = Array.isArray(summaryArtifact.evidence) ? summaryArtifact.evidence : [];
        sourceEvidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
      }
    }
    validateTranslationArtifact(artifact, filing, ticker, `${ticker}/${filing.accession}`, errors, sourceEvidenceById);
  }
}

if (errors.length > 0) fail(errors);

console.log(`edgar translation contract check passed (${tickers.length} tickers, ${filingCount} filings, ${translationCount} translations)`);
