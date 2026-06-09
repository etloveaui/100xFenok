import type {
  StockAnalyzerDataProvider,
  StockAnalyzerDataProviderContext,
  StockAnalyzerRecord,
} from "@/lib/stock-analyzer/types";

type JsonValue = string | number | boolean | null | undefined;
type JsonRecord = Record<string, JsonValue>;

interface DatasetResponse {
  data?: JsonRecord[];
}

function parseNumber(value: JsonValue): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const sanitized = value.replace(/,/g, "").trim();
    if (!sanitized) return undefined;

    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeString(value: JsonValue): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
}

async function fetchDataset(
  path: string,
  context?: StockAnalyzerDataProviderContext,
): Promise<JsonRecord[]> {
  const response = await fetch(path, {
    signal: context?.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Data fetch failed: ${path} (${response.status})`);
  }

  const payload = (await response.json()) as DatasetResponse;
  return Array.isArray(payload.data) ? payload.data : [];
}

export class StaticStockAnalyzerDataProvider
  implements StockAnalyzerDataProvider<StockAnalyzerRecord>
{
  readonly id = "stock-analyzer-static-json-provider";
  readonly source = "data/global-scouter/core/stocks_analyzer.json";

  /**
   * CAUTION: roe, opm, growthRate, and momentum fields are stored as
   * fractions in stocks_analyzer.json (e.g., roe=1.17 means 117%,
   * opm=0.32 means 32%). Multiply by 100 when displaying as percentages
   * to prevent a future 100× bug.
   */
  async load(
    context?: StockAnalyzerDataProviderContext,
  ): Promise<StockAnalyzerRecord[]> {
    const rows = await fetchDataset(
      "/data/global-scouter/core/stocks_analyzer.json",
      context,
    );

    const parsed = rows
      .map((row) => {
        const symbol = normalizeString(row.symbol).toUpperCase();
        if (!symbol) return null;

        return {
          symbol,
          companyName:
            normalizeString(row.companyName) || normalizeString(row.Corp),
          sector:
            normalizeString(row.sector) || normalizeString(row.WI26),
          industry: normalizeString(row.industry) || normalizeString(row.Exchange),
          marketCap: parseNumber(row.marketCap) ?? parseNumber(row["(USD mn)"]),
          growthRate: parseNumber(row.growthRate) ?? parseNumber(row["3 M"]),
          eps: parseNumber(row.eps) ?? parseNumber(row["EPS (Oct-25)"]),
          per: parseNumber(row.per) ?? parseNumber(row["PER (Fwd)"]),
          rank: parseNumber(row.rank) ?? parseNumber(row["PER+PBR"]),
          pbr: parseNumber(row.pbr) ?? parseNumber(row["PBR (Fwd)"]),
          roe: parseNumber(row.roe) ?? parseNumber(row["ROE (Fwd)"]),
          opm: parseNumber(row.opm) ?? parseNumber(row["OPM (Fwd)"]),
          momentum1m:
            parseNumber(row.momentum1m) ?? parseNumber(row["1 M"]),
          momentum3m:
            parseNumber(row.momentum3m) ?? parseNumber(row["3 M"]),
          momentum6m:
            parseNumber(row.momentum6m) ?? parseNumber(row["6 M"]),
          momentum12m:
            parseNumber(row.momentum12m) ?? parseNumber(row["12 M"]),
        } satisfies StockAnalyzerRecord;
      })
      .filter((row) => row !== null)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

    return parsed as StockAnalyzerRecord[];
  }

  async getBySymbol(
    symbol: string,
    context?: StockAnalyzerDataProviderContext,
  ): Promise<StockAnalyzerRecord | null> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return null;

    const records = await this.load(context);
    return records.find((record) => record.symbol === normalized) ?? null;
  }
}
