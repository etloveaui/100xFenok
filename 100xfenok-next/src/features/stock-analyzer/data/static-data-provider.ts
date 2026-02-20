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
    cache: "force-cache",
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
  readonly source =
    "public/tools/stock_analyzer/data/M_Company.json + T_Rank.json";

  async load(
    context?: StockAnalyzerDataProviderContext,
  ): Promise<StockAnalyzerRecord[]> {
    const [companyRows, rankRows] = await Promise.all([
      fetchDataset("/tools/stock_analyzer/data/M_Company.json", context),
      fetchDataset("/tools/stock_analyzer/data/T_Rank.json", context),
    ]);

    const rankBySymbol = new Map<string, JsonRecord>();

    for (const row of rankRows) {
      const symbol = normalizeString(row.Ticker).toUpperCase();
      if (!symbol) continue;
      if (!rankBySymbol.has(symbol)) {
        rankBySymbol.set(symbol, row);
      }
    }

    const merged = companyRows
      .map((companyRow) => {
        const symbol = normalizeString(companyRow.Ticker).toUpperCase();
        if (!symbol) return null;

        const rankRow = rankBySymbol.get(symbol);

        const growthRate =
          parseNumber(rankRow?.["3 M"]) ?? parseNumber(companyRow["3 M"]);

        return {
          symbol,
          companyName:
            normalizeString(companyRow.Corp) || normalizeString(rankRow?.Corp),
          sector:
            normalizeString(companyRow.WI26) || normalizeString(rankRow?.WI26),
          industry: normalizeString(companyRow.Exchange),
          marketCap:
            parseNumber(companyRow["(USD mn)"]) ??
            parseNumber(rankRow?.["(USD mn)"]),
          growthRate,
          eps: parseNumber(rankRow?.["EPS (Oct-25)"]),
          per:
            parseNumber(companyRow["PER (Fwd)"]) ??
            parseNumber(rankRow?.["PER (Oct-25)"]),
          rank:
            parseNumber(rankRow?.["PER+PBR"]) ??
            parseNumber(rankRow?.["CCC (FY 0)"]),
        } satisfies StockAnalyzerRecord;
      })
      .filter((row) => row !== null)
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

    // Native pilot: cap initial universe size to reduce client bootstrap cost.
    return (merged as StockAnalyzerRecord[]).slice(0, 800);
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
