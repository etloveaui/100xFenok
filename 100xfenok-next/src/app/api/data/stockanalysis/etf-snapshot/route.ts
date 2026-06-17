import { NextResponse } from "next/server";
import { getStockanalysisSurface } from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

type JsonRecord = Record<string, unknown>;

const ETF_SNAPSHOT_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

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

function pickFields(row: JsonRecord, fields: string[]): JsonRecord {
  const picked: JsonRecord = {};
  for (const field of fields) {
    if (field in row) picked[field] = row[field];
  }
  return picked;
}

function countsFromSurface(payload: JsonRecord | null, fallback: number) {
  const counts = asRecord(payload?.counts);
  return {
    records: typeof counts?.records === "number" ? counts.records : fallback,
    rows: typeof counts?.rows === "number" ? counts.rows : fallback,
    fields: typeof counts?.fields === "number" ? counts.fields : undefined,
  };
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

export async function GET() {
  return withResponseCache(
    "stockanalysis:etf-snapshot",
    300,
    async () => {
      const [newEtfs, screener, blackrock, proshares, bitcoin] = await Promise.all([
        summarizeSurface("new_etfs", ["s", "n", "inceptionDate", "price", "change"], 5),
        summarizeSurface("etf_screener", ["s", "n", "assetClass", "aum", "price", "change", "volume", "holdings"], 5),
        summarizeSurface("etf_provider_blackrock", ["symbol", "fund_name", "assets", "div_yield", "exp_ratio", "change_1y"], 3),
        summarizeSurface("etf_provider_proshares", ["symbol", "fund_name", "assets", "div_yield", "exp_ratio", "change_1y"], 3),
        summarizeSurface("list_bitcoin_etfs", ["symbol", "fund_name", "assets", "stock_price", "pct_change"], 4),
      ]);

      return NextResponse.json(
        {
          schema_version: "stockanalysis-etf-snapshot/v1",
          generated_at: new Date().toISOString(),
          source: "stockanalysis ETF surfaces summarized from local DataPack",
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
