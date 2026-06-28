import type { StockAnalyzerDataProviderContext } from "@/lib/stock-analyzer/types";

type JsonRecord = Record<string, unknown>;

export interface FenokSignalsSummaryCoverage {
  row_count?: number | null;
  signal_counts?: Record<string, number>;
  confidence_counts?: Record<string, number>;
  market_scope_counts?: Record<string, number>;
  [key: string]: unknown;
}

export interface FenokSignalsSummaryRecord {
  symbol: string;
  company?: string | null;
  marketScope?: string | null;
  canonicalSector?: string | null;
  asOf?: string | null;
  confidence?: string | null;
  coverageRatio?: number | null;
  convictionScore?: number | null;
  convictionCall?: "concentrated" | "mixed" | "diluted" | null;
  profitabilityScore?: number | null;
  profitabilityDirection?: string | null;
  growthScore?: number | null;
  growthDirection?: string | null;
  technicalFlowScore?: number | null;
  technicalFlowDirection?: string | null;
  upsideDownsideScore?: number | null;
  upsideDownsideDirection?: string | null;
  marketSimilarityScore?: number | null;
  marketSimilarityDirection?: string | null;
  durabilityProfitabilityScore?: number | null;
  durabilityProfitabilityCoverage?: number | null;
  upsidePotentialScore?: number | null;
  downsidePressureScore?: number | null;
  lensCoverageRatio?: number | null;
  longTermScore?: number | null;
  shortTermScore?: number | null;
  longTermConvictionScore?: number | null;
  longTermConvictionCall?: "concentrated" | "mixed" | "diluted" | null;
  peerSimilarityScore?: number | null;
  sp500TrackingSimilarityScore?: number | null;
  technicalIndicatorProxyScore?: number | null;
  netOptionsProxyScore?: number | null;
  offExchangeActivityProxyScore?: number | null;
  shortPressureProxyScore?: number | null;
  directNewsToneProxyScore?: number | null;
}

export interface FenokSignalsSummaryDocument {
  schema_version?: number;
  generated_at?: string;
  source_file?: string;
  formula_version?: string;
  contract_doc?: string;
  public_surface_status?: string;
  coverage?: FenokSignalsSummaryCoverage;
  fields: string[];
  rows: FenokSignalsSummaryRecord[];
}

interface RawFenokSignalsSummaryDocument {
  schema_version?: number;
  generated_at?: string;
  source_file?: string;
  formula_version?: string;
  contract_doc?: string;
  public_surface_status?: string;
  coverage?: FenokSignalsSummaryCoverage;
  fields?: string[];
  rows?: Array<JsonRecord | unknown[]>;
}

const FENOK_SIGNALS_SUMMARY_PATH = "/data/computed/fenok_signals_summary.json";
const FENOK_SIGNALS_SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedDocument: FenokSignalsSummaryDocument | null = null;
let cachedDocumentAt = 0;
let cachedDocumentPromise: Promise<FenokSignalsSummaryDocument | null> | null = null;

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

function convictionCallValue(
  row: JsonRecord | unknown[],
  fields: string[],
  key = "convictionCall",
): "concentrated" | "mixed" | "diluted" | null {
  const value = stringValue(row, fields, key);
  if (value === "concentrated" || value === "mixed" || value === "diluted") return value;
  return null;
}

export function normalizeFenokSignalsSummaryRecord(
  row: JsonRecord | unknown[],
  fields: string[],
): FenokSignalsSummaryRecord | null {
  if (!Array.isArray(row) && (!row || typeof row !== "object")) return null;
  const symbol = stringValue(row, fields, "ticker")?.toUpperCase() ?? "";
  if (!symbol) return null;

  return {
    symbol,
    company: stringValue(row, fields, "company"),
    marketScope: stringValue(row, fields, "marketScope"),
    canonicalSector: stringValue(row, fields, "canonicalSector"),
    asOf: stringValue(row, fields, "asOf"),
    confidence: stringValue(row, fields, "confidence"),
    coverageRatio: numberValue(row, fields, "coverageRatio"),
    convictionScore: numberValue(row, fields, "convictionScore"),
    convictionCall: convictionCallValue(row, fields),
    profitabilityScore: numberValue(row, fields, "profitabilityScore"),
    profitabilityDirection: stringValue(row, fields, "profitabilityDirection"),
    growthScore: numberValue(row, fields, "growthScore"),
    growthDirection: stringValue(row, fields, "growthDirection"),
    technicalFlowScore: numberValue(row, fields, "technicalFlowScore"),
    technicalFlowDirection: stringValue(row, fields, "technicalFlowDirection"),
    upsideDownsideScore: numberValue(row, fields, "upsideDownsideScore"),
    upsideDownsideDirection: stringValue(row, fields, "upsideDownsideDirection"),
    marketSimilarityScore: numberValue(row, fields, "marketSimilarityScore"),
    marketSimilarityDirection: stringValue(row, fields, "marketSimilarityDirection"),
    durabilityProfitabilityScore: numberValue(row, fields, "durabilityProfitabilityScore"),
    durabilityProfitabilityCoverage: numberValue(row, fields, "durabilityProfitabilityCoverage"),
    upsidePotentialScore: numberValue(row, fields, "upsidePotentialScore"),
    downsidePressureScore: numberValue(row, fields, "downsidePressureScore"),
    lensCoverageRatio: numberValue(row, fields, "lensCoverageRatio"),
    longTermScore: numberValue(row, fields, "longTermScore"),
    shortTermScore: numberValue(row, fields, "shortTermScore"),
    longTermConvictionScore: numberValue(row, fields, "longTermConvictionScore"),
    longTermConvictionCall: convictionCallValue(row, fields, "longTermConvictionCall"),
    peerSimilarityScore: numberValue(row, fields, "peerSimilarityScore"),
    sp500TrackingSimilarityScore: numberValue(row, fields, "sp500TrackingSimilarityScore"),
    technicalIndicatorProxyScore: numberValue(row, fields, "technicalIndicatorProxyScore"),
    netOptionsProxyScore: numberValue(row, fields, "netOptionsProxyScore"),
    offExchangeActivityProxyScore: numberValue(row, fields, "offExchangeActivityProxyScore"),
    shortPressureProxyScore: numberValue(row, fields, "shortPressureProxyScore"),
    directNewsToneProxyScore: numberValue(row, fields, "directNewsToneProxyScore"),
  };
}

async function fetchFenokSignalsSummaryDocument(
  context?: StockAnalyzerDataProviderContext,
): Promise<FenokSignalsSummaryDocument | null> {
  const response = await fetch(FENOK_SIGNALS_SUMMARY_PATH, {
    signal: context?.signal,
    cache: "no-store",
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as RawFenokSignalsSummaryDocument;
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const normalizedRows = rows
    .map((row) => normalizeFenokSignalsSummaryRecord(row, fields))
    .filter((row): row is FenokSignalsSummaryRecord => Boolean(row));

  return {
    schema_version: payload.schema_version,
    generated_at: payload.generated_at,
    source_file: payload.source_file,
    formula_version: payload.formula_version,
    contract_doc: payload.contract_doc,
    public_surface_status: payload.public_surface_status,
    coverage: payload.coverage,
    fields,
    rows: normalizedRows,
  };
}

export async function loadFenokSignalsSummaryDocument(
  context?: StockAnalyzerDataProviderContext,
): Promise<FenokSignalsSummaryDocument | null> {
  if (context?.signal) {
    return fetchFenokSignalsSummaryDocument(context);
  }

  if (cachedDocument && Date.now() - cachedDocumentAt < FENOK_SIGNALS_SUMMARY_CACHE_TTL_MS) {
    return cachedDocument;
  }

  if (!cachedDocumentPromise) {
    cachedDocumentPromise = fetchFenokSignalsSummaryDocument()
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

export async function loadFenokSignalsSummaryMap(
  context?: StockAnalyzerDataProviderContext,
): Promise<Map<string, FenokSignalsSummaryRecord>> {
  const document = await loadFenokSignalsSummaryDocument(context);
  const map = new Map<string, FenokSignalsSummaryRecord>();
  for (const row of document?.rows ?? []) {
    map.set(row.symbol, row);
  }
  return map;
}
