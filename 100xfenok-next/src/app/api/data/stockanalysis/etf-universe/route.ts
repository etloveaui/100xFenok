import { NextResponse } from "next/server";
import { getStockanalysisEtfUniverse, getStockanalysisSurface } from "@/lib/server/data-loader";
import { withResponseCache } from "@/lib/server/response-cache";

const STOCKANALYSIS_ETF_UNIVERSE_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = false;

type JsonRecord = Record<string, unknown>;
const ETF_DETAIL_FIELDS = [
  "expenseRatio",
  "expense_ratio",
  "dividendYield",
  "dividend_yield",
  "sharesOut",
  "beta",
  "inceptionDate",
  "provider_page",
  "etf_website",
  "performance",
] as const;

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

function pickRecordFields(record: JsonRecord | undefined, fields: readonly string[]): JsonRecord {
  if (!record) return {};
  return Object.fromEntries(
    fields
      .filter((field) => field in record)
      .map((field) => [field, record[field]]),
  );
}

function classificationCounts(records: JsonRecord[]): JsonRecord {
  const classified = records.filter((row) => asRecord(row.classification) !== null);
  return {
    classified: classified.length,
    coverage_pct: records.length > 0 ? Number(((classified.length / records.length) * 100).toFixed(2)) : 0,
    leveraged: records.filter((row) => asRecord(row.classification)?.is_leveraged === true).length,
    inverse: records.filter((row) => asRecord(row.classification)?.is_inverse === true).length,
    single_stock: records.filter((row) => asRecord(row.classification)?.is_single_stock === true).length,
  };
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
          ...pickRecordFields(row, ETF_DETAIL_FIELDS),
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
          ...pickRecordFields(existing, ETF_DETAIL_FIELDS),
          ...pickRecordFields(row, ETF_DETAIL_FIELDS),
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
            with_expense_ratio: records.filter((row) => numericValue(row.expense_ratio ?? row.expenseRatio) !== null).length,
            with_performance: records.filter((row) => asRecord(row.performance) !== null).length,
            classification: classificationCounts(records),
          },
          records,
        },
        { headers: STOCKANALYSIS_ETF_UNIVERSE_CACHE_HEADERS },
      );
    },
  );
}
