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
const RAW_ENGLISH_SCALE_RE = /\b(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:million|billion|trillion)\b/gi;
const RAW_MILLION_KO_RE = /(?:^|[^\d,])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*백만\s*달러)/g;
const RAW_USD_PARENTHESES_RE = /\(\s*USD\s+[0-9,.]+\s*[BM]\s*\)/gi;
const LARGE_EOK_AMOUNT_RE = /(?:^|[^\d,])((\d{1,3}(?:,\d{3})+|\d+)억(?:\s*(\d{1,3}(?:,\d{3})*)만)?\s*달러)/g;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const FOREIGN_FORMS = new Set(["6-K", "20-F", "40-F"]);

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

function normalizeCik(cik) {
  const raw = String(cik ?? "").trim();
  if (!/^\d+$/.test(raw) || raw.length > 10) return "";
  return raw.padStart(10, "0");
}

function accessionDigits(accession) {
  const normalized = String(accession ?? "").trim();
  return /^\d{10}-\d{2}-\d{6}$/.test(normalized) ? normalized.replace(/-/g, "") : "";
}

function secArchiveIdentity(sourceUrl) {
  try {
    const parsed = new URL(String(sourceUrl ?? ""));
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.sec.gov") return null;
    const match = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})(?:\/|$)/i.exec(parsed.pathname);
    if (!match) return null;
    return { cik: normalizeCik(match[1]), accession: match[2] };
  } catch {
    return null;
  }
}

function checkForeignFilingIdentity(filing, expectedTicker, label, errors, expectedCik = null) {
  const form = String(filing?.form ?? "").trim().toUpperCase();
  if (!FOREIGN_FORMS.has(form)) return;
  const ticker = normalizeTicker(filing?.ticker);
  const cik = normalizeCik(filing?.cik);
  const manifestCik = normalizeCik(expectedCik);
  const accession = String(filing?.accession ?? "").trim();
  const accessionId = accessionDigits(accession);
  const sourceIdentity = secArchiveIdentity(filing?.sourceUrl);
  if (!ticker || ticker !== normalizeTicker(expectedTicker)) {
    errors.push(`${label}: foreign filing ticker identity is not bound to manifest ticker`);
  }
  if (!cik || cik === "0000000000") errors.push(`${label}: foreign filing requires a non-zero CIK`);
  if (expectedCik !== null && (!manifestCik || cik !== manifestCik)) {
    errors.push(`${label}: foreign filing CIK is not bound to manifest CIK`);
  }
  if (!accessionId) errors.push(`${label}: foreign filing requires a canonical accession`);
  if (!sourceIdentity) errors.push(`${label}: foreign filing sourceUrl must be a SEC archive URL`);
  if (sourceIdentity && (sourceIdentity.cik !== cik || sourceIdentity.accession !== accessionId)) {
    errors.push(`${label}: foreign filing sourceUrl is not bound to its CIK/accession`);
  }
}

function checkForeignEvidenceIdentity(evidence, filing, label, errors) {
  const form = String(filing?.form ?? "").trim().toUpperCase();
  if (!FOREIGN_FORMS.has(form)) return;
  const sourceIdentity = secArchiveIdentity(evidence?.sourceUrl);
  const filingCik = normalizeCik(filing?.cik);
  const filingAccession = accessionDigits(filing?.accession);
  if (!sourceIdentity) {
    errors.push(`${label}: foreign evidence sourceUrl must be a SEC archive URL`);
    return;
  }
  if (sourceIdentity.cik !== filingCik || sourceIdentity.accession !== filingAccession) {
    errors.push(`${label}: foreign evidence sourceUrl is not bound to filing CIK/accession`);
  }
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

function checkNoRawEnglishScale(label, text, errors) {
  for (const match of String(text ?? "").matchAll(RAW_ENGLISH_SCALE_RE)) {
    errors.push(`${label}: raw English scale amount '${match[0]}' must use Korean 조/억/만 units`);
  }
}

function checkNoRawMillionKo(label, text, errors) {
  for (const match of String(text ?? "").matchAll(RAW_MILLION_KO_RE)) {
    errors.push(`${label}: raw million-dollar amount '${match[1]}' must use Korean 조/억/만 units`);
  }
}

function checkNoRawUsdParentheses(label, text, errors) {
  for (const match of String(text ?? "").matchAll(RAW_USD_PARENTHESES_RE)) {
    errors.push(`${label}: raw USD parenthetical '${match[0]}' must be omitted when Korean units are available`);
  }
}

function checkNoLargeEok(label, text, errors) {
  for (const match of String(text ?? "").matchAll(LARGE_EOK_AMOUNT_RE)) {
    const eok = Number(String(match[2]).replace(/,/g, ""));
    if (Number.isFinite(eok) && eok >= 10000) {
      errors.push(`${label}: large 억 amount '${match[1]}' must use 조/억 units`);
    }
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
  checkForeignFilingIdentity(filing, ticker, label, errors);
  expectEqual(artifact.schemaVersion, 1, `${label}: schemaVersion`, errors);
  expectEqual(artifact.artifactType, TRANSLATION_ARTIFACT_TYPE, `${label}: artifactType`, errors);
  expectEqual(normalizeTicker(artifact.company?.ticker), ticker, `${label}: company.ticker`, errors);
  expectEqual(artifact.company?.cik, filing.cik, `${label}: company.cik`, errors);
  expectEqual(artifact.filing?.form, filing.form, `${label}: filing.form`, errors);
  expectEqual(artifact.filing?.accession, filing.accession, `${label}: filing.accession`, errors);
  expectEqual(artifact.filing?.filingDate, filing.filingDate, `${label}: filing.filingDate`, errors);
  expectEqual(artifact.filing?.periodEnd, filing.periodEnd, `${label}: filing.periodEnd`, errors);
  expectEqual(artifact.filing?.sourceUrl, filing.sourceUrl, `${label}: filing.sourceUrl`, errors);
  checkForeignFilingIdentity(
    {
      ticker: artifact.company?.ticker,
      cik: artifact.company?.cik,
      form: artifact.filing?.form,
      accession: artifact.filing?.accession,
      sourceUrl: artifact.filing?.sourceUrl,
    },
    ticker,
    `${label}: artifact filing`,
    errors,
    filing.cik,
  );
  if (FOREIGN_FORMS.has(String(filing?.form ?? "").trim().toUpperCase()) && !sourceEvidenceById) {
    errors.push(`${label}: foreign translation requires source summary evidence`);
  }
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
    checkNoRawEnglishScale(`${label}: translationKo.sections[${index}].bodyKo`, section?.bodyKo ?? "", errors);
    checkNoRawMillionKo(`${label}: translationKo.sections[${index}].bodyKo`, section?.bodyKo ?? "", errors);
    checkNoRawUsdParentheses(`${label}: translationKo.sections[${index}].bodyKo`, section?.bodyKo ?? "", errors);
    checkNoLargeEok(`${label}: translationKo.sections[${index}].bodyKo`, section?.bodyKo ?? "", errors);
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
        for (const anchor of section.sourceAnchors) {
          if (sourceEvidenceById.has(anchor)) {
            checkForeignEvidenceIdentity(
              sourceEvidenceById.get(anchor),
              filing,
              `${label}: translationKo.sections[${index}].sourceAnchors/${anchor}`,
              errors,
            );
          }
        }
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

function validateForeignFixtureSmoke(errors) {
  const fixtures = [
    {
      ticker: "BMO",
      cik: "0000927971",
      form: "6-K",
      accession: "0001193125-26-271288",
      filingDate: "2026-06-15",
      periodEnd: "2026-06-15",
      primaryDocument: "bmo-6k.htm",
      sourceSection: "Foreign report",
    },
    {
      ticker: "ARM",
      cik: "0001973239",
      form: "20-F",
      accession: "0001973239-26-000097",
      filingDate: "2026-05-26",
      periodEnd: "2026-03-31",
      primaryDocument: "arm-20260331.htm",
      sourceSection: "Item 3.D and Item 5",
    },
    {
      ticker: "SHOP",
      cik: "0001594805",
      form: "40-F",
      accession: "0001594805-26-000001",
      filingDate: "2026-03-01",
      periodEnd: "2025-12-31",
      primaryDocument: "shop-40f.htm",
      sourceSection: "Risk factors and MD&A",
    },
  ];
  for (const fixture of fixtures) {
    const archiveAccession = fixture.accession.replace(/-/g, "");
    const sourceUrl = "https://www.sec.gov/Archives/edgar/data/" + fixture.cik.replace(/^0+/, "") + "/" + archiveAccession + "/" + fixture.primaryDocument;
    const evidenceId = fixture.form.toLowerCase().replace("-", "_") + "_fixture";
    const filing = {
      ...fixture,
      sourceUrl,
      summaryPath: "/data/edgar-korean-summaries/pilot/" + evidenceId + "-summary.json",
    };
    const artifact = {
      schemaVersion: 1,
      artifactType: TRANSLATION_ARTIFACT_TYPE,
      company: { ticker: fixture.ticker, cik: fixture.cik, name: fixture.ticker + " fixture" },
      filing: {
        form: fixture.form,
        accession: fixture.accession,
        filingDate: fixture.filingDate,
        periodEnd: fixture.periodEnd,
        sourceUrl,
      },
      sourceSummaryPath: filing.summaryPath,
      translationKo: {
        title: fixture.ticker + " " + fixture.form + " 한글 번역",
        scopeNote: "AI가 선택 섹션을 한국어로 재구성한 비공식 참고 번역이며, 공식 법률 번역이나 원문 대체물이 아닙니다.",
        sections: [{
          id: "foreign_fixture",
          sourceSection: fixture.sourceSection,
          titleKo: fixture.sourceSection + " 요약",
          bodyKo: "공시 원문에 기반한 참고 번역입니다.",
          sourceAnchors: [evidenceId],
        }],
      },
      generation: {
        generatedAtUtc: "2026-06-21T00:00:00Z",
        promptVersion: "fixture-foreign",
        model: "fixture",
        costUsedUsd: 0,
        paidQuotaUsed: false,
      },
    };
    const sourceEvidenceById = new Map([[
      evidenceId,
      {
        id: evidenceId,
        sourceTextDigest: fixture.form + " source digest",
        sourceUrl: "https://www.sec.gov/Archives/edgar/data/" + fixture.cik.replace(/^0+/, "") + "/" + archiveAccession + "/exhibit.htm",
      },
    ]]);
    validateTranslationArtifact(artifact, filing, fixture.ticker, "foreign-fixture/" + fixture.form, errors, sourceEvidenceById);
  }
  const base = {
    ticker: "ARM",
    cik: "0001973239",
    form: "20-F",
    accession: "0001973239-26-000097",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1973239/000197323926000097/arm-20260331.htm",
  };
  const rejected = [
    ["missing ticker", { ...base, ticker: undefined }],
    ["spoofed ticker", { ...base, ticker: "NVDA" }],
    ["wrong CIK", { ...base, cik: "0001086888" }],
    ["malformed CIK", { ...base, cik: "x0001973239" }],
    ["wrong source URL", { ...base, sourceUrl: "https://example.com/filing" }],
  ];
  for (const [name, candidate] of rejected) {
    const candidateErrors = [];
    checkForeignFilingIdentity(candidate, "ARM", "translation-fixture-" + name, candidateErrors, "0001973239");
    if (candidateErrors.length === 0) errors.push("translation fixture " + name + ": foreign identity was not rejected");
  }
}

const errors = [];
validateFixtureSmoke(errors);
validateForeignFixtureSmoke(errors);
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
    checkForeignFilingIdentity(filing, ticker, `${ticker}/${filing.accession}`, errors, manifest.cik);
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
