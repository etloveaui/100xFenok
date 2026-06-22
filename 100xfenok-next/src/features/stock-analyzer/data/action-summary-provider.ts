import type { StockAnalyzerDataProviderContext } from "@/lib/stock-analyzer/types";

type JsonRecord = Record<string, unknown>;

export interface ActionSummaryCoverage {
  indexed_stock_count?: number | null;
  guru_ticker_count?: number | null;
  conviction_matched_count?: number | null;
  quarter_close_ticker_count?: number | null;
  bucket_counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface ActionSummaryRecord {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  marketScope?: string | null;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  guruHolders?: number | null;
  return12m?: number | null;
  forwardPeFy1?: number | null;
  forwardEpsFy1?: number | null;
  revenueGrowthFy1?: number | null;
  epsGrowthFy1?: number | null;
  grossMarginFy1?: number | null;
  operatingMarginFy1?: number | null;
  roeFy1?: number | null;
  forwardPeFy2?: number | null;
  forwardEpsFy2?: number | null;
  revenueGrowthFy2?: number | null;
  epsGrowthFy2?: number | null;
  grossMarginFy2?: number | null;
  operatingMarginFy2?: number | null;
  roeFy2?: number | null;
  forwardPeFy3?: number | null;
  forwardEpsFy3?: number | null;
  revenueGrowthFy3?: number | null;
  epsGrowthFy3?: number | null;
  grossMarginFy3?: number | null;
  operatingMarginFy3?: number | null;
  roeFy3?: number | null;
}

export interface ActionSummaryDocument {
  schema_version?: string;
  generated_at?: string;
  source_file?: string;
  score_contract?: unknown;
  coverage?: ActionSummaryCoverage;
  fields: string[];
  rows: ActionSummaryRecord[];
}

interface RawActionSummaryDocument {
  schema_version?: string;
  generated_at?: string;
  source_file?: string;
  score_contract?: unknown;
  coverage?: ActionSummaryCoverage;
  fields?: string[];
  rows?: Array<JsonRecord | unknown[]>;
}

const ACTION_SUMMARY_PATH = "/data/computed/stock_action_summary.json";
const ACTION_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedDocument: ActionSummaryDocument | null = null;
let cachedDocumentAt = 0;
let cachedDocumentPromise: Promise<ActionSummaryDocument | null> | null = null;

function readValue(row: JsonRecord | unknown[], fields: string[], key: string): unknown {
  if (Array.isArray(row)) {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  }
  return row[key];
}

function stringValue(row: JsonRecord | unknown[], fields: string[], key: string): string | null {
  const value = readValue(row, fields, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(row: JsonRecord | unknown[], fields: string[], key: string): number | null {
  const value = readValue(row, fields, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(row: JsonRecord | unknown[], fields: string[], key: string): boolean | null {
  const value = readValue(row, fields, key);
  return typeof value === "boolean" ? value : null;
}

function stringArrayValue(row: JsonRecord | unknown[], fields: string[], key: string): string[] {
  const value = readValue(row, fields, key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function normalizeActionSummaryRecord(
  row: JsonRecord | unknown[],
  fields: string[],
): ActionSummaryRecord | null {
  if (!Array.isArray(row) && (!row || typeof row !== "object")) return null;
  const symbol = stringValue(row, fields, "symbol")?.toUpperCase() ?? "";
  if (!symbol) return null;

  return {
    symbol,
    company: stringValue(row, fields, "company"),
    sector: stringValue(row, fields, "sector"),
    marketScope: stringValue(row, fields, "marketScope"),
    actionScore: numberValue(row, fields, "actionScore"),
    confidenceLabel: stringValue(row, fields, "confidenceLabel"),
    actionBucket: stringValue(row, fields, "actionBucket"),
    actionLabel: stringValue(row, fields, "actionLabel"),
    actionReasons: stringArrayValue(row, fields, "actionReasons"),
    lowEvidence: booleanValue(row, fields, "lowEvidence"),
    guruHolders: numberValue(row, fields, "guruHolders"),
    return12m: numberValue(row, fields, "return12m"),
    forwardPeFy1: numberValue(row, fields, "forwardPeFy1"),
    forwardEpsFy1: numberValue(row, fields, "forwardEpsFy1"),
    revenueGrowthFy1: numberValue(row, fields, "revenueGrowthFy1"),
    epsGrowthFy1: numberValue(row, fields, "epsGrowthFy1"),
    grossMarginFy1: numberValue(row, fields, "grossMarginFy1"),
    operatingMarginFy1: numberValue(row, fields, "operatingMarginFy1"),
    roeFy1: numberValue(row, fields, "roeFy1"),
    forwardPeFy2: numberValue(row, fields, "forwardPeFy2"),
    forwardEpsFy2: numberValue(row, fields, "forwardEpsFy2"),
    revenueGrowthFy2: numberValue(row, fields, "revenueGrowthFy2"),
    epsGrowthFy2: numberValue(row, fields, "epsGrowthFy2"),
    grossMarginFy2: numberValue(row, fields, "grossMarginFy2"),
    operatingMarginFy2: numberValue(row, fields, "operatingMarginFy2"),
    roeFy2: numberValue(row, fields, "roeFy2"),
    forwardPeFy3: numberValue(row, fields, "forwardPeFy3"),
    forwardEpsFy3: numberValue(row, fields, "forwardEpsFy3"),
    revenueGrowthFy3: numberValue(row, fields, "revenueGrowthFy3"),
    epsGrowthFy3: numberValue(row, fields, "epsGrowthFy3"),
    grossMarginFy3: numberValue(row, fields, "grossMarginFy3"),
    operatingMarginFy3: numberValue(row, fields, "operatingMarginFy3"),
    roeFy3: numberValue(row, fields, "roeFy3"),
  };
}

async function fetchActionSummaryDocument(
  context?: StockAnalyzerDataProviderContext,
): Promise<ActionSummaryDocument | null> {
  const response = await fetch(ACTION_SUMMARY_PATH, {
    signal: context?.signal,
    cache: "no-store",
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as RawActionSummaryDocument;
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const normalizedRows = rows
    .map((row) => normalizeActionSummaryRecord(row, fields))
    .filter((row): row is ActionSummaryRecord => Boolean(row));

  return {
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    source_file: payload.source_file,
    score_contract: payload.score_contract,
    coverage: payload.coverage,
    fields,
    rows: normalizedRows,
  };
}

export async function loadActionSummaryDocument(
  context?: StockAnalyzerDataProviderContext,
): Promise<ActionSummaryDocument | null> {
  if (context?.signal) {
    return fetchActionSummaryDocument(context);
  }

  if (cachedDocument && Date.now() - cachedDocumentAt < ACTION_SUMMARY_CACHE_TTL_MS) {
    return cachedDocument;
  }

  if (!cachedDocumentPromise) {
    cachedDocumentPromise = fetchActionSummaryDocument()
      .then((document) => {
        cachedDocument = document;
        cachedDocumentAt = Date.now();
        cachedDocumentPromise = null;
        return document;
      })
      .catch(() => {
        cachedDocumentPromise = null;
        return null;
      });
  }

  return cachedDocumentPromise;
}

export async function loadActionSummaryMap(
  context?: StockAnalyzerDataProviderContext,
): Promise<Map<string, ActionSummaryRecord>> {
  const document = await loadActionSummaryDocument(context);
  const map = new Map<string, ActionSummaryRecord>();
  for (const row of document?.rows ?? []) {
    map.set(row.symbol, row);
  }
  return map;
}
