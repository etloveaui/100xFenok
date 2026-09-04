"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { formatInteger, formatPercent } from "@/lib/format";
import type {
  ByTickerData,
  BuyingPressureData,
  ConsensusData,
  ConvictionEntriesData,
  EnhancedConsensusData,
  NewPositionsData,
  SummaryData,
} from "@/lib/superinvestors/types";
import { loadSignalBuyingPressure, loadSignalNewPositions } from "./signalFeeds";
import WhoHoldsPanel from "./WhoHoldsPanel";
import {
  FOLLOW_ROSTER_SIZE,
  avatarStyleFor,
  buildNewBuyRanks,
  buildPressureRanks,
  initialsOf,
  investorDisplayName,
  selectFollowRoster,
  type NewBuyRank,
  type PressureRank,
} from "./signalData";

type FollowMode = "roster" | "all";

interface SignalPanelProps {
  summary: SummaryData | null;
  consensus: ConsensusData | null;
  enhancedConsensus: EnhancedConsensusData | null;
  byTicker: ByTickerData | null;
  convictionEntries: ConvictionEntriesData | null;
  quarter: string | null;
  asOf: string;
  dataReady: boolean;
  failed: boolean;
  partialFeeds: boolean;
  investorCount: number;
  onRetry: () => void;
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

function HolderAvatars({ ids, total, summary }: { ids: string[]; total: number; summary: SummaryData | null }) {
  const shown = ids.slice(0, 2);
  const rest = total - shown.length;
  return (
    <span className="sup-avatars" aria-hidden="true">
      {shown.map((id) => {
        const style = avatarStyleFor(id);
        return (
          <span
            key={id}
            className="sup-av"
            style={{ background: style.bg, color: style.fg }}
          >
            {initialsOf(investorDisplayName(summary, id))}
          </span>
        );
      })}
      {rest > 0 ? <span className="sup-av sup-av-more">+{formatInteger(rest)}</span> : null}
    </span>
  );
}

function ValueBandLine() {
  return (
    <span className="sup-band-row">
      <span className="sup-mute">밸류 밴드 —</span>
      <span className="sup-epills">
        <span className="sup-epill">단기 —</span>
        <span className="sup-epill">장기 —</span>
      </span>
    </span>
  );
}

function NewBuyRow({ rank, summary }: { rank: NewBuyRank; summary: SummaryData | null }) {
  const names = rank.buyers.slice(0, 2).map((b) => investorDisplayName(summary, b.investor));
  return (
    <div
      className="sup-srow"
      data-superinvestors-signal-row
      data-superinvestors-signal-ticker={rank.ticker}
    >
      <div className="sup-srow-top">
        <span className="sup-mono sup-srow-ticker">{rank.ticker}</span>
        <span className="tabular-nums sup-srow-count">{formatInteger(rank.count)}명</span>
      </div>
      <div className="sup-srow-who">
        <HolderAvatars ids={rank.buyers.map((b) => b.investor)} total={rank.count} summary={summary} />
        <span className="sup-srow-names">{names.join(" · ")}{rank.count > names.length ? " 외" : ""}</span>
      </div>
      <div className="sup-srow-change">
        <span className="sup-mute">평균 비중 변화 {rank.avgWeight === null ? "—" : `+${formatPercent(rank.avgWeight, { digits: 1 })}`}</span>
      </div>
      <ValueBandLine />
    </div>
  );
}

function PressureRow({
  rank,
  kind,
  holdersTotal,
  summary,
}: {
  rank: PressureRank;
  kind: "buy" | "sell";
  holdersTotal: number | null;
  summary: SummaryData | null;
}) {
  const names = rank.holders.slice(0, 2).map((h) => investorDisplayName(summary, h.investor));
  return (
    <div
      className="sup-srow"
      data-superinvestors-signal-row
      data-superinvestors-signal-ticker={rank.ticker}
    >
      <div className="sup-srow-top">
        <span className="sup-mono sup-srow-ticker">{rank.ticker}</span>
        <span className={`tabular-nums sup-srow-count ${kind === "buy" ? "sup-up" : "sup-dn"}`}>
          {formatInteger(rank.count)}명
        </span>
      </div>
      <div className="sup-srow-who">
        {rank.holders.length > 0 ? (
          <>
            <HolderAvatars ids={rank.holders.map((h) => h.investor)} total={rank.holders.length} summary={summary} />
            <span className="sup-srow-names">
              {names.join(" · ")}{rank.holders.length > names.length ? " 외" : ""}
              {holdersTotal !== null ? ` · 총 보유 ${formatInteger(holdersTotal)}명` : ""}
            </span>
          </>
        ) : (
          <span className="sup-mute">보유자 —{holdersTotal !== null ? ` · 총 보유 ${formatInteger(holdersTotal)}명` : ""}</span>
        )}
      </div>
      <div className="sup-srow-change">
        <span className="sup-mute">평균 비중 변화 —</span>
      </div>
      <ValueBandLine />
    </div>
  );
}

// Signal hero: three ranked lists over the loaded 13F feeds. Value band and
// Edge scores have no ticker-level feed on this page, so rows show "—"
// instead of a synthesized number — never fabricated.
export default function SignalPanel({
  summary,
  consensus,
  enhancedConsensus,
  byTicker,
  convictionEntries,
  quarter,
  asOf,
  dataReady,
  failed,
  partialFeeds,
  investorCount,
  onRetry,
}: SignalPanelProps) {
  const [followMode, setFollowMode] = useState<FollowMode>("roster");
  const [attempt, setAttempt] = useState(0);
  const [newPositions, setNewPositions] = useState<NewPositionsData | null | undefined>(undefined);
  const [buyingPressure, setBuyingPressure] = useState<BuyingPressureData | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadSignalNewPositions().then((d) => { if (!cancelled) setNewPositions(d); });
    loadSignalBuyingPressure().then((d) => { if (!cancelled) setBuyingPressure(d); });
    return () => { cancelled = true; };
  }, [attempt]);

  const roster = useMemo(
    () => selectFollowRoster(summary, convictionEntries, byTicker),
    [summary, convictionEntries, byTicker],
  );
  const scope = useMemo(
    () => (followMode === "roster" ? new Set(roster.ids) : null),
    [followMode, roster],
  );
  const topSet = useMemo(() => new Set(roster.ids), [roster]);
  const newBuys = useMemo(() => buildNewBuyRanks(newPositions ?? null, scope, topSet), [newPositions, scope, topSet]);
  const increases = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_buyers", scope, byTicker), [buyingPressure, scope, byTicker]);
  const decreases = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_sellers", scope, byTicker), [buyingPressure, scope, byTicker]);

  const loading = (!dataReady && !failed) || newPositions === undefined || buyingPressure === undefined;
  const feedsFailed = !loading && (newPositions === null || buyingPressure === null);
  const freshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : failed || (newPositions === null && buyingPressure === null) ? "error" : partialFeeds || feedsFailed ? "partial" : "stale";

  function retryFeeds() {
    setNewPositions(undefined);
    setBuyingPressure(undefined);
    setAttempt((n) => n + 1);
  }

  const holdersTotalOf = (ticker: string): number | null => {
    const details = byTicker?.[ticker]?.holder_details;
    if (Array.isArray(details) && details.length > 0) return details.length;
    return consensus?.consensus[ticker]?.holders_count ?? null;
  };

  const rosterNames = roster.ids.map((id) => investorDisplayName(summary, id));
  const newCoverage = followMode === "roster"
    ? `상위 컨빅션 ${formatInteger(roster.ids.length)}명 로스터: ${rosterNames.join(" · ") || "—"}`
    : `전체 ${formatInteger(dataReady ? investorCount : null)}명 기준`;
  const pressureCoverage = followMode === "roster"
    ? `상위 컨빅션 ${formatInteger(roster.ids.length)}명 보유자 기준 컨빅션 가중 순위`
    : `전체 ${formatInteger(dataReady ? investorCount : null)}명 보유자 기준 컨빅션 가중 순위`;

  return (
    <div data-superinvestors-signal>
      <div className="sup-follow-row">
        <span className="sup-follow-label">팔로우</span>
        <div className="sup-follow-toggle" role="group" aria-label="따라가기 범위">
          <button
            type="button"
            data-superinvestors-follow="roster"
            aria-pressed={followMode === "roster"}
            className={`sup-follow-btn${followMode === "roster" ? " on" : ""}`}
            onClick={() => setFollowMode("roster")}
          >
            상위 컨빅션 {formatInteger(FOLLOW_ROSTER_SIZE)}명
          </button>
          <button
            type="button"
            data-superinvestors-follow="all"
            aria-pressed={followMode === "all"}
            className={`sup-follow-btn${followMode === "all" ? " on" : ""}`}
            onClick={() => setFollowMode("all")}
          >
            전체 {formatInteger(dataReady ? investorCount : null)}명
          </button>
        </div>
      </div>

      <div className="sup-signal-grid">
        <Panel
          loading={loading}
          error={!loading && (failed || newPositions === null)}
          errorDetail="신규 매수 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || newPositions === null) ? (failed ? onRetry : retryFeeds) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="new">
            <PanelHeader eyebrow="New buys" title="신규 매수 상위" right={<Pill>신규</Pill>} />
            {newBuys.length > 0 ? (
              newBuys.map((rank) => (
                <NewBuyRow key={rank.ticker} rank={rank} summary={summary} />
              ))
            ) : !loading && !failed && newPositions !== null ? (
              <EmptyState reason="표시할 신규 매수 종목이 없습니다" nextRefresh="다음 분기 공시 반영 후 갱신" />
            ) : null}
          </div>
          <EvidenceRail
            freshness={freshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={newCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={failed ? onRetry : feedsFailed ? retryFeeds : undefined}
            onEvidence={dataReady && !failed && newPositions ? () => openEvidence("/data/sec-13f/analytics/new_positions.json") : undefined}
          />
        </Panel>

        <Panel
          loading={loading}
          error={!loading && (failed || buyingPressure === null)}
          errorDetail="증가 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || buyingPressure === null) ? (failed ? onRetry : retryFeeds) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="increased">
            <PanelHeader eyebrow="Increases" title="증가 상위" right={<Pill>증가</Pill>} />
            {increases.length > 0 ? (
              increases.map((rank) => (
                <PressureRow key={rank.ticker} rank={rank} kind="buy" holdersTotal={holdersTotalOf(rank.ticker)} summary={summary} />
              ))
            ) : !loading && !failed && buyingPressure !== null ? (
              <EmptyState reason="표시할 증가 상위 종목이 없습니다" nextRefresh="다음 분기 공시 반영 후 갱신" />
            ) : null}
          </div>
          <EvidenceRail
            freshness={freshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={pressureCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={failed ? onRetry : feedsFailed ? retryFeeds : undefined}
            onEvidence={dataReady && !failed && buyingPressure ? () => openEvidence("/data/sec-13f/analytics/buying_pressure.json") : undefined}
          />
        </Panel>

        <Panel
          loading={loading}
          error={!loading && (failed || buyingPressure === null)}
          errorDetail="감소 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || buyingPressure === null) ? (failed ? onRetry : retryFeeds) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="decreased">
            <PanelHeader eyebrow="Decreases" title="감소 상위" right={<Pill>감소</Pill>} />
            {decreases.length > 0 ? (
              decreases.map((rank) => (
                <PressureRow key={rank.ticker} rank={rank} kind="sell" holdersTotal={holdersTotalOf(rank.ticker)} summary={summary} />
              ))
            ) : !loading && !failed && buyingPressure !== null ? (
              <EmptyState reason="표시할 감소 상위 종목이 없습니다" nextRefresh="다음 분기 공시 반영 후 갱신" />
            ) : null}
          </div>
          <EvidenceRail
            freshness={freshness}
            source="SEC EDGAR 13F"
            asOf={asOf}
            coverage={pressureCoverage}
            next="분기 종료 후 최대 45일"
            onRetry={failed ? onRetry : feedsFailed ? retryFeeds : undefined}
            onEvidence={dataReady && !failed && buyingPressure ? () => openEvidence("/data/sec-13f/analytics/buying_pressure.json") : undefined}
          />
        </Panel>

        <WhoHoldsPanel
          summary={summary}
          consensus={consensus}
          enhancedConsensus={enhancedConsensus}
          byTicker={byTicker}
          quarter={quarter}
          asOf={asOf}
          dataReady={dataReady}
          failed={failed}
          partialFeeds={partialFeeds}
          onRetry={onRetry}
          compact
        />
      </div>
    </div>
  );
}
