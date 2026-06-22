import type {
  StockAnalyzerDataProvider,
  StockAnalyzerDataProviderContext,
  StockAnalyzerRecord,
} from "@/lib/stock-analyzer/types";
import { loadActionSummaryMap } from "./action-summary-provider";

type JsonValue = string | number | boolean | null | undefined;
type JsonRecord = Record<string, JsonValue>;

interface DatasetResponse {
  source_date?: string;
  data?: JsonRecord[];
}

interface NormalizedDataset {
  sourceDate: string | null;
  records: StockAnalyzerRecord[];
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

async function fetchDatasetDocument(
  path: string,
  context?: StockAnalyzerDataProviderContext,
): Promise<DatasetResponse> {
  const response = await fetch(path, {
    signal: context?.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Data fetch failed: ${path} (${response.status})`);
  }

  const payload = (await response.json()) as DatasetResponse;
  return payload && typeof payload === "object" ? payload : {};
}

const DATASET_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedDataset: NormalizedDataset | null = null;
let cachedDatasetAt = 0;
let cachedDatasetPromise: Promise<NormalizedDataset> | null = null;

async function loadDataset(
  context?: StockAnalyzerDataProviderContext,
): Promise<NormalizedDataset> {
  const [dataset, actionMap] = await Promise.all([
    fetchDatasetDocument(
      "/data/global-scouter/core/stocks_analyzer.json",
      context,
    ),
    loadActionSummaryMap(context),
  ]);
  const rows = Array.isArray(dataset.data) ? dataset.data : [];
  const sourceDate = typeof dataset.source_date === "string" ? dataset.source_date : null;

  const records = rows
    .map((row) => {
      const symbol = normalizeString(row.symbol).toUpperCase();
      if (!symbol) return null;
      const action = actionMap.get(symbol);

      return {
        symbol,
        companyName:
          normalizeString(row.companyName) || normalizeString(row.Corp),
        sector:
          normalizeString(row.sector) || normalizeString(row.WI26),
        industry: normalizeString(row.industry) || normalizeString(row.Exchange),
        country: normalizeString(row.country),
        price: parseNumber(row.price),
        marketCap: parseNumber(row.marketCap) ?? parseNumber(row["(USD mn)"]),
        growthRate: parseNumber(row.growthRate) ?? parseNumber(row["3 M"]),
        eps: parseNumber(row.eps) ?? parseNumber(row["EPS (Oct-25)"]),
        per: parseNumber(row.per) ?? parseNumber(row["PER (Fwd)"]),
        rank: parseNumber(row.rank) ?? parseNumber(row["PER+PBR"]),
        pbr: parseNumber(row.pbr) ?? parseNumber(row["PBR (Fwd)"]),
        dividendYield: parseNumber(row.dividendYield),
        return12m: parseNumber(row.return12m) ?? action?.return12m ?? undefined,
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
        perBandCurrent: parseNumber(row.perBandCurrent),
        perBandMin: parseNumber(row.perBandMin),
        perBandAvg: parseNumber(row.perBandAvg),
        perBandMax: parseNumber(row.perBandMax),
        peForward: parseNumber(row.peForward),
        epsForward: parseNumber(row.epsForward),
        dividendTtm: parseNumber(row.dividendTtm),
        ret1y: parseNumber(row.ret1y),
        ret3y: parseNumber(row.ret3y),
        ret5y: parseNumber(row.ret5y),
        guruHolders: action?.guruHolders ?? null,
        actionScore: action?.actionScore ?? null,
        confidenceLabel: action?.confidenceLabel ?? null,
        actionLabel: action?.actionLabel ?? null,
        actionBucket: action?.actionBucket ?? null,
        actionReasons: action?.actionReasons ?? [],
        lowEvidence: action?.lowEvidence ?? null,
        forwardPeFy1: action?.forwardPeFy1 ?? parseNumber(row.peForward) ?? null,
        forwardEpsFy1: action?.forwardEpsFy1 ?? parseNumber(row.epsForward) ?? null,
        revenueGrowthFy1: action?.revenueGrowthFy1 ?? null,
        epsGrowthFy1: action?.epsGrowthFy1 ?? null,
        grossMarginFy1: action?.grossMarginFy1 ?? null,
        operatingMarginFy1: action?.operatingMarginFy1 ?? null,
        roeFy1: action?.roeFy1 ?? null,
        forwardPeFy2: action?.forwardPeFy2 ?? null,
        forwardEpsFy2: action?.forwardEpsFy2 ?? null,
        revenueGrowthFy2: action?.revenueGrowthFy2 ?? null,
        epsGrowthFy2: action?.epsGrowthFy2 ?? null,
        grossMarginFy2: action?.grossMarginFy2 ?? null,
        operatingMarginFy2: action?.operatingMarginFy2 ?? null,
        roeFy2: action?.roeFy2 ?? null,
        forwardPeFy3: action?.forwardPeFy3 ?? null,
        forwardEpsFy3: action?.forwardEpsFy3 ?? null,
        revenueGrowthFy3: action?.revenueGrowthFy3 ?? null,
        epsGrowthFy3: action?.epsGrowthFy3 ?? null,
        grossMarginFy3: action?.grossMarginFy3 ?? null,
        operatingMarginFy3: action?.operatingMarginFy3 ?? null,
        roeFy3: action?.roeFy3 ?? null,
      } satisfies StockAnalyzerRecord;
    })
    .filter((row) => row !== null)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));

  return { sourceDate, records: records as StockAnalyzerRecord[] };
}

export class StaticStockAnalyzerDataProvider
  implements StockAnalyzerDataProvider<StockAnalyzerRecord>
{
  readonly id = "stock-analyzer-static-json-provider";
  readonly source = "data/global-scouter/core/stocks_analyzer.json";
  private sourceDate: string | null = null;

  /**
   * CAUTION: roe, opm, growthRate, and momentum fields are stored as
   * fractions in stocks_analyzer.json (e.g., roe=1.17 means 117%,
   * opm=0.32 means 32%). Multiply by 100 when displaying as percentages
   * to prevent a future 100× bug.
   */
  async load(
    context?: StockAnalyzerDataProviderContext,
  ): Promise<StockAnalyzerRecord[]> {
    if (context?.signal) {
      const dataset = await loadDataset(context);
      this.sourceDate = dataset.sourceDate;
      return dataset.records;
    }

    if (cachedDataset && Date.now() - cachedDatasetAt < DATASET_CACHE_TTL_MS) {
      this.sourceDate = cachedDataset.sourceDate;
      return cachedDataset.records;
    }

    if (!cachedDatasetPromise) {
      cachedDatasetPromise = loadDataset()
        .then((dataset) => {
          cachedDataset = dataset;
          cachedDatasetAt = Date.now();
          cachedDatasetPromise = null;
          return dataset;
        })
        .catch((error) => {
          cachedDatasetPromise = null;
          throw error;
        });
    }

    const dataset = await cachedDatasetPromise;
    this.sourceDate = dataset.sourceDate;
    return dataset.records;
  }

  getSourceDate(): string | null {
    return this.sourceDate;
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
