"use client";

import {
  CpAccordion,
  CpCTARow,
  CpGaugeCard,
  CpMeterRow,
  CpSectionCard,
  CpVerdictHero,
  type CpTone,
} from "@/components/canvas-plus/kit";
import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { formatAsOf, freshnessDataState, latestAsOf } from "@/lib/data-state";
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
import { ROUTES } from "@/lib/routes";

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

type RegimeAction = {
  key: string;
  label: string;
  detail: string;
  href: string;
};

const REGIME_ACTIONS: RegimeAction[] = [
  {
    key: "events",
    label: "이벤트",
    detail: "이번 주 리스크 일정 확인",
    href: ROUTES.marketEvents,
  },
  {
    key: "sectors",
    label: "섹터",
    detail: "국면과 맞는 업종 강도 확인",
    href: ROUTES.sectors,
  },
  {
    key: "screener",
    label: "스크리너",
    detail: "조건에 맞는 종목 후보 압축",
    href: ROUTES.screener,
  },
  {
    key: "portfolio",
    label: "포트폴리오",
    detail: "내 보유와 위험 노출 점검",
    href: ROUTES.portfolio,
  },
];

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
  if (tone === "emerald") return "양호";
  return "중립";
}

/** Maps the route's 4-value MarketTone (rose/amber/emerald/slate) onto the kit's CpTone. */
function carrierTone(tone: MarketTone): CpTone {
  if (tone === "rose") return "negative";
  if (tone === "amber") return "warning";
  if (tone === "emerald") return "positive";
  return "neutral";
}

/** Discrete axis tone → a position on the 경계→양호 meter track (see brief-regime.md D). */
function axisPercent(tone: MarketTone): number {
  if (tone === "rose") return 15;
  if (tone === "amber") return 40;
  if (tone === "emerald") return 85;
  return 55;
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

function toneCounts(pulses: Pulse[]) {
  return {
    alert: pulses.filter((pulse) => pulse.tone === "rose").length,
    caution: pulses.filter((pulse) => pulse.tone === "amber").length,
    friendly: pulses.filter((pulse) => pulse.tone === "emerald").length,
  };
}

function buildHeadline(axes: Axis[]) {
  const pulses = axes.flatMap((axis) => axis.pulses);
  const { alert: alertCount, caution: cautionCount, friendly: friendlyCount } = toneCounts(pulses);
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
      detail: `주의 ${cautionCount}개, 긍정 ${friendlyCount}개입니다. 방향성보다 리스크 점검이 먼저입니다.`,
    };
  }
  if (friendlyCount > 0) {
    return {
      label: "긍정 신호 우세",
      tone: "emerald" as MarketTone,
      detail: `긍정 신호 ${friendlyCount}개가 확인됩니다. 단, 밸류에이션과 심리 과열 여부는 함께 봐야 합니다.`,
    };
  }
  return {
    label: "중립 혼합",
    tone: "slate" as MarketTone,
    detail: "강한 한쪽 신호보다 중립 신호가 많은 상태입니다.",
  };
}

/**
 * Composite gauge position — a pure client-side transform of already-loaded tone counts
 * (friendlyCount − cautionCount − alertCount×2, normalized to 0-100). No new data source;
 * see brief-regime.md section G/H — a true numeric regime score is not emitted by the hook.
 */
function gaugeReading(pulses: Pulse[]) {
  const { alert, caution, friendly } = toneCounts(pulses);
  const total = pulses.length;
  if (total === 0) {
    return { percent: 50, tone: "neutral" as CpTone, position: "중립", alert, caution, friendly, total };
  }
  const raw = friendly - caution - alert * 2;
  const min = -2 * total;
  const max = total;
  const percent = ((raw - min) / (max - min)) * 100;
  const tone: CpTone = alert > 0 ? "negative" : caution > friendly ? "warning" : friendly > 0 ? "positive" : "neutral";
  const position = percent < 20 ? "경계" : percent < 40 ? "주의" : percent < 60 ? "중립" : percent < 80 ? "양호" : "강한 양호";
  return { percent, tone, position, alert, caution, friendly, total };
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
    return <p className="cpw5-regime-evidence-row__detail">표시할 신호가 없습니다.</p>;
  }
  return (
    <div className="cpw5-regime-evidence-list">
      {items.map((item) => (
        <div key={item.id} className="cpw5-regime-evidence-row" data-regime-evidence-row={item.id}>
          <div className="cpw5-regime-evidence-row__main">
            <p className="cpw5-regime-evidence-row__label">{item.label}</p>
            <p className="cpw5-regime-evidence-row__detail">{item.detail}</p>
            {item.asOf ? <p className="cpw5-regime-evidence-row__asof">기준 {formatAsOf(item.asOf)}</p> : null}
          </div>
          <span className="cpw5-regime-evidence-row__value" data-tone={carrierTone(item.tone)}>
            {item.valueLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

function AxisAccordion({ axis }: { axis: Axis }) {
  // CpAccordionProps intersects DetailsHTMLAttributes (native `title?: string` tooltip attr)
  // with its own `title: ReactNode`, so the merged type only accepts `string`. Cast around the
  // kit's own type collision rather than editing the read-only kit file.
  const axisTitle = (
    <span className="cpw5-regime-axis-title-row">
      <span className="cpw5-regime-tone-pill" data-tone={carrierTone(axis.tone)} data-regime-axis-tone>
        {toneLabel(axis.tone)}
      </span>
      {axis.title}
    </span>
  ) as unknown as string;

  return (
    <CpAccordion title={axisTitle} meta={`${axis.summary} · ${axis.pulses.length}개 신호`} data-regime-axis-card={axis.id}>
      <EvidenceList items={axis.pulses} />
    </CpAccordion>
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
  const allPulses = axes.flatMap((axis) => axis.pulses);
  const gauge = gaugeReading(allPulses);
  const latestSource = latestAsOf([sourceDate, ...allPulses.map((pulse) => pulse.asOf)]);
  const freshness = freshnessDataState({ asOf: latestSource, maxAgeDays: 3 });
  const visibleSources = dataSources.filter((source) => ["benchmarks", "yardney", "damodaran", "macro", "computed", "sentiment", "indices", "slickcharts"].includes(source.id));

  const isLoading = !dataReady && !failed;

  return (
    <div className="data-shell-page canvas-plus" data-regime-surface data-canvas-plus data-canvas-plus-regime>
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
        <div className="cpw5-empty" data-variant="skip-note" data-regime-failed>
          시장 국면 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {isLoading ? (
        <div className="cpw5-regime-skeleton" aria-busy="true" data-regime-loading>
          <div className="cpw5-regime-skeleton__hero" />
          <div className="cpw5-regime-skeleton__gauge" />
          <div className="cpw5-regime-skeleton__row" />
          <div className="cpw5-regime-skeleton__row" />
          <div className="cpw5-regime-skeleton__row" />
          <div className="cpw5-regime-skeleton__row" />
        </div>
      ) : null}

      {dataReady ? (
        <>
          <CpVerdictHero
            eyebrow="MARKET REGIME · 종합 판독"
            verdict={headline.label}
            sub={headline.detail}
            trustChips={[
              {
                label: freshness.status === "stale" ? "오래된 기준일" : "기준",
                value: formatAsOf(latestSource) ?? "확인 불가",
                freshness: true,
                tone: freshness.status === "ready" ? "positive" : freshness.status === "stale" ? "warning" : "neutral",
              },
            ]}
            data-regime-headline
          />

          <CpSectionCard title="국면 포지션" meta={`긍정 ${gauge.friendly} · 주의 ${gauge.caution} · 경계 ${gauge.alert}`}>
            <div className="cpw5-regime-gauge-wrap">
              <CpGaugeCard
                value={gauge.percent}
                displayValue={gauge.position}
                unitLabel="시장 국면"
                tone={gauge.tone}
                sub={
                  <>
                    긍정 신호 <b>{gauge.friendly}개</b>, 주의 신호 <b>{gauge.caution}개</b>, 경계 신호 <b>{gauge.alert}개</b>를 종합한
                    위치입니다.
                  </>
                }
              />
            </div>
          </CpSectionCard>

          <CpSectionCard variant="edge" eyebrow="AXIS · 4축 포지션" title="축별 신호 위치" meta={latestSource ? `기준 ${formatAsOf(latestSource)}` : undefined}>
            {axes.map((axis) => (
              <CpMeterRow
                key={axis.id}
                variant="axis"
                label={axis.title}
                value={toneLabel(axis.tone)}
                percent={axisPercent(axis.tone)}
                tone={carrierTone(axis.tone)}
                toneWord={`${axis.pulses.length}개 신호`}
                data-regime-axis-summary-card={axis.id}
              />
            ))}
          </CpSectionCard>

          <CpSectionCard title="오늘 확인 순서" meta="판독 후 바로 이어갈 작업">
            <div className="cpw5-regime-action-rail" data-regime-action-rail>
              {REGIME_ACTIONS.map((action, index) => (
                <TransitionLink
                  key={action.key}
                  href={action.href}
                  className="cpw5-regime-action-card"
                  data-regime-action={action.key}
                >
                  <span className="cpw5-regime-action-card__num">{index + 1}</span>
                  <span className="cpw5-regime-action-card__body">
                    <span className="cpw5-regime-action-card__label">{action.label}</span>
                    <span className="cpw5-regime-action-card__detail">{action.detail}</span>
                  </span>
                </TransitionLink>
              ))}
            </div>
          </CpSectionCard>

          <section className="grid gap-3" data-regime-axis-accordions>
            {axes.map((axis) => (
              <AxisAccordion key={axis.id} axis={axis} />
            ))}
          </section>

          <CpAccordion title="데이터 신선도 보기" meta="직접 실시간 조회 없이 저장된 데이터만 사용" data-regime-source-accordion>
            <div className="cpw5-regime-source-grid">
              {visibleSources.map((source) => (
                <div key={source.id} className="cpw5-regime-source-tile" data-regime-source-card={source.id}>
                  <p className="cpw5-regime-source-tile__label">{readableSourceLabel(source)}</p>
                  <p className="cpw5-regime-source-tile__usage">{readableSourceUsage(source)}</p>
                  <p className="cpw5-regime-source-tile__meta">
                    {source.updated ? `갱신 ${formatAsOf(source.updated)}` : "갱신일 확인 필요"}
                    {source.cadence ? ` · ${readableCadence(source.cadence)}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </CpAccordion>

          <CpCTARow
            primary={{ label: "스크리너로 이어가기", href: ROUTES.screener }}
            secondary={{ label: "포트폴리오 점검", href: ROUTES.portfolio }}
            note="투자 조언 아님"
          />
        </>
      ) : null}
    </div>
  );
}
