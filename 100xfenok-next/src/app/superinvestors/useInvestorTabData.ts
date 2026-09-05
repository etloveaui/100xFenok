"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetch13FJson } from "@/hooks/use13FData";
import type {
  BuyingPressureData,
  ConvictionData,
  FactorExposuresSummaryData,
  NewPositionsData,
  PortfolioViewsData,
  TradesRankingData,
  TurnoverData,
} from "@/lib/superinvestors/types";
import { loadFactorExposuresSummary, loadPortfolioViews } from "./portfolioViewsLoader";
import {
  loadSignalBuyingPressure,
  loadSignalConviction,
  loadSignalNewPositions,
  loadSignalScores,
  type SignalScoreData,
} from "./signalFeeds";

export type InvestorTab = "signal" | "investors" | "stocks" | "trades" | "insights" | "graph";

export type FeedStatus = "not-requested" | "loading" | "ready" | "unavailable" | "error";

export interface FeedState<T> {
  status: FeedStatus;
  data: T | null;
}

export interface InvestorSignalFeedState {
  newPositions: FeedState<NewPositionsData>;
  buyingPressure: FeedState<BuyingPressureData>;
  conviction: FeedState<ConvictionData>;
  signalScores: FeedState<Map<string, SignalScoreData>>;
}

export interface InvestorTabDataState {
  turnover: FeedState<TurnoverData["by_investor"]>;
  trades: FeedState<TradesRankingData>;
  portfolio: FeedState<PortfolioViewsData>;
  factor: FeedState<FactorExposuresSummaryData>;
  signal: InvestorSignalFeedState;
  retryTurnover: () => void;
  retryTrades: () => void;
  retryPortfolio: () => void;
  retryFactor: () => void;
  retrySignal: () => void;
  readyFor: (tab: InvestorTab, guruId: string | null) => boolean;
}

type FeedKey =
  | "turnover"
  | "trades"
  | "portfolio"
  | "factor"
  | "newPositions"
  | "buyingPressure"
  | "conviction"
  | "signalScores";

type TabDataState = Omit<InvestorTabDataState, "retryTurnover" | "retryTrades" | "retryPortfolio" | "retryFactor" | "retrySignal" | "readyFor">;

function feed<T>(): FeedState<T> {
  return { status: "not-requested", data: null };
}

function createInitialState(): TabDataState {
  return {
    turnover: feed<TurnoverData["by_investor"]>(),
    trades: feed<TradesRankingData>(),
    portfolio: feed<PortfolioViewsData>(),
    factor: feed<FactorExposuresSummaryData>(),
    signal: {
      newPositions: feed<NewPositionsData>(),
      buyingPressure: feed<BuyingPressureData>(),
      conviction: feed<ConvictionData>(),
      signalScores: feed<Map<string, SignalScoreData>>(),
    },
  };
}

function normalizeTradesRanking(data: unknown): TradesRankingData | null {
  const raw = data as Partial<TradesRankingData> | null;
  if (!raw?.metadata) return null;
  return {
    metadata: raw.metadata,
    bought: Array.isArray(raw.bought) ? raw.bought : [],
    sold: Array.isArray(raw.sold) ? raw.sold : [],
  };
}

let turnoverCache: TurnoverData["by_investor"] | undefined;
let turnoverPromise: Promise<TurnoverData["by_investor"] | null> | null = null;

function isTurnoverMap(value: unknown): value is TurnoverData["by_investor"] {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function loadTurnoverLocal(): Promise<TurnoverData["by_investor"] | null> {
  if (turnoverCache !== undefined) return Promise.resolve(turnoverCache);
  if (turnoverPromise) return turnoverPromise;
  turnoverPromise = fetch13FJson<TurnoverData>("/data/sec-13f/analytics/turnover.json").then((data) => {
    const map = data?.by_investor;
    if (!isTurnoverMap(map)) {
      turnoverPromise = null;
      return null;
    }
    turnoverCache = map;
    turnoverPromise = null;
    return map;
  }, (error) => {
    turnoverPromise = null;
    throw error;
  });
  return turnoverPromise;
}

function loadTradesLocal(): Promise<TradesRankingData | null> {
  return fetch13FJson<unknown>("/data/sec-13f/analytics/trades_ranking.json").then((data) => {
    const normalized = normalizeTradesRanking(data);
    if (!normalized) throw new Error("Invalid trades_ranking shape");
    return normalized;
  });
}

const LOADERS: Record<FeedKey, () => Promise<unknown>> = {
  turnover: loadTurnoverLocal,
  trades: loadTradesLocal,
  portfolio: loadPortfolioViews,
  factor: loadFactorExposuresSummary,
  newPositions: loadSignalNewPositions,
  buyingPressure: loadSignalBuyingPressure,
  conviction: loadSignalConviction,
  signalScores: loadSignalScores,
};

function feedStateFor(state: TabDataState, key: FeedKey): FeedState<unknown> {
  if (key === "newPositions" || key === "buyingPressure" || key === "conviction" || key === "signalScores") {
    return state.signal[key];
  }
  return state[key];
}

function isSettled(state: FeedState<unknown>): boolean {
  return state.status === "ready" || state.status === "unavailable" || state.status === "error";
}

function requiredFeeds(tab: InvestorTab, guruId: string | null): FeedKey[] {
  if (tab === "signal") return ["newPositions", "buyingPressure", "conviction", "signalScores"];
  if (tab === "investors") return guruId ? ["turnover", "portfolio", "factor"] : ["turnover"];
  if (tab === "stocks") return ["portfolio", "newPositions", "buyingPressure", "conviction"];
  if (tab === "trades") return ["trades", "portfolio"];
  return [];
}

function stateForKey(state: TabDataState, key: FeedKey, next: FeedState<unknown>): TabDataState {
  if (key === "newPositions" || key === "buyingPressure" || key === "conviction" || key === "signalScores") {
    return { ...state, signal: { ...state.signal, [key]: next } } as TabDataState;
  }
  return { ...state, [key]: next } as TabDataState;
}

export function useInvestorTabData(tab: InvestorTab, guruId: string | null): InvestorTabDataState {
  const [state, setState] = useState<TabDataState>(createInitialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const inFlightRef = useRef(new Set<FeedKey>());
  const previousTabRef = useRef<InvestorTab | null>(null);
  const [retryEpoch, setRetryEpoch] = useState(0);

  const requestFeed = useCallback((key: FeedKey) => {
    if (inFlightRef.current.has(key)) return;
    const current = feedStateFor(stateRef.current, key);
    if (current.status !== "not-requested") return;
    inFlightRef.current.add(key);
    setState((previous) => stateForKey(previous, key, { status: "loading", data: current.data }));
    LOADERS[key]().then(
      (data) => {
        const settled = data == null
          ? { status: "unavailable" as const, data: null }
          : { status: "ready" as const, data };
        setState((previous) => stateForKey(previous, key, settled));
      },
      () => {
        setState((previous) => stateForKey(previous, key, {
          status: "error",
          data: key === "signalScores" ? feedStateFor(previous, key).data : null,
        }));
      },
    ).finally(() => {
      inFlightRef.current.delete(key);
    });
  }, []);

  const refreshSignalScores = useCallback(() => {
    const key: FeedKey = "signalScores";
    if (inFlightRef.current.has(key)) return;
    const current = feedStateFor(stateRef.current, key);
    if (current.status === "not-requested") {
      requestFeed(key);
      return;
    }
    inFlightRef.current.add(key);
    if (current.status !== "ready") {
      setState((previous) => stateForKey(previous, key, { status: "loading", data: current.data }));
    }
    LOADERS[key]().then(
      (data) => {
        setState((previous) => {
          const previousData = feedStateFor(previous, key).data;
          return stateForKey(previous, key, data == null
            ? { status: "unavailable", data: previousData }
            : { status: "ready", data });
        });
      },
      () => {
        setState((previous) => stateForKey(previous, key, {
          status: "error",
          data: feedStateFor(previous, key).data,
        }));
      },
    ).finally(() => {
      inFlightRef.current.delete(key);
    });
  }, [requestFeed]);

  useEffect(() => {
    const enteredSignal = tab === "signal" && previousTabRef.current !== "signal";
    previousTabRef.current = tab;
    for (const key of requiredFeeds(tab, guruId)) requestFeed(key);
    if (enteredSignal) refreshSignalScores();
  }, [tab, guruId, requestFeed, refreshSignalScores, retryEpoch]);

  const retryKeys = useCallback((keys: FeedKey[]) => {
    setState((previous) => {
      let next = previous;
      for (const key of keys) {
        const current = feedStateFor(next, key);
        if (current.status === "error" || current.status === "unavailable") {
          next = stateForKey(next, key, {
            status: "not-requested",
            data: key === "signalScores" ? current.data : null,
          });
        }
      }
      return next;
    });
    setRetryEpoch((value) => value + 1);
  }, []);

  const retryTurnover = useCallback(() => retryKeys(["turnover"]), [retryKeys]);
  const retryTrades = useCallback(() => retryKeys(["trades"]), [retryKeys]);
  const retryPortfolio = useCallback(() => retryKeys(["portfolio"]), [retryKeys]);
  const retryFactor = useCallback(() => retryKeys(["factor"]), [retryKeys]);
  const retrySignal = useCallback(() => {
    const signalKeys: FeedKey[] = ["newPositions", "buyingPressure", "conviction", "signalScores"];
    retryKeys(signalKeys.filter((key) => {
      const current = feedStateFor(stateRef.current, key);
      return current.status === "error" || current.status === "unavailable";
    }));
  }, [retryKeys]);

  const readyFor = useCallback((targetTab: InvestorTab, targetGuruId: string | null) => {
    return requiredFeeds(targetTab, targetGuruId)
      .filter((key) => key !== "signalScores")
      .every((key) => isSettled(feedStateFor(stateRef.current, key)));
  }, []);

  return {
    ...state,
    retryTurnover,
    retryTrades,
    retryPortfolio,
    retryFactor,
    retrySignal,
    readyFor,
  };
}
