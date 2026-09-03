"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { fetch13FJson, use13FData, useInvestorDetail } from "@/hooks/use13FData";
import { Button, EmptyState, EvidenceRail, Panel, PanelHeader, Pill, Row } from "@/components/ui";
import {
  formatCurrencyCompact,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import type {
  ConsensusTicker,
  SummaryInvestor,
  TurnoverData,
} from "@/lib/superinvestors/types";
import { buildGraphNetwork } from "./graphNetwork";
import GraphNetworkPanel, { GraphNetworkTeaser } from "./GraphNetworkPanel";

type HolderSort = "aum" | "holdings" | "change";

const HOLDER_SORTS: Array<{ key: HolderSort; label: string }> = [
  { key: "aum", label: "AUM 순" },
  { key: "holdings", label: "보유종목 순" },
  { key: "change", label: "변화율 순" },
];

// Turnover is shaped in the client (never in use13FData — window-2 owns that
// hook). One bulk fetch covers the Holders "분기 변화" column for all rows.
let turnoverCache: TurnoverData["by_investor"] | null | undefined;
let turnoverPromise: Promise<TurnoverData["by_investor"] | null> | null = null;

function loadTurnoverLocal(): Promise<TurnoverData["by_investor"] | null> {
  if (turnoverCache !== undefined) return Promise.resolve(turnoverCache);
  if (turnoverPromise) return turnoverPromise;
  turnoverPromise = fetch13FJson<TurnoverData>("/data/sec-13f/analytics/turnover.json").then((data) => {
    turnoverCache = data?.by_investor ?? null;
    return turnoverCache;
  }, (error) => {
    // A rejected fetch must not pin the module slot: clear it so a manual
    // retry can issue a fresh request instead of replaying the rejection.
    turnoverPromise = null;
    throw error;
  });
  return turnoverPromise;
}

function reload() {
  window.location.reload();
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

function syncGuruParam(guru: string | null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (guru) params.set("guru", guru);
  else params.delete("guru");
  const queryString = params.toString();
  const nextUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) window.history.replaceState(window.history.state, "", nextUrl);
}

function sortConsensusByHolders(rows: ConsensusTicker[]): ConsensusTicker[] {
  return [...rows].sort((a, b) => {
    if (a.holders_count !== b.holders_count) return b.holders_count - a.holders_count;
    return a.ticker.localeCompare(b.ticker);
  });
}

function HolderDetail({ id }: { id: string }) {
  const { data, loading, status } = useInvestorDetail(id);
  const latest = data?.investor?.filings?.[data.investor.filings.length - 1] ?? null;
  const topRows = useMemo(() => {
    if (!latest) return [];
    const byTicker = new Map<string, { ticker: string; weight: number; market_value: number }>();
    for (const h of latest.holdings ?? []) {
      if (!h.ticker) continue;
      const cur = byTicker.get(h.ticker);
      if (cur) {
        cur.weight += h.weight || 0;
        cur.market_value += h.market_value || 0;
      } else {
        byTicker.set(h.ticker, { ticker: h.ticker, weight: h.weight || 0, market_value: h.market_value || 0 });
      }
    }
    return [...byTicker.values()].sort((a, b) => b.weight - a.weight).slice(0, 5);
  }, [latest]);

  if (loading) {
    return <p className="sup-detail-note" role="status">최신 공시 상세를 불러오는 중입니다…</p>;
  }
  if (status === "private") {
    return <p className="sup-detail-note">상세 데이터는 비공개입니다. 요약 정보는 공개 범위에서 제공합니다.</p>;
  }
  if (!latest) {
    return <p className="sup-detail-note">상세 데이터를 불러오지 못했습니다. 다른 투자자를 선택해 주세요.</p>;
  }

  return (
    <div className="sup-detail">
      <dl className="sup-detail-facts">
        <div><dt>기준 분기</dt><dd className="tabular-nums">{latest.quarter}</dd></div>
        <div><dt>보고 기준일</dt><dd className="tabular-nums">{latest.report_date}</dd></div>
        <div><dt>공시일</dt><dd className="tabular-nums">{latest.filing_date}</dd></div>
        <div><dt>운용 자산</dt><dd className="tabular-nums">{formatCurrencyCompact(latest.aum_total, "USD")}</dd></div>
        <div><dt>보유 종목</dt><dd className="tabular-nums">{formatInteger(latest.holdings_count)}개</dd></div>
        <div><dt>TOP 10 비중</dt><dd className="tabular-nums">{formatPercent(latest.top_10_weight, { digits: 1 })}</dd></div>
      </dl>
      {topRows.length > 0 ? (
        <ul className="sup-detail-tops">
          {topRows.map((row) => (
            <li key={row.ticker} data-superinvestors-holder-top-row={row.ticker}>
              <span className="sup-mono">{row.ticker}</span>
              <span className="tabular-nums">{formatPercent(row.weight, { digits: 1 })}</span>
              <span className="tabular-nums sup-mute">{formatCurrencyCompact(row.market_value, "USD")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function SuperinvestorsClient({ initialGuru = null }: { initialGuru?: string | null }) {
  const {
    consensus,
    enhancedConsensus,
    summary,
    byTicker,
    dataReady,
    failed,
    quarter,
    excludedStale,
    failedRequests,
    retry,
  } = use13FData();
  const [sort, setSort] = useState<HolderSort>("aum");
  const [expandedGuru, setExpandedGuru] = useState<string | null>(initialGuru);
  const [turnover, setTurnover] = useState<TurnoverData["by_investor"] | null | undefined>(undefined);
  const [turnoverError, setTurnoverError] = useState(false);

  useEffect(() => {
    setExpandedGuru(initialGuru);
  }, [initialGuru]);

  useEffect(() => {
    let cancelled = false;
    loadTurnoverLocal().then(
      (map) => {
        if (!cancelled) {
          setTurnover(map);
          setTurnoverError(false);
        }
      },
      () => {
        // Turnover shapes only the "분기 변화" column: a fetch rejection is
        // an error state on the Holders rail, never a silent pending cell.
        if (!cancelled) {
          setTurnover(null);
          setTurnoverError(true);
        }
      },
    );
    return () => { cancelled = true; };
  }, []);

  function retryTurnover() {
    setTurnoverError(false);
    setTurnover(undefined);
    loadTurnoverLocal().then(
      (map) => {
        setTurnover(map);
      },
      () => {
        setTurnover(null);
        setTurnoverError(true);
      },
    );
  }

  const investors = useMemo<[string, SummaryInvestor][]>(
    () => (summary ? Object.entries(summary.investors) : []),
    [summary],
  );

  // Per-investor top holding: max within-investor weight across by_ticker
  // holder_details. Falls back to summary top5[0] (ticker only, no weight).
  const topHoldings = useMemo(() => {
    const map = new Map<string, { ticker: string; weight: number }>();
    if (!byTicker) return map;
    for (const [ticker, entry] of Object.entries(byTicker)) {
      if (!entry || !Array.isArray(entry.holder_details)) continue;
      for (const h of entry.holder_details) {
        if (!h || typeof h.investor !== "string") continue;
        const w = typeof h.weight === "number" && Number.isFinite(h.weight) ? h.weight : null;
        if (w === null) continue;
        const cur = map.get(h.investor);
        if (!cur || w > cur.weight) map.set(h.investor, { ticker, weight: w });
      }
    }
    return map;
  }, [byTicker]);

  const sortedInvestors = useMemo(() => {
    const rows = [...investors];
    if (sort === "aum") rows.sort(([, a], [, b]) => (b.aum ?? -1) - (a.aum ?? -1));
    else if (sort === "holdings") rows.sort(([, a], [, b]) => (b.holdings_count ?? -1) - (a.holdings_count ?? -1));
    else {
      rows.sort(([a], [b]) => (turnover?.[b]?.turnover ?? -1) - (turnover?.[a]?.turnover ?? -1));
    }
    if (expandedGuru) {
      rows.sort(([a], [b]) => {
        if (a === expandedGuru) return -1;
        if (b === expandedGuru) return 1;
        return 0;
      });
    }
    return rows;
  }, [investors, sort, turnover, expandedGuru]);

  const overlapRows = useMemo(() => {
    if (!consensus) return [];
    return sortConsensusByHolders(Object.values(consensus.consensus)).slice(0, 4);
  }, [consensus]);

  const loading = !dataReady && !failed;
  const investorCount =
    consensus?.metadata?.current_cohort_investors ??
    summary?.metadata?.investor_count ??
    summary?.metadata?.total_investors ??
    investors.length;
  const totalTracked =
    consensus?.metadata?.total_investors ??
    summary?.metadata?.investor_count ??
    summary?.metadata?.total_investors ??
    investors.length;
  const coverage = dataReady ? `${formatInteger(investorCount)}/${formatInteger(totalTracked)} 투자자` : "—";
  const turnoverCovered = turnover ? Object.keys(turnover).length : 0;
  const holdersCoverage =
    turnoverError
      ? `${coverage} · 회전율 확인 불가`
      : turnover !== undefined && turnoverCovered > 0
        ? `${coverage} · 회전율 ${formatInteger(turnoverCovered)}명`
        : coverage;
  // 13F filings land up to 45 days after quarter end: the quarter label names
  // the cohort, never a fresh as-of. Rails carry the real build clock when the
  // summary stamps one, else the true quarter as-of — always stale, never
  // fresh from the quarter label alone.
  const generatedClock = summary?.metadata?.generated_at?.slice(0, 10) ?? null;
  const asOfLabel = generatedClock ?? quarter ?? "—";
  const partialFeeds = failedRequests.length > 0;

  const holdersFailed = !loading && summary === null && failedRequests.includes("summary");
  const overlapFailed = !loading && consensus === null && failedRequests.includes("consensus");
  const holdersEmpty = !loading && !holdersFailed && dataReady && sortedInvestors.length === 0;
  const overlapEmpty = !loading && !overlapFailed && dataReady && overlapRows.length === 0;
  const holdersFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : holdersFailed ? "error" : partialFeeds || excludedStale.length > 0 || turnoverError ? "partial" : "stale";
  const overlapFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : overlapFailed ? "error" : partialFeeds || excludedStale.length > 0 ? "partial" : "stale";

  const [selectedGraphTicker, setSelectedGraphTicker] = useState<string | null>(null);
  const graphNetwork = useMemo(
    () => buildGraphNetwork({ summary, byTicker, excludedStale, failedRequests }),
    [summary, byTicker, excludedStale, failedRequests],
  );
  const graphFailed = !loading && byTicker === null && graphNetwork.edges.length === 0 && failedRequests.includes("by_ticker");
  const graphReady = !loading && !graphFailed && (byTicker !== null || graphNetwork.edges.length > 0);
  const graphFreshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : graphFailed ? "error" : partialFeeds || excludedStale.length > 0 ? "partial" : "stale";
  const graphCoverage = graphReady
    ? `투자자 ${formatInteger(graphNetwork.investorCount)}${graphNetwork.totalInvestors !== null ? `/${formatInteger(graphNetwork.totalInvestors)}` : ""}명 · 종목 ${formatInteger(graphNetwork.tickerCount)}/${formatInteger(graphNetwork.totalTickers)} 연결`
    : coverage;
  function openGraphEvidence() {
    openEvidence("/data/sec-13f/summary.json");
    openEvidence("/data/sec-13f/by_ticker.json");
  }

  function toggleGuru(id: string) {
    setExpandedGuru((cur) => {
      const next = cur === id ? null : id;
      syncGuruParam(next);
      return next;
    });
  }

  return (
    <div className="sup" data-superinvestors-surface>
      <div className="sup-head">
        <div className="sup-title-block">
          <div className="sup-eyebrow-row">
            <span className="sup-eyebrow" data-superinvestors-eyebrow>
              SUPERINVESTORS · 13F {quarter ?? "분기 확인 중"}
            </span>
            <Pill data-superinvestors-count>투자자 {formatInteger(dataReady ? investorCount : null)}명</Pill>
          </div>
          <h1 className="sup-title">
            {loading ? "투자자 데이터를 불러오는 중입니다." : failed ? "투자자 데이터를 불러오지 못했습니다. 다시 시도해 주세요." : (
              <>거장 <b className="tabular-nums">{formatInteger(investorCount)}</b>명의 보유·매매를 한 화면에서 비교합니다</>
            )}
          </h1>
          <div className="sup-meta-row">
            <Pill data-superinvestors-quarter>기준 {quarter ?? "—"} 제출분</Pill>
            {excludedStale.length > 0 ? <Pill tone="warn">최신 분기 제외 {excludedStale.length}명</Pill> : null}
            {!failed && partialFeeds ? <Pill tone="warn">일부 피드 {failedRequests.length}개 미반영</Pill> : null}
            {!failed && !partialFeeds && turnoverError ? <Pill tone="warn">회전율 확인 불가</Pill> : null}
            {failed ? <Button variant="secondary" onClick={reload}>다시 시도</Button> : null}
          </div>
        </div>
      </div>

      <div className="sup-grid">
        <Panel
          loading={loading}
          empty={holdersEmpty}
          emptyReason="표시할 투자자가 없습니다"
          emptyNextRefresh="다음 분기 공시 반영 후 갱신"
          error={holdersFailed}
          errorDetail="투자자 목록을 불러오지 못했습니다."
          onRetry={holdersFailed ? retry : undefined}
          retryLabel="다시 시도"
        >
          {dataReady && sortedInvestors.length > 0 && (
            <div data-superinvestors-holders data-superinvestors-holders-count={sortedInvestors.length}>
              <PanelHeader
                eyebrow="Holders"
                title="투자자 목록"
                right={(
                  <div className="sup-sort-toggle" data-superinvestors-sort-toggle role="group" aria-label="투자자 정렬 기준">
                    {HOLDER_SORTS.map((item) => (
                      <Button
                        key={item.key}
                        type="button"
                        variant="tab"
                        active={sort === item.key}
                        aria-pressed={sort === item.key}
                        data-superinvestors-sort={item.key}
                        className="sup-sort-btn"
                        onClick={() => setSort(item.key)}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                )}
              />
              <div className="sup-hold-scroll scroll-hint-x" role="region" tabIndex={0} aria-label="투자자 목록 표 가로 스크롤">
                <table className="sup-hold-table">
                  <thead>
                    <tr>
                      <th scope="col" className="sup-th-name">투자자</th>
                      <th scope="col">AUM</th>
                      <th scope="col">보유종목</th>
                      <th scope="col">최대 비중</th>
                      <th scope="col">분기 변화</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInvestors.map(([id, inv]) => {
                      const isOpen = expandedGuru === id;
                      const top = topHoldings.get(id);
                      const topTicker = top?.ticker ?? inv.top5?.[0] ?? null;
                      const change = turnover?.[id] ?? null;
                      const changeValue = change && typeof change.turnover === "number" && Number.isFinite(change.turnover)
                        ? formatPercent(change.turnover, { digits: 1 })
                        : change
                          ? `신규 ${formatInteger(change.new_count)} · 청산 ${formatInteger(change.sold_count)}`
                          : "—";
                      return (
                        <Fragment key={id}>
                          <tr
                            className="sup-hold-row"
                            data-superinvestors-holder-row
                            data-superinvestors-holder-id={id}
                            data-superinvestors-holder-expanded={isOpen ? "true" : "false"}
                          >
                            <th scope="row" className="sup-holder-name-cell">
                              <button
                                type="button"
                                className="sup-holder-name"
                                aria-expanded={isOpen}
                                onClick={() => toggleGuru(id)}
                              >
                                <span className="sup-holder-name-text">{inv.name}</span>
                                <span className="sup-holder-sub">
                                  {inv.group}
                                  {inv.is_stale ? <span className="sup-stale-badge">지연</span> : null}
                                </span>
                              </button>
                            </th>
                            <td className="tabular-nums">{formatCurrencyCompact(inv.aum, "USD")}</td>
                            <td className="tabular-nums">{formatInteger(inv.holdings_count)}개</td>
                            <td>
                              {topTicker ? (
                                <span className="sup-top">
                                  <span className="sup-mono">{topTicker}</span>
                                  <span className="tabular-nums">{top ? formatPercent(top.weight, { digits: 1 }) : "—"}</span>
                                </span>
                              ) : (
                                <span className="sup-mute">—</span>
                              )}
                            </td>
                            <td
                              className="tabular-nums"
                              title={change ? `신규 ${change.new_count} · 청산 ${change.sold_count} · ${change.total_positions}포지션` : undefined}
                            >
                              {changeValue}
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr key={`${id}-detail`} className="sup-detail-row">
                              <td colSpan={5} data-superinvestors-holder-detail data-superinvestors-holder-detail-id={id}>
                                <HolderDetail id={id} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <EvidenceRail
            freshness={holdersFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={holdersCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={failed ? reload : partialFeeds ? retry : turnoverError ? retryTurnover : undefined}
            onEvidence={dataReady && !failed ? () => openEvidence("/data/sec-13f/summary.json") : undefined}
          />
        </Panel>

        <div className="sup-rail">
          <Panel
            loading={loading}
            empty={overlapEmpty}
            emptyReason="표시할 공통 보유 종목이 없습니다"
            emptyNextRefresh="다음 분기 공시 반영 후 갱신"
            error={overlapFailed}
            errorDetail="공통 보유 종목을 불러오지 못했습니다."
            onRetry={overlapFailed ? retry : undefined}
            retryLabel="다시 시도"
          >
            {dataReady && overlapRows.length > 0 && (
              <div data-superinvestors-overlap data-superinvestors-overlap-count={overlapRows.length}>
                <PanelHeader
                  eyebrow="Overlap"
                  title="공통 보유"
                  right={<span className="sup-head-note">가장 많이 겹치는 종목</span>}
                />
                {overlapRows.map((row) => {
                  const enhanced = enhancedConsensus?.enhanced_consensus?.[row.ticker];
                  return (
                    <Row
                      key={row.ticker}
                      data-superinvestors-overlap-row
                      data-superinvestors-overlap-ticker={row.ticker}
                      data-superinvestors-overlap-holders={row.holders_count}
                    >
                      <span className="sup-mono sup-ticker-strong">{row.ticker}</span>
                      <span className="sup-olap-holders">
                        <b className="tabular-nums">{formatInteger(row.holders_count)}명</b>
                        {enhanced ? (
                          <span className="sup-mute tabular-nums">주식 {enhanced.equity_holders}/{enhanced.total_holders}</span>
                        ) : null}
                      </span>
                      <span className="tabular-nums sup-olap-score">
                        {enhanced ? formatPercent(enhanced.equity_score, { digits: 0 }) : "—"}
                      </span>
                    </Row>
                  );
                })}
              </div>
            )}
            <EvidenceRail
              freshness={overlapFreshness}
              source="SEC EDGAR 13F"
              asOf={asOfLabel}
              coverage={coverage}
              next="분기 종료 후 최대 45일"
              onRetry={failed ? reload : partialFeeds ? retry : undefined}
              onEvidence={dataReady && !failed ? () => openEvidence("/data/sec-13f/analytics/consensus.json") : undefined}
            />
          </Panel>

          <GraphNetworkTeaser
            network={graphNetwork}
            href="#superinvestors-graph-full"
            status={loading ? "pending" : graphFailed ? "error" : "ready"}
            freshness={graphFreshness}
            source="SEC EDGAR 13F"
            asOf={asOfLabel}
            coverage={graphCoverage}
            onRetry={graphFailed || (graphReady && partialFeeds) ? retry : undefined}
            onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
          />
        </div>
      </div>

      <section className="sup-graph-full" id="superinvestors-graph-full" aria-label="투자자 종목 연결 그래프">
        {graphFailed ? (
          <Panel
            error
            errorDetail="종목별 보유 피드를 불러오지 못했습니다."
            asOf={asOfLabel}
            onRetry={retry}
            retryLabel="다시 시도"
          >
            <div data-superinvestors-graph>
              <PanelHeader eyebrow="Graph Network" title="누가 무엇을 함께 들고 있나" />
              <EvidenceRail
                freshness="error"
                source="SEC EDGAR 13F"
                asOf={asOfLabel}
                coverage="—"
                onRetry={retry}
                onEvidence={dataReady && !failed ? openGraphEvidence : undefined}
              />
            </div>
          </Panel>
        ) : graphReady ? (
          <GraphNetworkPanel
            network={graphNetwork}
            selectedTicker={selectedGraphTicker}
            onSelectTicker={setSelectedGraphTicker}
            rail={{
              freshness: graphFreshness,
              source: "SEC EDGAR 13F",
              asOf: asOfLabel,
              coverage: graphCoverage,
              onRetry: failed ? reload : partialFeeds ? retry : undefined,
              onEvidence: dataReady && !failed ? openGraphEvidence : undefined,
            }}
          />
        ) : (
          <Panel>
            <div data-superinvestors-graph>
              <PanelHeader eyebrow="Graph Network" title="누가 무엇을 함께 들고 있나" />
              <EmptyState
                reason="그래프 데이터를 불러오는 중입니다"
                nextRefresh="잠시 후 다시 확인해 주세요"
              />
              <EvidenceRail
                freshness="pending"
                source="SEC EDGAR 13F"
                asOf={asOfLabel}
                coverage="—"
              />
            </div>
          </Panel>
        )}
      </section>

      <div className="sup-cta">
        <span className="sup-cta-note">13F 공시 기반 장기 보유 포지션만 집계합니다. 공시는 최대 45일 늦게 반영됩니다.</span>
        <span className="sup-cta-note sup-mute">투자 조언 아님 · 데이터 지연 가능</span>
      </div>
    </div>
  );
}
