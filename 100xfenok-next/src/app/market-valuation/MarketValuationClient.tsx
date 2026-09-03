"use client";

import { useEffect, useState } from "react";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { useBenchmarkOrdinals } from "@/hooks/useBenchmarkOrdinals";
import {
  BENCHMARK_ORDINAL_GROUPS,
  benchmarkHorizonReading,
  type BenchmarkOrdinalHorizon,
  type BenchmarkOrdinalRow,
} from "@/lib/market-valuation/benchmarkOrdinals";
import { EvidenceRail, Panel, PanelHeader, Pill, Stat } from "@/components/ui";
import {
  ErpHistoryPanel,
  YardeniOverlayChartPanel,
} from "@/lib/market-valuation/charts/ledgerChartPanels";
import { formatDecimal, formatSignedDecimal } from "@/lib/format";
import { formatPercent } from "@/lib/dashboard/formatters";
import {
  freshnessDataState,
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

const HIGHLIGHT_IDS = ["sp500", "nasdaq100", "nasdaq_composite", "russell2000", "kospi"];

const HORIZONS: ReadonlyArray<{ id: BenchmarkOrdinalHorizon; label: string }> = [
  { id: "all", label: "전체" },
  { id: "w5", label: "5년" },
  { id: "w10", label: "10년" },
];

type PillTone = "neutral" | "up" | "down" | "warn";

function valuationMeta(pct: number | null): { label: string; pill: PillTone; num: string } {
  if (pct === null) return { label: "확인 중", pill: "neutral", num: "text-[#0f172a]" };
  if (pct >= 80) return { label: "고평가", pill: "down", num: "text-[#e84a5a]" };
  if (pct >= 60) return { label: "다소 높음", pill: "warn", num: "text-[#b9791a]" };
  if (pct >= 40) return { label: "역사적 중립", pill: "neutral", num: "text-[#0f172a]" };
  if (pct >= 20) return { label: "다소 낮음", pill: "neutral", num: "text-[#0f172a]" };
  return { label: "저평가", pill: "up", num: "text-[#1aa86f]" };
}

function averagePremiumPct(band: ValuationBand): number | null {
  if (band.current === null || band.avg === null || band.avg === 0) return null;
  return (band.current / band.avg - 1) * 100;
}

function signedClass(value: number | null): string {
  if (value === null) return "text-[#0f172a]";
  return value >= 0 ? "text-[#e84a5a]" : "text-[#1aa86f]";
}

function verdictSentence(sp500: MarketIndexValuation | undefined): string {
  if (!sp500 || sp500.pe.current === null) return "밸류에이션 데이터를 불러오는 중입니다.";
  const pct = sp500.pe.percentile;
  const meta = valuationMeta(pct);
  const pe = formatDecimal(sp500.pe.current, { digits: 1 });
  const where = pct === null ? "역사 위치 확인 중" : `역사 ${pct}%ile`;
  return `${sp500.name} 선행 PER는 ${pe}배로 ${where} — ${meta.label} 구간입니다.`;
}

function reload() {
  window.location.reload();
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

function ValuationReadPanel({
  sp500,
  count,
  loading,
  failed,
  sourceDate,
}: {
  sp500: MarketIndexValuation | undefined;
  count: number;
  loading: boolean;
  failed: boolean;
  sourceDate: string | null;
}) {
  const pct = sp500?.pe.percentile ?? null;
  const meta = valuationMeta(pct);
  const premium = sp500 ? averagePremiumPct(sp500.pe) : null;
  const empty = !loading && !failed && !sp500;

  return (
    <Panel
      loading={loading}
      empty={empty || failed}
      emptyReason={failed ? "지수 밸류에이션을 불러오지 못했습니다" : "표시할 밸류에이션 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? reload : undefined}
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
            <span className={sp500?.roe == null ? "text-[#0f172a]" : sp500.roe >= 0.15 ? "text-[#1aa86f]" : "text-[#0f172a]"}>
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
      <EvidenceRail
        freshness={loading ? "pending" : failed ? "error" : "fresh"}
        source="Bloomberg · Yardeni"
        asOf={sourceDate ?? "—"}
        coverage={`${count}/4`}
        onRetry={failed ? reload : undefined}
        onEvidence={failed ? undefined : () => openEvidence("/data/benchmarks/us.json")}
      />
    </Panel>
  );
}

function PeerComparePanel({
  indices,
  loading,
  failed,
  sourceDate,
}: {
  indices: MarketIndexValuation[];
  loading: boolean;
  failed: boolean;
  sourceDate: string | null;
}) {
  const rows = PEER_ORDER.map((id) => indices.find((index) => index.id === id)).filter(
    (row): row is MarketIndexValuation => row !== undefined,
  );
  const empty = !loading && !failed && rows.length === 0;

  return (
    <Panel
      loading={loading}
      empty={empty || failed}
      emptyReason={failed ? "지수 비교 데이터를 불러오지 못했습니다" : "비교할 지수 데이터가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed ? "다시 시도" : undefined}
      onEmptyAction={failed ? reload : undefined}
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
            <div className="mv-trow" role="row" key={index.id}>
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
      <EvidenceRail
        freshness={loading ? "pending" : failed ? "error" : "fresh"}
        source="Bloomberg"
        asOf={sourceDate ?? "—"}
        coverage={`${rows.length}/4`}
        onRetry={failed ? reload : undefined}
        onEvidence={failed ? undefined : () => openEvidence("/data/benchmarks/us.json")}
      />
    </Panel>
  );
}

function HistoricalPositionPanel() {
  const { state, view } = useBenchmarkOrdinals();
  const [horizon, setHorizon] = useState<BenchmarkOrdinalHorizon>("w10");
  const loading = state === "pending";
  const refused = state === "refused" || state === "failed";
  const ready = state === "ready" && view?.status === "ready";

  const allRows: BenchmarkOrdinalRow[] = view && view.status === "ready"
    ? view.groups.flatMap((group) => group.rows)
    : [];
  const ordered = [
    ...HIGHLIGHT_IDS.map((id) => allRows.find((row) => row.id === id)).filter(
      (row): row is BenchmarkOrdinalRow => row !== undefined,
    ),
    ...allRows.filter((row) => !HIGHLIGHT_IDS.includes(row.id)),
  ];
  const shown = ordered
    .map((row) => ({ row, reading: benchmarkHorizonReading(row, horizon) }))
    .filter((item) => item.reading.percentile !== null)
    .slice(0, 8);
  const groupRefusals = view && view.status === "ready"
    ? view.groups.filter((group) => group.refusal)
    : [];
  const horizonLabel = HORIZONS.find((item) => item.id === horizon)?.label ?? "10년";
  const asOf = view && view.status === "ready" ? view.asOf : null;

  return (
    <Panel
      loading={loading}
      empty={!loading && (refused || !ready || shown.length === 0)}
      emptyReason={refused ? "역사 위치 데이터를 읽지 못했습니다" : "표시할 역사 위치 데이터가 없습니다"}
      emptyNextRefresh="주간 갱신"
      emptyActionLabel={refused ? "다시 시도" : undefined}
      onEmptyAction={refused ? reload : undefined}
    >
      <PanelHeader
        eyebrow="Historical Position"
        title={`${allRows.length > 0 ? allRows.length : 38}종 자산 — 역사 대비 위치`}
        right={<Pill>{horizonLabel} 기준</Pill>}
      />
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
      <div>
        {shown.map(({ row, reading }) => {
          const pct = reading.percentile ?? 0;
          const meta = valuationMeta(reading.percentile);
          return (
            <div className="mv-brow" key={row.id}>
              <span className="mv-bname">{row.name}</span>
              <div className="mv-band" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.name} 역사 백분위`}>
                <i style={{ left: `${pct}%` }} />
              </div>
              <span className="mv-bpct tabular-nums">{pct}%</span>
              <span className={meta.num}>{meta.label}</span>
            </div>
          );
        })}
      </div>
      {groupRefusals.length > 0 ? (
        <p className="mv-note">
          {groupRefusals.map((group) => group.label).join(" · ")}: 표시할 수 없습니다
        </p>
      ) : null}
      <EvidenceRail
        freshness={loading ? "pending" : refused ? "error" : "fresh"}
        source="Yardeni · Damodaran"
        asOf={asOf ?? "—"}
        coverage={allRows.length > 0 ? `${allRows.length}/38` : "—"}
        onRetry={refused ? reload : undefined}
        onEvidence={refused ? undefined : () => openEvidence(BENCHMARK_ORDINAL_GROUPS[0].file)}
      />
    </Panel>
  );
}

function HistoricalReferencePanel({ erpSourceDate }: { erpSourceDate: string | null }) {
  return (
    <Panel>
      <PanelHeader eyebrow="Historical Reference" title="ERP · 채권 대비 PER 추이" right={<Pill>20Y</Pill>} />
      <div className="mv-histref">
        <div>
          <p className="mv-chart-cap">Damodaran ERP vs 10년물</p>
          <ErpHistoryPanel bare />
        </div>
        <div>
          <p className="mv-chart-cap">Yardeni 채권 대비 PER</p>
          <YardeniOverlayChartPanel bare />
        </div>
      </div>
      <EvidenceRail
        freshness="fixed"
        source="Damodaran · Yardeni"
        asOf={erpSourceDate ?? "—"}
        coverage="2/2"
        onEvidence={() => openEvidence("/data/damodaran/historical_erp.json")}
      />
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
  } = useMarketValuation();

  useEffect(() => {
    if (!onFreshnessChange) return;
    if (!dataReady && !failed) {
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
      </div>

      <ValuationReadPanel
        sp500={sp500}
        count={indices.length}
        loading={loading}
        failed={failed}
        sourceDate={sourceDate}
      />
      <PeerComparePanel indices={indices} loading={loading} failed={failed} sourceDate={sourceDate} />
      <HistoricalPositionPanel />
      <HistoricalReferencePanel erpSourceDate={erpInsight?.sourceDate ?? null} />

      <p className="mv-foot">
        백분위는 현재값의 역사적 위치이며, 높을수록 고평가 구간에 가깝습니다.
      </p>
    </div>
  );
}
