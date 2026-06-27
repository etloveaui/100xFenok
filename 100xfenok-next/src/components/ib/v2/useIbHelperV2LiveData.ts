"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CASH_BASE,
  PROFILES,
  STRAT,
  type AlertState,
  type CashSnapshot,
  type OrderRowData,
  type Profile,
  type StrategyData,
} from "./mockData";
import { calculate } from "./lib/ibCalculator";
import { getIbLivePrices, type IbPriceQuote } from "./lib/ibPriceClient";
import {
  getEnabledIbStocks,
  normalizeIbNumber,
  normalizeIbSymbol,
  readIbDailyData,
  readIbV1Profiles,
  toIbV2Profile,
  type IbV1DailyData,
  type IbV1Profile,
  type IbV1Stock,
} from "./lib/ibV1Storage";

export type IbHelperV2LiveData = {
  profiles: Profile[];
  activeProfile: Profile;
  strategies: Record<string, StrategyData>;
  cash: CashSnapshot;
  alertState: AlertState;
  isLoading: boolean;
  errors: Record<string, string>;
  refresh: () => Promise<void>;
};

type CalculatorOrder = {
  type?: string;
  description?: string;
  price?: number;
  amount?: number;
  quantity?: number;
  orderType?: string;
};

type CalculatorResult = {
  error?: string;
  ticker?: string;
  input?: {
    principal?: number;
    divisions?: number;
    avgPrice?: number;
    effectiveAvgPrice?: number;
    totalInvested?: number;
    holdings?: number;
    currentPrice?: number;
  };
  calculation?: {
    oneTimeBuy?: number;
    T?: number;
    phase?: string;
  };
  buyOrders?: CalculatorOrder[];
  sellOrders?: CalculatorOrder[];
  deadZone?: { active?: boolean; reason?: string } | null;
  seedInfo?: { insufficient?: boolean; reason?: string } | null;
  quarterStopLoss?: { active?: boolean; mocQuantity?: number; message?: string } | null;
};

export type IbCalculatorInput = {
  ticker: string;
  principal: number;
  divisions: number;
  avgPrice: number;
  totalInvested: number;
  holdings: number;
  currentPrice: number;
  sellPercent: number;
  locSellPercent: number;
  additionalBuyEnabled: boolean;
  additionalBuyMode: string;
  additionalBuyOrderCount: number;
  additionalBuyBudgetRatio: number;
  additionalBuyAllowOneOver: boolean;
  deadZoneGuardEnabled: boolean;
  additionalBuyMaxDecline: number;
  additionalBuyQuantity: number;
};

type NormalizedAdditionalBuySettings = {
  enabled: boolean;
  mode: "budget_ratio" | "fixed";
  budgetRatio: number;
  allowOneOver: boolean;
  deadZoneGuardEnabled: boolean;
  maxDecline: number;
  quantity: number;
  orderCount: number;
};

const EMPTY_PROFILE: Profile = {
  id: "empty",
  name: "IB Helper",
  broker: "IBKR",
  tickers: [],
};

const TICKER_META: Record<string, { name: string; exch: string }> = {
  TQQQ: { name: "ProShares UltraPro QQQ", exch: "NASDAQ" },
  SOXL: { name: "Direxion Daily Semi Bull 3X", exch: "AMEX" },
  SGOV: { name: "iShares 0-3 Month Treasury Bond", exch: "NYSE" },
  BIL: { name: "SPDR Bloomberg 1-3 Month T-Bill", exch: "NYSE" },
  BILS: { name: "SPDR Bloomberg 3-12 Month T-Bill", exch: "NYSE" },
};

function defaultSellPercent(ticker: string): number {
  return ticker === "SOXL" ? 12 : 10;
}

export function computeIbV1AvgPrice(totalInvested: number, holdings: number): number {
  if (totalInvested > 0 && holdings > 0) {
    return parseFloat((totalInvested / holdings).toFixed(4));
  }
  return 0;
}

function parseFloatOr(value: unknown, fallback: number): number {
  const parsed = parseFloat(String(value ?? ""));
  return parsed || fallback;
}

export function normalizeAdditionalBuy(profile: IbV1Profile | null): NormalizedAdditionalBuySettings {
  const raw = profile?.settings?.additionalBuy || {};
  const mode = raw.mode === "fixed" ? "fixed" : "budget_ratio";
  const budgetRatio = normalizeIbNumber(raw.budgetRatio, 20);
  const maxDecline = normalizeIbNumber(raw.maxDecline, 15);
  const quantity = Math.floor(normalizeIbNumber(raw.quantity, 1));
  const orderCount = Math.floor(normalizeIbNumber(raw.orderCount, 8));

  return {
    enabled: raw.enabled !== false,
    mode,
    budgetRatio: Math.max(0, Math.min(100, budgetRatio === 25 ? 20 : budgetRatio)),
    allowOneOver: raw.allowOneOver !== false,
    deadZoneGuardEnabled: raw.deadZoneGuardEnabled !== false,
    maxDecline: Number.isFinite(maxDecline) ? maxDecline : 15,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    orderCount: Number.isFinite(orderCount) ? Math.max(0, Math.min(8, orderCount)) : 8,
  };
}

export function buildAdditionalBuyInput(profile: IbV1Profile | null) {
  const normalized = normalizeAdditionalBuy(profile);
  if (!normalized.enabled) {
    return {
      additionalBuyEnabled: false,
      additionalBuyMode: normalized.mode,
      additionalBuyOrderCount: 0,
      additionalBuyBudgetRatio: 0,
      additionalBuyAllowOneOver: normalized.allowOneOver,
      deadZoneGuardEnabled: normalized.deadZoneGuardEnabled,
      additionalBuyMaxDecline: normalized.maxDecline,
      additionalBuyQuantity: normalized.quantity,
    };
  }

  return {
    additionalBuyEnabled: true,
    additionalBuyMode: normalized.mode,
    additionalBuyOrderCount: normalized.orderCount,
    additionalBuyBudgetRatio: normalized.budgetRatio,
    additionalBuyAllowOneOver: normalized.allowOneOver,
    deadZoneGuardEnabled: normalized.deadZoneGuardEnabled,
    additionalBuyMaxDecline: normalized.maxDecline,
    additionalBuyQuantity: normalized.quantity,
  };
}

export function buildIbCalculatorInput(
  profile: IbV1Profile | null,
  stock: IbV1Stock,
  dailyData: IbV1DailyData | null,
  quote: IbPriceQuote | null,
): IbCalculatorInput {
  const ticker = normalizeIbSymbol(stock.symbol);
  const totalInvested = parseFloat(String(dailyData?.totalInvested ?? "")) || 0;
  const holdings = parseInt(String(dailyData?.holdings ?? ""), 10) || 0;
  const avgPrice = computeIbV1AvgPrice(totalInvested, holdings);
  const currentPrice = quote?.price || 0;

  return {
    ticker,
    principal: parseFloat(String(stock.principal ?? "")) || 0,
    divisions: parseInt(String(stock.divisions ?? ""), 10) || 40,
    avgPrice,
    totalInvested,
    holdings,
    currentPrice,
    sellPercent: parseFloatOr(stock.sellPercent, defaultSellPercent(ticker)),
    locSellPercent: parseFloatOr(stock.locSellPercent, 5),
    ...buildAdditionalBuyInput(profile),
  };
}

function orderTag(orderType: string | undefined): OrderRowData["tag"] {
  return String(orderType || "").toUpperCase() === "LIMIT" ? "LIMIT" : "LOC";
}

function toOrderRow(order: CalculatorOrder, index: number, side: "buy" | "sell", nextN: number): OrderRowData {
  const price = normalizeIbNumber(order.price);
  const qty = normalizeIbNumber(order.quantity);
  const amount = normalizeIbNumber(order.amount, price * qty);

  return {
    n: nextN + index,
    side,
    price,
    qty,
    amt: amount,
    tag: orderTag(order.orderType),
    placedAt: "-",
    filled: false,
    type: order.type || order.description || (side === "buy" ? "매수" : "매도"),
    avg: order.description || "-",
  };
}

function phaseFromResult(result: CalculatorResult): StrategyData["phase"] {
  if (result.quarterStopLoss?.active || result.calculation?.phase === "쿼터손절") return 3;
  const t = normalizeIbNumber(result.calculation?.T);
  return t >= 20 ? 2 : 1;
}

function mapStrategy(
  stock: IbV1Stock,
  result: CalculatorResult,
  quote: IbPriceQuote | null,
  warning: string | null,
): StrategyData {
  const sym = normalizeIbSymbol(stock.symbol);
  const meta = TICKER_META[sym] || { name: `${sym} Strategy`, exch: "US" };
  const input = result.input || {};
  const totalInvested = normalizeIbNumber(input.totalInvested);
  const holdings = normalizeIbNumber(input.holdings);
  const avg = normalizeIbNumber(input.effectiveAvgPrice, normalizeIbNumber(input.avgPrice));
  const price = normalizeIbNumber(input.currentPrice, quote?.price || 0);
  const plAbs = price > 0 && holdings > 0 ? (price - avg) * holdings : 0;
  const pl = avg > 0 && price > 0 ? ((price - avg) / avg) * 100 : 0;
  const nextN = Math.max(1, Math.ceil(normalizeIbNumber(result.calculation?.T)) + 1);
  const buyRows = (result.buyOrders || []).map((order, index) => toOrderRow(order, index, "buy", nextN));
  const sellRows = (result.sellOrders || []).map((order, index) =>
    toOrderRow(order, buyRows.length + index, "sell", nextN),
  );

  return {
    sym,
    name: meta.name,
    exch: meta.exch,
    state: "open",
    phase: phaseFromResult(result),
    plan: {
      count: Math.max(1, Math.floor(normalizeIbNumber(input.divisions, normalizeIbNumber(stock.divisions, 40)))),
      per: normalizeIbNumber(result.calculation?.oneTimeBuy),
      budget: normalizeIbNumber(input.principal, normalizeIbNumber(stock.principal)),
    },
    pos: {
      invested: totalInvested,
      count: normalizeIbNumber(result.calculation?.T),
      avg,
      shares: holdings,
      price,
      pl: parseFloat(pl.toFixed(2)),
      plAbs: parseFloat(plAbs.toFixed(2)),
    },
    orders: [...buyRows, ...sellRows],
    nextN,
    priceSource: quote?.source || (warning ? "PRICE:UNAVAILABLE" : "PRICE:AVG_ONLY"),
    error: warning || undefined,
    calculation: result,
  };
}

function buildCashSnapshot(profile: IbV1Profile | null, strategies: Record<string, StrategyData>): CashSnapshot {
  const balance = normalizeIbNumber(profile?.settings?.balance?.available);
  const nextBuy = Object.values(strategies).reduce((sum, strategy) => {
    const buyTotal = strategy.orders
      .filter((order) => order.side === "buy")
      .reduce((orderSum, order) => orderSum + order.price * order.qty, 0);
    return sum + buyTotal;
  }, 0);

  return {
    bal: balance,
    nextBuy: parseFloat(nextBuy.toFixed(2)),
    needed5: parseFloat((nextBuy * 5).toFixed(2)),
  };
}

function cashAlert(cash: CashSnapshot): AlertState {
  if (cash.nextBuy <= 0 || cash.bal <= 0) return "none";
  if (cash.bal < cash.nextBuy) return "margin-call";
  if (cash.bal < cash.nextBuy * 2) return "warn";
  return "none";
}

function buildFallbackState(): Omit<IbHelperV2LiveData, "refresh"> {
  return {
    profiles: PROFILES,
    activeProfile: PROFILES[0],
    strategies: STRAT,
    cash: CASH_BASE,
    alertState: "none",
    isLoading: false,
    errors: {
      profile: "V1 profile unavailable; fixture fallback rendered",
    },
  };
}

export function useIbHelperV2LiveData(selectedProfileId?: string | null): IbHelperV2LiveData {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfile, setActiveProfile] = useState<Profile>(EMPTY_PROFILE);
  const [strategies, setStrategies] = useState<Record<string, StrategyData>>({});
  const [cash, setCash] = useState<CashSnapshot>({ bal: 0, nextBuy: 0, needed5: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    const profileRead = readIbV1Profiles();
    if (profileRead.error || profileRead.profiles.length === 0) {
      const fallback = buildFallbackState();
      setProfiles(fallback.profiles);
      setActiveProfile(fallback.activeProfile);
      setStrategies(fallback.strategies);
      setCash(fallback.cash);
      setErrors(fallback.errors);
      setIsLoading(false);
      return;
    }

    const v2Profiles = profileRead.profiles.map(toIbV2Profile);
    const targetProfile =
      (selectedProfileId && profileRead.profiles.find((profile) => profile.id === selectedProfileId)) ||
      profileRead.activeProfile ||
      profileRead.profiles[0] ||
      null;
    const uiProfile = targetProfile ? toIbV2Profile(targetProfile) : EMPTY_PROFILE;
    const activeStocks = getEnabledIbStocks(targetProfile);
    const symbols = activeStocks.map((stock) => normalizeIbSymbol(stock.symbol));
    const nextErrors: Record<string, string> = {};

    let quotes: Record<string, IbPriceQuote | null> = {};
    if (symbols.length > 0) {
      quotes = await getIbLivePrices(symbols);
    }

    const nextStrategies: Record<string, StrategyData> = {};

    for (const stock of activeStocks) {
      const ticker = normalizeIbSymbol(stock.symbol);
      const dailyData = targetProfile?.id ? readIbDailyData(targetProfile.id, ticker) : null;
      const quote = quotes[ticker] || null;
      const input = buildIbCalculatorInput(targetProfile, stock, dailyData, quote);

      const result = calculate(input) as CalculatorResult;
      let warning: string | null = null;
      if (result.error) {
        warning = result.error;
        nextErrors[ticker] = result.error;
      }

      nextStrategies[ticker] = mapStrategy(stock, result, quote, warning);
    }

    const nextCash = buildCashSnapshot(targetProfile, nextStrategies);

    setProfiles(v2Profiles.length > 0 ? v2Profiles : [EMPTY_PROFILE]);
    setActiveProfile(uiProfile);
    setStrategies(nextStrategies);
    setCash(nextCash);
    setErrors(nextErrors);
    setIsLoading(false);
  }, [selectedProfileId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const alertState = useMemo(() => cashAlert(cash), [cash]);

  return {
    profiles,
    activeProfile,
    strategies,
    cash,
    alertState,
    isLoading,
    errors,
    refresh,
  };
}
