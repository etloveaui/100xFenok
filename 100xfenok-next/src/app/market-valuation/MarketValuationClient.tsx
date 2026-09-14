"use client";

import { useEffect, useState } from "react";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { useBenchmarkOrdinals } from "@/hooks/useBenchmarkOrdinals";
import {
  BENCHMARK_ORDINAL_GROUPS,
  benchmarkHorizonReading,
  type BenchmarkGroupId,
  type BenchmarkOrdinalHorizon,
  type BenchmarkOrdinalRow,
} from "@/lib/market-valuation/benchmarkOrdinals";
import { Panel, PanelHeader, Pill, Stat } from "@/components/ui";
import {
  ErpHistoryPanel,
  YardeniOverlayChartPanel,
  type LedgerChartLoadStatus,
} from "@/lib/market-valuation/charts/ledgerChartPanels";
import { formatDecimal, formatSignedDecimal } from "@/lib/format";
import { formatPercent } from "@/lib/dashboard/formatters";
import {
  freshnessDataState,
  isStaleAsOf,
  latestAsOf,
  makeDataState,
  oldestAsOf,
  DATA_STATE_LABELS,
  type DataState,
} from "@/lib/data-state";
import type {
  MarketIndexValuation,
  ValuationBand,
} from "@/lib/market-valuation/types";

const INDEX_KO: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq100: "나스닥 100",
  nasdaq_composite: "나스닥 종합",
  russell2000: "러셀 2000",
};

const PEER_ORDER = ["sp500", "nasdaq100", "nasdaq_composite", "russell2000"];

const ALL_GROUPS = "all" as const;

type GroupFilter = BenchmarkGroupId | typeof ALL_GROUPS;

const HORIZONS: ReadonlyArray<{ id: BenchmarkOrdinalHorizon; label: string }> = [
  { id: "all", label: "전체" },
  { id: "w5", label: "5년" },
  { id: "w10", label: "10년" },
];

type PillTone = "neutral" | "up" | "down" | "warn";

function valuationMeta(pct: number | null): { label: string; pill: PillTone; num: string } {
  if (pct === null) return { label: "확인 중", pill: "neutral", num: "text-[var(--fnk-neutral-500)]" };
  if (pct >= 80) return { label: "고평가", pill: "down", num: "text-[var(--fnk-color-loss)]" };
  if (pct >= 60) return { label: "다소 높음", pill: "warn", num: "text-[var(--fnk-color-warn-ink)]" };
  if (pct >= 40) return { label: "역사적 중립", pill: "neutral", num: "text-[var(--fnk-neutral-900)]" };
  if (pct >= 20) return { label: "다소 낮음", pill: "neutral", num: "text-[var(--fnk-neutral-900)]" };
  return { label: "저평가", pill: "up", num: "text-[var(--fnk-color-gain)]" };
}

function averagePremiumPct(band: ValuationBand): number | null {
  if (band.current === null || band.avg === null || band.avg === 0) return null;
  return (band.current / band.avg - 1) * 100;
}

// Signed history-premium numerics follow the artboard: positive reads gain,
// negative reads loss (the pre-fix mapping had them reversed).
function signedClass(value: number | null): string {
  if (value === null) return "text-[var(--fnk-neutral-900)]";
  return value >= 0 ? "text-[var(--fnk-color-gain)]" : "text-[var(--fnk-color-loss)]";
}

function verdictSentence(sp500: MarketIndexValuation | undefined): string {
  if (!sp500 || sp500.pe.current === null) return "밸류에이션 데이터를 불러오는 중입니다.";
  const pct = sp500.pe.percentile;
  const meta = valuationMeta(pct);
  const pe = formatDecimal(sp500.pe.current, { digits: 1 });
  const where = pct === null ? "역사 위치 확인 중" : `역사 ${pct}%ile`;
  return `${sp500.name} 선행 PER는 ${pe}배로 ${where} — ${meta.label} 구간입니다.`;
}

// One provenance line replaces the four per-panel evidence rails. Each panel
// reports its own state derivation and date; the header shows the worst state
// against the OLDEST date, because a page is only as fresh as its oldest feed.
type ProvenanceFreshness = "fresh" | "stale" | "pending" | "error" | "partial";

type PanelProvenance = { freshness: ProvenanceFreshness; asOf: string | null };

// Worst first: an error outranks any pending fetch, which outranks the two
// warning states; stale outranks partial because this line's date is the age
// claim. Labels and dot vocabulary follow the retired EvidenceRail row.
const PROVENANCE_WORST_FIRST: ReadonlyArray<ProvenanceFreshness> = [
  "error",
  "pending",
  "stale",
  "partial",
  "fresh",
];

const PROVENANCE_LABEL: Record<ProvenanceFreshness, string> = {
  fresh: "신선",
  stale: "대기",
  pending: "확인 중",
  error: "오류",
  partial: "부분",
};

const PROVENANCE_SOURCES = "Bloomberg · Damodaran · Yardeni";

function aggregateProvenance(panels: ReadonlyArray<PanelProvenance>): PanelProvenance {
  return {
    freshness: PROVENANCE_WORST_FIRST.find(
      (state) => panels.some((panel) => panel.freshness === state),
    ) ?? "fresh",
    asOf: oldestAsOf(panels.map((panel) => panel.asOf)),
  };
}

function ValuationReadPanel({
  sp500,
  loading,
  failed,
  sourceDate,
  onRefetch,
  onProvenance,
}: {
  sp500: MarketIndexValuation | undefined;
  loading: boolean;
  failed: boolean;
  sourceDate: string | null;
  onRefetch: () => void;
  onProvenance: (value: PanelProvenance) => void;
}) {
  const pct = sp500?.pe.percentile ?? null;
  const meta = valuationMeta(pct);
  const premium = sp500 ? averagePremiumPct(sp500.pe) : null;
  const empty = !loading && !sp500;
  const stale = !loading && !failed && isStaleAsOf(sourceDate);
  const freshness: ProvenanceFreshness = loading ? "pending" : failed ? "error" : stale ? "stale" : "fresh";

  useEffect(() => {
    onProvenance({ freshness, asOf: sourceDate });
  }, [freshness, sourceDate, onProvenance]);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed ? "지수 밸류에이션을 불러오지 못했습니다" : "표시할 밸류에이션 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? onRefetch : undefined}
      stale={stale}
      asOf={sourceDate ?? undefined}
      onRetry={stale ? onRefetch : undefined}
    >
      <PanelHeader
        eyebrow="Valuation Read"
        title="오늘의 밸류에이션 판독"
        right={
          <Pill tone={meta.pill}>
            {pct === null ? meta.label : `${meta.label} · 상위 ${100 - pct}%`}
          </Pill>
        }
      />
      <p className="mv-lede">{verdictSentence(sp500)}</p>
      <div className="mv-stats">
        <Stat label="Fwd P/E" value={`${formatDecimal(sp500?.pe.current ?? null, { digits: 1 })}x`} />
        <Stat label="P/B" value={`${formatDecimal(sp500?.pb.current ?? null, { digits: 2 })}x`} />
        <Stat
          label="ROE"
          value={
            <span className={sp500?.roe == null ? "text-[var(--fnk-neutral-900)]" : sp500.roe >= 0.15 ? "text-[var(--fnk-color-gain)]" : "text-[var(--fnk-neutral-900)]"}>
              {sp500?.roe == null ? "—" : formatPercent(sp500.roe * 100, 1)}
            </span>
          }
        />
        <Stat
          label="평균 대비"
          value={
            <span className={signedClass(premium)}>
              {premium === null ? "—" : `${formatSignedDecimal(premium)}%`}
            </span>
          }
        />
      </div>
    </Panel>
  );
}

function PeerComparePanel({
  indices,
  loading,
  failed,
  sourceDate,
  onRefetch,
  onProvenance,
}: {
  indices: MarketIndexValuation[];
  loading: boolean;
  failed: boolean;
  sourceDate: string | null;
  onRefetch: () => void;
  onProvenance: (value: PanelProvenance) => void;
}) {
  const rows = PEER_ORDER.map((id) => indices.find((index) => index.id === id)).filter(
    (row): row is MarketIndexValuation => row !== undefined,
  );
  const empty = !loading && rows.length === 0;
  const stale = !loading && !failed && rows.length > 0 && isStaleAsOf(sourceDate);
  const freshness: ProvenanceFreshness = loading ? "pending" : failed ? "error" : stale ? "stale" : "fresh";

  useEffect(() => {
    onProvenance({ freshness, asOf: sourceDate });
  }, [freshness, sourceDate, onProvenance]);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={failed ? "지수 비교 데이터를 불러오지 못했습니다" : "비교할 지수 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? onRefetch : undefined}
      stale={stale}
      asOf={sourceDate ?? undefined}
      onRetry={stale ? onRefetch : undefined}
    >
      <PanelHeader
        eyebrow="Peer Compare"
        title="지수별 비교"
        right={<Pill>{rows.length}개 표시</Pill>}
      />
      <div role="table" aria-label="지수별 밸류에이션 비교">
        <div className="mv-thead" role="row">
          <span role="columnheader">지수</span>
          <span role="columnheader">Fwd P/E</span>
          <span role="columnheader">P/B</span>
          <span role="columnheader">ROE</span>
          <span role="columnheader">구간</span>
        </div>
        {rows.map((index) => {
          const meta = valuationMeta(index.pe.percentile);
          return (
            <div className="mv-trow" role="row" tabIndex={0} key={index.id}>
              <span className="mv-idx" role="cell">{INDEX_KO[index.id] ?? index.name}</span>
              <span className="tabular-nums" role="cell">
                {formatDecimal(index.pe.current, { digits: 1 })}x
              </span>
              <span className="tabular-nums" role="cell">
                {formatDecimal(index.pb.current, { digits: 2 })}x
              </span>
              <span className="tabular-nums" role="cell">
                {index.roe === null ? "—" : formatPercent(index.roe * 100, 1)}
              </span>
              <span role="cell">
                <Pill tone={meta.pill}>{meta.label}</Pill>
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// Historical Position reads the six Bloomberg benchmark ordinals
// (us/us_sectors/developed/emerging/msci/micro_sectors — every file carries
// metadata.source "Bloomberg Terminal"), which is why the page provenance line
// names Bloomberg alongside the Reference-panel feeds. Wiring the RIM
// sustainable ranges + Yardeni model in here instead would replace the 38-asset
// trailing-window reading with a different model; the panel reports its own
// state and date upward instead (fh-669 P1b).
function HistoricalPositionPanel({ onProvenance }: { onProvenance: (value: PanelProvenance) => void }) {
  const { state, view, refetch } = useBenchmarkOrdinals();
  const [horizon, setHorizon] = useState<BenchmarkOrdinalHorizon>("w10");
  const [group, setGroup] = useState<GroupFilter>(ALL_GROUPS);
  const loading = state === "pending";
  const transportFailed = state === "refused" || state === "failed";
  const ready = state === "ready" && view?.status === "ready";

  const allRows: BenchmarkOrdinalRow[] = view && view.status === "ready"
    ? view.groups.flatMap((entry) => entry.rows)
    : [];
  const readable = allRows
    .map((row, index) => ({ row, index, reading: benchmarkHorizonReading(row, horizon) }))
    .filter((item) => item.reading.percentile !== null);
  // The board is the working surface: every rankable row stays, highest
  // percentile first, and equal percentiles keep the source order.
  const ranked = readable
    .filter((item) => group === ALL_GROUPS || item.row.groupId === group)
    .sort((a, b) => (b.reading.percentile ?? 0) - (a.reading.percentile ?? 0) || a.index - b.index)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const groupRefusals = view && view.status === "ready"
    ? view.groups.filter((entry) => entry.refusal)
    : [];
  const horizonLabel = HORIZONS.find((item) => item.id === horizon)?.label ?? "10년";
  const asOf = view && view.status === "ready" ? view.asOf : null;
  // Loaded groups stay visible when siblings refuse (LKG): only a fully empty
  // board becomes the empty state. A filter that matches nothing is a filtered
  // view of live data, not an empty panel — it gets a note instead.
  const empty = !loading && readable.length === 0;
  const filteredEmpty = !loading && !empty && ranked.length === 0;
  const partial = !loading && !empty && (!ready || groupRefusals.length > 0);
  const stale = !loading && !empty && !transportFailed && isStaleAsOf(asOf);
  const freshness: ProvenanceFreshness = loading
    ? "pending"
    : transportFailed && empty
      ? "error"
      : partial
        ? "partial"
        : stale
          ? "stale"
          : "fresh";

  useEffect(() => {
    onProvenance({ freshness, asOf });
  }, [freshness, asOf, onProvenance]);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={transportFailed ? "역사 위치 데이터를 읽지 못했습니다" : "표시할 역사 위치 데이터가 없습니다"}
      emptyNextRefresh="주간 갱신"
      emptyActionLabel={transportFailed ? "다시 시도" : undefined}
      onEmptyAction={transportFailed ? refetch : undefined}
      stale={stale}
      asOf={asOf ?? undefined}
      onRetry={stale ? refetch : undefined}
    >
      <PanelHeader
        eyebrow="Historical Position"
        title={`${allRows.length > 0 ? allRows.length : 38}종 자산 — 역사 대비 위치`}
        right={<Pill>{horizonLabel} 기준</Pill>}
      />
      <div className="mv-board-controls">
        <div className="mv-horizons" role="group" aria-label="역사 구간">
          {HORIZONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={horizon === item.id}
              onClick={() => setHorizon(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mv-chips" role="group" aria-label="자산군 필터">
          <button type="button" aria-pressed={group === ALL_GROUPS} onClick={() => setGroup(ALL_GROUPS)}>
            전체
          </button>
          {BENCHMARK_ORDINAL_GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={group === item.id}
              onClick={() => setGroup(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mv-board-list">
        {ranked.map(({ row, reading, rank }) => {
          const pct = reading.percentile ?? 0;
          const meta = valuationMeta(reading.percentile);
          return (
            <div className="mv-brow" tabIndex={0} key={row.id}>
              <span className="mv-brank tabular-nums">{rank}</span>
              <span className="mv-bname">{row.name}</span>
              <div className="mv-band" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.name} 역사 백분위`}>
                <i style={{ left: `${pct}%` }} />
              </div>
              <span className="mv-bpct tabular-nums">{pct}%</span>
              <span className={`mv-blabel ${meta.num}`}>{meta.label}</span>
            </div>
          );
        })}
      </div>
      {filteredEmpty ? <p className="mv-note">이 자산군에는 표시할 역사 위치 데이터가 없습니다</p> : null}
      {groupRefusals.length > 0 ? (
        <p className="mv-note">
          {groupRefusals.map((item) => item.label).join(" · ")}: 표시할 수 없습니다
        </p>
      ) : null}
    </Panel>
  );
}

// The Reference panel waits for both embedded chart loaders: freshness derives
// from the ERP + Yardeni outcomes, never from a fixed 2/2.
function HistoricalReferencePanel({
  erpSourceDate,
  onProvenance,
}: {
  erpSourceDate: string | null;
  onProvenance: (value: PanelProvenance) => void;
}) {
  const [erp, setErp] = useState<LedgerChartLoadStatus>({ state: "pending", asOf: null });
  const [yardeni, setYardeni] = useState<LedgerChartLoadStatus>({ state: "pending", asOf: null });
  // Refetch is local to this panel: bumping the attempt token remounts the two
  // chart loaders (they own their fetches), and the statuses drop back to
  // pending so the panel reads as loading again while they re-run.
  const [attempt, setAttempt] = useState(0);
  const refetch = () => {
    setErp({ state: "pending", asOf: null });
    setYardeni({ state: "pending", asOf: null });
    setAttempt((value) => value + 1);
  };
  const pending = erp.state === "pending" || yardeni.state === "pending";
  const readyCount = (erp.state === "ready" ? 1 : 0) + (yardeni.state === "ready" ? 1 : 0);
  const bothFailed = erp.state === "failed" && yardeni.state === "failed";
  const empty = !pending && bothFailed;
  const partial = !pending && !bothFailed && readyCount < 2;
  const asOf = latestAsOf([erp.asOf, yardeni.asOf, erpSourceDate]);
  const stale = !pending && !bothFailed && (isStaleAsOf(erp.asOf) || isStaleAsOf(yardeni.asOf));
  const freshness: ProvenanceFreshness = pending
    ? "pending"
    : bothFailed
      ? "error"
      : partial
        ? "partial"
        : stale
          ? "stale"
          : "fresh";

  useEffect(() => {
    // The page clock takes this panel's OLDEST internal date: two charts with
    // different publication dates must not be summarized by the newer one.
    onProvenance({ freshness, asOf: oldestAsOf([erp.asOf, yardeni.asOf, erpSourceDate]) });
  }, [freshness, erp.asOf, yardeni.asOf, erpSourceDate, onProvenance]);

  return (
    // Route-level five-state: the ERP/Yardeni charts load their own feeds, so
    // the panel never delegates loading to Panel — Panel's delayed skeleton
    // replaces children after 120ms, which would drop the live chart frames
    // for a slow fetch. Children stay mounted; pending/partial surface in the
    // page provenance line and the empty/error states on the Panel itself.
    <Panel
      loading={false}
      empty={empty}
      emptyReason="ERP · 채권 대비 PER 차트를 불러오지 못했습니다"
      emptyActionLabel="다시 시도"
      onEmptyAction={refetch}
      stale={stale}
      asOf={asOf ?? undefined}
      onRetry={stale ? refetch : undefined}
    >
      <PanelHeader eyebrow="Historical Reference" title="ERP · 채권 대비 PER 추이" right={<Pill>20Y</Pill>} />
      <div className="mv-histref" data-market-valuation-chart-grid aria-busy={pending}>
        <div>
          <p className="mv-chart-cap">Damodaran ERP vs 10년물</p>
          <ErpHistoryPanel key={`erp-${attempt}`} bare onStatus={setErp} />
        </div>
        <div>
          <p className="mv-chart-cap">Yardeni 채권 대비 PER</p>
          <YardeniOverlayChartPanel key={`yardeni-${attempt}`} bare onStatus={setYardeni} />
        </div>
      </div>
    </Panel>
  );
}

export default function MarketValuationClient({
  onFreshnessChange,
}: {
  onFreshnessChange?: (state: DataState | null) => void;
}) {
  const {
    indices,
    erpInsight,
    dataReady,
    failed,
    sourceDate,
    refetch,
  } = useMarketValuation();
  // Per-panel provenance: the four states are reported by the panels' own
  // derivations (never recomputed here), so the header line cannot drift from
  // what each panel renders.
  const [readProvenance, setReadProvenance] = useState<PanelProvenance>({ freshness: "pending", asOf: null });
  const [peerProvenance, setPeerProvenance] = useState<PanelProvenance>({ freshness: "pending", asOf: null });
  const [boardProvenance, setBoardProvenance] = useState<PanelProvenance>({ freshness: "pending", asOf: null });
  const [referenceProvenance, setReferenceProvenance] = useState<PanelProvenance>({ freshness: "pending", asOf: null });

  useEffect(() => {
    if (!onFreshnessChange) return;
    if (failed) {
      onFreshnessChange(makeDataState({
        status: "error",
        label: DATA_STATE_LABELS.error,
        detail: "지수 밸류에이션을 불러오지 못했습니다.",
        asOf: sourceDate,
      }));
      return;
    }
    if (!dataReady) {
      onFreshnessChange(null);
      return;
    }
    onFreshnessChange(freshnessDataState({
      asOf: sourceDate,
      readyLabel: DATA_STATE_LABELS.ready,
      staleLabel: DATA_STATE_LABELS.stale,
      unavailableLabel: DATA_STATE_LABELS.unavailable,
    }));
  }, [dataReady, failed, onFreshnessChange, sourceDate]);

  const loading = !dataReady && !failed;
  const sp500 = indices.find((index) => index.id === "sp500") ?? indices[0];
  const provenance = aggregateProvenance([
    readProvenance,
    peerProvenance,
    boardProvenance,
    referenceProvenance,
  ]);

  return (
    <div className="mv" data-market-valuation-surface>
      <div className="mv-head">
        <div>
          <h1 className="mv-title">시장 밸류에이션</h1>
          <span className="mv-verdict">{verdictSentence(sp500)}</span>
        </div>
        <div className="mv-tabs">
          <MarketSectionNav active="valuation" />
        </div>
        <p className="mv-prov" data-market-valuation-provenance>
          <span className="mv-prov-state">
            <i className="mv-prov-dot" data-state={provenance.freshness} aria-hidden="true" />
            <b>{PROVENANCE_LABEL[provenance.freshness]}</b>
          </span>
          <span>기준 <b className="tabular-nums">{provenance.asOf ?? "—"}</b></span>
          <span>출처 <b>{PROVENANCE_SOURCES}</b></span>
        </p>
      </div>

      <ValuationReadPanel
        sp500={sp500}
        loading={loading}
        failed={failed}
        sourceDate={sourceDate}
        onRefetch={refetch}
        onProvenance={setReadProvenance}
      />
      <PeerComparePanel
        indices={indices}
        loading={loading}
        failed={failed}
        sourceDate={sourceDate}
        onRefetch={refetch}
        onProvenance={setPeerProvenance}
      />
      <HistoricalPositionPanel onProvenance={setBoardProvenance} />
      <HistoricalReferencePanel
        erpSourceDate={erpInsight?.sourceDate ?? null}
        onProvenance={setReferenceProvenance}
      />

      <p className="mv-foot">
        백분위는 현재값의 역사적 위치이며, 높을수록 고평가 구간에 가깝습니다.
      </p>
    </div>
  );
}
