import type { ByTickerData, SummaryData } from "@/lib/superinvestors/types";

export interface GraphNetworkInput {
  summary: SummaryData | null;
  byTicker: ByTickerData | null;
  excludedStale: string[];
  failedRequests: string[];
}

export type GraphNode =
  | {
      kind: "investor";
      id: string;
      investorId: string;
      label: string;
      group: string | null;
      aum: number | null;
      stale: boolean;
      unprofiled: boolean;
    }
  | { kind: "ticker"; id: string; ticker: string; holdersCount: number };

export interface GraphEdge {
  investorId: string;
  ticker: string;
  weight: number;
  marketValue: number | null;
}

export interface GraphNetwork {
  nodes: GraphNode[];
  edges: GraphEdge[];
  investorCount: number;
  tickerCount: number;
  feeds: { summary: boolean; byTicker: boolean };
  excludedCount: number;
}

const EMPTY: GraphNetwork = {
  nodes: [],
  edges: [],
  investorCount: 0,
  tickerCount: 0,
  feeds: { summary: false, byTicker: false },
  excludedCount: 0,
};

export function buildGraphNetwork(input: GraphNetworkInput): GraphNetwork {
  const { summary, byTicker, excludedStale, failedRequests } = input;
  const feeds = {
    summary: summary !== null && !failedRequests.includes("summary"),
    byTicker: byTicker !== null && !failedRequests.includes("by_ticker"),
  };
  if (!feeds.byTicker || byTicker === null) return { ...EMPTY, feeds, excludedCount: excludedStale.length };
  const excluded = new Set(excludedStale);

  const tickerHolders = new Map<string, Map<string, { weight: number; marketValue: number | null }>>();
  for (const [ticker, entry] of Object.entries(byTicker)) {
    const holders = tickerHolders.get(ticker) ?? new Map();
    for (const detail of entry.holder_details ?? []) {
      if (excluded.has(detail.investor)) continue;
      const prev = holders.get(detail.investor);
      if (!prev || detail.weight > prev.weight) {
        holders.set(detail.investor, { weight: detail.weight, marketValue: detail.market_value ?? null });
      }
    }
    if (holders.size >= 2) tickerHolders.set(ticker, holders);
    else tickerHolders.delete(ticker);
  }

  const edges: GraphEdge[] = [];
  const activeInvestors = new Set<string>();
  for (const [ticker, holders] of tickerHolders) {
    for (const [investorId, holding] of holders) {
      activeInvestors.add(investorId);
      edges.push({ investorId, ticker, weight: holding.weight, marketValue: holding.marketValue });
    }
  }
  edges.sort((a, b) => b.weight - a.weight || (a.ticker < b.ticker ? -1 : 1));

  const profiles = feeds.summary && summary !== null ? summary.investors : {};
  const nodes: GraphNode[] = [];
  for (const investorId of activeInvestors) {
    const profile = profiles[investorId];
    nodes.push(
      profile
        ? {
            kind: "investor",
            id: `investor:${investorId}`,
            investorId,
            label: profile.name,
            group: profile.group,
            aum: profile.aum,
            stale: profile.is_stale,
            unprofiled: false,
          }
        : {
            kind: "investor",
            id: `investor:${investorId}`,
            investorId,
            label: investorId,
            group: null,
            aum: null,
            stale: false,
            unprofiled: true,
          },
    );
  }
  for (const [ticker, holders] of tickerHolders) {
    nodes.push({ kind: "ticker", id: `ticker:${ticker}`, ticker, holdersCount: holders.size });
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "investor" ? -1 : 1;
    if (a.kind === "investor" && b.kind === "investor") return (b.aum ?? -1) - (a.aum ?? -1);
    if (a.kind === "ticker" && b.kind === "ticker") return b.holdersCount - a.holdersCount || (a.ticker < b.ticker ? -1 : 1);
    return 0;
  });

  return {
    nodes,
    edges,
    investorCount: activeInvestors.size,
    tickerCount: tickerHolders.size,
    feeds,
    excludedCount: excludedStale.length,
  };
}
