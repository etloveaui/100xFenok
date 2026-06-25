import { normalizeForEntityKey } from "@/lib/ticker";

const EDGAR_KOREAN_SUMMARY_INDEX_URL = "/data/edgar-korean-summaries/index.json";

interface EdgarKoreanSummaryIndex {
  schemaVersion: number;
  artifactType: string;
  updated: string;
  tickers: string[];
  byTicker?: Record<string, string>;
}

export interface EdgarKoreanSummaryFilingEntry {
  ticker: string;
  companyName: string;
  cik: string;
  form: string;
  accession: string;
  filingDate: string;
  periodEnd: string;
  title: string;
  summaryPath?: string | null;
  translationPath?: string | null;
  sourceUrl: string;
  sectionsExtracted?: string[];
  missingSections?: string[];
  summaryOneLine?: string;
  generatedAtUtc?: string;
  summaryStatus?: "ready" | "pending" | string;
  translationStatus?: "ready" | "not_available" | "pending" | string;
  evidencePolicy?: string;
  caveats?: string[];
}

export interface EdgarKoreanTickerSummaryManifest {
  schemaVersion: number;
  artifactType: string;
  ticker: string;
  companyName?: string;
  cik?: string;
  updated: string;
  source: string;
  summaryStatus?: string;
  filings: EdgarKoreanSummaryFilingEntry[];
}

export interface EdgarKoreanSummaryCoverage {
  tickerCount: number;
  updated: string;
}

const tickerManifestCache: Record<string, EdgarKoreanTickerSummaryManifest | null> = {};
const tickerManifestPending: Record<string, Promise<EdgarKoreanTickerSummaryManifest | null>> = {};
let indexCache: EdgarKoreanSummaryIndex | null = null;
let indexPending: Promise<EdgarKoreanSummaryIndex | null> | null = null;

export function normalizeEdgarTicker(ticker: string) {
  return normalizeForEntityKey(ticker);
}

function edgarTickerCandidates(ticker: string): string[] {
  const symbol = normalizeEdgarTicker(ticker);
  if (!symbol) return [];
  const candidates = [symbol];
  if (symbol.includes("-")) candidates.push(symbol.replace(/-/g, "."));
  if (symbol.includes(".")) candidates.push(symbol.replace(/\./g, "-"));
  return [...new Set(candidates)];
}

export function edgarTickerManifestUrl(ticker: string) {
  return `/data/edgar-korean-summaries/by-ticker/${encodeURIComponent(normalizeEdgarTicker(ticker).toLowerCase())}.json`;
}

function loadEdgarKoreanSummaryIndex(): Promise<EdgarKoreanSummaryIndex | null> {
  if (indexCache) return Promise.resolve(indexCache);
  if (indexPending) return indexPending;
  indexPending = fetch(EDGAR_KOREAN_SUMMARY_INDEX_URL, { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`EDGAR_SUMMARY_INDEX_FAILED:${response.status}`);
      return response.json() as Promise<EdgarKoreanSummaryIndex>;
    })
    .then((payload) => {
      indexCache = {
        ...payload,
        tickers: Array.isArray(payload?.tickers) ? payload.tickers.map(normalizeEdgarTicker) : [],
        byTicker: payload?.byTicker ?? {},
      };
      indexPending = null;
      return indexCache;
    })
    .catch(() => {
      indexPending = null;
      return null;
    });
  return indexPending;
}

export function edgarFilingsForTicker(manifest: EdgarKoreanTickerSummaryManifest | null, ticker: string) {
  const symbols = new Set(edgarTickerCandidates(ticker));
  return (manifest?.filings ?? [])
    .filter((filing) => symbols.has(normalizeEdgarTicker(filing.ticker)))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate));
}

export function loadEdgarKoreanSummaryCoverage(): Promise<EdgarKoreanSummaryCoverage | null> {
  return loadEdgarKoreanSummaryIndex().then((index) => {
    if (!index) return null;
    return {
      tickerCount: index.tickers.length,
      updated: index.updated,
    };
  });
}

export function loadEdgarKoreanSummariesForTicker(ticker: string): Promise<EdgarKoreanTickerSummaryManifest | null> {
  const symbol = normalizeEdgarTicker(ticker);
  if (!symbol) return Promise.resolve(null);
  if (symbol in tickerManifestCache) return Promise.resolve(tickerManifestCache[symbol]);
  if (symbol in tickerManifestPending) return tickerManifestPending[symbol];
  tickerManifestPending[symbol] = loadEdgarKoreanSummaryIndex()
    .then((index) => {
      const matchedSymbol = edgarTickerCandidates(symbol).find((candidate) => index?.tickers.includes(candidate));
      if (!index || !matchedSymbol) {
        tickerManifestCache[symbol] = null;
        return null;
      }
      return fetch(index.byTicker?.[matchedSymbol] ?? edgarTickerManifestUrl(matchedSymbol), { cache: "no-store" });
    })
    .then((response) => {
      if (response === null) return null;
      return response;
    })
    .then((response) => {
      if (response === null) return null;
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`EDGAR_TICKER_SUMMARY_FAILED:${response.status}`);
      return response.json() as Promise<EdgarKoreanTickerSummaryManifest>;
    })
    .then((payload) => {
      const nextPayload = payload ? { ...payload, filings: Array.isArray(payload.filings) ? payload.filings : [] } : null;
      tickerManifestCache[symbol] = nextPayload;
      delete tickerManifestPending[symbol];
      return nextPayload;
    })
    .catch(() => {
      delete tickerManifestPending[symbol];
      return null;
    });
  return tickerManifestPending[symbol];
}
