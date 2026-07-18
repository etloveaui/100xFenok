"use client";

import { useEffect, useRef, useState } from "react";
import { StaticStockAnalyzerDataProvider } from "@/features/stock-analyzer/data/static-data-provider";
import { loadFenokSignalsSummaryMap } from "@/features/stock-analyzer/data/fenok-signals-summary-provider";
import {
  getStockConnection,
  getStockServices,
  loadStockConnectionIndex,
  loadStockServicesIndex,
  stockConnectionCount,
} from "@/lib/data-entity-graph/stock-index";
import type { ScreenerStock, ScreenerDataResult } from "@/lib/screener/types";
import type { StockAnalyzerRecord } from "@/lib/stock-analyzer/types";

const FETCH_TIMEOUT_MS = 4000; // single payload

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizedSourceDate(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  if (date) return date;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(text);
  if (!quarter) return null;
  const year = Number(quarter[1]);
  const quarterNumber = Number(quarter[2]);
  const month = quarterNumber * 3;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function completeSourceFloor(values: Array<string | null | undefined>): string | null {
  if (values.length === 0) return null;
  const dates = values.map(normalizedSourceDate);
  if (dates.some((value) => value === null)) return null;
  return (dates as string[]).sort().at(0) ?? null;
}

function convictionCallFromRecord(
  call: string | null | undefined,
  score: number | null | undefined,
): ScreenerStock["fenokConvictionCall"] {
  if (call === "concentrated") return "집중";
  if (call === "mixed") return "혼재";
  if (call === "diluted") return "희석";
  if (score === null || score === undefined) return null;
  if (score >= 70) return "집중";
  if (score >= 41) return "혼재";
  return "희석";
}

const provider = new StaticStockAnalyzerDataProvider();

async function loadRecords(timeoutMs = FETCH_TIMEOUT_MS): Promise<StockAnalyzerRecord[] | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await provider.load({ signal: controller.signal });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadConnectionIndex(timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await loadStockConnectionIndex(controller.signal);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadServicesIndex(timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await loadStockServicesIndex(controller.signal);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function loadFenokSignalsMap(timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await loadFenokSignalsSummaryMap({ signal: controller.signal });
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const EMPTY: ScreenerDataResult = {
  stocks: [],
  dataReady: false,
  failed: false,
  sourceDate: null,
  connectionIndexDate: null,
  connectionIndexReady: false,
  sectors: [],
  countries: [],
};

export function useScreenerData(): ScreenerDataResult {
  const [result, setResult] = useState<ScreenerDataResult>(EMPTY);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    void (async () => {
      const [records, connectionIndex, servicesIndex, fenokSignals] = await Promise.all([
        loadRecords(),
        loadConnectionIndex(),
        loadServicesIndex(),
        loadFenokSignalsMap(),
      ]);
      if (!isMountedRef.current) return;

      if (!records) {
        setResult({ ...EMPTY, failed: true });
        return;
      }

      const stocks: ScreenerStock[] = records.map((item) => {
        const ticker = item.symbol ?? "";
        const tickerKey = ticker.toUpperCase();
        const connectionEntry = getStockConnection(connectionIndex, ticker);
        const servicesEntry = getStockServices(servicesIndex, ticker);
        const fenokSignal = fenokSignals?.get(tickerKey) ?? null;
        const connectionCount = stockConnectionCount(connectionEntry);
        const serviceLinks = servicesEntry?.single_stock_etfs ?? [];
        const connection = connectionEntry ? {
          flags: {
            marketFacts: connectionEntry.flags?.market_facts === true,
            filings: connectionEntry.flags?.filings === true,
            smartMoney: connectionEntry.flags?.sec_13f === true,
            indexMembership: connectionEntry.flags?.index_membership === true,
            singleStockEtfs: connectionEntry.flags?.single_stock_etfs === true,
          },
          count: connectionCount ?? 0,
          serviceCount: serviceLinks.length || num(connectionEntry.service_count),
          singleStockEtfs: serviceLinks,
          confidenceLabel: connectionEntry.confidence?.label ?? null,
          coverageRatio: num(connectionEntry.confidence?.coverage_ratio),
          asOf: {
            profile: connectionEntry.as_of?.profile ?? null,
            actionIndex: connectionEntry.as_of?.action_index ?? null,
            marketFacts: connectionEntry.as_of?.market_facts ?? null,
            filings: connectionEntry.as_of?.filings ?? null,
            sec13f: connectionEntry.as_of?.sec_13f ?? null,
          },
        } : null;
        return {
          ticker,
          name: item.companyName ?? ticker,
          exchange: item.industry ?? "",
          sector: item.sector ?? "",
          country: item.country ?? "",
          price: num(item.price),
          marketCap: num(item.marketCap),
          per: num(item.per),
          pbr: num(item.pbr),
          dividendYield: num(item.dividendYield),
          return12m: num(item.return12m),
          roe: num(item.roe),
          opm: num(item.opm),
          eps: num(item.eps),
          growthRate: num(item.growthRate),
          momentum1m: num(item.momentum1m),
          momentum3m: num(item.momentum3m),
          momentum6m: num(item.momentum6m),
          momentum12m: num(item.momentum12m),
          rank: num(item.rank),
          perBandCurrent: num(item.perBandCurrent),
          perBandMin: num(item.perBandMin),
          perBandAvg: num(item.perBandAvg),
          perBandMax: num(item.perBandMax),
          peForward: num(item.peForward),
          epsForward: num(item.epsForward),
          dividendTtm: num(item.dividendTtm),
          ret1y: num(item.ret1y),
          ret3y: num(item.ret3y),
          ret5y: num(item.ret5y),
          guruHolders: num(item.guruHolders),
          actionScore: num(item.actionScore),
          fenokEdgeScore: fenokSignal?.upsideDownsideScore ?? null,
          fenokEdgeDirection: fenokSignal?.upsideDownsideDirection ?? null,
          fenokSignalConfidence: fenokSignal?.confidence ?? null,
          fenokSignalCoverageRatio: fenokSignal?.coverageRatio ?? null,
          fenokSignalAsOf: fenokSignal?.asOf ?? null,
          fenokMarketScope: fenokSignal?.marketScope ?? null,
          fenokConvictionScore: fenokSignal?.convictionScore ?? null,
          fenokConvictionCall: convictionCallFromRecord(fenokSignal?.convictionCall, fenokSignal?.convictionScore),
          fenokShortTermScore: fenokSignal?.shortTermScore ?? fenokSignal?.shortTermConvictionScore ?? fenokSignal?.convictionScore ?? null,
          fenokShortTermConvictionScore: fenokSignal?.shortTermConvictionScore ?? fenokSignal?.convictionScore ?? null,
          fenokShortTermConvictionCall: convictionCallFromRecord(
            fenokSignal?.shortTermConvictionCall,
            fenokSignal?.shortTermConvictionScore ?? fenokSignal?.convictionScore,
          ),
          fenokLongTermScore: fenokSignal?.longTermConvictionScore ?? fenokSignal?.longTermScore ?? fenokSignal?.convictionScore ?? null,
          fenokLongTermConvictionScore: fenokSignal?.longTermConvictionScore ?? fenokSignal?.convictionScore ?? null,
          fenokLongTermConvictionCall: convictionCallFromRecord(
            fenokSignal?.longTermConvictionCall,
            fenokSignal?.longTermConvictionScore ?? fenokSignal?.convictionScore,
          ),
          profitabilityScore: fenokSignal?.profitabilityScore ?? null,
          profitabilityDirection: fenokSignal?.profitabilityDirection ?? null,
          growthScore: fenokSignal?.growthScore ?? null,
          growthDirection: fenokSignal?.growthDirection ?? null,
          technicalFlowScore: fenokSignal?.technicalFlowScore ?? null,
          technicalFlowDirection: fenokSignal?.technicalFlowDirection ?? null,
          volumeLiquidityTrendScore: fenokSignal?.volumeLiquidityTrendScore ?? null,
          volumeLiquidityTrendDirection: fenokSignal?.volumeLiquidityTrendDirection ?? null,
          shortTermRelativeStrengthScore: fenokSignal?.shortTermRelativeStrengthScore ?? null,
          shortTermRelativeStrengthDirection: fenokSignal?.shortTermRelativeStrengthDirection ?? null,
          technicalIndicatorProxyScore: fenokSignal?.technicalIndicatorProxyScore ?? null,
          netOptionsProxyScore: fenokSignal?.netOptionsProxyScore ?? null,
          offExchangeActivityProxyScore: fenokSignal?.offExchangeActivityProxyScore ?? null,
          shortPressureProxyScore: fenokSignal?.shortPressureProxyScore ?? null,
          durabilityProfitabilityScore: fenokSignal?.durabilityProfitabilityScore ?? null,
          durabilityProfitabilityCoverage: fenokSignal?.durabilityProfitabilityCoverage ?? null,
          upsidePotentialScore: fenokSignal?.upsidePotentialScore ?? null,
          downsidePressureScore: fenokSignal?.downsidePressureScore ?? null,
          marketSimilarityScore: fenokSignal?.marketSimilarityScore ?? null,
          marketSimilarityDirection: fenokSignal?.marketSimilarityDirection ?? null,
          sp500TrackingSimilarityScore: fenokSignal?.sp500TrackingSimilarityScore ?? null,
          confidenceLabel: typeof item.confidenceLabel === "string" ? item.confidenceLabel : null,
          actionLabel: typeof item.actionLabel === "string" ? item.actionLabel : null,
          actionBucket: typeof item.actionBucket === "string" ? item.actionBucket : null,
          actionReasons: Array.isArray(item.actionReasons) ? item.actionReasons : [],
          lowEvidence: typeof item.lowEvidence === "boolean" ? item.lowEvidence : null,
          forwardPeFy1: num(item.forwardPeFy1),
          forwardEpsFy1: num(item.forwardEpsFy1),
          peg: (() => {
            const fpe = num(item.forwardPeFy1);
            const eg = num(item.epsGrowthFy1);
            return fpe !== null && fpe > 0 && eg !== null && eg > 0 ? fpe / eg : null;
          })(),
          revenueGrowthFy1: num(item.revenueGrowthFy1),
          epsGrowthFy1: num(item.epsGrowthFy1),
          forwardPeFy2: num(item.forwardPeFy2),
          forwardEpsFy2: num(item.forwardEpsFy2),
          revenueGrowthFy2: num(item.revenueGrowthFy2),
          epsGrowthFy2: num(item.epsGrowthFy2),
          forwardPeFy3: num(item.forwardPeFy3),
          forwardEpsFy3: num(item.forwardEpsFy3),
          revenueGrowthFy3: num(item.revenueGrowthFy3),
          epsGrowthFy3: num(item.epsGrowthFy3),
          operatingMarginFy1: num(item.operatingMarginFy1),
          roeFy1: num(item.roeFy1),
          grossMarginFy1: num(item.grossMarginFy1),
          operatingMarginFy2: num(item.operatingMarginFy2),
          roeFy2: num(item.roeFy2),
          grossMarginFy2: num(item.grossMarginFy2),
          operatingMarginFy3: num(item.operatingMarginFy3),
          roeFy3: num(item.roeFy3),
          grossMarginFy3: num(item.grossMarginFy3),
          connection,
          connectionCount,
        };
      });

      const sectors = Array.from(new Set(stocks.map((s) => s.sector).filter(Boolean))).sort();
      const countries = Array.from(new Set(stocks.map((s) => s.country).filter(Boolean))).sort();
      const connectionIndexDate = completeSourceFloor([
        connectionIndex?.source_as_of?.stocks_analyzer,
        connectionIndex?.source_as_of?.stock_action_index,
        connectionIndex?.source_as_of?.market_facts,
      ]);

      setResult({
        stocks,
        dataReady: true,
        failed: false,
        sourceDate: provider.getSourceDate(),
        connectionIndexDate,
        connectionIndexReady: Boolean(connectionIndex),
        sectors,
        countries,
      });
    })();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return result;
}
