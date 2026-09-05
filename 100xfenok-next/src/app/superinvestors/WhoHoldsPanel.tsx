"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { formatCurrencyCompact, formatInteger, formatPercent } from "@/lib/format";
import type {
  ByTickerData,
  BuyingPressureData,
  ConsensusData,
  ConvictionData,
  EnhancedConsensusData,
  NewPositionsData,
  SummaryData,
} from "@/lib/superinvestors/types";
import { loadSignalBuyingPressure, loadSignalConviction, loadSignalNewPositions } from "./signalFeeds";
import { buildGrandPortfolio, investorDisplayName } from "./signalData";

interface WhoHoldsPanelProps {
  summary: SummaryData | null;
  consensus: ConsensusData | null;
  enhancedConsensus: EnhancedConsensusData | null;
  byTicker: ByTickerData | null;
  quarter: string | null;
  asOf: string;
  dataReady: boolean;
  failed: boolean;
  partialFeeds: boolean;
  onRetry: () => void;
  initialTicker?: string | null;
  onTickerChange?: (ticker: string) => void;
  compact?: boolean;
}

function normalizeTickerInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

// "누가 들고 있나": ticker search over the loaded 13F feeds. Compact mode is
// the signal-hero cell (stats only); full mode adds the holder list and the
// grand-portfolio table before any search.
export default function WhoHoldsPanel({
  summary,
  consensus,
  enhancedConsensus,
  byTicker,
  quarter,
  asOf,
  dataReady,
  failed,
  partialFeeds,
  onRetry,
  initialTicker = null,
  onTickerChange,
  compact = false,
}: WhoHoldsPanelProps) {
  const normalizedInitialTicker = normalizeTickerInput(initialTicker ?? "");
  const [query, setQuery] = useState(normalizedInitialTicker);
  const [committed, setCommitted] = useState<string | null>(normalizedInitialTicker || null);
  const [newPositions, setNewPositions] = useState<NewPositionsData | null | undefined>(undefined);
  const [buyingPressure, setBuyingPressure] = useState<BuyingPressureData | null | undefined>(undefined);
  const [conviction, setConviction] = useState<ConvictionData | null | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setQuery(normalizedInitialTicker);
    setCommitted(normalizedInitialTicker || null);
  }, [normalizedInitialTicker]);

  useEffect(() => {
    let cancelled = false;
    loadSignalNewPositions().then((d) => { if (!cancelled) setNewPositions(d); });
    loadSignalBuyingPressure().then((d) => { if (!cancelled) setBuyingPressure(d); });
    loadSignalConviction().then((d) => { if (!cancelled) setConviction(d); });
    return () => { cancelled = true; };
  }, [attempt]);

  const tickers = useMemo(() => {
    const set = new Set<string>();
    if (consensus) for (const key of Object.keys(consensus.consensus)) set.add(key);
    if (byTicker) for (const key of Object.keys(byTicker)) set.add(key);
    return [...set].sort();
  }, [consensus, byTicker]);

  const suggestions = useMemo(() => {
    const q = normalizeTickerInput(query);
    if (q.length === 0 || !tickers) return [];
    if (tickers.includes(q)) return [];
    return tickers.filter((t) => t.startsWith(q)).slice(0, 6);
  }, [query, tickers]);

  const result = useMemo(() => {
    if (!committed || !dataReady) return null;
    const entry = byTicker?.[committed] ?? null;
    const consensusRow = consensus?.consensus[committed] ?? null;
    const details = entry && Array.isArray(entry.holder_details) ? entry.holder_details : [];
    const holders = [...details].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
    const holderCount = holders.length > 0
      ? holders.length
      : (Array.isArray(entry?.holders) ? entry.holders.length : (consensusRow?.holders_count ?? 0));
    if (holderCount === 0 && !consensusRow) return null;
    const pressure = buyingPressure?.buying_pressure[committed] ?? null;
    let newCount = 0;
    if (newPositions) {
      for (const p of newPositions.new_positions) {
        if (p?.ticker === committed) newCount += 1;
      }
    }
    let top10Count: number | null = null;
    if (conviction) {
      top10Count = 0;
      for (const positions of Object.values(conviction.by_investor)) {
        if (Array.isArray(positions) && positions.some((p) => p?.ticker === committed && p.is_top10)) top10Count += 1;
      }
    }
    const enhanced = enhancedConsensus?.enhanced_consensus[committed] ?? null;
    return { holders, holderCount, pressure, newCount, top10Count, enhanced, holdersCount: consensusRow?.holders_count ?? holderCount };
  }, [committed, dataReady, byTicker, consensus, buyingPressure, newPositions, conviction, enhancedConsensus]);

  const grand = useMemo(() => buildGrandPortfolio(byTicker, compact ? 3 : 10), [byTicker, compact]);
  const loading = (!dataReady && !failed) || newPositions === undefined || buyingPressure === undefined || conviction === undefined;
  const feedsFailed = !loading && (newPositions === null || buyingPressure === null || conviction === null);
  const freshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : failed || (newPositions === null && buyingPressure === null && conviction === null) ? "error" : partialFeeds || feedsFailed ? "partial" : "stale";
  const emptyResult = committed !== null && dataReady && result === null && !loading;

  function retryFeeds() {
    setNewPositions(undefined);
    setBuyingPressure(undefined);
    setConviction(undefined);
    setAttempt((n) => n + 1);
  }

  function commit(value: string) {
    const q = normalizeTickerInput(value);
    if (!q) return;
    if (tickers.includes(q)) {
      setCommitted(q);
      onTickerChange?.(q);
      return;
    }
    const prefix = tickers.filter((t) => t.startsWith(q));
    const next = prefix[0] ?? q;
    setCommitted(next);
    onTickerChange?.(next);
  }

  const coverage = dataReady && committed && result
    ? `보유 ${formatInteger(result.holderCount)}명`
    : coverageOf(quarter);

  return (
    <Panel
      loading={loading}
      empty={!loading && !failed && dataReady && tickers.length === 0}
      emptyReason="검색할 종목 데이터가 없습니다"
      emptyNextRefresh="다음 분기 공시 반영 후 갱신"
      error={!loading && failed}
      errorDetail="보유 데이터를 불러오지 못했습니다."
      onRetry={!loading && failed ? onRetry : undefined}
      retryLabel="다시 시도"
    >
      <div data-superinvestors-whoholds>
        <PanelHeader eyebrow="Who holds" title="누가 들고 있나" />
        <div className="sup-whoholds-search">
          <form
            role="search"
            aria-label="보유 투자자 티커 검색"
            onSubmit={(event) => { event.preventDefault(); commit(query); }}
          >
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="티커 입력 (예: NVDA)"
              aria-label="티커 입력"
              autoComplete="off"
              spellCheck={false}
              data-superinvestors-whoholds-input
              className="sup-whoholds-input sup-mono"
            />
          </form>
          {suggestions.length > 0 ? (
            <div className="sup-whoholds-suggest" role="group" aria-label="유사 티커">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="sup-whoholds-chip sup-mono"
                  data-superinvestors-whoholds-suggest={t}
                  onClick={() => { setQuery(t); setCommitted(t); onTickerChange?.(t); }}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {result && committed ? (
          <div data-superinvestors-whoholds-result={committed}>
            <div className="sup-whoholds-head">
              <span className="sup-mono sup-whoholds-ticker">{committed}</span>
              {result.enhanced ? (
                <Pill data-superinvestors-whoholds-consensus>
                  컨센서스 {formatPercent(result.enhanced.equity_score, { digits: 0 })} · {formatInteger(result.enhanced.equity_holders)}/{formatInteger(result.enhanced.total_holders)}
                </Pill>
              ) : (
                <Pill>보유 {formatInteger(result.holdersCount)}명</Pill>
              )}
            </div>
            <dl className="sup-whoholds-facts">
              <div><dt>보유 투자자</dt><dd className="tabular-nums">{formatInteger(result.holderCount)}명</dd></div>
              <div><dt>신규</dt><dd className="tabular-nums sup-up">{newPositions ? formatInteger(result.newCount) : "—"}</dd></div>
              <div><dt>증가</dt><dd className="tabular-nums sup-up">{result.pressure ? formatInteger(result.pressure.net_buyers) : "—"}</dd></div>
              <div><dt>감소</dt><dd className="tabular-nums sup-dn">{result.pressure ? formatInteger(result.pressure.net_sellers) : "—"}</dd></div>
              <div><dt>TOP10 편입 수</dt><dd className="tabular-nums">{result.top10Count === null ? "—" : formatInteger(result.top10Count)}</dd></div>
            </dl>
            {!compact && result.holders.length > 0 ? (
              <ul className="sup-whoholds-list">
                {result.holders.slice(0, 12).map((h) => (
                  <li
                    key={h.investor}
                    data-superinvestors-whoholds-row
                    data-superinvestors-whoholds-investor={h.investor}
                  >
                    <span className="sup-whoholds-name">{investorDisplayName(summary, h.investor)}</span>
                    <span className="tabular-nums">{formatPercent(h.weight, { digits: 1 })}</span>
                    <span className="tabular-nums sup-mute">{formatCurrencyCompact(h.market_value, "USD")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {!compact && result.holders.length === 0 ? (
              <EmptyState reason="보유자 명단이 없습니다" nextRefresh="다음 분기 공시 반영 후 갱신" />
            ) : null}
          </div>
        ) : emptyResult ? (
          <EmptyState
            reason={`"${committed}" 보유 데이터를 찾지 못했습니다`}
            nextRefresh="티커를 확인한 뒤 다시 검색해 주세요"
          />
        ) : !compact || grand.length > 0 ? (
          <div className="sup-grand">
            {!compact ? (
              <p className="sup-grand-note">검색 전 합산 포트폴리오 상위 종목입니다. 티커를 입력하면 보유자를 보여줍니다.</p>
            ) : null}
            <table className="sup-grand-table">
              <thead>
                <tr>
                  <th scope="col">종목</th>
                  <th scope="col">보유 투자자 수</th>
                  {!compact ? <th scope="col">합산 비중</th> : null}
                  {!compact ? <th scope="col">최대 집중</th> : null}
                </tr>
              </thead>
              <tbody>
                {grand.map((row) => (
                  <tr key={row.ticker} data-superinvestors-grand-row data-superinvestors-grand-ticker={row.ticker}>
                    <th scope="row">
                      <button
                        type="button"
                        className="sup-mono sup-grand-ticker"
                        onClick={() => { setQuery(row.ticker); setCommitted(row.ticker); onTickerChange?.(row.ticker); }}
                      >
                        {row.ticker}
                      </button>
                    </th>
                    <td className="tabular-nums">{formatInteger(row.holders)}명</td>
                    {!compact ? <td className="tabular-nums">{formatPercent(row.totalWeight, { digits: 1 })}</td> : null}
                    {!compact ? <td className="tabular-nums">{formatPercent(row.maxWeight, { digits: 1 })}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <EvidenceRail
        freshness={freshness}
        source="SEC EDGAR 13F"
        asOf={asOf}
        coverage={coverage}
        next="분기 종료 후 최대 45일"
        onRetry={failed ? onRetry : feedsFailed ? retryFeeds : undefined}
        onEvidence={dataReady && !failed ? () => window.open("/data/sec-13f/by_ticker.json", "_blank", "noopener") : undefined}
      />
    </Panel>
  );
}

function coverageOf(quarter: string | null): string {
  return quarter ? `기준 ${quarter} 제출분` : "—";
}
