/**
 * IB Helper V2 mock data — matches the Claude Design handoff sample.
 * Wiring this to the real `/ib` strategy hook is deferred (BACKLOG).
 * Shape mirrors what the live hook would produce.
 */

export type Profile = {
  id: string;
  name: string;
  broker: string;
  tickers: string[];
};

export type OrderRowData = {
  n: number;
  side: "buy" | "sell";
  price: number;
  qty: number;
  amt: number;
  tag: "LIMIT" | "LOC";
  placedAt: string;
  filled: boolean;
  type: string;
  avg: string;
};

export type StrategyData = {
  sym: string;
  name: string;
  exch: string;
  state: "open" | "closed";
  phase: 1 | 2 | 3;
  plan: { count: number; per: number; budget: number };
  pos: {
    invested: number;
    count: number;
    avg: number;
    shares: number;
    price: number;
    pl: number;
    plAbs: number;
  };
  orders: OrderRowData[];
  nextN: number;
  priceSource?: string;
  error?: string;
  calculation?: unknown;
};

export const PROFILES: Profile[] = [
  { id: "A", name: "Main 계좌", broker: "IBKR Pro", tickers: ["TQQQ", "SOXL"] },
  { id: "B", name: "검토용 보조", broker: "IBKR Lite", tickers: ["TQQQ"] },
  { id: "C", name: "시즌 1H 전략", broker: "IBKR Pro", tickers: [] },
];

export const STRAT: Record<string, StrategyData> = {
  TQQQ: {
    sym: "TQQQ",
    name: "ProShares UltraPro QQQ",
    exch: "NASDAQ",
    state: "open",
    phase: 1,
    plan: { count: 40, per: 250, budget: 10000 },
    pos: {
      invested: 3250,
      count: 13,
      avg: 118.42,
      shares: 27.46,
      price: 124.18,
      pl: 4.86,
      plAbs: 158.14,
    },
    orders: [
      { n: 13, side: "buy", price: 124.18, qty: 2.01, amt: 250, tag: "LIMIT", placedAt: "04-15 09:31", filled: true, type: "Limit", avg: "$118.42" },
      { n: 14, side: "buy", price: 122.40, qty: 2.04, amt: 250, tag: "LOC", placedAt: "04-22 09:30", filled: false, type: "Limit On Close", avg: "$118.78 (+0.30%)" },
      { n: 15, side: "buy", price: 120.60, qty: 2.07, amt: 250, tag: "LOC", placedAt: "04-29 09:30", filled: false, type: "Limit On Close", avg: "$117.88 (−0.45%)" },
      { n: 16, side: "buy", price: 118.90, qty: 2.10, amt: 250, tag: "LOC", placedAt: "05-06 09:30", filled: false, type: "Limit On Close", avg: "$117.00 (−0.71%)" },
      { n: 17, side: "sell", price: 130.00, qty: 12.00, amt: 1560, tag: "LIMIT", placedAt: "-", filled: false, type: "Limit", avg: "손절 트리거" },
    ],
    nextN: 14,
  },
  SOXL: {
    sym: "SOXL",
    name: "Direxion Daily Semi Bull 3X",
    exch: "AMEX",
    state: "open",
    phase: 2,
    plan: { count: 30, per: 300, budget: 9000 },
    pos: {
      invested: 2100,
      count: 7,
      avg: 34.18,
      shares: 61.44,
      price: 31.92,
      pl: -6.62,
      plAbs: -139.05,
    },
    orders: [
      { n: 7, side: "buy", price: 31.92, qty: 9.40, amt: 300, tag: "LIMIT", placedAt: "04-18 09:31", filled: true, type: "Limit", avg: "$34.18" },
      { n: 8, side: "buy", price: 30.50, qty: 9.84, amt: 300, tag: "LOC", placedAt: "04-25 09:30", filled: false, type: "Limit On Close", avg: "$33.71 (−1.37%)" },
      { n: 9, side: "buy", price: 29.10, qty: 10.30, amt: 300, tag: "LOC", placedAt: "05-02 09:30", filled: false, type: "Limit On Close", avg: "$33.05 (−3.31%)" },
      { n: 10, side: "sell", price: 36.00, qty: 30.00, amt: 1080, tag: "LIMIT", placedAt: "-", filled: false, type: "Limit", avg: "손절 트리거" },
    ],
    nextN: 8,
  },
};

export type AlertState = "none" | "warn" | "margin-call";

export type CashSnapshot = {
  bal: number;
  nextBuy: number;
  needed5: number;
};

export const CASH_BASE: CashSnapshot = {
  bal: 1080,
  nextBuy: 250 + 300,
  needed5: 250 * 5 + 300 * 5,
};
