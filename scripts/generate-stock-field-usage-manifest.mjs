#!/usr/bin/env node
/**
 * Build a field-level inventory for Feno Stock Lens work.
 *
 * This is intentionally conservative: it does not decide that unused fields are
 * unimportant. It records what exists, where code appears to consume it, and
 * what still needs product/raw-view mapping.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(ROOT, "100xfenok-next/public/data");
const SRC_ROOT = path.join(ROOT, "100xfenok-next/src");
const SCRIPT_ROOT = path.join(ROOT, "scripts");

const DATASETS = [
  {
    id: "stock_detail",
    productLabel: "기업 실적·추정 상세",
    internalSource: "global-scouter/stocks/detail",
    paths: ["global-scouter/stocks/detail/*.json"],
    maxFiles: null,
  },
  {
    id: "price_dividend_history",
    productLabel: "가격·배당 히스토리",
    internalSource: "slickcharts/stocks",
    paths: ["slickcharts/stocks/*.json"],
    maxFiles: null,
  },
  {
    id: "institutional_filings",
    productLabel: "기관 공시·고수 보유",
    internalSource: "sec-13f",
    paths: ["sec-13f/*.json", "sec-13f/analytics/*.json", "sec-13f/investors/*.json"],
    excludeBasenames: ["schema.json"],
    maxFiles: null,
  },
  {
    id: "quote_finance",
    productLabel: "가격·재무 보조 데이터",
    internalSource: "yf",
    paths: ["yf/quarter_closes.json", "yf/finance/*.json"],
    maxFiles: null,
  },
  {
    id: "computed_stock_indexes",
    productLabel: "Feno 통합 스코어·요약",
    internalSource: "computed",
    paths: ["computed/stock_action_index.json", "computed/stock_action_summary.json"],
    maxFiles: null,
  },
];

const SOURCE_DIRS = [SRC_ROOT, SCRIPT_ROOT];
const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 16;
const MAX_DYNAMIC_OBJECT_KEYS = 12;
const MAX_SAMPLE_VALUES = 2;
const MAX_HIT_FILES = 4;
const DYNAMIC_KEY_MIN_COUNT = 60;
const GENERIC_TOKEN_BLACKLIST = new Set([
  "id",
  "key",
  "row",
  "rows",
  "date",
  "year",
  "name",
  "value",
  "values",
  "type",
  "source",
  "symbol",
  "ticker",
  "amount",
  "total",
  "count",
  "counts",
  "label",
  "title",
  "description",
  "data",
  "items",
  "status",
  "meta",
  "metadata",
  "company",
  "current",
  "open",
  "high",
  "low",
  "close",
  "price",
  "return",
  "returns",
  "quarter",
  "quarters",
  "period",
  "periods",
  "selected",
  "fallback",
  "unknown",
  "investor",
  "shares",
  "weight",
  "rank",
  "score",
  "change",
  "added",
  "benchmark",
  "bought",
  "buyers",
  "classification",
  "direction",
  "entity",
  "event",
  "filings",
  "form",
  "macro",
  "mean",
  "median",
  "normalized",
  "pressure",
  "removed",
  "sellers",
  "signal",
  "sold",
  "updated",
  "version",
]);
const METADATA_LEAVES = new Set([
  "id",
  "cik",
  "cusip",
  "exchange",
  "sector",
  "industry",
  "country",
  "currency",
  "name",
  "symbol",
  "ticker",
  "source",
  "source_date",
  "generated_at",
  "updated_at",
  "schema_version",
  "filing_date",
  "report_date",
]);
const RECORD_MAP_LEAVES = new Set([
  "all_investors",
  "by_investor",
  "by_ticker",
  "holdings",
  "holders",
  "investors",
  "portfolio",
  "portfolios",
  "securities",
  "tickers",
]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function filesForPattern(pattern) {
  if (!pattern.includes("*")) {
    const full = path.join(DATA_ROOT, pattern);
    return fs.existsSync(full) ? [full] : [];
  }
  const base = pattern.slice(0, pattern.indexOf("*"));
  const suffix = pattern.slice(pattern.indexOf("*") + 1);
  const dir = path.join(DATA_ROOT, base);
  return walkFiles(dir, (file) => file.endsWith(suffix)).sort();
}

function datasetFiles(dataset) {
  const files = dataset.paths.flatMap(filesForPattern);
  const excludeBasenames = new Set(dataset.excludeBasenames ?? []);
  const unique = [...new Set(files)].filter((file) => !excludeBasenames.has(path.basename(file))).sort();
  return dataset.maxFiles ? unique.slice(0, dataset.maxFiles) : unique;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueKind(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function looksDynamicKey(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return true;
  if (/^[A-Z0-9]{1,6}([.-][A-Z0-9]{1,4})?$/.test(key)) return true;
  if (/^\d{4,6}\.(KS|KQ|SZ|SS|HK|T)$/.test(key)) return true;
  if (/^[a-z]+(-[a-z]+)?$/.test(key) && key.length <= 18) return false;
  return false;
}

function normalizeObjectKeys(keys, prefix) {
  if (keys.length >= DYNAMIC_KEY_MIN_COUNT) return ["*"];
  const leaf = prefix.split(".").filter(Boolean).at(-1) ?? "";
  if (keys.length >= 2 && RECORD_MAP_LEAVES.has(leaf)) return ["*"];
  const sectorCount = keys.filter((key) => /^(Communication Services|Consumer Discretionary|Consumer Staples|Energy|Financials|Health Care|Industrials|Information Technology|Materials|Real Estate|Utilities)$/.test(key)).length;
  if (sectorCount >= 5) return ["*"];
  const dynamicCount = keys.filter(looksDynamicKey).length;
  if (dynamicCount >= Math.max(2, keys.length * 0.75)) return ["*"];
  return keys.slice(0, MAX_DYNAMIC_OBJECT_KEYS);
}

function addField(fields, fieldPath, value, fileRel) {
  if (!fieldPath) return;
  let field = fields.get(fieldPath);
  if (!field) {
    field = {
      path: fieldPath,
      presenceCount: 0,
      valueKinds: new Set(),
      sampleValues: [],
      sampleFiles: [],
    };
    fields.set(fieldPath, field);
  }
  field.presenceCount += 1;
  field.valueKinds.add(valueKind(value));
  if (field.sampleFiles.length < MAX_SAMPLE_VALUES && !field.sampleFiles.includes(fileRel)) {
    field.sampleFiles.push(fileRel);
  }
  if (field.sampleValues.length < MAX_SAMPLE_VALUES && value !== null && typeof value !== "object") {
    const stringValue = String(value);
    if (!field.sampleValues.includes(stringValue)) field.sampleValues.push(stringValue.slice(0, 80));
  }
}

function walkValue(value, prefix, fields, fileRel, depth = 0) {
  if (depth > MAX_DEPTH) {
    addField(fields, prefix, "[max-depth]", fileRel);
    return;
  }
  if (Array.isArray(value)) {
    addField(fields, `${prefix}[]`, value, fileRel);
    value.slice(0, MAX_ARRAY_ITEMS).forEach((item) => walkValue(item, `${prefix}[]`, fields, fileRel, depth + 1));
    return;
  }
  if (!isRecord(value)) {
    addField(fields, prefix, value, fileRel);
    return;
  }
  const keys = Object.keys(value).sort();
  const selected = normalizeObjectKeys(keys, prefix);
  if (selected.length === 1 && selected[0] === "*") {
    addField(fields, prefix ? `${prefix}.*` : "*", value, fileRel);
    keys.slice(0, MAX_DYNAMIC_OBJECT_KEYS).forEach((key) => {
      const next = prefix ? `${prefix}.*` : "*";
      walkValue(value[key], next, fields, fileRel, depth + 1);
    });
    return;
  }
  selected.forEach((key) => {
    const next = prefix ? `${prefix}.${key}` : key;
    walkValue(value[key], next, fields, fileRel, depth + 1);
  });
}

function walkStockActionSummary(value, fields, fileRel) {
  const fieldNames = Array.isArray(value?.fields) ? value.fields.filter((field) => typeof field === "string") : [];
  const rows = Array.isArray(value?.rows) ? value.rows : [];
  const topLevel = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "rows"));

  walkValue(topLevel, "", fields, fileRel);
  addField(fields, "rows[]", rows, fileRel);

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    fieldNames.forEach((fieldName, index) => {
      walkValue(row[index] ?? null, `rows[].${fieldName}`, fields, fileRel);
    });
  }
}

function sourceFiles() {
  return SOURCE_DIRS.flatMap((dir) =>
    walkFiles(dir, (file) => /\.(ts|tsx|js|jsx|mjs)$/.test(file))
      .filter((file) => !file.endsWith("generate-stock-field-usage-manifest.mjs"))
  ).map((file) => ({
    file,
    rel: path.relative(ROOT, file),
    text: fs.readFileSync(file, "utf8"),
  }));
}

function candidateTokens(fieldPath) {
  const parts = fieldPath
    .replaceAll("[]", "")
    .split(".")
    .filter((part) => part && part !== "*" && !/^\d+$/.test(part));
  const leaf = parts.at(-1);
  const tokens = new Set();
  if (leaf && leaf.length >= 4 && !GENERIC_TOKEN_BLACKLIST.has(leaf.toLowerCase())) tokens.add(leaf);
  if (parts.length >= 2) tokens.add(parts.slice(-2).join("."));
  if (parts.length >= 2) tokens.add(parts.slice(-2).join("_"));
  if (parts.length >= 3) tokens.add(parts.slice(-3).join("."));
  return [...tokens].filter((token) => {
    const last = token.split(/[._]/).at(-1);
    return last && !GENERIC_TOKEN_BLACKLIST.has(last.toLowerCase());
  });
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenMatches(text, token) {
  if (token.includes(".") || token.includes("_")) return text.includes(token);
  const re = new RegExp(`(^|[^A-Za-z0-9_$])${regexEscape(token)}([^A-Za-z0-9_$]|$)`);
  return re.test(text);
}

function isMetadataField(fieldPath) {
  const parts = fieldPath
    .replaceAll("[]", "")
    .split(".")
    .filter((part) => part && part !== "*" && !/^\d+$/.test(part));
  const leaf = parts.at(-1) ?? "";
  return METADATA_LEAVES.has(leaf) || /^(metadata|schema|generated_at|updated_at|source_date)/.test(fieldPath);
}

function classifyField(fieldPath, hits) {
  const hitText = hits.map((hit) => hit.file).join(" ");
  if (/deterministicRules/.test(hitText)) return "interpreted";
  if (isMetadataField(fieldPath)) return "metadata";
  if (hits.some((hit) => /100xfenok-next\/src\/app|100xfenok-next\/src\/components/.test(hit.file))) return "visually_rendered";
  return "not_yet_used";
}

function buildCodeIndex() {
  const files = sourceFiles();
  return (fieldPath) => {
    const tokens = candidateTokens(fieldPath);
    if (tokens.length === 0) return [];
    const hits = [];
    for (const source of files) {
      const matched = tokens.filter((token) => tokenMatches(source.text, token));
      if (matched.length > 0) hits.push({ file: source.rel, tokens: matched.slice(0, 4) });
      if (hits.length >= MAX_HIT_FILES) break;
    }
    return hits;
  };
}

function summarizeDataset(dataset, codeHitsForPath) {
  const files = datasetFiles(dataset);
  const fields = new Map();
  let scannedBytes = 0;
  let parsedFiles = 0;
  for (const file of files) {
    const stat = fs.statSync(file);
    scannedBytes += stat.size;
    const rel = path.relative(DATA_ROOT, file);
    const json = readJson(file);
    if (json === null) continue;
    parsedFiles += 1;
    if (rel === "computed/stock_action_summary.json") {
      walkStockActionSummary(json, fields, rel);
    } else {
      walkValue(json, "", fields, rel);
    }
  }
  const fieldRows = [...fields.values()].map((field) => {
    const codeHits = codeHitsForPath(field.path);
    const status = classifyField(field.path, codeHits);
    const row = {
      path: field.path,
      status,
      presenceCount: field.presenceCount,
      valueKinds: [...field.valueKinds].sort(),
    };
    if (field.sampleValues.length > 0) row.sampleValues = field.sampleValues;
    if (field.sampleFiles.length > 0) row.sampleFiles = field.sampleFiles;
    if (codeHits.length > 0) row.consumerHits = codeHits;
    return row;
  }).sort((a, b) => a.path.localeCompare(b.path));
  const statusCounts = fieldRows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    id: dataset.id,
    productLabel: dataset.productLabel,
    internalSource: dataset.internalSource,
    fileCount: files.length,
    parsedFileCount: parsedFiles,
    scannedBytes,
    fieldCount: fieldRows.length,
    statusCounts,
    fields: fieldRows,
  };
}

function compactDataset(dataset) {
  return {
    id: dataset.id,
    productLabel: dataset.productLabel,
    internalSource: dataset.internalSource,
    fileCount: dataset.fileCount,
    parsedFileCount: dataset.parsedFileCount,
    scannedBytes: dataset.scannedBytes,
    fieldCount: dataset.fieldCount,
    statusCounts: dataset.statusCounts,
  };
}

function main() {
  const generatedAt = new Date().toISOString();
  const codeHitsForPath = buildCodeIndex();
  const datasets = DATASETS.map((dataset) => summarizeDataset(dataset, codeHitsForPath));
  const totals = datasets.reduce((acc, dataset) => {
    acc.fileCount += dataset.fileCount;
    acc.parsedFileCount += dataset.parsedFileCount;
    acc.scannedBytes += dataset.scannedBytes;
    acc.fieldCount += dataset.fieldCount;
    for (const [status, count] of Object.entries(dataset.statusCounts)) {
      acc.statusCounts[status] = (acc.statusCounts[status] ?? 0) + count;
    }
    return acc;
  }, { fileCount: 0, parsedFileCount: 0, scannedBytes: 0, fieldCount: 0, statusCounts: {} });
  const manifest = {
    schema_version: 1,
    generated_at: generatedAt,
    product_language_rule: "User-facing surfaces use Feno/function labels; source/vendor names stay in internal provenance/admin/debug/docs.",
    status_definitions: {
      interpreted: "Observed in deterministic or future interpretation code paths.",
      visually_rendered: "Rendered directly in UI tables, cards, charts, or text surfaces.",
      metadata: "Structural/provenance fields used for identity, grouping, freshness, or source traceability.",
      not_yet_used: "Inventoried but not yet mapped to product, raw/pro, or interpretation surface.",
      deprecated_with_reason: "Reserved for explicit removal with rationale; not emitted unless an explicit exclusion list exists.",
    },
    totals,
    dataset_summaries: datasets.map(compactDataset),
    datasets,
  };
  const rootOut = path.join(DATA_ROOT, "admin/stock-field-usage-manifest.json");
  const publicOut = path.join(PUBLIC_DATA_ROOT, "admin/stock-field-usage-manifest.json");
  writeJson(rootOut, manifest);
  writeJson(publicOut, manifest);
  console.log(JSON.stringify({
    generated_at: generatedAt,
    datasets: datasets.length,
    files: totals.fileCount,
    parsed_files: totals.parsedFileCount,
    fields: totals.fieldCount,
    status_counts: totals.statusCounts,
    bytes: fs.statSync(rootOut).size,
  }, null, 2));
}

main();
