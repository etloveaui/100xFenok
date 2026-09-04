"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { formatInteger } from "@/lib/format";
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
        <span className="sup-mute">신규 편입 · 비교 기준 없음</span>
      </div>
      <ValueBandLine />
    </div>
  );
}

function PressureRow({
  rank,
  kind,
  holdersTotal,
}: {
  rank: PressureRank;
  kind: "buy" | "sell";
  holdersTotal: number | null;
}) {
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
        <span className="sup-av sup-av-unknown" aria-hidden="true">?</span>
        <span className="sup-mute">
          명단 —{holdersTotal !== null ? ` · 총 보유 ${formatInteger(holdersTotal)}명` : ""}
        </span>
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
  const newBuys = useMemo(() => buildNewBuyRanks(newPositions ?? null, scope), [newPositions, scope]);
  const increases = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_buyers"), [buyingPressure]);
  const exits = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_sellers"), [buyingPressure]);

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
  const pressureCoverage = "전체 코호트 순매수·순매도 집계 (보유자별 가중치 미제공)";

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
                <PressureRow key={rank.ticker} rank={rank} kind="buy" holdersTotal={holdersTotalOf(rank.ticker)} />
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
          errorDetail="청산 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || buyingPressure === null) ? (failed ? onRetry : retryFeeds) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="exited">
            <PanelHeader eyebrow="Exits" title="청산 상위" right={<Pill>청산</Pill>} />
            {exits.length > 0 ? (
              exits.map((rank) => (
                <PressureRow key={rank.ticker} rank={rank} kind="sell" holdersTotal={holdersTotalOf(rank.ticker)} />
              ))
            ) : !loading && !failed && buyingPressure !== null ? (
              <EmptyState reason="13F 확정 대기" nextRefresh="다음 분기 공시 반영 후 갱신" />
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
