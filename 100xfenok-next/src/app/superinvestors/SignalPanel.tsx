"use client";

import { useMemo, useState } from "react";
import { EmptyState, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import PerBandBar from "@/components/screener/PerBandBar";
import type { PerBandRecord } from "@/features/stock-analyzer/data/per-band-provider";
import { formatInteger, formatPercent } from "@/lib/format";
import { ROUTES } from "@/lib/routes";
import { currentJourneyReturnTo } from "@/lib/journey-context";
import type {
  ByTickerData,
  ConsensusData,
  ConvictionEntriesData,
  EnhancedConsensusData,
  HoldingChangeSummary,
  SummaryData,
} from "@/lib/superinvestors/types";
import type { SignalScoreData } from "./signalFeeds";
import type { InvestorSignalFeedState } from "./useInvestorTabData";
import WhoHoldsPanel from "./WhoHoldsPanel";
import {
  FOLLOW_ROSTER_SIZE,
  MIN_TOP_BUYERS,
  avatarStyleFor,
  buildNewBuyRanks,
  buildPressureRanks,
  initialsOf,
  investorDisplayName,
  selectFollowRoster,
  VISIBLE_MIN_TOP_BUYERS,
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
  investorCount: number | null;
  returnTo?: string | null;
  onRetry: () => void;
  signalFeeds: InvestorSignalFeedState;
  onRetrySignal: () => void;
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

function fmtWeightDelta(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%p`;
}

function ValueBandLine({
  score,
  band,
  perBandSourceDate,
}: {
  score?: SignalScoreData;
  band?: PerBandRecord | null;
  perBandSourceDate?: string | null;
}) {
  const short = score?.shortTermScore ?? null;
  const long = score?.longTermScore ?? null;
  const scoreAsOf = score?.asOf ?? null;
  const scoreTitle = scoreAsOf ? `FENOK 신호 기준 ${scoreAsOf.slice(0, 10)}` : "FENOK 신호 기준일 미제공";
  const perBandTitle = perBandSourceDate ? `PER 밴드 원천 ${perBandSourceDate.slice(0, 10)}` : "PER 밴드 원천일 미제공";
  const title = `${scoreTitle} · ${perBandTitle}`;
  return (
    <div className="sup-band-row" title={title} aria-label={title}>
      <span className="sup-mute">PER 밴드</span>
      {band ? (
        <div className="min-w-0 flex-1">
          <PerBandBar current={band.current} min={band.min} avg={band.avg} max={band.max} />
        </div>
      ) : <span className="sup-mute">—</span>}
      <span className="sup-epills">
        <span className="sup-epill">단기 {formatInteger(short)}</span>
        <span className="sup-epill">장기 {formatInteger(long)}</span>
      </span>
    </div>
  );
}

function stockHref(ticker: string, returnTo?: string | null): string {
  return ROUTES.stock(ticker, returnTo === undefined ? currentJourneyReturnTo() : returnTo);
}

function NewBuyRow({
  rank,
  summary,
  score,
  band,
  perBandSourceDate,
  returnTo,
  quarter,
}: {
  rank: NewBuyRank;
  summary: SummaryData | null;
  score?: SignalScoreData;
  band?: PerBandRecord | null;
  perBandSourceDate?: string | null;
  returnTo?: string | null;
  quarter?: string | null;
}) {
  const names = rank.buyers.slice(0, 2).map((b) => investorDisplayName(summary, b.investor));
  return (
    <a
      href={stockHref(rank.ticker, returnTo)}
      className="sup-srow"
      data-superinvestors-signal-row
      data-superinvestors-signal-ticker={rank.ticker}
    >
      <span className="sup-srow-top">
        <span className="sup-mono sup-srow-ticker">{rank.ticker}</span>
        <span className="tabular-nums sup-srow-count">{formatInteger(rank.count)}명</span>
      </span>
      <span className="sup-srow-who">
        <HolderAvatars ids={rank.buyers.map((b) => b.investor)} total={rank.count} summary={summary} />
        <span className="sup-srow-names">{names.join(" · ")}{rank.count > names.length ? " 외" : ""}</span>
      </span>
      <span className="sup-srow-change">
        <span className="sup-mute">평균 신규 보유 비중 {rank.avgWeight === null ? "—" : formatPercent(rank.avgWeight, { digits: 1 })}{quarter ? ` · ${quarter} 기준` : ""}</span>
      </span>
      <ValueBandLine score={score} band={band} perBandSourceDate={perBandSourceDate} />
    </a>
  );
}

function PressureRow({
  rank,
  kind,
  score,
  weightDelta,
  band,
  perBandSourceDate,
  returnTo,
  change,
}: {
  rank: PressureRank;
  kind: "buy" | "sell";
  score?: SignalScoreData;
  weightDelta?: number | null;
  band?: PerBandRecord | null;
  perBandSourceDate?: string | null;
  returnTo?: string | null;
  change?: HoldingChangeSummary | null;
}) {
  return (
    <a
      href={stockHref(rank.ticker, returnTo)}
      className="sup-srow"
      data-superinvestors-signal-row
      data-superinvestors-signal-ticker={rank.ticker}
    >
      <span className="sup-srow-top">
        <span className="sup-mono sup-srow-ticker">{rank.ticker}</span>
        <span className={`tabular-nums sup-srow-count ${kind === "buy" ? "sup-up" : "sup-dn"}`}>
          {formatInteger(rank.count)}명
        </span>
      </span>
      <span className="sup-srow-change">
        <span className="sup-mute">{kind === "buy" ? "주식수 증가 투자자" : "주식수 감소 투자자"} {formatInteger(rank.count)}명 · 평균 비중 변화 {fmtWeightDelta(weightDelta)}{change?.current_quarter && change.previous_quarter ? ` · ${change.current_quarter}↔${change.previous_quarter}` : ""}</span>
      </span>
      <ValueBandLine score={score} band={band} perBandSourceDate={perBandSourceDate} />
    </a>
  );
}

// Signal hero: three ranked lists over the loaded 13F feeds. The optional
// score enrichment is independent of those lists and never fabricates values.
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
  returnTo,
  onRetry,
  signalFeeds,
  onRetrySignal,
}: SignalPanelProps) {
  // Default scope is the whole cohort so the hero answers on first paint;
  // the conviction roster is the opt-in toggle.
  const [followMode, setFollowMode] = useState<FollowMode>("all");
  const newPositions = signalFeeds.newPositions.status === "not-requested" || signalFeeds.newPositions.status === "loading"
    ? undefined
    : signalFeeds.newPositions.data;
  const buyingPressure = signalFeeds.buyingPressure.status === "not-requested" || signalFeeds.buyingPressure.status === "loading"
    ? undefined
    : signalFeeds.buyingPressure.data;
  const signalScores = (signalFeeds.signalScores.status === "not-requested" || signalFeeds.signalScores.status === "loading") &&
    signalFeeds.signalScores.data === null
    ? undefined
    : signalFeeds.signalScores.data;
  const tickerEvidence = signalFeeds.tickerEvidence.status === "not-requested" || signalFeeds.tickerEvidence.status === "loading"
    ? undefined
    : signalFeeds.tickerEvidence.data;
  const perBands = signalFeeds.perBands.status === "not-requested" || signalFeeds.perBands.status === "loading"
    ? undefined
    : signalFeeds.perBands.data;

  const roster = useMemo(
    () => selectFollowRoster(summary, convictionEntries, byTicker),
    [summary, convictionEntries, byTicker],
  );
  const scope = useMemo(
    () => (followMode === "roster" ? new Set(roster.ids) : null),
    [followMode, roster],
  );
  const topSet = useMemo(() => new Set(roster.ids), [roster]);
  const { newBuys, newBuyThreshold } = useMemo(() => {
    const primary = buildNewBuyRanks(newPositions ?? null, scope, topSet);
    if (primary.length > 0) return { newBuys: primary, newBuyThreshold: MIN_TOP_BUYERS };
    return {
      newBuys: buildNewBuyRanks(newPositions ?? null, scope, topSet, 3, VISIBLE_MIN_TOP_BUYERS),
      newBuyThreshold: VISIBLE_MIN_TOP_BUYERS,
    };
  }, [newPositions, scope, topSet]);
  const increases = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_buyers"), [buyingPressure]);
  const decreases = useMemo(() => buildPressureRanks(buyingPressure ?? null, "net_sellers"), [buyingPressure]);

  function scoreFor(ticker: string): SignalScoreData | undefined {
    return signalScores?.get(ticker);
  }

  function bandFor(ticker: string): PerBandRecord | null | undefined {
    return perBands?.rows.get(ticker.toUpperCase());
  }

  function weightDeltaFor(ticker: string): number | null | undefined {
    return tickerEvidence?.holding_changes?.[ticker.toUpperCase()]?.mean_weight_delta;
  }

  function changeFor(ticker: string): HoldingChangeSummary | null | undefined {
    return tickerEvidence?.holding_changes?.[ticker.toUpperCase()];
  }

  const scoreAsOfLabel = useMemo(() => {
    if (signalScores === undefined) return "확인 중";
    if (signalScores === null) return "미제공";
    const dates = new Set(
      [...newBuys, ...increases, ...decreases]
        .map((rank) => signalScores.get(rank.ticker)?.asOf?.slice(0, 10) ?? null)
        .filter((date): date is string => Boolean(date)),
    );
    if (dates.size === 1) return [...dates][0];
    if (dates.size > 1) {
      const sorted = [...dates].sort();
      return `${sorted[0]} ~ ${sorted[sorted.length - 1]}`;
    }
    return "미제공";
  }, [signalScores, newBuys, increases, decreases]);

  const loading = (!dataReady && !failed) || newPositions === undefined || buyingPressure === undefined;
  const feedsFailed = !loading && (
    signalFeeds.newPositions.status === "error" || signalFeeds.newPositions.status === "unavailable" ||
    signalFeeds.buyingPressure.status === "error" || signalFeeds.buyingPressure.status === "unavailable" ||
    signalFeeds.tickerEvidence.status === "error" || signalFeeds.tickerEvidence.status === "unavailable" ||
    signalFeeds.perBands.status === "error" || signalFeeds.perBands.status === "unavailable"
  );
  const freshness: "pending" | "error" | "partial" | "stale" =
    loading ? "pending" : failed || (newPositions === null && buyingPressure === null) ? "error" : partialFeeds || feedsFailed ? "partial" : "stale";

  const rosterNames = roster.ids.map((id) => investorDisplayName(summary, id));
  const newCoverage = followMode === "roster"
    ? `상위 컨빅션 ${formatInteger(roster.ids.length)}명 로스터: ${rosterNames.join(" · ") || "—"} · 신규 ≥${newBuyThreshold}명`
    : `전체 ${formatInteger(dataReady ? investorCount : null)}명 기준 · 신규 로스터 ≥${newBuyThreshold}명`;
  const pressureCoverage = "13F 집계값 · 주식수 증가·감소 투자자 수 · 개별 투자자 내역 미제공";

  return (
    <div data-superinvestors-signal>
      <div className="sup-follow-row">
        <span className="sup-follow-label">팔로우</span>
        <div className="sup-follow-toggle" role="group" aria-label="따라가기 범위">
          <button
            type="button"
            data-superinvestors-follow="all"
            aria-pressed={followMode === "all"}
            className={`sup-follow-btn${followMode === "all" ? " on" : ""}`}
            onClick={() => setFollowMode("all")}
          >
            전체 {formatInteger(dataReady ? investorCount : null)}명
          </button>
          <button
            type="button"
            data-superinvestors-follow="roster"
            aria-pressed={followMode === "roster"}
            className={`sup-follow-btn${followMode === "roster" ? " on" : ""}`}
            onClick={() => setFollowMode("roster")}
          >
            상위 컨빅션 {formatInteger(FOLLOW_ROSTER_SIZE)}명
          </button>
        </div>
        <span className="sup-mute" aria-label={`FENOK 신호 기준일 ${scoreAsOfLabel}`}>
          FENOK 신호 기준일 {scoreAsOfLabel}
        </span>
      </div>

      <div className="sup-signal-grid">
        <Panel
          loading={loading}
          error={!loading && (failed || newPositions === null)}
          errorDetail="신규 매수 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || newPositions === null) ? (failed ? onRetry : onRetrySignal) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="new">
            <PanelHeader eyebrow="New buys" title="신규 매수 상위" right={<Pill>신규</Pill>} />
            {newBuys.length > 0 ? (
                newBuys.map((rank) => (
                <NewBuyRow
                  key={rank.ticker}
                  rank={rank}
                  summary={summary}
                  score={scoreFor(rank.ticker)}
                  band={bandFor(rank.ticker)}
                  perBandSourceDate={perBands?.sourceDate}
                  returnTo={returnTo}
                  quarter={newPositions?.metadata.quarter ?? quarter}
                />
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
            onRetry={failed ? onRetry : feedsFailed ? onRetrySignal : undefined}
            onEvidence={dataReady && !failed && newPositions ? () => openEvidence("/data/sec-13f/analytics/new_positions.json") : undefined}
          />
        </Panel>

        <Panel
          loading={loading}
          error={!loading && (failed || buyingPressure === null)}
          errorDetail="증가 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || buyingPressure === null) ? (failed ? onRetry : onRetrySignal) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="increased">
            <PanelHeader eyebrow="Increases" title="증가 상위" right={<Pill>증가</Pill>} />
            {followMode === "roster" ? (
              <p className="sup-unfiltered sup-mute">팔로우 필터 비적용 · 전체 범위에서 확인</p>
            ) : increases.length > 0 ? (
                increases.map((rank) => (
                  <PressureRow
                    key={rank.ticker}
                    rank={rank}
                    kind="buy"
                    score={scoreFor(rank.ticker)}
                    weightDelta={weightDeltaFor(rank.ticker)}
                    change={changeFor(rank.ticker)}
                    band={bandFor(rank.ticker)}
                    perBandSourceDate={perBands?.sourceDate}
                    returnTo={returnTo}
                  />
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
            onRetry={failed ? onRetry : feedsFailed ? onRetrySignal : undefined}
            onEvidence={dataReady && !failed && buyingPressure ? () => openEvidence("/data/sec-13f/analytics/buying_pressure.json") : undefined}
          />
        </Panel>

        <Panel
          loading={loading}
          error={!loading && (failed || buyingPressure === null)}
          errorDetail="감소 집계를 불러오지 못했습니다."
          onRetry={!loading && (failed || buyingPressure === null) ? (failed ? onRetry : onRetrySignal) : undefined}
          retryLabel="다시 시도"
        >
          <div data-superinvestors-signal-list="decreased">
            <PanelHeader eyebrow="Decreases" title="감소 상위" right={<Pill>감소</Pill>} />
            {followMode === "roster" ? (
              <p className="sup-unfiltered sup-mute">팔로우 필터 비적용 · 전체 범위에서 확인</p>
            ) : decreases.length > 0 ? (
                decreases.map((rank) => (
                  <PressureRow
                    key={rank.ticker}
                    rank={rank}
                    kind="sell"
                    score={scoreFor(rank.ticker)}
                    weightDelta={weightDeltaFor(rank.ticker)}
                    change={changeFor(rank.ticker)}
                    band={bandFor(rank.ticker)}
                    perBandSourceDate={perBands?.sourceDate}
                    returnTo={returnTo}
                  />
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
            onRetry={failed ? onRetry : feedsFailed ? onRetrySignal : undefined}
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
          signalFeeds={signalFeeds}
          onRetrySignal={onRetrySignal}
          compact
        />
      </div>
    </div>
  );
}
