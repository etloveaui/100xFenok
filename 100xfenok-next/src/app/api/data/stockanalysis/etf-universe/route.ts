import { NextResponse } from "next/server";
import { getStockanalysisEtfUniverse, getStockanalysisSurface } from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

const STOCKANALYSIS_ETF_UNIVERSE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function cleanTicker(value: unknown): string {
  return String(value ?? "")
    .replace(/^\$/, "")
    .trim()
    .toUpperCase();
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "-" ? text : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function classificationFrom(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function compactRecord(record: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  );
}

export async function GET() {
  return withResponseCache(
    "stockanalysis:etf-universe-merged",
    300,
    async () => {
      const [universePayload, screenerPayload] = await Promise.all([
        getStockanalysisEtfUniverse(),
        getStockanalysisSurface("etf_screener"),
      ]);
      const universe = asRecord(universePayload);
      const screener = asRecord(screenerPayload);
      const recordsByTicker = new Map<string, JsonRecord>();

      for (const row of rowsFromSurface(universe)) {
        const ticker = cleanTicker(row.ticker ?? row.s ?? row.symbol);
        if (!ticker) continue;
        recordsByTicker.set(ticker, compactRecord({
          ticker,
          name: cleanText(row.name ?? row.n) ?? ticker,
          category: cleanText(row.category) ?? null,
          aum_raw: cleanText(row.aum_raw),
          aum: numericValue(row.aum),
          source_page: numericValue(row.source_page),
          classification: classificationFrom(row.classification),
        }));
      }

      let screenerOnly = 0;
      for (const row of rowsFromSurface(screener)) {
        const ticker = cleanTicker(row.s ?? row.ticker ?? row.symbol);
        if (!ticker) continue;
        const existing = recordsByTicker.get(ticker);
        if (!existing) screenerOnly += 1;
        recordsByTicker.set(ticker, compactRecord({
          ...(existing ?? {}),
          ticker,
          name: cleanText(existing?.name) ?? cleanText(row.n ?? row.name) ?? ticker,
          category: cleanText(existing?.category) ?? cleanText(row.assetClass) ?? null,
          aum_raw: cleanText(existing?.aum_raw),
          aum: numericValue(existing?.aum) ?? numericValue(row.aum),
          source_page: numericValue(existing?.source_page),
          assetClass: cleanText(row.assetClass),
          price: numericValue(row.price),
          change: numericValue(row.change),
          volume: numericValue(row.volume),
          holdings: numericValue(row.holdings),
          classification: classificationFrom(existing?.classification, row.classification),
        }));
      }

      const records = [...recordsByTicker.values()].sort((a, b) => {
        const aumA = numericValue(a.aum) ?? -1;
        const aumB = numericValue(b.aum) ?? -1;
        return aumB - aumA || cleanTicker(a.ticker).localeCompare(cleanTicker(b.ticker));
      });

      return NextResponse.json(
        {
          schema_version: "stockanalysis/v1",
          source: "stockanalysis",
          asset_type: "etf_universe",
          generated_at:
            (typeof universe?.generated_at === "string" ? universe.generated_at : null) ??
            (typeof screener?.fetched_at === "string" ? screener.fetched_at : null),
          universe_generated_at: typeof universe?.generated_at === "string" ? universe.generated_at : null,
          screener_fetched_at: typeof screener?.fetched_at === "string" ? screener.fetched_at : null,
          counts: {
            records: records.length,
            etf_universe: rowsFromSurface(universe).length,
            etf_screener: rowsFromSurface(screener).length,
            screener_only: screenerOnly,
            with_price: records.filter((row) => typeof row.price === "number").length,
            with_volume: records.filter((row) => typeof row.volume === "number").length,
            with_holdings: records.filter((row) => typeof row.holdings === "number").length,
          },
          records,
        },
        { headers: STOCKANALYSIS_ETF_UNIVERSE_CACHE_HEADERS },
      );
    },
  );
}
