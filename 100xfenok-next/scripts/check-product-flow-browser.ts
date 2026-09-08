import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chromium,
  webkit,
  type Browser,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "playwright";

/**
 * Hosted, synthetic browser proof for the product-flow preservation packet.
 *
 * Source screens run the real application with synthetic same-origin data/API
 * fixtures. Palette navigation destinations use inert documents: those cases
 * prove the requested route, not unrelated destination-page functionality.
 * No authenticated or personal data is read. Each case receives a new context so local storage, module caches,
 * and assertion failures cannot leak into a later case.
 */

const QA_BASE_URL = requireLoopbackUrl(process.env.QA_BASE_URL ?? "http://127.0.0.1:3107");
const QA_ORIGIN = new URL(QA_BASE_URL).origin;
const SCREENSHOT_DIR = process.env.QA_SCREENSHOT_DIR ?? "test-results/product-flow";
const PORTFOLIO_KEY = "fenok.portfolio.v1";
const FIXTURE_DATE = "2026-09-06";
const WAIT_SHORT_MS = 2_500;
const WAIT_DATA_MS = 8_000;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

function requireLoopbackUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`QA_BASE_URL must be an absolute loopback URL: ${raw}`);
  }
  const host = parsed.hostname.toLowerCase();
  const loopback = host === "localhost"
    || host.endsWith(".localhost")
    || host === "127.0.0.1"
    || host === "::1"
    || host === "[::1]";
  if (!loopback || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error(`QA_BASE_URL must use HTTP(S) loopback host, received ${raw}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("QA_BASE_URL must not contain credentials");
  }
  return parsed.origin;
}

type JsonObject = Record<string, unknown>;

type BrowserCondition = {
  name: "chromium" | "webkit";
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
};

const CONDITIONS: BrowserCondition[] = [
  { name: "chromium", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "webkit", width: 820, height: 1180, isMobile: true, hasTouch: true },
];

type EtfMode = "valid" | "unavailable" | "failed" | "null" | "disjoint";

type FixtureRuntimeOptions = {
  delayedInitialStock?: boolean;
  delayedOptionalSearch?: boolean;
  searchInvestors?: boolean;
  invalidInitialInvestor?: boolean;
  etfMode?: EtfMode;
};

type CaseRuntime = {
  readonly blockedForeign: string[];
  readonly unexpectedDataPaths: string[];
  readonly expectedFailurePaths: Set<string>;
  readonly expectedCancellations: string[];
  readonly requestFailures: string[];
  readonly mode?: EtfMode;
  stockRequestCount: number;
  stockResponseCount: number;
  stockReleased: boolean;
  optionalResponseCount: number;
  investorRequestCount: number;
  searchMetrics: Record<string, number | boolean>;
  releaseStock(): void;
  releaseOptional(): void;
};

type BrowserCase = {
  name: string;
  options?: FixtureRuntimeOptions;
  run: (page: Page, runtime: CaseRuntime, condition: BrowserCondition) => Promise<void>;
};

type CaseReceipt = {
  condition: string;
  case: string;
  status: "passed" | "failed";
  duration_ms: number;
  search_metrics?: Record<string, number | boolean>;
  error?: string;
  blocked_foreign?: string[];
  unexpected_data_paths?: string[];
  expected_cancellations?: string[];
  request_failures?: string[];
};

const portfolioCore = {
  id: "p-core",
  name: "Synthetic Core",
  currency: "USD" as const,
  cash: 12_500,
  holdings: [
    { ticker: "AAPL", shares: 10, avg_cost: 180.25 },
    { ticker: "MSFT", shares: 8, avg_cost: 410.5 },
  ],
};

const portfolioOld = {
  id: "p-old",
  name: "Stored Before Failure",
  currency: "USD" as const,
  cash: 2_000,
  holdings: [{ ticker: "SPY", shares: 4, avg_cost: 450 }],
};

const legacyPortfolio = {
  id: "p-legacy",
  name: "Legacy Symbols",
  currency: "USD" as const,
  cash: 900,
  holdings: [
    { ticker: "BRK/B", shares: 2, avg_cost: 470 },
    { ticker: "AAPL", shares: 3, avg_cost: 180 },
  ],
};

function portfolioDoc(portfolios: unknown[]): string {
  return JSON.stringify({ version: 1, updated_at: `${FIXTURE_DATE}T00:00:00.000Z`, portfolios });
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stockRows(): JsonObject[] {
  return [
    { symbol: "AAPL", companyName: "Synthetic Apple", sector: "Technology", price: 190 },
    { symbol: "MSFT", companyName: "Synthetic Microsoft", sector: "Technology", price: 420 },
    { symbol: "NVDA", companyName: "Synthetic Nvidia", sector: "Technology", price: 125 },
    { symbol: "SPY", companyName: "Synthetic S&P 500 ETF", sector: "ETF", price: 550 },
    { symbol: "QQQ", companyName: "Synthetic Nasdaq 100 ETF", sector: "ETF", price: 480 },
    { symbol: "BRKB", companyName: "Synthetic Berkshire B", sector: "Financials", price: 500 },
    { symbol: "DISJA", companyName: "Synthetic Disjoint A", sector: "ETF", price: 100 },
    { symbol: "DISJB", companyName: "Synthetic Disjoint B", sector: "ETF", price: 100 },
  ];
}

function stockDataset(): JsonObject {
  return { source_date: FIXTURE_DATE, data: stockRows() };
}

function actionSummary(): JsonObject {
  return { schema_version: "synthetic-product-flow/v1", fields: ["symbol"], rows: stockRows().map((row) => [row.symbol]) };
}

function graphIndex(): JsonObject {
  const stocks: JsonObject = {};
  for (const row of stockRows()) {
    const symbol = String(row.symbol);
    stocks[symbol] = {
      key: symbol,
      ticker: symbol,
      label: String(row.companyName),
      flags: { market_facts: true, filings: false, sec_13f: false, index_membership: false, single_stock_etfs: false },
      connection_count: 1,
    };
  }
  return { schema_version: "data-entity-graph-stock-index/v1", source_as_of: { synthetic: FIXTURE_DATE }, stocks };
}

function serviceIndex(): JsonObject {
  const stocks: JsonObject = {};
  for (const row of stockRows()) {
    const symbol = String(row.symbol);
    stocks[symbol] = { target_key: symbol, ticker: symbol, route: `/stock/${symbol}`, single_stock_etfs: [] };
  }
  return { schema_version: "data-entity-graph-stock-services/v1", source_as_of: { synthetic: FIXTURE_DATE }, stocks };
}

function benchmarkSummary(): JsonObject {
  const momentum: JsonObject = {};
  for (const key of ["sp500", "nasdaq100", "russell2000", "kospi", "nikkei", "emerging"]) {
    momentum[key] = { ytd: 0.01 };
  }
  return { generated_at: `${FIXTURE_DATE}T00:00:00.000Z`, momentum };
}

function etfHolding(symbol: string, weight_pct: number, name = `Synthetic ${symbol}`): JsonObject {
  return { rank: 1, symbol, name, weight_pct };
}

function validEtf(ticker: string, holdings: JsonObject[]): JsonObject {
  return {
    ticker,
    asset_type: "etf",
    fetched_at: `${FIXTURE_DATE}T00:00:00.000Z`,
    detail_status: "complete",
    normalized: {
      overview: {
        name: `Synthetic ${ticker} ETF`,
        exchange: "NASDAQ",
        fundFamily: "Synthetic Funds",
        category: "Synthetic Equity",
        expenseRatio: 0.2,
        dividendYield: 1.1,
        aum: "100M",
      },
      performance: { tr1m: 1.2, trYTD: 5.6, tr1y: 12.3, cagr5y: 8.4 },
      holdings,
      holding_count: holdings.length,
      holdings_updated: FIXTURE_DATE,
      history: [],
    },
  };
}

function unavailableSupply(): JsonObject {
  return {
    enrollment_state: "enrolled",
    resolution_state: "unavailable",
    provider_role: null,
    fallback_depth: null,
    source_as_of: null,
    selected_at: null,
    source_age_days: null,
    reason_code: null,
    recovery_transition: "unavailable",
    projection_digest: "0".repeat(64),
  };
}

function etfPayload(ticker: string, mode: EtfMode): { status: number; body: unknown } {
  if (mode === "unavailable") {
    return { status: 503, body: { error: "DATA_SUPPLY_UNAVAILABLE", data_supply: unavailableSupply() } };
  }
  if (mode === "failed") return { status: 500, body: { error: "SYNTHETIC_FAILURE" } };
  if (mode === "null") return { status: 200, body: validEtf(ticker, []) };
  if (mode === "disjoint") {
    return { status: 200, body: validEtf(ticker, [etfHolding(ticker === "DISJA" ? "AAA" : "BBB", 7.5)]) };
  }
  const holdings = ticker === "QQQ"
    ? [etfHolding("QQQ", 30), etfHolding("AAPL", 8)]
    : ticker === "SPY"
      ? [etfHolding("SPY", 25), etfHolding("MSFT", 7)]
      : [etfHolding(ticker, 10)];
  return { status: 200, body: validEtf(ticker, holdings) };
}

function marketFacts(): JsonObject {
  const output: JsonObject = {};
  for (const ticker of ["QQQ", "SPY", "VOO", "DISJA", "DISJB", "NULL", "UNAVAIL", "FAILED"]) {
    output[ticker] = {
      ticker,
      asset_type: "etf",
      generated_at: `${FIXTURE_DATE}T00:00:00.000Z`,
      identity: {
        name: `Synthetic ${ticker} ETF`,
        exchange: "NASDAQ",
        currency: "USD",
        fund_family: "Synthetic Funds",
        category: "Synthetic Equity",
      },
      facts: { price: { value: 100, as_of: FIXTURE_DATE, source: "synthetic" } },
      etf: { holdings_count: 1, holdings_updated: FIXTURE_DATE, top_holdings: [] },
    };
  }
  return output;
}

function etfSignals(ticker: string): JsonObject {
  return { generated_at: `${FIXTURE_DATE}T00:00:00.000Z`, formula_version: "synthetic", row: { ticker, company: `Synthetic ${ticker}`, scored_signal_count: 0, scores: {} } };
}

function etfUniverse(): JsonObject {
  return {
    generated_at: `${FIXTURE_DATE}T00:00:00.000Z`,
    counts: { records: 0 },
    records: [],
  };
}

function macroFixtures(pathname: string): unknown | undefined {
  const points = [
    { date: "2026-09-01", value: 100 },
    { date: "2026-09-02", value: 102 },
    { date: "2026-09-03", value: 104 },
    { date: "2026-09-04", value: 107 },
    { date: "2026-09-05", value: 108 },
    { date: FIXTURE_DATE, value: 110 },
  ];
  if (pathname === "/data/indices/sp500.json") return points;
  if (pathname === "/data/macro/fred-banking-daily.json") return { series: { DGS10: points.map((point) => ({ ...point, value: point.value / 20 })) } };
  return undefined;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  };
}

class FixtureRouter implements CaseRuntime {
  readonly blockedForeign: string[] = [];
  readonly unexpectedDataPaths: string[] = [];
  readonly expectedFailurePaths = new Set<string>();
  readonly expectedCancellations: string[] = [];
  readonly requestFailures: string[] = [];
  readonly mode: EtfMode;
  stockRequestCount = 0;
  stockResponseCount = 0;
  stockReleased = false;
  optionalResponseCount = 0;
  investorRequestCount = 0;
  searchMetrics: Record<string, number | boolean> = {};
  private optionalReleased = false;
  private optionalWaiters: Array<() => void> = [];
  private readonly harnessAbortedRequests = new WeakSet<Request>();
  private readonly options: FixtureRuntimeOptions;
  private stockWaiters: Array<() => void> = [];

  constructor(options: FixtureRuntimeOptions = {}) {
    this.options = options;
    this.mode = options.etfMode ?? "valid";
  }

  releaseStock() {
    this.stockReleased = true;
    const waiters = this.stockWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  releaseOptional() {
    this.optionalReleased = true;
    for (const resolve of this.optionalWaiters.splice(0)) resolve();
  }

  private waitForStockRelease(): Promise<void> {
    if (this.stockReleased) return Promise.resolve();
    return new Promise((resolve) => this.stockWaiters.push(resolve));
  }

  markHarnessAborted(request: Request): void {
    this.harnessAbortedRequests.add(request);
  }

  isHarnessAborted(request: Request): boolean {
    return this.harnessAbortedRequests.has(request);
  }

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (requestUrl.origin !== QA_ORIGIN) {
      this.blockedForeign.push(requestUrl.origin);
      await route.abort("blockedbyclient");
      return;
    }
    if (isHarnessRscRequest(request, requestUrl)) {
      this.markHarnessAborted(request);
      await route.abort("aborted");
      return;
    }
    if (!requestUrl.pathname.startsWith("/data/") && !requestUrl.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (requestUrl.pathname === "/data/global-scouter/core/stocks_analyzer.json" && this.options.delayedInitialStock) {
      this.stockRequestCount += 1;
      await this.waitForStockRelease();
    }

    if (requestUrl.pathname === "/data/sec-13f/analytics/portfolio_views.json") this.investorRequestCount += 1;
    const optionalSearch = requestUrl.pathname === "/data/computed/stock_action_summary.json"
      || requestUrl.pathname === "/data/sec-13f/analytics/portfolio_views.json";
    if (optionalSearch && this.options.delayedOptionalSearch && !this.optionalReleased) {
      await new Promise<void>((resolve) => this.optionalWaiters.push(resolve));
    }
    const response = this.dataResponse(requestUrl.pathname);
    if (response === undefined) {
      this.unexpectedDataPaths.push(requestUrl.pathname);
      await route.fulfill(jsonResponse({ error: "SYNTHETIC_UNEXPECTED_DATA_PATH" }, 404));
      return;
    }
    if (response.status >= 400) this.expectedFailurePaths.add(requestUrl.pathname);
    await route.fulfill(jsonResponse(response.body, response.status));
    if (requestUrl.pathname === "/data/global-scouter/core/stocks_analyzer.json") this.stockResponseCount += 1;
    if (optionalSearch) this.optionalResponseCount += 1;
  }

  private dataResponse(pathname: string): { status: number; body: unknown } | undefined {
    const macro = macroFixtures(pathname);
    if (macro !== undefined) return { status: 200, body: macro };
    if (pathname === "/data/global-scouter/core/stocks_analyzer.json") return { status: 200, body: stockDataset() };
    if (pathname === "/data/computed/stock_action_summary.json") return { status: 200, body: actionSummary() };
    // Exact empty/unavailable contracts for the real AAPL stock/screener journey.
    if (pathname === "/data/computed/fenok_signals_summary.json") return { status: 200, body: { fields: [], rows: [] } };
    if (pathname === "/data/sec-13f/analytics/guru_holders_index.json") return { status: 200, body: {} };
    if (pathname === "/data/sec-13f/by_ticker.json") return { status: 200, body: { AAPL: { holder_details: [] } } };
    if (pathname === "/data/global-scouter/stocks/detail/AAPL.json") return { status: 200, body: { years: [], income_statement: {} } };
    if (pathname === "/api/data/stockanalysis/stocks/AAPL" || pathname === "/api/data/stockanalysis/financials/AAPL") return { status: 200, body: {} };
    if (pathname === "/data/damodaran/industry_benchmarks.json") return { status: 200, body: {} };
    if (pathname === "/data/slickcharts/stocks/AAPL.json") return { status: 200, body: {} };
    if (pathname === "/data/earnings-overview/AAPL.json") return { status: 503, body: { error: "SYNTHETIC_UNAVAILABLE" } };
    if (pathname === "/data/computed/entity_graph_stock_index.json") return { status: 200, body: graphIndex() };
    if (pathname === "/data/computed/entity_graph_stock_services.json") return { status: 200, body: serviceIndex() };
    if (pathname === "/data/benchmarks/summaries.json") return { status: 200, body: benchmarkSummary() };
    if (pathname === "/data/sec-13f/analytics/portfolio_views.json") {
      if (this.options.invalidInitialInvestor && this.investorRequestCount === 1) return { status: 200, body: {} };
      return { status: 200, body: { investors: this.options.delayedOptionalSearch || this.options.searchInvestors || this.options.invalidInitialInvestor
        ? { synthetic: { name: "Synthetic AAPL Investor" } } : {} } };
    }
    if (pathname.startsWith("/data/computed/market_facts/shards/")) return { status: 200, body: marketFacts() };
    if (pathname.startsWith("/data/yf/finance/")) return { status: 200, body: { data: { info: { currentPrice: 100 } } } };
    if (pathname === "/api/data/stockanalysis/etf-universe") return { status: 200, body: etfUniverse() };

    const tickerSurfacesMatch = pathname.match(/^\/api\/data\/stockanalysis\/ticker\/([^/]+)\/surfaces\/?$/);
    if (tickerSurfacesMatch) {
      const ticker = decodeURIComponent(tickerSurfacesMatch[1] ?? "").toUpperCase();
      return {
        status: 200,
        body: {
          schema_version: "stockanalysis-ticker-surfaces/v1",
          generated_at: `${FIXTURE_DATE}T00:00:00.000Z`,
          source: "synthetic product-flow fixture",
          ticker,
          counts: { asset_filter: "all", surfaces_checked: 0, surfaces_matched: 0, rows_returned: 0 },
          sections: { earnings: [], actions: [], markets: [], etfs: [], ipo: [], industry: [] },
        },
      };
    }

    const etfMatch = pathname.match(/^\/api\/data\/stockanalysis\/etfs\/([^/]+)\/?$/);
    if (etfMatch) {
      const ticker = decodeURIComponent(etfMatch[1] ?? "").toUpperCase();
      const mode = ticker === "SPY" && this.mode !== "valid" ? "valid" : this.mode;
      return etfPayload(ticker, mode);
    }
    const signalMatch = pathname.match(/^\/api\/data\/fenok-etf-signals\/([^/]+)\/?$/);
    if (signalMatch) return { status: 200, body: etfSignals(decodeURIComponent(signalMatch[1] ?? "").toUpperCase()) };
    return undefined;
  }
}

async function waitForCondition(
  condition: () => Promise<boolean> | boolean,
  message: string,
  timeout = WAIT_SHORT_MS,
): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await condition()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  if (lastError) throw new Error(`${message}: ${String(lastError)}`);
  throw new Error(message);
}

async function gotoPath(page: Page, pathname: string): Promise<void> {
  const response = await page.goto(new URL(pathname, QA_BASE_URL).href, {
    waitUntil: "domcontentloaded",
    timeout: 15_000,
  });
  assert(response && response.status() < 400, `navigation ${pathname} returned ${response?.status() ?? "no response"}`);
}

async function readDownload(download: Download): Promise<string> {
  const path = await download.path();
  assert(path, `download ${download.suggestedFilename()} did not expose a hosted path`);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

async function screenshot(page: Page, label: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${label}.png`), fullPage: true });
}

async function seedStorage(page: Page, raw: string, failWrites = false): Promise<void> {
  await page.addInitScript(({ key, value, fail }) => {
    window.localStorage.setItem(key, value);
    if (fail) {
      const marker = window as unknown as { __productFlowStorageFailure?: boolean };
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(name: string, next: string) {
        if (name === key && marker.__productFlowStorageFailure) {
          throw new DOMException("Synthetic localStorage write failure", "QuotaExceededError");
        }
        return original.call(this, name, next);
      };
    }
  }, { key: PORTFOLIO_KEY, value: raw, fail: failWrites });
}

async function enableStorageFailure(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __productFlowStorageFailure?: boolean }).__productFlowStorageFailure = true;
  });
}

async function portfolioRaw(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), PORTFOLIO_KEY);
}

async function portfolioPortfolios(page: Page): Promise<JsonObject[]> {
  const raw = await portfolioRaw(page);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { portfolios?: unknown };
  return Array.isArray(parsed.portfolios) ? parsed.portfolios as JsonObject[] : [];
}

async function portfolioInputs(page: Page) {
  const section = page.locator('[data-portfolio-section="add-holding"]');
  return {
    ticker: section.locator("input").nth(0),
    shares: section.locator("input").nth(1),
    cost: section.locator("input").nth(2),
  };
}

async function waitForPortfolioEditor(page: Page, name: string): Promise<void> {
  await waitForCondition(async () => {
    const holdings = page.locator('[data-portfolio-section="holdings"]');
    const addHolding = page.locator('[data-portfolio-section="add-holding"]');
    if (await holdings.count() !== 1 || await addHolding.count() !== 1) return false;
    return (await page.locator("body").innerText().catch(() => "")).includes(name);
  }, `seeded portfolio editor did not become interactive for ${name}`, WAIT_DATA_MS);
}

async function fillPortfolioImport(page: Page, value: string): Promise<void> {
  const input = page.locator("[data-portfolio-import-json-input]");
  const action = page.locator("[data-portfolio-import-json-action]");
  await waitForCondition(async () => {
    return await input.count() === 1
      && await action.count() === 1
      && await input.isVisible()
      && await input.isEditable()
      && await action.isVisible();
  }, "portfolio import controls did not become interactive", WAIT_DATA_MS);
  await input.fill(value);
  await waitForCondition(async () => {
    return await input.inputValue() === value && await action.isEnabled();
  }, "portfolio import action did not enable after paste", WAIT_SHORT_MS);
  await action.click();
}

async function portfolioActionButton(page: Page, name: string): Promise<Locator> {
  const button = page.getByRole("button", { name, exact: true });
  await waitForCondition(async () => await button.count() === 1 && await button.isVisible() && await button.isEnabled(), `portfolio ${name} action did not become interactive`);
  return button;
}

async function storageErrorVisible(page: Page): Promise<boolean> {
  const candidates = page.locator('[role="alert"], [role="status"], [aria-live], [data-portfolio-save-error], [data-portfolio-storage-error]');
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    if (!await candidates.nth(index).isVisible()) continue;
    const text = (await candidates.nth(index).innerText().catch(() => "")).trim();
    if (/저장[^\n]*(?:못|실패|불가)|(?:storage|write)[^\n]*(?:fail|error)/i.test(text)) return true;
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return /저장(?:에|이|을)?\s*(?:실패|되지|못|할 수 없)|입력값?\s*(?:유지|보존)|변경.*(?:유지|보존)/i.test(bodyText);
}

async function emptyPortfolioCase(page: Page, _runtime: CaseRuntime, condition: BrowserCondition): Promise<void> {
  await gotoPath(page, "/portfolio/");
  await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  await waitForCondition(async () => await page.locator("[data-portfolio-local-boundary]").count() > 0, "empty portfolio boundary did not render");
  await screenshot(page, `portfolio-empty-${condition.name}`);
  assert.equal(
    await page.locator('[data-portfolio-import-json-input]').count(),
    1,
    "empty portfolio must expose a direct restore/import input",
  );
  await fillPortfolioImport(page, JSON.stringify(portfolioCore));
  await waitForCondition(async () => (await portfolioPortfolios(page)).length === 1, "empty device must restore directly without a placeholder portfolio");
  const [restored] = await portfolioPortfolios(page);
  assert.deepEqual(restored.holdings, portfolioCore.holdings);
  assert.equal(restored.name, portfolioCore.name);
}

async function exportImportCase(page: Page, _runtime: CaseRuntime, condition: BrowserCondition): Promise<void> {
  await seedStorage(page, portfolioDoc([portfolioCore]));
  await gotoPath(page, "/portfolio/");
  await waitForPortfolioEditor(page, portfolioCore.name);
  await screenshot(page, `portfolio-editor-${condition.name}`);
  const exportButton = page.locator("[data-portfolio-export-json-action]");
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: WAIT_SHORT_MS }), exportButton.click()]);
  const exportedBytes = await readDownload(download);
  const exported = JSON.parse(exportedBytes) as JsonObject;
  assert.equal(download.suggestedFilename().endsWith(".json"), true, "portfolio export must be a JSON download");
  await fillPortfolioImport(page, exportedBytes);
  await waitForCondition(async () => (await portfolioPortfolios(page)).length === 2, "imported portfolio was not persisted");
  const stored = await portfolioPortfolios(page);
  const sameName = stored.filter((portfolio) => portfolio.name === exported.name);
  assert.equal(sameName.length, 2, "round-trip import must add a second portfolio with the exported name");
  const imported = sameName.find((portfolio) => portfolio.id !== exported.id);
  assert(imported, "imported portfolio must retain the exported name");
  assert.equal(stored.some((portfolio) => portfolio.id === exported.id), true, "round-trip import must retain the original portfolio");
  assert.notEqual(imported.id, exported.id, "additive import must regenerate the imported portfolio id");
  assert.deepEqual(
    { name: imported.name, currency: imported.currency, cash: imported.cash, holdings: imported.holdings },
    { name: exported.name, currency: exported.currency, cash: exported.cash, holdings: exported.holdings },
    "export -> import must preserve portfolio fields and holdings",
  );
}

async function storageAddFailureCase(page: Page, _runtime: CaseRuntime): Promise<void> {
  const raw = portfolioDoc([portfolioOld]);
  await seedStorage(page, raw, true);
  await gotoPath(page, "/portfolio/");
  await waitForPortfolioEditor(page, portfolioOld.name);
  await enableStorageFailure(page);
  const inputs = await portfolioInputs(page);
  await inputs.ticker.fill("NVDA");
  await inputs.shares.fill("3");
  await inputs.cost.fill("120");
  await (await portfolioActionButton(page, "추가")).click();
  await waitForCondition(() => storageErrorVisible(page), "failed add did not announce a storage error");
  assert.equal(await portfolioRaw(page), raw, "failed add must preserve old stored bytes");
  const stored = await portfolioPortfolios(page);
  assert.equal(stored.length, 1, "failed add must not append a record");
  assert.equal(await inputs.ticker.inputValue(), "NVDA", "failed add must preserve the entered ticker");
  assert.equal(await inputs.shares.inputValue(), "3", "failed add must preserve the entered share draft");
  assert.equal(await inputs.cost.inputValue(), "120", "failed add must preserve the entered cost draft");
  assert.equal(await storageErrorVisible(page), true, "failed add must announce a visible storage error");
}

async function storageImportFailureCase(page: Page, _runtime: CaseRuntime): Promise<void> {
  const raw = portfolioDoc([portfolioOld]);
  await seedStorage(page, raw, true);
  await gotoPath(page, "/portfolio/");
  await waitForPortfolioEditor(page, portfolioOld.name);
  await enableStorageFailure(page);
  const imported = cloneJson(portfolioCore);
  imported.id = "p-import-failure";
  const importBytes = JSON.stringify(imported, null, 2);
  const input = page.locator("[data-portfolio-import-json-input]");
  await fillPortfolioImport(page, importBytes);
  await waitForCondition(() => storageErrorVisible(page), "failed import did not announce a storage error");
  assert.equal(await portfolioRaw(page), raw, "failed import must preserve old stored bytes");
  assert.equal((await portfolioPortfolios(page)).length, 1, "failed import must not append a record");
  assert.equal(await input.inputValue(), importBytes, "failed import must preserve pasted bytes");
  assert.equal(await storageErrorVisible(page), true, "failed import must announce a visible storage error");
}

async function importLegacy(page: Page): Promise<void> {
  await seedStorage(page, portfolioDoc([{ id: "p-placeholder", name: "Existing", currency: "USD", cash: 0, holdings: [] }]));
  await gotoPath(page, "/portfolio/");
  await waitForPortfolioEditor(page, "Existing");
  const legacy = {
    portfolios: {
      [legacyPortfolio.name]: {
        cash: legacyPortfolio.cash,
        holdings: legacyPortfolio.holdings,
      },
    },
  };
  await fillPortfolioImport(page, JSON.stringify(legacy));
  await waitForCondition(async () => (await portfolioPortfolios(page)).some((portfolio) => portfolio.name === legacyPortfolio.name), "legacy portfolio was not imported");
  await waitForCondition(async () => {
    const action = legacyActionButton(page, "수정 입력");
    return await action.count() === 1 && await action.isVisible() && await action.isEnabled();
  }, "legacy portfolio row action did not become interactive", WAIT_DATA_MS);
}

function legacyActionButton(page: Page, action: "수정 입력" | "삭제") {
  return page.getByRole("button", { name: new RegExp(`BRK(?:\\/B|\\.B|B).*${action}`) }).first();
}

async function legacyEditCase(page: Page): Promise<void> {
  await importLegacy(page);
  const button = legacyActionButton(page, "수정 입력");
  assert.equal(await button.count(), 1, "legacy BRK/B row must expose an edit action");
  await button.click();
  const inputs = await portfolioInputs(page);
  await inputs.shares.fill("7");
  await inputs.cost.fill("500");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await waitForCondition(async () => {
    const current = (await portfolioPortfolios(page)).find((portfolio) => portfolio.name === legacyPortfolio.name);
    return Array.isArray(current?.holdings) && current.holdings.length === 2 && current.holdings.some((holding) => holding.ticker === "BRK/B" && holding.shares === 7);
  }, "editing legacy BRK/B did not update the original row");
  const current = (await portfolioPortfolios(page)).find((portfolio) => portfolio.name === legacyPortfolio.name);
  assert(current);
  assert.equal(current.holdings.filter((holding) => holding.ticker === "BRK/B").length, 1, "legacy edit must not create a transformed duplicate");
  assert.equal(current.holdings.some((holding) => holding.ticker === "AAPL"), true, "legacy edit must preserve the other ticker");

  const beforeCollision = await portfolioRaw(page);
  await legacyActionButton(page, "수정 입력").click();
  await inputs.ticker.fill("AAPL");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  assert.equal(await portfolioRaw(page), beforeCollision, "editing into an existing ticker must preserve both rows");
  assert.equal(await inputs.ticker.inputValue(), "AAPL", "a rejected edit must preserve its draft");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await inputs.ticker.fill("BRKB");
  await inputs.shares.fill("1");
  await inputs.cost.fill("500");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await waitForCondition(async () => {
    const saved = (await portfolioPortfolios(page)).find((portfolio) => portfolio.name === legacyPortfolio.name);
    return Array.isArray(saved?.holdings) && saved.holdings.length === 3;
  }, "BRKB must remain distinct from imported BRK/B");
}

async function stalePortfolioEditCase(page: Page): Promise<void> {
  const duplicate = { ...legacyPortfolio, holdings: [
    { ticker: "BRK/B", shares: 2, avg_cost: 470 },
    { ticker: "BRK/B", shares: 5, avg_cost: 490 },
    { ticker: "AAPL", shares: 3, avg_cost: 180 },
  ] };
  await seedStorage(page, portfolioDoc([duplicate, { id: "p-other", name: "Other Portfolio", currency: "USD", cash: 0, holdings: [] }]));
  await gotoPath(page, "/portfolio/");
  await waitForPortfolioEditor(page, duplicate.name);
  const editButtons = page.getByRole("button", { name: /BRK\/B.*수정 입력/ });
  await editButtons.nth(1).click();
  const inputs = await portfolioInputs(page);
  await inputs.shares.fill("7");
  const beforeSwitch = await portfolioRaw(page);
  await page.getByRole("button", { name: "Other Portfolio", exact: true }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  assert.equal(await portfolioRaw(page), beforeSwitch, "switching portfolios must not turn an edit into an add");
  assert.equal(await inputs.shares.inputValue(), "7", "stale edit must retain the draft");
  await page.getByRole("button", { name: legacyPortfolio.name, exact: true }).click();
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await waitForCondition(async () => {
    const [saved] = await portfolioPortfolios(page);
    return Array.isArray(saved.holdings) && saved.holdings[0].shares === 2 && saved.holdings[1].shares === 7;
  }, "editing a duplicate ticker must change only the original second row");

  await editButtons.nth(1).click();
  await inputs.shares.fill("9");
  const changed = await portfolioPortfolios(page);
  (changed[0].holdings as JsonObject[]).splice(0, 1);
  const externalBytes = portfolioDoc(changed);
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, { key: PORTFOLIO_KEY, value: externalBytes });
  await page.getByRole("button", { name: "저장", exact: true }).click();
  assert.equal(await portfolioRaw(page), externalBytes, "a shifted edit target must not be guessed by ticker");
  assert.equal(await inputs.shares.inputValue(), "9", "a shifted target must retain the entered quantity");
}

async function legacyDeleteCase(page: Page): Promise<void> {
  await importLegacy(page);
  const button = legacyActionButton(page, "삭제");
  assert.equal(await button.count(), 1, "legacy BRK/B row must expose a delete action");
  await button.click();
  await waitForCondition(async () => {
    const current = (await portfolioPortfolios(page)).find((portfolio) => portfolio.name === legacyPortfolio.name);
    return Array.isArray(current?.holdings) && current.holdings.length === 1 && current.holdings[0]?.ticker === "AAPL";
  }, "deleting legacy BRK/B did not target the original row");
  const current = (await portfolioPortfolios(page)).find((portfolio) => portfolio.name === legacyPortfolio.name);
  assert(current);
  assert.equal(current.holdings.some((holding) => /BRK[/.]?B/.test(String(holding.ticker))), false, "legacy delete must remove the BRK/B row");
}

async function etfDetailCompareCase(page: Page, _runtime: CaseRuntime, condition: BrowserCondition): Promise<void> {
  await gotoPath(page, "/etfs/QQQ/");
  await waitForCondition(async () => await page.locator('[data-etf-detail-client="true"]').count() === 1, "QQQ ETF detail did not render");
  const compare = page.locator('[data-etf-detail-owner-action="compare"]');
  assert.equal(await compare.count(), 1, "QQQ detail must expose the compare action");
  await compare.click();
  await waitForCondition(() => pagePath(page) === "/etfs/compare", "detail compare navigation did not reach compare route");
  await waitForCondition(async () => await page.locator('[data-etf-compare-panel="true"]').count() === 1, "ETF compare panel did not render");
  await waitForCondition(async () => await page.locator('[data-etf-compare-summary-card="true"]').count() > 0, "ETF compare result did not reach a ready state", WAIT_DATA_MS);
  const query = new URL(page.url()).searchParams.get("tickers") ?? "";
  assert(query.split(",").includes("QQQ"), `detail compare URL must retain QQQ, received ${query}`);
  const inputValue = await page.locator('[data-etf-compare-control="input"]').inputValue();
  assert(inputValue.split(/[,\s]+/).includes("QQQ"), `compare input must retain QQQ, received ${inputValue}`);
  await screenshot(page, `etf-compare-${condition.name}`);
}

async function etfOverlapAvailabilityCase(page: Page, runtime: CaseRuntime, _condition: BrowserCondition): Promise<void> {
  const right = runtimeModeTicker(runtime);
  await gotoPath(page, `/etfs/compare?tickers=SPY,${right}`);
  await waitForCondition(async () => await page.locator('[data-etf-compare-overlap-card="true"]').count() === 1, `${right} overlap card did not render`, WAIT_DATA_MS);
  const card = page.locator('[data-etf-compare-overlap-card="true"]').first();
  const text = await card.innerText();
  if (runtimeMode(runtime) === "disjoint") {
    assert.match(text, /0\.00%/, "valid disjoint holdings must show a numeric zero overlap");
    assert.doesNotMatch(text, /불가|부족|확인되지|미확인|unavailable/i, "valid disjoint holdings must not be marked unavailable");
  } else {
    assert.doesNotMatch(text, /0\.00%/, `${right} unavailable holdings must not become numeric zero`);
    assert.match(text, /불가|부족|확인되지|미확인|확인 필요|사용할 수 없|계산할 수 없|unavailable/i, `${right} must expose unavailable overlap status`);
  }
}

function runtimeModeTicker(runtime: CaseRuntime): string {
  const mode = runtimeMode(runtime);
  if (mode === "disjoint") return "DISJB";
  if (mode === "failed") return "FAILED";
  if (mode === "null") return "NULL";
  return "UNAVAIL";
}

function runtimeMode(runtime: CaseRuntime): EtfMode {
  return runtime.mode ?? "valid";
}

function pagePath(page: Page): string {
  return new URL(page.url()).pathname.replace(/\/+$/, "") || "/";
}

async function paletteOpen(page: Page, waitForIdle = true): Promise<Locator> {
  if (waitForIdle) await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  const dialog = page.locator('[role="dialog"][aria-label="명령 팔레트"]');
  await waitForCondition(async () => {
    if (await dialog.count() === 1 && await dialog.locator("input").count() === 1) return true;
    await page.keyboard.press("/");
    return false;
  }, "command palette did not hydrate");
  return dialog;
}

async function paletteHelpCase(page: Page): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const dialog = await paletteOpen(page);
  await page.keyboard.press("Tab");
  assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim() })), { tag: "BUTTON", text: "?" }, "Tab must focus the palette help button");
  await page.keyboard.press("Enter");
  await waitForCondition(async () => (await dialog.count()) === 1 && (await dialog.innerText()).includes("j/k"), "focused help Enter must show help without navigating");
  assert.equal(pagePath(page), "/portfolio", "focused help Enter must not navigate");
}

async function paletteCloseCase(page: Page): Promise<void> {
  await gotoPath(page, "/portfolio/");
  await paletteOpen(page);
  const close = page.locator('[role="dialog"][aria-label="명령 팔레트"] button[aria-label="close"]');
  await close.focus();
  await page.keyboard.press("Enter");
  await waitForCondition(async () => await page.locator('[role="dialog"][aria-label="명령 팔레트"]').count() === 0, "focused close Enter must close the palette");
  assert.equal(pagePath(page), "/portfolio", "focused close Enter must not navigate");
}

async function isolateNavigationDestination(page: Page, pathname: string): Promise<void> {
  await page.route((url) => url.origin === QA_ORIGIN && url.pathname.replace(/\/+$/, "") === pathname, async (route) => {
    if (route.request().isNavigationRequest() && route.request().resourceType() === "document") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><head><title>Synthetic navigation destination</title></head><body>Navigation received</body></html>",
      });
    } else {
      await route.fallback();
    }
  });
}

async function paletteFocusedResultCase(page: Page): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const dialog = await paletteOpen(page);
  await isolateNavigationDestination(page, "/market-valuation");
  const market = dialog.locator("button").filter({ has: page.locator("span.font-medium", { hasText: /^시장$/ }) });
  assert.equal(await market.count(), 1, "palette must expose the market screen result");
  await market.focus();
  await page.keyboard.press("Enter");
  await waitForCondition(() => pagePath(page) !== "/portfolio", "focused result Enter did not activate a result", WAIT_SHORT_MS);
  assert.equal(pagePath(page), "/market-valuation", "focused market result Enter must navigate to market");
}

async function paletteInputSelectionCase(page: Page): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const dialog = await paletteOpen(page);
  const input = dialog.locator("input");
  await input.fill("AAPL");
  const result = dialog.locator("button").filter({ has: page.locator("span.font-medium", { hasText: /^AAPL$/ }) });
  await waitForCondition(async () => await result.count() === 1, "palette stock query did not produce an AAPL result");
  await input.press("ArrowDown");
  await input.press("ArrowUp");
  await isolateNavigationDestination(page, "/stock/AAPL");
  await input.press("Enter");
  await waitForCondition(() => pagePath(page) !== "/portfolio", "palette input selection did not navigate", WAIT_SHORT_MS);
  assert.equal(pagePath(page), "/stock/AAPL", "palette input ArrowDown + Enter must select the current result");
}

async function openMobileTypeahead(page: Page): Promise<Locator> {
  const open = page.locator('button[aria-label="검색 열기"]:visible');
  await waitForCondition(async () => await open.count() === 1 && await open.isEnabled(), "mobile search did not expose an interactive open control", WAIT_DATA_MS);
  await open.click();
  const input = page.locator('input[role="combobox"]:visible');
  await waitForCondition(async () => await input.count() === 1 && await input.isEditable(), "mobile search did not expose an interactive combobox");
  return input;
}

async function typeaheadStaleCase(page: Page, runtime: CaseRuntime): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const input = await openMobileTypeahead(page);
  await input.fill("AAPL");
  await waitForCondition(() => runtime.stockRequestCount > 0, "delayed typeahead search did not start");
  await input.fill("");
  await page.locator("[data-portfolio-local-boundary]").click();
  runtime.releaseStock();
  await waitForCondition(() => runtime.stockResponseCount > 0, "delayed typeahead data did not fulfill");
  await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  await waitForCondition(async () => {
    return await input.getAttribute("aria-expanded") === "false"
      && await page.locator('ul[role="listbox"]:visible').count() === 0;
  }, "dismissed typeahead reopened after stale data resolved");
  assert.equal(await input.inputValue(), "", "clearing typeahead must preserve an empty query");
  assert.equal(await input.getAttribute("aria-expanded"), "false", "dismissed typeahead must remain closed after stale data resolves");
  assert.equal(await page.locator('ul[role="listbox"]:visible').count(), 0, "dismissed typeahead must not reopen from stale data");
  await input.fill("AAPL");
  await waitForCondition(async () => (await page.locator('[role="option"]:visible').count()) > 0, "typeahead must still show a current fast result after stale completion");
  assert.match(await page.locator('[role="option"]:visible').first().innerText(), /AAPL/);
}

async function typeaheadStaleDismissCase(page: Page, runtime: CaseRuntime): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const input = await openMobileTypeahead(page);
  await input.fill("AAPL");
  await waitForCondition(() => runtime.stockRequestCount > 0, "delayed typeahead search did not start");
  await page.locator("[data-portfolio-local-boundary]").click();
  runtime.releaseStock();
  await waitForCondition(() => runtime.stockResponseCount > 0, "delayed typeahead data did not fulfill");
  await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  await waitForCondition(async () => {
    return await input.getAttribute("aria-expanded") === "false"
      && await page.locator('ul[role="listbox"]:visible').count() === 0;
  }, "dismissed nonempty typeahead reopened after stale data resolved");
  assert.equal(await input.inputValue(), "AAPL", "dismissing typeahead must preserve the nonempty query");
  assert.equal(await input.getAttribute("aria-expanded"), "false", "dismissed nonempty typeahead must remain closed after stale data resolves");
  assert.equal(await page.locator('ul[role="listbox"]:visible').count(), 0, "dismissed nonempty typeahead must not reopen from stale data");
}

async function searchOptionalReadinessCase(page: Page, runtime: CaseRuntime, condition: BrowserCondition, palette = false): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const dialog = palette ? await paletteOpen(page, false) : null;
  const input = dialog ? dialog.locator("input") : await openMobileTypeahead(page);
  const result = dialog
    ? dialog.locator("button").filter({ has: page.locator("span.font-medium", { hasText: /^AAPL$/ }) })
    : page.locator('[role="option"]:visible').filter({ hasText: "Synthetic Apple" });
  const started = Date.now();
  await input.fill("AAPL");
  let firstResultMs: number | undefined;
  const holdUntil = started + 1_500;
  while (Date.now() < holdUntil) {
    if (firstResultMs === undefined && await result.count() === 1) firstResultMs = Date.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  runtime.searchMetrics = {
    optional_hold_ms: Date.now() - started,
    identity_responses_before_release: runtime.stockResponseCount,
    optional_responses_before_release: runtime.optionalResponseCount,
    result_before_optional_release: firstResultMs !== undefined,
  };
  let activeBefore: string | null = null;
  if (!palette && firstResultMs !== undefined) {
    await input.press("ArrowDown");
    activeBefore = await input.getAttribute("aria-activedescendant");
    assert(activeBefore, "stock result must be keyboard selectable before optional data");
  }
  runtime.releaseOptional();
  await waitForCondition(async () => await result.count() === 1, "stock result did not arrive after optional data release", WAIT_DATA_MS);
  runtime.searchMetrics.first_result_ms = firstResultMs ?? Date.now() - started;
  const resultBox = await result.boundingBox();
  assert(resultBox, "stock search result must have a visible box");
  runtime.searchMetrics.result_height_px = resultBox.height;
  assert(resultBox.height >= 43.98, `stock search touch target must be 44px high (subpixel tolerance), received ${resultBox.height}`);
  if (!palette) {
    await waitForCondition(async () => await page.locator('[role="option"]:visible').filter({ hasText: "Synthetic AAPL Investor" }).count() === 1, "late investor result must remain available");
    if (activeBefore) assert.equal(await input.getAttribute("aria-activedescendant"), activeBefore, "late investor results must preserve the selected stock");
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `search causes ${overflow}px horizontal viewport overflow`);
  await screenshot(page, `search-${palette ? "palette" : "typeahead"}-${condition.name}`);
  assert.equal(runtime.searchMetrics.optional_responses_before_release, 0, "optional gate must be held during readiness measurement");
  assert(runtime.stockResponseCount > 0, "core identity fixture must actually be requested");
  assert(firstResultMs !== undefined, "stock suggestions waited for optional action/investor data despite ready identities");
}

async function typeaheadOptionalDismissCase(page: Page, runtime: CaseRuntime): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const input = await openMobileTypeahead(page);
  await input.fill("AAPL");
  await waitForCondition(() => runtime.stockResponseCount > 0, "stock identity request did not resolve");
  await page.locator("[data-portfolio-local-boundary]").click();
  runtime.releaseOptional();
  await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  assert.equal(await input.inputValue(), "AAPL");
  assert.equal(await input.getAttribute("aria-expanded"), "false", "late optional results reopened dismissed search");
  assert.equal(await page.locator('ul[role="listbox"]:visible').count(), 0);
}

async function investorFirstSelectionCase(page: Page, runtime: CaseRuntime): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const input = await openMobileTypeahead(page);
  await input.fill("AAPL");
  const investor = page.locator('[role="option"]:visible').filter({ hasText: "Synthetic AAPL Investor" });
  await waitForCondition(async () => await investor.count() === 1, "investor result must be usable while stock identities wait");
  assert.equal(runtime.stockResponseCount, 0);
  await input.press("ArrowDown");
  assert.equal(await investor.getAttribute("aria-selected"), "true");
  runtime.releaseStock();
  await waitForCondition(async () => await page.locator('[role="option"]:visible').filter({ hasText: "Synthetic Apple" }).count() === 1, "late stock result did not appear");
  assert.equal(await investor.getAttribute("aria-selected"), "true", "late stock insertion must preserve the selected investor");
  const activeId = await input.getAttribute("aria-activedescendant");
  assert(activeId);
  assert.match(await page.locator(`[id="${activeId}"]`).innerText(), /Synthetic AAPL Investor/);
}

async function investorInvalidRetryCase(page: Page, runtime: CaseRuntime): Promise<void> {
  await gotoPath(page, "/portfolio/");
  const input = await openMobileTypeahead(page);
  await input.fill("AAPL");
  await waitForCondition(async () => runtime.investorRequestCount === 1 && await page.locator('[role="option"]:visible').filter({ hasText: "Synthetic Apple" }).count() === 1, "invalid investor response must not block stocks");
  await page.waitForLoadState("networkidle", { timeout: WAIT_DATA_MS });
  await input.fill("");
  await input.fill("AAPL");
  await waitForCondition(async () => runtime.investorRequestCount === 2 && await page.locator('[role="option"]:visible').filter({ hasText: "Synthetic AAPL Investor" }).count() === 1, "invalid 200 investor response must remain retryable");
}

async function searchStockReturnCase(page: Page, runtime: CaseRuntime, condition: BrowserCondition, preview = false): Promise<void> {
  await gotoPath(page, "/screener?ticker=AAPL&mode=analyze");
  const ready = page.locator('[data-canvas-plus-screener-service][data-screener-mode="analyze"][data-journey-ready="true"]');
  const filter = page.locator('input[data-canvas-plus-screener-search="true"]');
  await waitForCondition(async () => await ready.count() === 1, "source screener did not become ready", WAIT_DATA_MS);
  assert.equal(await filter.inputValue(), "AAPL");
  const card = page.locator('[data-canvas-plus-screener-card="mobile"]:visible').filter({ has: page.locator('button[aria-label="AAPL 상세 접기"]') });
  const selected = card.getByRole("checkbox", { name: "선택", exact: true });
  // The existing label's 44px pseudo-element owns the checkbox tap target.
  await card.locator("label[data-screener-checkbox-target]").tap();
  assert.equal(await selected.isChecked(), true, "tapping the selection label must check the stock");
  await waitForCondition(async () => (await page.locator('[data-canvas-plus-screener-selection-actions]').innerText()).includes("1개 선택"), "source selection did not settle");
  const source = new URL(page.url());
  const returnTo = `${source.pathname.replace(/\/+$/, "")}${source.search}${source.hash}`;
  let sourceScroll = 0;
  if (preview) {
    const input = await openMobileTypeahead(page);
    await input.fill("AAPL");
    const result = page.locator('[role="option"]:visible').filter({ hasText: "Synthetic Apple" });
    await waitForCondition(async () => await result.count() === 1, "search stock option did not appear");
    await result.tap();
    const drawer = page.locator('[data-testid="typeahead-preview"]');
    await waitForCondition(async () => await drawer.count() === 1, "stock preview did not open");
    const full = drawer.getByRole("link", { name: "전체 보기", exact: true });
    const box = await full.boundingBox();
    assert(box && box.height >= 43.98, "stock preview primary touch target must be at least 44px high");
    assert.equal(new URL((await full.getAttribute("href"))!, QA_BASE_URL).searchParams.get("returnTo"), returnTo);
    await full.tap();
  } else {
    await page.evaluate(() => window.scrollTo(0, 600));
    sourceScroll = await page.evaluate(() => window.scrollY);
    const dialog = await paletteOpen(page);
    const input = dialog.locator("input");
    await input.fill("AAPL");
    await waitForCondition(async () => await dialog.locator("button").filter({ has: page.locator("span.font-medium", { hasText: /^AAPL$/ }) }).count() === 1, "palette AAPL result did not appear");
    await input.press("Enter");
  }
  await waitForCondition(() => pagePath(page) === "/stock/AAPL", "search did not reach real stock detail", WAIT_DATA_MS);
  await waitForCondition(async () => await page.locator('[data-canvas-plus-stock-detail-preview] h1').count() === 1, "real stock hero did not render", WAIT_DATA_MS);
  assert.equal(new URL(page.url()).searchParams.get("returnTo"), returnTo, "stock detail must retain the full originating filter context");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `stock detail causes ${overflow}px horizontal viewport overflow`);
  await screenshot(page, `search-stock-${preview ? "preview" : "palette"}-${condition.name}`);
  if (preview) {
    const back = page.locator('.appbar a[aria-label="스크리너로 돌아가기"]');
    assert.equal(new URL((await back.getAttribute("href"))!, QA_BASE_URL).search, source.search);
    await back.tap();
  } else {
    await page.goBack({ waitUntil: "domcontentloaded" });
  }
  await waitForCondition(async () => await ready.count() === 1, "returning screener did not restore ready state", WAIT_DATA_MS);
  assert.equal(new URL(page.url()).search, source.search, "return navigation must preserve filters and analysis mode");
  assert.equal(await filter.inputValue(), "AAPL");
  assert.equal(await selected.isChecked(), true, "return navigation must preserve selected stock");
  if (!preview) {
    await waitForCondition(async () => Math.abs(await page.evaluate(() => window.scrollY) - sourceScroll) <= 80, "browser Back must restore the source scroll position");
    runtime.searchMetrics = { source_scroll_y: sourceScroll, restored_scroll_y: await page.evaluate(() => window.scrollY) };
  }
  await screenshot(page, `search-return-${preview ? "preview" : "palette"}-${condition.name}`);
}

async function readCsvDownload(page: Page, button: Locator): Promise<string> {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: WAIT_SHORT_MS }), button.click()]);
  return readDownload(download);
}

async function macroCsvVisibleCase(page: Page, _runtime: CaseRuntime, condition: BrowserCondition): Promise<void> {
  await gotoPath(page, "/macro-chart?series=sp500,DGS10&transform=raw,raw&range=MAX&hidden=DGS10");
  await waitForCondition(async () => await page.locator('[data-macro-v2-table-drawer="true"]').getAttribute("data-macro-v2-table-state") === "ready", "macro table did not reach ready state", WAIT_DATA_MS);
  assert.equal(await page.locator('[data-macro-chart-series-range="sp500"]').count(), 1, "macro hero must retain the visible S&P 500 series");
  const tableDrawer = page.locator('[data-macro-v2-table-drawer="true"]');
  await tableDrawer.locator("summary").click();
  await waitForCondition(async () => await page.locator("[data-cp-data-table]").count() === 1, "macro data table did not open");
  await screenshot(page, `macro-tablet-${condition.name}`);
  const heroCsvButton = page.getByRole("group", { name: "공유 및 내보내기" }).getByRole("button", { name: "CSV", exact: true });
  const tableCsvButton = tableDrawer.getByRole("button", { name: "CSV로 내보내기", exact: true });
  const heroCsv = await readCsvDownload(page, heroCsvButton);
  const tableCsv = await readCsvDownload(page, tableCsvButton);
  const heroHeader = heroCsv.split("\n", 1)[0] ?? "";
  const tableHeader = tableCsv.split("\n", 1)[0] ?? "";
  assert.match(heroHeader, /S&P 500/, "hero CSV must include the visible S&P 500 series");
  assert.doesNotMatch(heroHeader, /10Y/, "hero CSV must exclude hidden 10Y series");
  assert.match(tableHeader, /S&P 500/, "table CSV must include the visible S&P 500 series");
  assert.doesNotMatch(tableHeader, /10Y/, "table CSV must exclude hidden 10Y series");
  assert.equal(heroCsv, tableCsv, "hero and table CSV downloads must contain the same visible series");
  const tableText = await page.locator("[data-cp-data-table]").innerText();
  assert.match(tableText, /S&P 500/);
  assert.doesNotMatch(tableText, /10Y/);
}

function makeCases(): BrowserCase[] {
  const cases: BrowserCase[] = [
    { name: "portfolio-empty", run: emptyPortfolioCase },
    { name: "portfolio-export-import", run: exportImportCase },
    { name: "portfolio-storage-add", run: storageAddFailureCase },
    { name: "portfolio-storage-import", run: storageImportFailureCase },
    { name: "portfolio-legacy-edit", run: legacyEditCase },
    { name: "portfolio-legacy-delete", run: legacyDeleteCase },
    { name: "portfolio-edit-target", run: stalePortfolioEditCase },
    { name: "etf-detail-compare", run: etfDetailCompareCase },
    { name: "palette-help", run: paletteHelpCase },
    { name: "palette-close", run: paletteCloseCase },
    { name: "palette-focused-result", run: paletteFocusedResultCase },
    { name: "palette-input-selection", run: paletteInputSelectionCase },
    { name: "typeahead-stale-clear", options: { delayedInitialStock: true }, run: typeaheadStaleCase },
    { name: "typeahead-stale-dismiss", options: { delayedInitialStock: true }, run: typeaheadStaleDismissCase },
    { name: "typeahead-optional-readiness", options: { delayedOptionalSearch: true }, run: searchOptionalReadinessCase },
    { name: "palette-optional-readiness", options: { delayedOptionalSearch: true }, run: (page, runtime, condition) => searchOptionalReadinessCase(page, runtime, condition, true) },
    { name: "typeahead-optional-dismiss", options: { delayedOptionalSearch: true }, run: typeaheadOptionalDismissCase },
    { name: "typeahead-investor-first", options: { delayedInitialStock: true, searchInvestors: true }, run: investorFirstSelectionCase },
    { name: "typeahead-investor-retry", options: { invalidInitialInvestor: true }, run: investorInvalidRetryCase },
    { name: "search-stock-browser-return", run: searchStockReturnCase },
    { name: "search-preview-app-return", run: (page, runtime, condition) => searchStockReturnCase(page, runtime, condition, true) },
    { name: "macro-csv-visible", run: macroCsvVisibleCase },
  ];
  for (const mode of ["unavailable", "failed", "null", "disjoint"] as const) {
    cases.push({
      name: `etf-overlap-${mode}`,
      options: { etfMode: mode },
      run: etfOverlapAvailabilityCase,
    });
  }
  return cases;
}

/*
 * These are the exact full-document destinations whose Next RSC prefetches
 * this synthetic harness aborts. Keeping the paths finite means an aborted
 * document, data request, or foreign request still remains a browser error.
 */
const INTENTIONAL_RSC_ABORT_PATHS = new Set([
  "/",
  "/screener",
  "/stock/AAPL",
  "/stock/NVDA",
  "/stock/KORU",
  "/market/events",
  "/stock/SCHD",
  "/stock/MSFT",
  "/stock/SPY",
  "/stock/BRKB",
  "/etfs",
  "/etfs/SPY",
  "/etfs/FAILED",
  "/etfs/NULL",
  "/etfs/UNAVAIL",
  "/etfs/DISJB",
  "/portfolio",
  "/portfolio/",
  "/etfs/QQQ",
  "/etfs/QQQ/",
  "/etfs/compare",
  "/etfs/compare/",
  "/macro-chart",
  "/macro-chart/",
  "/market-valuation",
  "/market-valuation/",
]);

function isHarnessRscRequest(request: Request, requestUrl: URL): boolean {
  const headers = request.headers();
  const prefetch = headers["next-router-prefetch"];
  const isPrefetch = prefetch === "1" || prefetch === "2"
    || typeof headers["next-router-segment-prefetch"] === "string";
  return request.method() === "GET"
    && !request.isNavigationRequest()
    && isPrefetch
    && requestUrl.origin === QA_ORIGIN
    && requestUrl.searchParams.has("_rsc")
    && INTENTIONAL_RSC_ABORT_PATHS.has(requestUrl.pathname);
}

function isIntentionalRscAbort(request: Request, requestUrl: URL, failure: string, engine: BrowserCondition["name"]): boolean {
  return isHarnessRscRequest(request, requestUrl)
    && (failure === "net::ERR_ABORTED" || failure === "Load request cancelled"
      || (engine === "webkit" && failure === "Blocked by Web Inspector"));
}

function requestFailureDetail(request: Request, requestUrl: URL, failure: string): string {
  const headers = request.headers();
  const purpose = headers["purpose"] ?? headers["sec-purpose"] ?? "";
  const classification = [
    request.resourceType(),
    request.isNavigationRequest() ? "navigation" : "subresource",
    requestUrl.searchParams.has("_rsc") ? "rsc" : "non-rsc",
  ].join("/");
  return `${request.method()} ${requestUrl.pathname} [${classification}${purpose ? ` purpose=${purpose}` : ""}] ${failure}`;
}

async function runCondition(browser: Browser, condition: BrowserCondition, receipts: CaseReceipt[]): Promise<void> {
  for (const testCase of makeCases()) {
    const started = Date.now();
    const router = new FixtureRouter(testCase.options);
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      context = await browser.newContext({
        acceptDownloads: true,
        hasTouch: condition.hasTouch,
        isMobile: condition.isMobile,
        serviceWorkers: "block",
        viewport: { width: condition.width, height: condition.height },
      });
      await context.route("**/*", (route) => router.handle(route));
      page = await context.newPage();
      page.on("requestfailed", (request) => {
        const url = new URL(request.url());
        const failure = request.failure()?.errorText ?? "unknown";
        if (url.origin !== QA_ORIGIN) return;
        if (router.isHarnessAborted(request) && isIntentionalRscAbort(request, url, failure, condition.name)) {
          router.expectedCancellations.push(requestFailureDetail(request, url, failure));
          return;
        }
        router.requestFailures.push(`requestfailed: ${requestFailureDetail(request, url, failure)}`);
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        if (condition.name === "webkit"
          && message.text() === 'Viewport argument key "interactive-widget" not recognized and ignored.') return;
        const location = message.location().url;
        let locationPath = "";
        try {
          const parsed = new URL(location);
          if (parsed.origin === QA_ORIGIN) locationPath = parsed.pathname;
        } catch {
          // Console locations are occasionally empty for browser-generated messages.
        }
        const isExpectedHttpResourceFailure = message.text().startsWith("Failed to load resource:")
          && router.expectedFailurePaths.has(locationPath);
        if (!isExpectedHttpResourceFailure) router.requestFailures.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => router.requestFailures.push(`pageerror: ${error.message}`));
      await testCase.run(page, router, condition);
      await new Promise((resolve) => setTimeout(resolve, 30));
      assert.equal(router.blockedForeign.length, 0, `foreign network attempts: ${router.blockedForeign.join(", ")}`);
      assert.equal(router.unexpectedDataPaths.length, 0, `unhandled synthetic data paths: ${router.unexpectedDataPaths.join(", ")}`);
      assert.equal(router.requestFailures.length, 0, `unexpected browser errors: ${router.requestFailures.join("; ")}`);
      receipts.push({
        condition: condition.name,
        case: testCase.name,
        status: "passed",
        duration_ms: Date.now() - started,
        search_metrics: router.searchMetrics,
        blocked_foreign: [...new Set(router.blockedForeign)],
        unexpected_data_paths: [...new Set(router.unexpectedDataPaths)],
        expected_cancellations: router.expectedCancellations,
        request_failures: router.requestFailures,
      });
    } catch (error) {
      if (page) {
        await page.screenshot({
          path: join(SCREENSHOT_DIR, `${condition.name}-${testCase.name}-failure.png`),
          fullPage: true,
        }).catch(() => undefined);
      }
      receipts.push({
        condition: condition.name,
        case: testCase.name,
        status: "failed",
        duration_ms: Date.now() - started,
        search_metrics: router.searchMetrics,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
        blocked_foreign: [...new Set(router.blockedForeign)],
        unexpected_data_paths: [...new Set(router.unexpectedDataPaths)],
        expected_cancellations: router.expectedCancellations,
        request_failures: router.requestFailures,
      });
    } finally {
      router.releaseStock();
      router.releaseOptional();
      if (context) await context.close().catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  const receipts: CaseReceipt[] = [];
  const browserFactories: Array<{ condition: BrowserCondition; launch: () => Promise<Browser> }> = [
    { condition: CONDITIONS[0], launch: () => chromium.launch({ headless: true }) },
    { condition: CONDITIONS[1], launch: () => webkit.launch({ headless: true }) },
  ];
  for (const entry of browserFactories) {
    const browser = await entry.launch();
    try {
      await runCondition(browser, entry.condition, receipts);
    } finally {
      await browser.close();
    }
  }
  const failed = receipts.filter((receipt) => receipt.status === "failed");
  const report = {
    generated_at: new Date().toISOString(),
    base_origin: QA_ORIGIN,
    conditions: CONDITIONS.map((condition) => ({ name: condition.name, viewport: `${condition.width}x${condition.height}` })),
    cases: receipts,
    summary: { passed: receipts.length - failed.length, failed: failed.length, total: receipts.length },
  };
  writeFileSync(join(SCREENSHOT_DIR, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const receipt of receipts) {
    const suffix = receipt.status === "passed" ? "PASS" : `FAIL ${receipt.error?.split("\n", 1)[0] ?? "unknown"}`;
    console.log(`[product-flow-browser] ${receipt.condition}/${receipt.case}: ${suffix}`);
  }
  console.log(`[product-flow-browser] ${report.summary.passed}/${report.summary.total} cases passed; report ${join(SCREENSHOT_DIR, "results.json")}`);
  if (failed.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`[product-flow-browser] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
