"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import PerBandBar from "@/components/screener/PerBandBar";
import { formatCurrencyCompact, formatInteger, formatPercent } from "@/lib/format";
import type {
  ByTickerData,
  ConsensusData,
  EnhancedConsensusData,
  SummaryData,
} from "@/lib/superinvestors/types";
import { buildGrandPortfolio, investorDisplayName } from "./signalData";
import type { InvestorSignalFeedState } from "./useInvestorTabData";

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
  signalFeeds: InvestorSignalFeedState;
  onRetrySignal: () => void;
  initialTicker?: string | null;
  onTickerChange?: (ticker: string) => void;
  compact?: boolean;
}

function normalizeTickerInput(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function formatWeightDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%p`;
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
  signalFeeds,
  onRetrySignal,
  initialTicker = null,
  onTickerChange,
  compact = false,
}: WhoHoldsPanelProps) {
  const normalizedInitialTicker = normalizeTickerInput(initialTicker ?? "");
  const [query, setQuery] = useState(normalizedInitialTicker);
  const [committed, setCommitted] = useState<string | null>(normalizedInitialTicker || null);

  const newPositions = signalFeeds.newPositions.status === "not-requested" || signalFeeds.newPositions.status === "loading"
    ? undefined
    : signalFeeds.newPositions.data;
  const buyingPressure = signalFeeds.buyingPressure.status === "not-requested" || signalFeeds.buyingPressure.status === "loading"
    ? undefined
    : signalFeeds.buyingPressure.data;
  const conviction = signalFeeds.conviction.status === "not-requested" || signalFeeds.conviction.status === "loading"
    ? undefined
    : signalFeeds.conviction.data;
  const tickerEvidence = signalFeeds.tickerEvidence.status === "not-requested" || signalFeeds.tickerEvidence.status === "loading"
    ? undefined
    : signalFeeds.tickerEvidence.data;
  const perBands = signalFeeds.perBands.status === "not-requested" || signalFeeds.perBands.status === "loading"
    ? undefined
    : signalFeeds.perBands.data;

  useEffect(() => {
    setQuery(normalizedInitialTicker);
    setCommitted(normalizedInitialTicker || null);
  }, [normalizedInitialTicker]);

  const tickers = useMemo(() => {
    const set = new Set<string>();
    if (consensus) for (const key of Object.keys(consensus.consensus)) set.add(key);
    if (byTicker) for (const key of Object.keys(byTicker)) set.add(key);
    if (tickerEvidence?.holding_changes) {
      for (const [ticker, change] of Object.entries(tickerEvidence.holding_changes)) {
        if (change.held_count > 0) set.add(ticker);
      }
    }
    return [...set].sort();
  }, [consensus, byTicker, tickerEvidence]);

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
    const change = tickerEvidence?.holding_changes?.[committed] ?? null;
    const details = entry && Array.isArray(entry.holder_details) ? entry.holder_details : [];
    const holders = [...details].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1));
    const holderCount = change
      ? change.held_count
      : holders.length > 0
      ? holders.length
      : (Array.isArray(entry?.holders) ? entry.holders.length : (consensusRow?.holders_count ?? 0));
    if (holderCount === 0 && !consensusRow && !entry && !change) return null;
    const pressure = buyingPressure?.buying_pressure[committed] ?? null;
    let newCount = change?.new_count ?? 0;
    if (!change && newPositions) {
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
    const band = perBands?.rows.get(committed) ?? null;
    return { holders, holderCount, pressure, newCount, top10Count, enhanced, change, band, holdersCount: consensusRow?.holders_count ?? holderCount };
  }, [committed, dataReady, byTicker, consensus, buyingPressure, newPositions, conviction, enhancedConsensus, tickerEvidence, perBands]);

  const grand = useMemo(() => buildGrandPortfolio(byTicker, compact ? 3 : 10), [byTicker, compact]);
  const loading = (!dataReady && !failed) || newPositions === undefined || buyingPressure === undefined || conviction === undefined;
  const feedsFailed = !loading && [signalFeeds.newPositions, signalFeeds.buyingPressure, signalFeeds.conviction, signalFeeds.tickerEvidence, signalFeeds.perBands]
    .some((feed) => feed.status === "error" || feed.status === "unavailable");
  const freshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : failed || (newPositions === null && buyingPressure === null && conviction === null) ? "error" : partialFeeds || feedsFailed ? "partial" : "stale";
  const emptyResult = committed !== null && dataReady && result === null && !loading;

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
    ? `${result.holderCount > 0 ? "보유" : "13F 근거 연결"} ${formatInteger(result.holderCount)}명`
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
            <dl
              className="sup-whoholds-facts"
              data-superinvestors-holding-evidence={result.change ? committed : undefined}
            >
              <div><dt>{result.holderCount > 0 ? "보유 투자자" : "13F 근거 연결"}</dt><dd className="tabular-nums">{formatInteger(result.holderCount)}명</dd></div>
              <div><dt>신규</dt><dd className="tabular-nums sup-up">{result.change || newPositions ? `${formatInteger(result.newCount)}명` : "—"}</dd></div>
              <div><dt>{result.change ? "비중확대" : "주식수 증가 투자자"}</dt><dd className="tabular-nums sup-up">{result.change ? `${formatInteger(result.change.increased_count)}명` : result.pressure ? `${formatInteger(result.pressure.net_buyers)}명` : "—"}</dd></div>
              <div><dt>{result.change ? "비중축소" : "주식수 감소 투자자"}</dt><dd className="tabular-nums sup-dn">{result.change ? `${formatInteger(result.change.decreased_count)}명` : result.pressure ? `${formatInteger(result.pressure.net_sellers)}명` : "—"}</dd></div>
              {result.change ? <div><dt>평균 비중 변화</dt><dd className="tabular-nums">{formatWeightDelta(result.change.mean_weight_delta)}</dd></div> : null}
              {result.change ? <div><dt>비교 가능</dt><dd className="tabular-nums">{formatInteger(result.change.comparable_count)}명</dd></div> : null}
              {result.change ? <div><dt>청산</dt><dd className="tabular-nums sup-dn">{formatInteger(result.change.sold_count)}명</dd></div> : null}
              <div><dt>TOP10 편입 수</dt><dd className="tabular-nums">{result.top10Count === null ? "—" : formatInteger(result.top10Count)}</dd></div>
            </dl>
            {result.band ? (
              <div
                className="mt-3 border-t border-[var(--c-line-2)] pt-3"
                data-superinvestors-per-band={committed}
                data-source-date={perBands?.sourceDate ?? ""}
                title={perBands?.sourceDate ? `PER 원천 ${perBands.sourceDate.slice(0, 10)}` : "PER 원천일 미제공"}
              >
                <div className="mb-1 text-[10px] font-bold text-[var(--c-ink-3)]">PER 밴드 · 원천 {perBands?.sourceDate?.slice(0, 10) ?? "—"}</div>
                <PerBandBar current={result.band.current} min={result.band.min} avg={result.band.avg} max={result.band.max} />
              </div>
            ) : null}
            {result.change ? (
              <p className="mt-2 text-[10px] leading-snug text-[var(--c-ink-3)]">
                {result.change.current_quarter} ↔ {result.change.previous_quarter} 공개 보유 목록 비교 · 신규·청산은 직전 분기 공개 보유 목록과 비교한 결과입니다. 공시 반영은 분기말 이후 최대 45일 지연될 수 있습니다.
              </p>
            ) : null}
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
        onRetry={failed ? onRetry : feedsFailed ? onRetrySignal : undefined}
        onEvidence={dataReady && !failed ? () => window.open("/data/sec-13f/by_ticker.json", "_blank", "noopener") : undefined}
      />
    </Panel>
  );
}

function coverageOf(quarter: string | null): string {
  return quarter ? `기준 ${quarter} 제출분` : "—";
}
