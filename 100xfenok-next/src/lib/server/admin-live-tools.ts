import { getTickerQuote } from "@/lib/server/ticker";
import { readPublicAssetText } from "@/lib/server/public-assets";

export type LiveToolId =
  | "market-data"
  | "feno-data"
  | "feno-search"
  | "google-search"
  | "naver-search"
  | "kakao-search"
  | "camera";
export type LiveToolCategory = "data" | "search" | "vision" | "dialog-mode";
export type LiveToolStatus = "available" | "locked" | "soon";

type LiveToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

type LiveToolDefinition = {
  id: LiveToolId;
  label: string;
  category: LiveToolCategory;
  status: LiveToolStatus;
  description: string;
  reason?: string;
  functionName?: string;
  instruction?: string;
  declaration?: LiveToolDeclaration;
};

export type LiveToolMetadata = Pick<
  LiveToolDefinition,
  "id" | "label" | "category" | "status" | "description" | "reason"
>;

const SYMBOL_PATTERN = /^[A-Z0-9.\-]{1,12}$/;
const FENO_SCOUTER_COMPANY_PATH = "/data/global-scouter/raw/companies_a_company.json";
const FENO_SCOUTER_ETF_PATH = "/data/global-scouter/raw/etfs_m_etfs.json";
const FENO_COMPUTED_SIGNALS_PATH = "/data/computed/signals.json";
const FENO_13F_BY_TICKER_PATH = "/data/sec-13f/by_ticker.json";
const FENO_13F_SUMMARY_PATH = "/data/sec-13f/summary.json";
const FENO_DETAIL_SECTIONS = [
  "overview",
  "valuation",
  "growth",
  "profitability",
  "cash_flow",
  "per_share",
  "holders",
  "signals",
] as const;

export const LIVE_SEARCH_SELECTION_POLICY = "multi" as const;

const LIVE_TOOL_DEFINITIONS = [
  {
    id: "market-data",
    label: "현재가",
    category: "data",
    status: "available",
    description: "100xFenok ticker price snapshot",
    functionName: "getTickerSnapshot",
    instruction:
      "Tool: getTickerSnapshot(symbol) is available for same-origin 100xFenok price snapshots only. Use it for current price context, not for full Fenok fundamentals, Scouter, 13F, or signal data. Keep stale or missing fields separate from verified facts.",
    declaration: {
      name: "getTickerSnapshot",
      description:
        "Fetch a same-origin 100xFenok price snapshot for a public market symbol. Use when the user asks for current ticker, index, ETF, crypto proxy, or market price context.",
      parameters: {
        type: "OBJECT",
        properties: {
          symbol: {
            type: "STRING",
            description:
              "Uppercase ticker symbol, ETF, index proxy, or crypto proxy such as SPY, QQQ, TQQQ, NVDA, BTC-USD.",
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    id: "feno-data",
    label: "Feno Data",
    category: "data",
    status: "available",
    description: "Global Scouter + 13F + computed signals",
    functionName: "getFenoTickerContext",
    instruction:
      "Tool: getFenoTickerContext(symbol, section?) is available for local 100xFenok feno-data. Use it when the user asks for Fenok data, Global Scouter, valuation, growth, profitability, consensus, 13F holders, ETF/index context, or known context about a symbol. Default to section=overview and summarize in 1-2 spoken sentences; never enumerate every returned field. Use getTickerSnapshot for price-only questions. Use a specific section only when the user asks for that detail. Explain when a symbol has ETF/index coverage but no stock detail file, and explain that computed signals are global/USD market context, not ticker-specific signals.",
    declaration: {
      name: "getFenoTickerContext",
      description:
        "Read local 100xFenok feno-data for a symbol. Default overview is voice-compact; optional section returns one focused detail area. Supports stock rows and ETF/index rows when available.",
      parameters: {
        type: "OBJECT",
        properties: {
          symbol: {
            type: "STRING",
            description: "Uppercase ticker, ETF, or index proxy such as NVDA, AAPL, MSFT, TSLA, AVGO, SPY, QQQ, or SOXX.",
          },
          section: {
            type: "STRING",
            description:
              "Optional detail section. Use overview by default; use valuation, growth, profitability, cash_flow, per_share, holders, or signals only when the user asks for that area.",
            enum: FENO_DETAIL_SECTIONS,
          },
        },
        required: ["symbol"],
      },
    },
  },
  {
    id: "feno-search",
    label: "Feno Search",
    category: "search",
    status: "soon",
    description: "Brave/Tavily search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "google-search",
    label: "Google",
    category: "search",
    status: "locked",
    description: "Google/Gemini search path",
    reason: "Gemini Live grounding은 현재 보류",
  },
  {
    id: "naver-search",
    label: "Naver",
    category: "search",
    status: "soon",
    description: "Naver search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "kakao-search",
    label: "Kakao",
    category: "search",
    status: "soon",
    description: "Kakao/Daum search skill bridge",
    reason: "서버 skill bridge 연결 후 활성화",
  },
  {
    id: "camera",
    label: "카메라",
    category: "vision",
    status: "soon",
    description: "모바일 카메라/이미지 입력",
    reason: "Android/iOS capture flow 설계 후 활성화",
  },
] satisfies LiveToolDefinition[];

const TOOL_BY_ID = new Map<LiveToolId, LiveToolDefinition>(
  LIVE_TOOL_DEFINITIONS.map((tool) => [tool.id, tool]),
);
const TOOL_BY_FUNCTION_NAME = new Map<string, LiveToolDefinition>(
  LIVE_TOOL_DEFINITIONS
    .filter((tool) => tool.functionName)
    .map((tool) => [tool.functionName as string, tool]),
);

export const DEFAULT_LIVE_ENABLED_TOOL_IDS: LiveToolId[] = [];

export function getLiveToolMetadata(): LiveToolMetadata[] {
  return LIVE_TOOL_DEFINITIONS.map(({ id, label, category, status, description, reason }) => ({
    id,
    label,
    category,
    status,
    description,
    reason,
  }));
}

export function normalizeLiveToolIds(value: unknown): LiveToolId[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<LiveToolId>();
  value.forEach((item) => {
    if (typeof item !== "string") return;
    const tool = TOOL_BY_ID.get(item as LiveToolId);
    if (!tool || tool.status !== "available") return;
    seen.add(tool.id);
  });

  return [...seen];
}

export function buildLiveToolInstructions(enabledToolIds: LiveToolId[]): string[] {
  return enabledToolIds
    .map((toolId) => TOOL_BY_ID.get(toolId)?.instruction)
    .filter((instruction): instruction is string => Boolean(instruction));
}

export function buildLiveToolDeclarations(enabledToolIds: LiveToolId[]): LiveToolDeclaration[] {
  return enabledToolIds
    .map((toolId) => TOOL_BY_ID.get(toolId)?.declaration)
    .filter((declaration): declaration is LiveToolDeclaration => Boolean(declaration));
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

type FenoDetailSection = (typeof FENO_DETAIL_SECTIONS)[number];
type JsonRecord = Record<string, unknown>;
const PUBLIC_JSON_CACHE = new Map<string, Promise<unknown>>();

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readPublicJson(pathname: string): Promise<unknown> {
  const cached = PUBLIC_JSON_CACHE.get(pathname);
  if (cached) return cached;

  const promise = readPublicAssetText(pathname)
    .then((raw) => JSON.parse(raw) as unknown)
    .catch((error) => {
      PUBLIC_JSON_CACHE.delete(pathname);
      throw error;
    });
  PUBLIC_JSON_CACHE.set(pathname, promise);
  return promise;
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pick(record: JsonRecord | null, key: string): unknown {
  return record ? record[key] : null;
}

function pickString(record: JsonRecord | null, key: string): string | null {
  return getString(pick(record, key));
}

function pickNumber(record: JsonRecord | null, key: string): number | null {
  return getNumber(pick(record, key));
}

function pickObject(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function pickArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactObject<T extends JsonRecord>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as Partial<T>;
}

function normalizeFenoSection(value: unknown): FenoDetailSection {
  if (typeof value !== "string") return "overview";
  return FENO_DETAIL_SECTIONS.includes(value as FenoDetailSection)
    ? value as FenoDetailSection
    : "overview";
}

function findGlobalScouterCompany(raw: unknown, symbol: string) {
  if (!isRecord(raw)) return { meta: null, company: null };

  const columns = pickArray(raw.columns)
    .filter(isRecord)
    .map((column) => getString(column.key) ?? "");
  const tickerIndex = columns.indexOf("ticker");
  const records = pickArray(raw.records).filter(isRecord);
  const row = records.find((record) => {
    const key = getString(record.key)?.toUpperCase();
    if (key === symbol) return true;
    const values = pickArray(record.values);
    return getString(values[tickerIndex])?.toUpperCase() === symbol;
  });

  if (!row) {
    return {
      meta: compactObject({
        generatedAt: getString(raw.generated_at),
        sourceDate: getString(raw.source_date),
        recordCount: getNumber(raw.count),
      }),
      company: null,
    };
  }

  const values = pickArray(row.values);
  const company = columns.reduce<JsonRecord>((acc, key, index) => {
    if (!key || key.startsWith("col_")) return acc;
    acc[key] = values[index] ?? null;
    return acc;
  }, {});

  return {
    meta: compactObject({
      generatedAt: getString(raw.generated_at),
      sourceDate: getString(raw.source_date),
      recordCount: getNumber(raw.count),
    }),
    company,
  };
}

function findGlobalScouterEtf(raw: unknown, symbol: string) {
  if (!isRecord(raw)) return { meta: null, etf: null };

  const columns = pickArray(raw.columns)
    .filter(isRecord)
    .map((column) => getString(column.key) ?? "");
  const tickerIndex = columns.indexOf("ticker");
  const records = pickArray(raw.records).filter(isRecord);
  const row = records.find((record) => {
    const key = getString(record.key)?.toUpperCase();
    if (key === symbol) return true;
    const values = pickArray(record.values);
    return getString(values[tickerIndex])?.toUpperCase() === symbol;
  });

  if (!row) {
    return {
      meta: compactObject({
        generatedAt: getString(raw.generated_at),
        sourceDate: getString(raw.source_date),
        recordCount: getNumber(raw.count),
      }),
      etf: null,
    };
  }

  const values = pickArray(row.values);
  const etf = columns.reduce<JsonRecord>((acc, key, index) => {
    if (!key || key.startsWith("col_")) return acc;
    acc[key] = values[index] ?? null;
    return acc;
  }, {});

  return {
    meta: compactObject({
      generatedAt: getString(raw.generated_at),
      sourceDate: getString(raw.source_date),
      recordCount: getNumber(raw.count),
    }),
    etf,
  };
}

function pickEstimateBlock(detail: JsonRecord | null, key: string) {
  const value = pickObject(pick(detail, key));
  return value ? compactObject(value) : null;
}

function pickEstimateNumber(detail: JsonRecord | null, blockKey: string, metricKey: string, yearKey: string) {
  const block = pickObject(pick(detail, blockKey));
  const metric = pickObject(block?.[metricKey]);
  return getNumber(metric?.[yearKey]);
}

function buildScouterDetail(detailRaw: unknown, section: FenoDetailSection) {
  const detail = pickObject(detailRaw);
  if (!detail) return null;

  if (section === "overview") {
    return compactObject({
      years: pickArray(detail.years),
      forwardHighlights: compactObject({
        perFy1: pickEstimateNumber(detail, "valuation_estimates", "per", "fy1"),
        perFy2: pickEstimateNumber(detail, "valuation_estimates", "per", "fy2"),
        pbrFy1: pickEstimateNumber(detail, "valuation_estimates", "pbr", "fy1"),
        revenueGrowthFy1: pickEstimateNumber(detail, "growth_estimates", "revenue_growth", "fy1"),
        epsGrowthFy1: pickEstimateNumber(detail, "growth_estimates", "eps_growth", "fy1"),
        operatingMarginFy1: pickEstimateNumber(detail, "profitability_estimates", "operating_margin", "fy1"),
        roeFy1: pickEstimateNumber(detail, "profitability_estimates", "roe", "fy1"),
        epsFy1: pickEstimateNumber(detail, "per_share_estimates", "eps", "fy1"),
        epsFy2: pickEstimateNumber(detail, "per_share_estimates", "eps", "fy2"),
      }),
    });
  }

  if (section === "valuation") {
    return compactObject({
      years: pickArray(detail.years),
      valuation: pickEstimateBlock(detail, "valuation"),
      valuationEstimates: pickEstimateBlock(detail, "valuation_estimates"),
    });
  }

  if (section === "growth") {
    return compactObject({
      years: pickArray(detail.years),
      growth: pickEstimateBlock(detail, "growth"),
      growthEstimates: pickEstimateBlock(detail, "growth_estimates"),
    });
  }

  if (section === "profitability") {
    return compactObject({
      years: pickArray(detail.years),
      profitability: pickEstimateBlock(detail, "profitability"),
      profitabilityEstimates: pickEstimateBlock(detail, "profitability_estimates"),
    });
  }

  if (section === "cash_flow") {
    return compactObject({
      years: pickArray(detail.years),
      cashFlow: pickEstimateBlock(detail, "cash_flow"),
      cashFlowEstimates: pickEstimateBlock(detail, "cash_flow_estimates"),
    });
  }

  if (section === "per_share") {
    return compactObject({
      years: pickArray(detail.years),
      perShare: pickEstimateBlock(detail, "per_share"),
      perShareEstimates: pickEstimateBlock(detail, "per_share_estimates"),
    });
  }

  if (section === "holders" || section === "signals") {
    return null;
  }

  return compactObject({
    years: pickArray(detail.years),
  });
}

function buildCompanySummary(company: JsonRecord | null) {
  if (!company) return null;

  return compactObject({
    symbol: pickString(company, "ticker"),
    name: pickString(company, "corp"),
    exchange: pickString(company, "exchange"),
    sector: pickString(company, "wi26"),
    fiscalYearCurrent: pickNumber(company, "fy_0"),
    foundedYear: pickNumber(company, "설립"),
    price: pickNumber(company, "현재가"),
    dayChangeRatio: pickNumber(company, "전일대비"),
    weekChangeRatio: pickNumber(company, "전주대비"),
    marketCapUsdMn: pickNumber(company, "usd_mn"),
    roeFwd: pickNumber(company, "roe_fwd"),
    opmFwd: pickNumber(company, "opm_fwd"),
    cashConversionCycleFy0: pickNumber(company, "ccc_fy_0"),
    perFwd: pickNumber(company, "per_fwd"),
    perAvgPremiumRatio: pickNumber(company, "per_avg"),
    pbrFwd: pickNumber(company, "pbr_fwd"),
    pegFwd: pickNumber(company, "peg_fwd"),
    returnYRatio: pickNumber(company, "return_y"),
    dividendYieldFy1Ratio: pickNumber(company, "dy_fy_1"),
  });
}

function buildEtfSummary(etf: JsonRecord | null, sourceDate: string | null) {
  if (!etf) return null;

  return compactObject({
    symbol: pickString(etf, "ticker"),
    category: pickString(etf, "sector"),
    inception: pickNumber(etf, "inception"),
    marketCapUsdMn: pickNumber(etf, "maket_cap_usd_mn"),
    price: sourceDate ? pickNumber(etf, sourceDate) : null,
    beta: pickNumber(etf, "beta"),
    expenseRatio: pickNumber(etf, "expense"),
    fiftyTwoWeekHigh: pickNumber(etf, "52_high_2"),
    fiftyTwoWeekLow: pickNumber(etf, "52_low_2"),
    return1mRatio: pickNumber(etf, "1_m"),
    return3mRatio: pickNumber(etf, "3_m"),
    return6mRatio: pickNumber(etf, "6_m"),
    returnYtdRatio: pickNumber(etf, "ytd"),
    return1yRatio: pickNumber(etf, "1_year"),
    return3yRatio: pickNumber(etf, "3_year"),
    return5yRatio: pickNumber(etf, "5_year"),
    return10yRatio: pickNumber(etf, "10_year"),
    assetWeightRatio: pickNumber(etf, "assets"),
    roeFwd: pickNumber(etf, "roe_fwd"),
    opmFwd: pickNumber(etf, "opm_fwd"),
    perFwd: pickNumber(etf, "per_fwd"),
  });
}

function buildHolderSummary(
  byTickerRaw: unknown,
  summaryRaw: unknown,
  symbol: string,
  options: { includeMetadata: boolean; holderLimit: number },
) {
  const byTicker = pickObject(byTickerRaw);
  const ticker = pickObject(byTicker?.[symbol]);
  const details = pickArray(ticker?.holder_details).filter(isRecord);
  const aggregated = new Map<string, { investor: string; shares: number; weight: number | null }>();

  details.forEach((detail) => {
    const investor = pickString(detail, "investor");
    const shares = pickNumber(detail, "shares");
    if (!investor || shares === null) return;
    const current = aggregated.get(investor) ?? { investor, shares: 0, weight: null };
    current.shares += shares;
    const weight = pickNumber(detail, "weight");
    if (weight !== null) current.weight = (current.weight ?? 0) + weight;
    aggregated.set(investor, current);
  });

  const summary = pickObject(summaryRaw);
  const metadata = pickObject(summary?.metadata);

  return compactObject({
    metadata: options.includeMetadata
      ? compactObject({
          version: getString(metadata?.version),
          generatedAt: getString(metadata?.generated_at),
          quartersCovered: pickArray(metadata?.quarters_covered).slice(0, 6),
          investorCount: getNumber(metadata?.investor_count),
          dataLatencyNote: getString(metadata?.data_latency_note),
        })
      : compactObject({
          generatedAt: getString(metadata?.generated_at),
          dataLatencyNote: getString(metadata?.data_latency_note),
        }),
    ticker: ticker
      ? compactObject({
          totalShares: pickNumber(ticker, "total_shares"),
          holderRows: details.length,
          uniqueHolderCount: aggregated.size,
          topHolders: [...aggregated.values()]
            .sort((a, b) => b.shares - a.shares)
            .slice(0, options.holderLimit),
        })
      : null,
  });
}

function buildSignalsSummary(raw: unknown, includeMetrics: boolean) {
  const signalsRoot = pickObject(raw);
  const signals = pickObject(signalsRoot?.signals);

  function signal(name: string) {
    const item = pickObject(signals?.[name]);
    if (!item) return null;
    return compactObject({
      status: getString(item.overallStatus),
      metrics: includeMetrics ? pickObject(item.metrics) : null,
      buyActive: getNumber(item.buy_active),
      buyNear: getNumber(item.buy_near),
      warnActive: getNumber(item.warn_active),
      warnNear: getNumber(item.warn_near),
    });
  }

  return compactObject({
    generatedAt: getString(signalsRoot?.generated_at),
    asOf: getString(signalsRoot?.as_of),
    note: "computed signals are global/USD market context, not ticker-specific signals",
    signals: compactObject({
      liquidityFlow: signal("liquidity_flow"),
      liquidityStress: signal("liquidity_stress"),
      bankingHealth: signal("banking_health"),
      sentiment: signal("sentiment_signal"),
    }),
  });
}

async function getTickerSnapshot(args: Record<string, unknown>) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) {
    return { error: "INVALID_SYMBOL", allowedPattern: SYMBOL_PATTERN.source };
  }

  const payload = await getTickerQuote(symbol).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "TICKER_FETCH_FAILED";
    return { error: "TICKER_FETCH_FAILED", symbol, message };
  });

  if ("error" in payload) return payload;

  return {
    symbol,
    snapshot: {
      symbol: payload.symbol,
      price: payload.price,
      previousClose: payload.previousClose,
      change: payload.change,
      changePercent: payload.changePercent,
      marketState: payload.marketState,
      source: payload.source,
      fetchedAt: payload.fetchedAt,
    },
    note: "Same-origin ticker snapshot. Treat stale or missing fields as uncertainty.",
  };
}

async function getFenoTickerContext(args: Record<string, unknown>) {
  const symbol = normalizeSymbol(args.symbol);
  if (!symbol) {
    return { error: "INVALID_SYMBOL", allowedPattern: SYMBOL_PATTERN.source };
  }

  const section = normalizeFenoSection(args.section);
  const detailPath = `/data/global-scouter/stocks/detail/${symbol}.json`;
  const [companyRaw, etfRaw, detailRaw, byTickerRaw, summaryRaw, signalsRaw] = await Promise.all([
    readPublicJson(FENO_SCOUTER_COMPANY_PATH).catch((error: unknown) => ({ error })),
    readPublicJson(FENO_SCOUTER_ETF_PATH).catch(() => null),
    readPublicJson(detailPath).catch(() => null),
    readPublicJson(FENO_13F_BY_TICKER_PATH).catch(() => null),
    readPublicJson(FENO_13F_SUMMARY_PATH).catch(() => null),
    readPublicJson(FENO_COMPUTED_SIGNALS_PATH).catch(() => null),
  ]);

  if (isRecord(companyRaw) && "error" in companyRaw) {
    return {
      error: "FENO_DATA_READ_FAILED",
      symbol,
      message: companyRaw.error instanceof Error ? companyRaw.error.message : "companies_a_company.json unavailable",
    };
  }

  const scouterCompany = findGlobalScouterCompany(companyRaw, symbol);
  const scouterEtf = findGlobalScouterEtf(etfRaw, symbol);
  const company = buildCompanySummary(scouterCompany.company);
  const etf = buildEtfSummary(scouterEtf.etf, getString(scouterEtf.meta?.sourceDate));
  const coverageType = company ? "stock" : etf ? "etf_or_index" : "none";

  return {
    symbol,
    section,
    coverage: compactObject({
      type: coverageType,
      hasStockDetail: detailRaw !== null,
      note:
        coverageType === "etf_or_index"
          ? "ETF/index row found in Global Scouter ETF data; stock detail/fundamental sections may be unavailable."
          : coverageType === "none"
            ? "No Global Scouter stock or ETF/index row was found for this symbol."
            : null,
    }),
    available: {
      globalScouterCompany: company !== null,
      globalScouterEtf: etf !== null,
      globalScouterDetail: detailRaw !== null,
      sec13f: pickObject(byTickerRaw)?.[symbol] !== undefined,
      computedSignals: signalsRaw !== null,
    },
    globalScouter: compactObject({
      meta: company ? scouterCompany.meta : scouterEtf.meta,
      company,
      etf,
      detail: company ? buildScouterDetail(detailRaw, section) : null,
    }),
    sec13f: buildHolderSummary(byTickerRaw, summaryRaw, symbol, {
      includeMetadata: section === "holders",
      holderLimit: section === "holders" ? 10 : 5,
    }),
    computedSignals: buildSignalsSummary(signalsRaw, section === "signals"),
    sources: [
      FENO_SCOUTER_COMPANY_PATH,
      FENO_SCOUTER_ETF_PATH,
      detailPath,
      FENO_13F_BY_TICKER_PATH,
      FENO_13F_SUMMARY_PATH,
      FENO_COMPUTED_SIGNALS_PATH,
    ],
    note: "This is local 100xFenok feno-data. It is not web search. Overview is intentionally voice-compact; call again with a specific section for focused detail. Current price snapshots may differ from Scouter source dates.",
  };
}

export async function executeLiveToolFunction(name: string, args: Record<string, unknown>) {
  const tool = TOOL_BY_FUNCTION_NAME.get(name);
  if (!tool || tool.status !== "available") {
    return { error: "UNKNOWN_TOOL" };
  }

  if (name === "getTickerSnapshot") {
    return getTickerSnapshot(args);
  }

  if (name === "getFenoTickerContext") {
    return getFenoTickerContext(args);
  }

  return { error: "TOOL_HANDLER_MISSING" };
}
