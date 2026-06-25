import { normalizeForEntityKey } from "@/lib/ticker";

/* ───────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────── */

export interface HolderDetail {
  investor: string;
  shares: number;
  market_value: number;
  weight: number;
  classes_held?: string[];
  position_types?: string[];
}

export interface TickerHoldersResult {
  ticker: string;
  holders: string[];
  total_shares: number;
  total_market_value: number;
  holder_details: HolderDetail[];
}

export interface InvestorFiling {
  accession_number: string;
  quarter: string;
  filing_date: string;
  report_date: string;
  holdings: InvestorHolding[];
  aum_total: number;
  holdings_count: number;
  top_10_weight: number;
}

export interface InvestorHolding {
  ticker?: string;
  company?: string;
  name?: string;
  shares?: number;
  market_value?: number;
  weight?: number;
  change?: string;
}

export interface InvestorResult {
  name: string;
  cik: string;
  entity: string;
  filings: InvestorFiling[];
}

export interface BuyingPressureRow {
  ticker: string;
  pressure: number;
  net_buyers: number;
  net_holders: number;
  net_sellers: number;
  total_value_change: number;
}

export interface BuyingPressureIndex {
  byTicker: Map<string, BuyingPressureRow>;
  raw: Record<string, BuyingPressureRow>;
}

export interface IndexMembershipEntry {
  rank: number;
  symbol: string;
  company: string;
  weight: number;
}

export interface IndexMembershipResult {
  ticker: string;
  sp500: IndexMembershipEntry | null;
  nasdaq100: IndexMembershipEntry | null;
  dowjones: IndexMembershipEntry | null;
  membershipChanges: string[];
}

/* ───────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────── */

function norm(ticker: string): string {
  return normalizeForEntityKey(ticker);
}

/* ───────────────────────────────────────────────
 * 1. loadByTickerHolders
 * ─────────────────────────────────────────────── */

let holdersCache: Record<string, TickerHoldersResult | null> | null = null;
let holdersPromise: Promise<Record<string, TickerHoldersResult | null>> | null = null;

async function loadHoldersIndex(): Promise<Record<string, TickerHoldersResult | null>> {
  if (holdersCache) return holdersCache;
  if (holdersPromise) return holdersPromise;

  holdersPromise = fetch("/data/sec-13f/by_ticker.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: Record<string, Record<string, unknown>> | null) => {
      const index: Record<string, TickerHoldersResult | null> = {};
      if (raw) {
        for (const [ticker, entry] of Object.entries(raw)) {
          const details = Array.isArray(entry?.holder_details) ? entry.holder_details as HolderDetail[] : [];
          index[norm(ticker)] = {
            ticker: norm(ticker),
            holders: Array.isArray(entry?.holders) ? entry.holders as string[] : [],
            total_shares: typeof entry?.total_shares === "number" ? entry.total_shares : 0,
            total_market_value: typeof entry?.total_market_value === "number" ? entry.total_market_value : 0,
            holder_details: details.map((d) => ({
              investor: String(d.investor ?? ""),
              shares: typeof d.shares === "number" ? d.shares : 0,
              market_value: typeof d.market_value === "number" ? d.market_value : 0,
              weight: typeof d.weight === "number" ? d.weight : 0,
              classes_held: Array.isArray(d.classes_held) ? d.classes_held : [],
              position_types: Array.isArray(d.position_types) ? d.position_types : [],
            })),
          };
        }
      }
      holdersCache = index;
      holdersPromise = null;
      return holdersCache;
    })
    .catch(() => {
      holdersPromise = null;
      return {};
    });

  return holdersPromise;
}

export async function loadByTickerHolders(ticker: string): Promise<TickerHoldersResult | null> {
  const index = await loadHoldersIndex();
  return index[norm(ticker)] ?? null;
}

/* ───────────────────────────────────────────────
 * 2. loadInvestorHoldings
 * ─────────────────────────────────────────────── */

const investorCache: Record<string, InvestorResult | null> = {};
const investorPending: Record<string, Promise<InvestorResult | null>> = {};

function investorFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

export async function loadInvestorHoldings(investorName: string): Promise<InvestorResult | null> {
  const key = investorFileName(investorName);
  if (key in investorCache) return investorCache[key];
  if (key in investorPending) return investorPending[key];

  investorPending[key] = fetch(`/data/sec-13f/investors/${encodeURIComponent(key)}.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: Record<string, unknown> | null) => {
      if (!raw?.investor) {
        investorCache[key] = null;
        return null;
      }
      const inv = raw.investor as Record<string, unknown>;
      const rawFilings = Array.isArray(inv.filings) ? inv.filings : [];
      const filings: InvestorFiling[] = rawFilings.map((f: Record<string, unknown>) => ({
        accession_number: String(f.accession_number ?? ""),
        quarter: String(f.quarter ?? ""),
        filing_date: String(f.filing_date ?? ""),
        report_date: String(f.report_date ?? ""),
        holdings: Array.isArray(f.holdings) ? (f.holdings as Record<string, unknown>[]).map((h) => ({
          ticker: typeof h.ticker === "string" ? h.ticker : undefined,
          company: typeof h.company === "string" ? h.company : typeof h.name === "string" ? h.name : undefined,
          name: typeof h.name === "string" ? h.name : undefined,
          shares: typeof h.shares === "number" ? h.shares : undefined,
          market_value: typeof h.market_value === "number" ? h.market_value : undefined,
          weight: typeof h.weight === "number" ? h.weight : undefined,
          change: typeof h.change === "string" ? h.change : undefined,
        })) : [],
        aum_total: typeof f.aum_total === "number" ? f.aum_total : 0,
        holdings_count: typeof f.holdings_count === "number" ? f.holdings_count : 0,
        top_10_weight: typeof f.top_10_weight === "number" ? f.top_10_weight : 0,
      }));
      const result: InvestorResult = {
        name: inv.name as string ?? investorName,
        cik: String(inv.cik ?? ""),
        entity: String(inv.entity ?? ""),
        filings,
      };
      investorCache[key] = result;
      delete investorPending[key];
      return result;
    })
    .catch(() => {
      delete investorPending[key];
      return null;
    });

  return investorPending[key];
}

/* ───────────────────────────────────────────────
 * 3. loadBuyingPressure
 * ─────────────────────────────────────────────── */

let bpCache: BuyingPressureIndex | null = null;
let bpPromise: Promise<BuyingPressureIndex | null> | null = null;

export async function loadBuyingPressure(): Promise<BuyingPressureIndex | null> {
  if (bpCache) return bpCache;
  if (bpPromise) return bpPromise;

  bpPromise = fetch("/data/sec-13f/analytics/buying_pressure.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw: Record<string, unknown> | null) => {
      if (!raw?.buying_pressure) {
        bpPromise = null;
        return null;
      }
      const bp = raw.buying_pressure as Record<string, Record<string, unknown>>;
      const byTicker = new Map<string, BuyingPressureRow>();
      const rawMap: Record<string, BuyingPressureRow> = {};
      for (const [, row] of Object.entries(bp)) {
        const ticker = typeof row.ticker === "string" ? row.ticker : "";
        if (!ticker) continue;
        const entry: BuyingPressureRow = {
          ticker,
          pressure: typeof row.pressure === "number" ? row.pressure : 0,
          net_buyers: typeof row.net_buyers === "number" ? row.net_buyers : 0,
          net_holders: typeof row.net_holders === "number" ? row.net_holders : 0,
          net_sellers: typeof row.net_sellers === "number" ? row.net_sellers : 0,
          total_value_change: typeof row.total_value_change === "number" ? row.total_value_change : 0,
        };
        byTicker.set(norm(ticker), entry);
        rawMap[norm(ticker)] = entry;
      }
      const result: BuyingPressureIndex = { byTicker, raw: rawMap };
      bpCache = result;
      bpPromise = null;
      return result;
    })
    .catch(() => {
      bpPromise = null;
      return null;
    });

  return bpPromise;
}

/* ───────────────────────────────────────────────
 * 4. loadTickerIndexMembership
 * ─────────────────────────────────────────────── */

const INDEX_URLS = {
  sp500: "/data/slickcharts/sp500.json",
  nasdaq100: "/data/slickcharts/nasdaq100.json",
  dowjones: "/data/slickcharts/dowjones.json",
  changes: "/data/slickcharts/membership-changes.json",
} as const;

type IndexCacheShape = {
  sp500: Record<string, IndexMembershipEntry>;
  nasdaq100: Record<string, IndexMembershipEntry>;
  dowjones: Record<string, IndexMembershipEntry>;
  changes: Record<string, string[]>;
} | null;

let indexCache: IndexCacheShape = null;
let indexPromise: Promise<IndexCacheShape> | null = null;

async function loadSlickchartsIndex(url: string): Promise<Record<string, IndexMembershipEntry>> {
  try {
    const r = await fetch(url, { cache: "force-cache" });
    if (!r.ok) return {};
    const raw = await r.json() as { holdings?: Array<Record<string, unknown>> };
    const holdings = Array.isArray(raw?.holdings) ? raw.holdings : [];
    const map: Record<string, IndexMembershipEntry> = {};
    for (const h of holdings) {
      const symbol = typeof h.symbol === "string" ? h.symbol : "";
      if (!symbol) continue;
      map[norm(symbol)] = {
        rank: typeof h.rank === "number" ? h.rank : 0,
        symbol,
        company: typeof h.company === "string" ? h.company : "",
        weight: typeof h.weight === "number" ? h.weight : 0,
      };
    }
    return map;
  } catch {
    return {};
  }
}

async function loadSlickchartsChanges(): Promise<Record<string, string[]>> {
  try {
    const r = await fetch(INDEX_URLS.changes, { cache: "force-cache" });
    if (!r.ok) return {};
    const raw = await r.json() as { indices?: Record<string, Record<string, string[]>> };
    const changes = raw?.indices ?? {};
    const map: Record<string, string[]> = {};
    for (const [, indexChanges] of Object.entries(changes)) {
      for (const [symbol, events] of Object.entries(indexChanges)) {
        map[norm(symbol)] = Array.isArray(events) ? events as string[] : [];
      }
    }
    return map;
  } catch {
    return {};
  }
}

async function loadIndexMembershipData() {
  if (indexCache) return indexCache;
  if (indexPromise) return indexPromise;

  indexPromise = Promise.all([
    loadSlickchartsIndex(INDEX_URLS.sp500),
    loadSlickchartsIndex(INDEX_URLS.nasdaq100),
    loadSlickchartsIndex(INDEX_URLS.dowjones),
    loadSlickchartsChanges(),
  ]).then(([sp500, nasdaq100, dowjones, changes]) => {
    indexCache = { sp500, nasdaq100, dowjones, changes };
    indexPromise = null;
    return indexCache;
  }).catch(() => {
    indexPromise = null;
    return null;
  });

  return indexPromise;
}

export async function loadTickerIndexMembership(ticker: string): Promise<IndexMembershipResult> {
  const symbol = norm(ticker);
  const data = await loadIndexMembershipData();
  return {
    ticker: symbol,
    sp500: data?.sp500[symbol] ?? null,
    nasdaq100: data?.nasdaq100[symbol] ?? null,
    dowjones: data?.dowjones[symbol] ?? null,
    membershipChanges: data?.changes[symbol] ?? [],
  };
}
