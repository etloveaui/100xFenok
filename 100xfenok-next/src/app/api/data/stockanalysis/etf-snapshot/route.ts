import { NextResponse } from "next/server";
import { getStockanalysisEtfUniverse, getStockanalysisSurface } from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

type JsonRecord = Record<string, unknown>;

const ETF_SNAPSHOT_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;
const DIGITAL_ASSET_ETF_SNAPSHOT_LIMIT = 100;

export const dynamic = "force-dynamic";
export const revalidate = false;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function rowsFromSurface(payload: JsonRecord | null): JsonRecord[] {
  if (!payload) return [];
  const records = Array.isArray(payload.records) ? payload.records : [];
  const tableRecords = Array.isArray(payload.tables)
    ? payload.tables.flatMap((table) => {
        const record = asRecord(table);
        return Array.isArray(record?.records) ? record.records : [];
      })
    : [];

  return [...records, ...tableRecords].map(asRecord).filter((row): row is JsonRecord => row !== null);
}

function cleanTicker(value: unknown): string {
  return String(value ?? "")
    .replace(/^\$/, "")
    .trim()
    .toUpperCase();
}

function pickFields(row: JsonRecord, fields: string[]): JsonRecord {
  const picked: JsonRecord = {};
  for (const field of fields) {
    if (field in row) picked[field] = row[field];
  }
  return picked;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function countsFromSurface(payload: JsonRecord | null, fallback: number) {
  const counts = asRecord(payload?.counts);
  return {
    records: typeof counts?.records === "number" ? counts.records : fallback,
    rows: typeof counts?.rows === "number" ? counts.rows : fallback,
    fields: typeof counts?.fields === "number" ? counts.fields : undefined,
  };
}

function buildClassificationMap(rows: JsonRecord[], tickerKeys: string[]): Map<string, JsonRecord> {
  const byTicker = new Map<string, JsonRecord>();
  for (const row of rows) {
    const classification = asRecord(row.classification);
    if (!classification) continue;
    const ticker = tickerKeys.map((key) => cleanTicker(row[key])).find(Boolean);
    if (ticker && !byTicker.has(ticker)) byTicker.set(ticker, classification);
  }
  return byTicker;
}

async function summarizeSurface(surface: string, fields: string[], limit: number) {
  const payload = asRecord(await getStockanalysisSurface(surface));
  const rows = rowsFromSurface(payload);
  return {
    surface,
    fetched_at: typeof payload?.fetched_at === "string" ? payload.fetched_at : null,
    counts: countsFromSurface(payload, rows.length),
    records: rows.slice(0, limit).map((row) => pickFields(row, fields)),
  };
}

async function summarizeEtfScreener(limit: number) {
  const fields = ["s", "n", "assetClass", "aum", "price", "change", "volume", "holdings", "expenseRatio", "expense_ratio", "dividendYield", "dividend_yield", "performance"];
  const payload = asRecord(await getStockanalysisSurface("etf_screener"));
  const rows = rowsFromSurface(payload);
  const pick = (row: JsonRecord) => pickFields(row, fields);
  const byVolume = [...rows]
    .filter((row) => numericValue(row.volume) !== null)
    .sort((a, b) => (numericValue(b.volume) ?? 0) - (numericValue(a.volume) ?? 0));
  const byAbsChange = [...rows]
    .filter((row) => numericValue(row.change) !== null)
    .sort((a, b) => Math.abs(numericValue(b.change) ?? 0) - Math.abs(numericValue(a.change) ?? 0));
  return {
    surface: "etf_screener",
    fetched_at: typeof payload?.fetched_at === "string" ? payload.fetched_at : null,
    counts: countsFromSurface(payload, rows.length),
    records: rows.slice(0, limit).map(pick),
    volumeLeaders: byVolume.slice(0, limit).map(pick),
    changeLeaders: byAbsChange.slice(0, limit).map(pick),
  };
}

async function summarizeNewEtfs(limit: number) {
  const [payload, screenerPayload, universePayload] = await Promise.all([
    getStockanalysisSurface("new_etfs"),
    getStockanalysisSurface("etf_screener"),
    getStockanalysisEtfUniverse(),
  ]);
  const newEtfs = asRecord(payload);
  const screener = asRecord(screenerPayload);
  const universe = asRecord(universePayload);
  const rows = rowsFromSurface(newEtfs);
  const classifications = new Map([
    ...buildClassificationMap(rowsFromSurface(universe), ["ticker", "s", "symbol"]),
    ...buildClassificationMap(rowsFromSurface(screener), ["s", "symbol", "ticker"]),
  ]);
  return {
    surface: "new_etfs",
    fetched_at: typeof newEtfs?.fetched_at === "string" ? newEtfs.fetched_at : null,
    counts: countsFromSurface(newEtfs, rows.length),
    records: rows.slice(0, limit).map((row) => {
      const picked = pickFields(row, ["s", "n", "inceptionDate", "price", "change"]);
      const classification = classifications.get(cleanTicker(row.s ?? row.symbol ?? row.ticker));
      return classification ? { ...picked, classification } : picked;
    }),
  };
}

export async function GET() {
  return withResponseCache(
    "stockanalysis:etf-snapshot",
    300,
    async () => {
      const [newEtfs, screener, blackrock, proshares, bitcoin] = await Promise.all([
        summarizeNewEtfs(100),
        summarizeEtfScreener(5),
        summarizeSurface("etf_provider_blackrock", ["symbol", "fund_name", "assets", "div_yield", "exp_ratio", "change_1y"], 20),
        summarizeSurface("etf_provider_proshares", ["symbol", "fund_name", "assets", "div_yield", "exp_ratio", "change_1y"], 20),
        summarizeSurface("list_bitcoin_etfs", ["symbol", "fund_name", "assets", "stock_price", "pct_change"], DIGITAL_ASSET_ETF_SNAPSHOT_LIMIT),
      ]);

      return NextResponse.json(
        {
          schema_version: "stockanalysis-etf-snapshot/v1",
          generated_at: new Date().toISOString(),
          source: "local ETF data snapshot",
          newEtfs,
          screener,
          blackrock,
          proshares,
          bitcoin,
        },
        { headers: ETF_SNAPSHOT_CACHE_HEADERS },
      );
    },
  );
}
