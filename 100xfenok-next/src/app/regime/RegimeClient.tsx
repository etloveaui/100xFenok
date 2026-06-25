"use client";

import MarketSectionNav from "@/components/market/MarketSectionNav";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { formatAsOf, latestAsOf } from "@/lib/market-valuation/freshness";
import type {
  MarketBondPulse,
  MarketIndexValuation,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
  ValuationDataSource,
} from "@/lib/market-valuation/types";

type Pulse = {
  id: string;
  label: string;
  valueLabel: string;
  detail: string;
  asOf: string | null;
  tone: MarketTone;
};

type Axis = {
  id: string;
  title: string;
  summary: string;
  tone: MarketTone;
  pulses: Pulse[];
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toneRank(tone: MarketTone): number {
  if (tone === "rose") return 3;
  if (tone === "amber") return 2;
  if (tone === "emerald") return 1;
  return 0;
}

function strongestTone(pulses: Pulse[]): MarketTone {
  return pulses.reduce<MarketTone>((top, pulse) => (toneRank(pulse.tone) > toneRank(top) ? pulse.tone : top), "slate");
}

function toneLabel(tone: MarketTone): string {
  if (tone === "rose") return "경계";
  if (tone === "amber") return "주의";
  if (tone === "emerald") return "우호";
  return "중립";
}

function toneClass(tone: MarketTone): string {
  if (tone === "rose") return "border-[var(--c-down)] bg-[var(--c-down-soft)] text-[var(--c-down)]";
  if (tone === "amber") return "border-[var(--c-warn)] bg-[var(--c-warn-soft)] text-[var(--c-warn)]";
  if (tone === "emerald") return "border-[var(--c-up)] bg-[var(--c-up-soft)] text-[var(--c-up)]";
  return "border-[var(--c-line)] bg-[var(--c-surface-2)] text-[var(--c-ink-2)]";
}

function dotClass(tone: MarketTone): string {
  if (tone === "rose") return "bg-[var(--c-down)]";
  if (tone === "amber") return "bg-[var(--c-warn)]";
  if (tone === "emerald") return "bg-[var(--c-up)]";
  return "bg-[var(--c-line)]";
}

function toneTextClass(tone: MarketTone): string {
  if (tone === "rose") return "text-[var(--c-down)]";
  if (tone === "amber") return "text-[var(--c-warn)]";
  if (tone === "emerald") return "text-[var(--c-up)]";
  return "text-[var(--c-ink)]";
}

function formatNumber(value: number | null, digits = 1): string {
  return value === null ? "-" : value.toFixed(digits);
}

function formatPercent(value: number | null, digits = 1): string {
  return value === null ? "-" : `${value.toFixed(digits)}%`;
}

function formatRatePercent(value: number | null, digits = 2): string {
  return value === null ? "-" : `${(value * 100).toFixed(digits)}%`;
}

function signalStatusLabel(item: MarketSignalPulse): string {
  const labels: Record<string, string> = {
    stable: "안정",
    normal: "정상",
    neutral: "중립",
    caution: "주의",
    danger: "위험",
    stress: "스트레스",
    warning: "경고",
    rising: "상승",
    falling: "하락",
  };
  return labels[item.status] ?? item.statusLabel;
}

function readableDetail(value: string): string {
  return value
    .replace(/Slickcharts yearly return/gi, "연도 기준 수익률")
    .replace(/^ATH /, "고점 ")
    .replace(/ · 현 /g, " · 현재 ")
    .replace(/buy on/gi, "매수 신호 켜짐")
    .replace(/buy off/gi, "매수 신호 꺼짐")
    .replace(/warn on/gi, "경고 신호 켜짐")
    .replace(/warn off/gi, "경고 신호 꺼짐")
    .replace(/\bGlobal\b/g, "글로벌")
    .replace(/\bKorea\b/g, "한국")
    .replace(/\bChina\b/g, "중국");
}

function readablePulseLabel(value: string): string {
  const labels: Record<string, string> = {
    "Fear & Greed": "공포·탐욕",
    "S&P 500 Fwd P/E": "S&P 500 선행 P/E",
    "S&P 500 연간": "S&P 500 연간 수익률",
    "NASDAQ 100 연간": "NASDAQ 100 연간 수익률",
  };
  return labels[value] ?? value;
}

function valuationTone(percentile: number | null): MarketTone {
  if (percentile === null) return "slate";
  if (percentile >= 80) return "rose";
  if (percentile >= 60) return "amber";
  if (percentile <= 25) return "emerald";
  return "slate";
}

function valuationLabel(percentile: number | null): string {
  if (percentile === null) return "자료 없음";
  if (percentile >= 80) return "역사적으로 높은 구간";
  if (percentile >= 60) return "평균보다 높은 구간";
  if (percentile <= 25) return "부담이 낮은 구간";
  return "역사적 중간 구간";
}

function toSignalPulse(item: MarketSignalPulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: signalStatusLabel(item),
    detail: readableDetail(item.detail),
    asOf: item.asOf,
    tone: item.tone,
  };
}

function toStructurePulse(item: MarketStructurePulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: item.valueLabel,
    detail: readableDetail(item.detail),
    asOf: item.updated,
    tone: item.tone,
  };
}

function toMacroPulse(item: MarketMacroPulse): Pulse {
  return {
    id: item.id,
    label: item.label,
    valueLabel: `${formatNumber(item.value)} ${item.unit}`.trim(),
    detail: readableDetail(item.detail),
    asOf: item.releaseDate ?? item.period,
    tone: item.tone,
  };
}

function toSentimentPulse(item: MarketSentimentPulse): Pulse {
  return {
    id: item.id,
    label: readablePulseLabel(item.label),
    valueLabel: item.valueLabel,
    detail: readableDetail(item.detail),
    asOf: item.date,
    tone: item.tone,
  };
}

function toBondPulse(item: MarketBondPulse): Pulse {
  return {
    id: item.id,
    label: item.label,
    valueLabel: item.valueLabel,
    detail: readableDetail(`${item.changeLabel} · ${item.detail}`),
    asOf: item.date,
    tone: item.tone,
  };
}

function sp500ValuationPulse(index: MarketIndexValuation | undefined): Pulse | null {
  if (!index) return null;
  const percentile = index.pe.percentile;
  return {
    id: "sp500_fwd_pe",
    label: readablePulseLabel("S&P 500 Fwd P/E"),
    valueLabel: index.pe.current === null ? "-" : `${index.pe.current.toFixed(1)}배`,
    detail: `${valuationLabel(percentile)} · 역사 백분위 ${formatPercent(percentile, 0)}`,
    asOf: index.date,
    tone: valuationTone(percentile),
  };
}

function buildHeadline(axes: Axis[]) {
  const pulses = axes.flatMap((axis) => axis.pulses);
  const alertCount = pulses.filter((pulse) => pulse.tone === "rose").length;
  const cautionCount = pulses.filter((pulse) => pulse.tone === "amber").length;
  const friendlyCount = pulses.filter((pulse) => pulse.tone === "emerald").length;
  const topTone = strongestTone(pulses);

  if (alertCount > 0) {
    return {
      label: "경계 신호 확인",
      tone: topTone,
      detail: `경계 ${alertCount}개, 주의 ${cautionCount}개를 먼저 확인해야 합니다.`,
    };
  }
  if (cautionCount > friendlyCount) {
    return {
      label: "주의 우세",
      tone: "amber" as MarketTone,
      detail: `주의 ${cautionCount}개, 우호 ${friendlyCount}개입니다. 방향성보다 리스크 점검이 먼저입니다.`,
    };
  }
  if (friendlyCount > 0) {
    return {
      label: "우호 신호 우세",
      tone: "emerald" as MarketTone,
      detail: `우호 ${friendlyCount}개가 확인됩니다. 단, 밸류에이션과 심리 과열 여부는 함께 봐야 합니다.`,
    };
  }
  return {
    label: "중립 혼합",
    tone: "slate" as MarketTone,
    detail: "강한 한쪽 신호보다 중립 신호가 많은 상태입니다.",
  };
}

function readableSourceLabel(source: ValuationDataSource): string {
  const labels: Record<string, string> = {
    benchmarks: "지수 밴드",
    yardney: "채권 PER 모델",
    damodaran: "주식위험프리미엄",
    macro: "경기 지표",
    computed: "가공 신호",
    sentiment: "투자심리",
    indices: "지수 추세",
    slickcharts: "시장 구조",
  };
  return labels[source.id] ?? source.label;
}

function readableSourceUsage(source: ValuationDataSource): string {
  const usage: Record<string, string> = {
    computed: "유동성·스트레스·은행·투자심리 가공 신호",
    sentiment: "VIX·공포탐욕·개인투자자 심리·채권 변동성·옵션 심리",
    indices: "S&P 500·나스닥 추세와 고점 대비 위치",
    slickcharts: "지수 집중도·고점 대비 위치·연간 수익률",
  };
  return usage[source.id] ?? source.usage;
}

function readableCadence(value: string | null): string {
  if (!value) return "";
  const labels: Record<string, string> = {
    daily: "일간",
    weekly: "주간",
    monthly: "월간",
    quarterly: "분기",
    yearly: "연간",
    "after source data refresh": "원천 갱신 후",
    "daily/weekly": "일간/주간",
    "daily/weekly/monthly/quarterly": "일간/주간/월간/분기",
    "daily/weekly/monthly": "일간/주간/월간",
    "yearly + ERP interim": "연간 + ERP 수시",
  };
  return labels[value] ?? value;
}

function EvidenceList({ items }: { items: Pulse[] }) {
  if (items.length === 0) {
    return <p className="text-sm font-semibold text-[var(--c-ink-4)]">표시할 신호가 없습니다.</p>;
  }
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[var(--c-ink)]">{item.label}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--c-ink-3)]">{item.detail}</p>
            </div>
            <span className={cx("shrink-0 rounded-full border px-2 py-1 text-[11px] font-black", toneClass(item.tone))}>
              {item.valueLabel}
            </span>
          </div>
          {item.asOf ? <p className="mt-2 text-[10px] font-bold text-[var(--c-ink-4)]">기준 {formatAsOf(item.asOf)}</p> : null}
        </div>
      ))}
    </div>
  );
}

function AxisCard({ axis }: { axis: Axis }) {
  return (
    <section className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)]">
      <header className="mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-4)]">판정 근거</p>
          <h2 className="mt-1 text-lg font-black text-[var(--c-ink)]">{axis.title}</h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-[var(--c-ink-3)]">{axis.summary}</p>
        </div>
        <span className={cx("shrink-0 rounded-full border px-2.5 py-1 text-xs font-black", toneClass(axis.tone))}>
          {toneLabel(axis.tone)}
        </span>
      </header>
      <EvidenceList items={axis.pulses} />
    </section>
  );
}

export default function RegimeClient() {
  const {
    indices,
    macroPulses,
    signalPulses,
    sentimentPulses,
    structurePulses,
    erpInsight,
    bondPulses,
    dataSources,
    dataReady,
    failed,
    sourceDate,
  } = useMarketValuation();

  const sp500 = indices.find((index) => index.id === "sp500");
  const valuationPulse = sp500ValuationPulse(sp500);
  const erpPulse: Pulse | null = erpInsight
    ? {
        id: "erp",
        label: "주식위험프리미엄",
        valueLabel: erpInsight.regimeLabel,
        detail: `미국 ERP ${formatRatePercent(erpInsight.usErp)} · 역사 백분위 ${formatPercent(erpInsight.historicalPercentile, 0)}`,
        asOf: erpInsight.sourceDate,
        tone: erpInsight.regimeTone,
      }
    : null;

  const axes: Axis[] = [
    {
      id: "structure",
      title: "시장 구조",
      summary: "고점 대비 위치와 상위 종목 집중도를 함께 봅니다.",
      pulses: structurePulses.slice(0, 4).map(toStructurePulse),
      tone: strongestTone(structurePulses.slice(0, 4).map(toStructurePulse)),
    },
    {
      id: "signals",
      title: "유동성·리스크",
      summary: "가공 신호가 안정, 주의, 경계 중 어디에 놓였는지 확인합니다.",
      pulses: signalPulses.map(toSignalPulse),
      tone: strongestTone(signalPulses.map(toSignalPulse)),
    },
    {
      id: "macro",
      title: "경기·금리",
      summary: "PMI와 금리·스프레드가 성장과 스트레스를 어떻게 가리키는지 봅니다.",
      pulses: [...macroPulses.slice(0, 3).map(toMacroPulse), ...bondPulses.slice(0, 2).map(toBondPulse)],
      tone: strongestTone([...macroPulses.slice(0, 3).map(toMacroPulse), ...bondPulses.slice(0, 2).map(toBondPulse)]),
    },
    {
      id: "valuation",
      title: "밸류에이션·보상",
      summary: "지수 멀티플 부담과 주식위험프리미엄 보상을 같이 봅니다.",
      pulses: [valuationPulse, erpPulse, ...sentimentPulses.slice(0, 2).map(toSentimentPulse)].filter((item): item is Pulse => item !== null),
      tone: strongestTone([valuationPulse, erpPulse, ...sentimentPulses.slice(0, 2).map(toSentimentPulse)].filter((item): item is Pulse => item !== null)),
    },
  ];

  const headline = buildHeadline(axes);
  const latestSource = latestAsOf([
    sourceDate,
    ...axes.flatMap((axis) => axis.pulses.map((pulse) => pulse.asOf)),
  ]);
  const visibleSources = dataSources.filter((source) => ["benchmarks", "yardney", "damodaran", "macro", "computed", "sentiment", "indices", "slickcharts"].includes(source.id));

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">시장 국면</p>
          <h1 className="data-shell-title">시장 국면</h1>
          <p className="data-shell-desc">
            이미 계산된 시장 구조, 유동성, 경기, 투자심리, 밸류에이션 신호를 한 화면에서 묶어 봅니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {latestSource ? (
            <span className="data-shell-pill ok">
              <span />
              기준 {formatAsOf(latestSource)}
            </span>
          ) : null}
          <MarketSectionNav active="regime" />
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-[var(--c-line)] bg-[var(--c-surface-2)] px-4 py-3 text-sm font-semibold text-[var(--c-ink)]">
          시장 국면 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      <section className={cx("rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-5 shadow-[var(--sh-sm)]", !dataReady && "opacity-70")}>
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-brand)]">종합 판독</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-[var(--c-ink)]">{headline.label}</h2>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-[var(--c-ink-3)]">{headline.detail}</p>
          </div>
          <span className={cx("inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-black", toneClass(headline.tone))}>
            <span className={cx("h-2.5 w-2.5 rounded-full", dotClass(headline.tone))} />
            {toneLabel(headline.tone)}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {axes.map((axis) => (
            <div key={axis.id} className="rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-3">
              <p className="text-[11px] font-black text-[var(--c-ink-4)]">{axis.title}</p>
              <p className={cx("mt-1 text-lg font-black", toneTextClass(axis.tone))}>
                {toneLabel(axis.tone)}
              </p>
              <p className="mt-1 text-xs font-semibold text-[var(--c-ink-3)]">{axis.pulses.length}개 신호</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {axes.map((axis) => (
          <AxisCard key={axis.id} axis={axis} />
        ))}
      </section>

      <section className="rounded-[1.25rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-4 shadow-[var(--sh-sm)]">
        <header className="mb-3 flex min-w-0 flex-wrap items-end justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-[var(--c-ink-4)]">자료 기준</p>
            <h2 className="mt-1 text-lg font-black text-[var(--c-ink)]">저장 데이터 갱신 정보</h2>
          </div>
          <p className="text-xs font-semibold text-[var(--c-ink-3)]">직접 실시간 조회 없이 저장된 데이터만 사용</p>
        </header>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visibleSources.map((source) => (
            <div key={source.id} className="rounded-[1rem] border border-[var(--c-line)] bg-white/70 px-3 py-3">
              <p className="text-sm font-black text-[var(--c-ink)]">{readableSourceLabel(source)}</p>
              <p className="mt-1 text-xs font-semibold leading-5 text-[var(--c-ink-3)]">{readableSourceUsage(source)}</p>
              <p className="mt-2 text-[10px] font-bold text-[var(--c-ink-4)]">
                {source.updated ? `갱신 ${formatAsOf(source.updated)}` : "갱신일 확인 필요"}
                {source.cadence ? ` · ${readableCadence(source.cadence)}` : ""}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
