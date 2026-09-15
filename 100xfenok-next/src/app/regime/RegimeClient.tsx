"use client";

import MarketSectionNav from "@/components/market/MarketSectionNav";
import TransitionLink from "@/components/TransitionLink";
import { DistributionBand, EvidenceRail, Panel, PanelHeader, Pill } from "@/components/ui";
import { useMarketValuation } from "@/hooks/useMarketValuation";
import { DATA_STATE_LABELS, dateOnly, formatAsOf, isStaleAsOf } from "@/lib/data-state";
import type {
  MarketBondPulse,
  MarketIndexValuation,
  MarketMacroPulse,
  MarketSentimentPulse,
  MarketSignalPulse,
  MarketStructurePulse,
  MarketTone,
} from "@/lib/market-valuation/types";
import { ROUTES } from "@/lib/routes";

type Pulse = {
  id: string;
  label: string;
  valueLabel: string;
  detail: string;
  asOf: string | null;
  period?: string | null;
  tone: MarketTone;
};

type Axis = {
  id: string;
  title: string;
  summary: string;
  tone: MarketTone;
  pulses: Pulse[];
  ready: boolean;
  asOf: string | null;
};

type PillTone = "neutral" | "up" | "down" | "warn";

type RegimeAction = {
  key: string;
  label: string;
  detail: string;
  href: string;
};

const REGIME_ACTIONS: RegimeAction[] = [
  {
    key: "events",
    label: "이벤트 확인",
    detail: "이번 주 리스크 일정",
    href: ROUTES.marketEvents,
  },
  {
    key: "sectors",
    label: "섹터 강도 확인",
    detail: "시황과 맞는 업종 강도",
    href: ROUTES.sectors,
  },
  {
    key: "screener",
    label: "스크리너 압축",
    detail: "조건에 맞는 종목 후보",
    href: ROUTES.screener,
  },
  {
    key: "portfolio",
    label: "포트폴리오 점검",
    detail: "내 보유와 위험 노출점",
    href: ROUTES.portfolio,
  },
];

const AXIS_SUMMARIES: Record<string, string> = {
  structure: "고점 대비 위치와 상위 종목 집중도를 함께 봅니다.",
  signals: "가공 신호가 안정, 주의, 경계 중 어디에 놓였는지 확인합니다.",
  macro: "PMI와 금리·스프레드가 성장과 스트레스를 어떻게 가르는지 봅니다.",
  valuation: "지수 멀티플 부담과 주식위험프리미엄 보상을 같이 봅니다.",
};

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

function axisPillTone(tone: MarketTone): PillTone {
  if (tone === "rose") return "down";
  if (tone === "amber") return "warn";
  if (tone === "emerald") return "up";
  return "neutral";
}

function axisLabelClass(tone: MarketTone): string {
  if (tone === "rose") return "rgm-down";
  if (tone === "amber") return "rgm-warn";
  if (tone === "emerald") return "rgm-up";
  return "rgm-mute";
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

function axisBarClass(tone: MarketTone): string {
  if (tone === "rose") return "rgm-bar-down";
  if (tone === "amber") return "rgm-bar-warn";
  if (tone === "emerald") return "rgm-bar-up";
  return "";
}

const ENGLISH_MONTHS: Record<string, number> = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};

function canonicalObservationDate(value: string | null): string | null {
  const isoDate = dateOnly(value);
  if (isoDate) return isoDate;
  const match = typeof value === "string" ? /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(value.trim()) : null;
  if (!match) return null;
  const month = ENGLISH_MONTHS[match[1]];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Oldest real observation/release date, used only for rail disclosure. */
function oldestDatedSourceDate(values: Array<string | null>): string | null {
  const dated = values.map(canonicalObservationDate).filter((value): value is string => value !== null);
  if (dated.length === 0) return null;
  return dated.sort().at(0) ?? null;
}

function latestDatedSourceDate(values: Array<string | null>): string | null {
  const dated = values.map(canonicalObservationDate).filter((value): value is string => value !== null);
  if (dated.length === 0) return null;
  return dated.sort().at(-1) ?? null;
}

function formatPeriod(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  const quarter = /^(\d{4})-?Q([1-4])$/i.exec(trimmed);
  if (quarter) return `${quarter[1]}Q${quarter[2]}`;
  return trimmed;
}

function axisAsOfLabel(axis: Axis): string {
  const labels: string[] = [];
  if (axis.asOf) labels.push(`기준 ${formatAsOf(axis.asOf) ?? axis.asOf}`);
  const latestPeriod = axis.pulses
    .map((pulse) => formatPeriod(pulse.period))
    .filter((period): period is string => period !== null)
    .sort()
    .at(-1);
  if (latestPeriod) labels.push(`기간 ${latestPeriod}`);
  return labels.join(" · ") || "관측일 미제공";
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
  return labels[value] ?? "기타 신호";
}

function valuationTone(percentile: number | null): MarketTone {
  if (percentile === null) return "slate";
  if (percentile >= 80) return "rose";
  if (percentile >= 60) return "amber";
  if (percentile <= 25) return "emerald";
  return "slate";
}

function valuationLabel(percentile: number | null): string {
  if (percentile === null) return DATA_STATE_LABELS.unavailable;
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
    // SlickCharts `updated` is the collection clock. The current structure
    // payloads carry no observation date, so freshness must remain unknown.
    asOf: null,
    tone: item.tone,
  };
}

function toMacroPulse(item: MarketMacroPulse): Pulse {
  return {
    id: item.id,
    label: item.label,
    valueLabel: `${formatNumber(item.value)} ${item.unit}`.trim(),
    detail: readableDetail(item.detail),
    // A period is not an observation day. Keep it as a labelled period and
    // reserve `asOf` for a real release/observation date.
    asOf: item.releaseDate,
    period: item.period,
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

/**
 * Composite position — a pure client-side transform of already-loaded tone counts
 * (friendlyCount − cautionCount − alertCount×2, normalized to 0-100). No new data source;
 * a true numeric regime score is not emitted by the hook. Returns null when there is
 * nothing to read: callers gate bodies on null instead of rendering a neutral 50.
 */
function gaugeReading(pulses: Pulse[]) {
  const { alert, caution, friendly } = toneCounts(pulses);
  const total = pulses.length;
  if (total === 0) {
    return null;
  }
  const raw = friendly - caution - alert * 2;
  const min = -2 * total;
  const max = total;
  const percent = ((raw - min) / (max - min)) * 100;
  const position = percent < 20 ? "경계" : percent < 40 ? "주의" : percent < 60 ? "중립" : percent < 80 ? "양호" : "강한 양호";
  return { percent, position, alert, caution, friendly, total };
}

function openEvidence(path: string) {
  window.open(path, "_blank", "noopener");
}

/* Composite gauge zones — the same 20/40/60/80 cuts `gaugeReading` labels and the
 * CSS track below paints. */
const GAUGE_TICKS = [20, 40, 60, 80];

/**
 * One axis's pulse tones as distribution segments. The live counts already exist
 * client-side, so nothing new is fetched; 중립 is the remainder of the axis's own
 * signals, and every tone is emitted (zeros included) so the band always accounts
 * for the axis's whole signal count.
 */
function toneDistribution(pulses: Pulse[]) {
  const { alert, caution, friendly } = toneCounts(pulses);
  const neutral = pulses.length - alert - caution - friendly;
  return [
    { key: "양호", count: friendly, tone: "gain" as const },
    { key: "주의", count: caution, tone: "warn" as const },
    { key: "경계", count: alert, tone: "loss" as const },
    { key: "중립", count: neutral, tone: "neutral" as const },
  ];
}

/** The word one axis's composition reads as, for the calm half of the sentence. */
function dominantWord(pulses: Pulse[]): string {
  return toneLabel(strongestTone(pulses));
}

/**
 * One-line read of the axis composition band, generated from the live counts.
 * Axes that carry a 주의/경계 signal are named with their counts; calm axes are
 * named without counts; an axis with no signals is stated as such instead of
 * disappearing from the sentence.
 */
function compositionSentence(axes: Axis[]): string {
  const tense = axes
    .filter((axis) => axis.pulses.length > 0 && (axis.tone === "rose" || axis.tone === "amber"))
    .sort((left, right) => toneRank(right.tone) - toneRank(left.tone));
  const calm = axes.filter(
    (axis) => axis.pulses.length > 0 && axis.tone !== "rose" && axis.tone !== "amber",
  );
  const silentCount = axes.filter((axis) => axis.pulses.length === 0).length;

  const tenseText = tense
    .map((axis) => {
      const { alert, caution } = toneCounts(axis.pulses);
      const parts = [alert > 0 ? `경계 ${alert}개` : null, caution > 0 ? `주의 ${caution}개` : null];
      return `${axis.title} 축에 ${parts.filter((part): part is string => part !== null).join(" · ")}`;
    })
    .join(", ");

  const calmText =
    calm.length === 0
      ? ""
      : `${tense.length > 0 ? "나머지 " : ""}${calm.map((axis) => axis.title).join("·")} 축은 ${[...new Set(calm.map(dominantWord))].join("·")}입니다`;

  const silentText = silentCount === 0 ? "" : `신호가 없는 ${silentCount}개 축은 그대로 신호 없음입니다`;

  if (tense.length === 0) {
    const calmOnly = [calmText, silentText].filter((part) => part.length > 0).join(", ");
    return calmOnly.length === 0 ? "" : `지금은 ${calmOnly}.`;
  }
  return `지금은 ${[tenseText, calmText, silentText].filter((part) => part.length > 0).join(", ")}.`;
}

function headerSentence(
  axes: Axis[],
  gauge: ReturnType<typeof gaugeReading>,
  loading: boolean,
  failed: boolean,
): string {
  if (loading) return "시장 신호를 불러오는 중입니다.";
  if (failed) return "시황 데이터를 불러오지 못했습니다.";
  if (gauge === null) return "표시할 신호가 아직 없습니다. 다음 마감 후 다시 확인해 주세요.";
  const hot = axes.filter((axis) => axis.pulses.length > 0 && (axis.tone === "rose" || axis.tone === "amber"));
  if (hot.length === 0) {
    return `긍정 신호 ${gauge.friendly}개 · ${gauge.position} — 과열 신호가 없습니다.`;
  }
  return `긍정 ${gauge.friendly} · 주의 ${gauge.caution} · 경계 ${gauge.alert} — 살펴볼 축: ${hot.map((axis) => axis.title).join("·")}.`;
}

function CompositePanel({
  axes,
  gauge,
  loading,
  failed,
  ready,
  partial,
  stale,
  asOf,
  oldestInputAsOf,
  onRefetch,
}: {
  axes: Axis[];
  gauge: ReturnType<typeof gaugeReading>;
  loading: boolean;
  failed: boolean;
  ready: boolean;
  partial: boolean;
  stale: boolean;
  asOf: string | null;
  oldestInputAsOf: string | null;
  onRefetch: () => void;
}) {
  const score = gauge === null ? null : Math.round(gauge.percent);
  const emptyActive = failed || (!loading && !ready);
  return (
    <Panel
      loading={loading}
      empty={emptyActive}
      emptyReason={failed ? "시황 데이터를 불러오지 못했습니다" : "표시할 신호가 아직 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel="다시 시도"
      onEmptyAction={onRefetch}
    >
      {ready && gauge !== null && score !== null && (
        <div data-regime-headline>
          <PanelHeader
            eyebrow="Si-hwang"
            title="종합 신호"
            right={
              <Pill tone={asOf ? "neutral" : "warn"} data-regime-composite-asof>
                {asOf ? `기준 ${formatAsOf(asOf)}` : "기준일 확인 필요"}
              </Pill>
            }
          />
          <div className="rgm-score">
            <div className="rgm-score-num">
              <span className="tabular-nums rgm-score-value">{score}</span>
              <span className="rgm-score-unit">/ 100 · {gauge.position}</span>
              <span className="rgm-score-counts tabular-nums">
                긍정 {gauge.friendly} · 주의 {gauge.caution} · 경계 {gauge.alert}
              </span>
            </div>
            {/* Composite gauge: the score's own 0-100 position over the zone cuts
                gaugeReading labels (20/40/60/80). The track shows the zones, the
                marker shows where this reading sits; both are tokens, no new scale. */}
            <div
              className="rgm-gauge"
              role="img"
              aria-label={`종합 ${score}/100 · ${gauge.position} · 구간 눈금 ${GAUGE_TICKS.join(" · ")}점`}
            >
              <div className="rgm-gauge-track">
                <span
                  className="rgm-gauge-marker"
                  style={{ left: `clamp(0.5%, ${gauge.percent}%, 99.5%)` }}
                />
              </div>
            </div>
            <div className="rgm-meters">
              {axes.map((axis) => {
                const reading = gaugeReading(axis.pulses);
                const counts = reading === null ? null : toneCounts(axis.pulses);
                return (
                  <div className="rgm-band-row" key={axis.id} data-regime-axis-band={axis.id}>
                    <div className="rgm-band-top">
                      <span className="rgm-band-label">{axis.title}</span>
                      <span className={`rgm-band-word ${axisLabelClass(axis.tone)}`}>{toneLabel(axis.tone)}</span>
                      <span className="rgm-band-count tabular-nums">
                        {axis.pulses.length > 0 ? `${axis.pulses.length}개 신호` : "신호 없음"}
                      </span>
                    </div>
                    {counts !== null && (
                      <DistributionBand
                        className="rgm-band"
                        segments={toneDistribution(axis.pulses)}
                        ariaLabel={`${axis.title} 신호 구성`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {axes.some((axis) => axis.pulses.length > 0) && (
              <p className="rgm-score-read" data-regime-composition-read>
                {compositionSentence(axes)}
              </p>
            )}
          </div>
        </div>
      )}
      <div data-regime-composite-rail>
        <EvidenceRail
          freshness={loading ? "pending" : failed || !ready ? "error" : partial ? "partial" : stale ? "stale" : "fresh"}
          source="시황 엔진"
          asOf={asOf ? (formatAsOf(asOf) ?? asOf) : "—"}
          coverage={
            gauge === null
              ? "0개 신호"
              : `${gauge.total}개 신호${oldestInputAsOf ? ` · 가장 오래된 입력 ${formatAsOf(oldestInputAsOf) ?? oldestInputAsOf}` : ""}`
          }
          onRetry={failed || stale || partial ? onRefetch : undefined}
          onEvidence={ready && !failed ? () => openEvidence("/data/computed/signals.json") : undefined}
        />
      </div>
    </Panel>
  );
}

function AxisTablePanel({
  axes,
  loading,
  failed,
  ready,
  partial,
  stale,
  floor,
  undatedStructure,
  onRefetch,
}: {
  axes: Axis[];
  loading: boolean;
  failed: boolean;
  ready: boolean;
  partial: boolean;
  stale: boolean;
  floor: string | null;
  undatedStructure: boolean;
  onRefetch: () => void;
}) {
  const readyAxes = axes.filter((axis) => axis.ready).length;
  return (
    <Panel
      loading={loading}
      empty={failed || (!loading && !ready)}
      emptyReason={failed ? "축별 신호 요약을 불러오지 못했습니다" : "표시할 신호가 아직 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel="다시 시도"
      onEmptyAction={onRefetch}
    >
      {ready && (
        <>
          <PanelHeader eyebrow="Axis Breakdown" title="축별 신호 요약" right={<Pill>4개 축</Pill>} />
          <div role="table" aria-label="축별 신호 요약">
            <div className="rgm-thead" role="row">
              <span role="columnheader">축</span>
              <span role="columnheader">요약</span>
              <span role="columnheader">신호수</span>
              <span role="columnheader">상태</span>
            </div>
            {axes.map((axis) => (
              // Unavailable axes render the shared empty row, never a
              // zero-signal row: "0개 · 신호 없음" would read as a genuine
              // all-clear reading instead of a missing feed.
              !axis.ready ? (
                <div className="rgm-trow" role="row" key={axis.id} data-regime-axis-unavailable={axis.id}>
                  <span className="rgm-axis" role="cell">
                    <span>{axis.title}</span>
                    <span className="rgm-axis-asof" data-regime-axis-asof>관측일 확인 필요</span>
                  </span>
                  <span className="rgm-sum" role="cell">피드를 받지 못했습니다 · 다음 마감 후 갱신</span>
                  <span className="tabular-nums" role="cell">—</span>
                  <span role="cell">
                    <Pill tone="neutral">미수신</Pill>
                  </span>
                </div>
              ) : (
              <div className="rgm-trow" role="row" key={axis.id} data-regime-axis-summary-card={axis.id}>
                <span className="rgm-axis" role="cell">
                  <span>{axis.title}</span>
                  <span className="rgm-axis-asof" data-regime-axis-asof title={axisAsOfLabel(axis)}>
                    {axisAsOfLabel(axis)}
                  </span>
                </span>
                <span className="rgm-sum" role="cell">{axis.summary}</span>
                <span className="tabular-nums" role="cell">{axis.pulses.length}개</span>
                <span role="cell">
                  {axis.pulses.length > 0 ? (
                    <Pill tone={axisPillTone(axis.tone)}>{toneLabel(axis.tone)}</Pill>
                  ) : (
                    <Pill tone="neutral">신호 없음</Pill>
                  )}
                </span>
              </div>
              )
            ))}
          </div>
          {undatedStructure && (
            <div className="rgm-floor-note" data-regime-floor-note>
              시장 구조 신호는 관측일이 제공되지 않아 기준일 계산에서 제외됩니다.
            </div>
          )}
        </>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : partial ? "partial" : stale ? "stale" : "fresh"}
        source="시황 엔진"
        asOf={floor ? (formatAsOf(floor) ?? floor) : "—"}
        coverage={`${readyAxes}/4 축`}
        onRetry={failed || stale || partial ? onRefetch : undefined}
        onEvidence={ready && !failed ? () => openEvidence("/data/computed/signals.json") : undefined}
      />
    </Panel>
  );
}

/** 주간 시황 기록 한 칸: 그 주의 기준일과 판정 톤(양호·주의·경계·중립). */
type RegimeHistoryWeek = {
  week: string;
  tone: MarketTone;
};

/**
 * 시황 기록 — 최근 12주.
 *
 * 이 패널은 지금 늘 빈 상태였다: 날짜별 시황 피드가 없고(생산자·산출물·스키마
 * 없음) 그래서 채울 데이터 자체가 없다. archive가 빈 동안에는 카드와 빈 상태를
 * 그리지 않고 한 줄로 접어 두고, 소스가 생겨 archive가 차면 같은
 * data-regime-history 자리에서 12주 스트립으로 자동으로 펼쳐진다.
 */
function HistoryPanel({
  archive,
  onRefetch,
}: {
  archive: RegimeHistoryWeek[];
  onRefetch: () => void;
}) {
  if (archive.length === 0) {
    return (
      <p className="rgm-history-note" data-regime-history>
        시황 기록 — 최근 12주: 날짜별 데이터가 아직 없습니다.
      </p>
    );
  }

  const weeks = archive.slice(-12);
  const latest = weeks[weeks.length - 1];
  const latestStale = isStaleAsOf(latest.week);
  return (
    <Panel>
      <div data-regime-history>
        <PanelHeader eyebrow="Si-hwang History" title="시황 기록 — 최근 12주" right={<Pill>주간</Pill>} />
        <div className="rgm-history">
          <div
            className="rgm-history-strip"
            role="img"
            aria-label={`최근 ${weeks.length}주: ${weeks.map((item) => `${dateOnly(item.week) ?? item.week} ${toneLabel(item.tone)}`).join(", ")}`}
          >
            {weeks.map((item) => (
              <span
                key={item.week}
                className={`rgm-hweek ${axisBarClass(item.tone)}`}
                data-current={item.week === latest.week ? "true" : undefined}
              />
            ))}
          </div>
          <div className="rgm-history-axis">
            <span className="tabular-nums">{dateOnly(weeks[0].week) ?? weeks[0].week}</span>
            <span>현재</span>
          </div>
          <div className="rgm-history-legend">
            <span><i className="rgm-hkey rgm-bar-up" aria-hidden="true" />양호</span>
            <span><i className="rgm-hkey rgm-bar-warn" aria-hidden="true" />주의</span>
            <span><i className="rgm-hkey rgm-hkey-current" aria-hidden="true" />현재 주</span>
          </div>
        </div>
        <EvidenceRail
          freshness={latestStale ? "stale" : "fresh"}
          source="시황 엔진 기록"
          asOf={formatAsOf(latest.week) ?? latest.week}
          coverage={`${weeks.length}/12주`}
          onRetry={latestStale ? onRefetch : undefined}
        />
      </div>
    </Panel>
  );
}

function ActionsPanel({
  loading,
  failed,
  partial,
  floor,
  onRefetch,
}: {
  loading: boolean;
  failed: boolean;
  partial: boolean;
  floor: string | null;
  onRefetch: () => void;
}) {
  return (
    <Panel>
      <PanelHeader eyebrow="Next Actions" title="다음 확인" right={<Pill>4개</Pill>} />
      <div data-regime-action-rail>
        {REGIME_ACTIONS.map((action) => (
          <TransitionLink
            key={action.key}
            href={action.href}
            className="rgm-arow"
            data-regime-action={action.key}
          >
            <span className="rgm-atext">
              <span className="rgm-alabel">{action.label}</span>
              <span className="rgm-adetail">{action.detail}</span>
            </span>
            <span className="rgm-abtn" aria-hidden="true">열기</span>
          </TransitionLink>
        ))}
      </div>
      <EvidenceRail
        freshness={loading ? "pending" : failed ? "error" : !floor || partial ? "partial" : "fresh"}
        source="시황 엔진"
        asOf={floor ? (formatAsOf(floor) ?? floor) : "—"}
        coverage="4/4"
        onRetry={failed || partial ? onRefetch : undefined}
        onEvidence={failed ? undefined : () => openEvidence("/data/computed/signals.json")}
      />
    </Panel>
  );
}

export default function RegimeClient() {
  // 이 화면의 모든 섹션은 같은 피드 하나를 읽는다(useMarketValuation). 재시도는
  // 그 피드만 다시 읽고 페이지를 새로 고치지 않는다 — 다른 화면·스크롤 상태 유지.
  const {
    indices,
    macroPulses,
    signalPulses,
    sentimentPulses,
    structurePulses,
    erpInsight,
    bondPulses,
    sharedDailyObservationDate,
    dataReady,
    failed,
    feedReady,
    refetch,
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

  const structurePulseList = structurePulses.slice(0, 4).map(toStructurePulse);
  const signalPulseList = signalPulses.map(toSignalPulse);
  const macroPulseList = [...macroPulses.slice(0, 3).map(toMacroPulse), ...bondPulses.slice(0, 2).map(toBondPulse)];
  const valuationPulseList = [valuationPulse, erpPulse, ...sentimentPulses.slice(0, 2).map(toSentimentPulse)].filter((item): item is Pulse => item !== null);

  const axes: Axis[] = [
    {
      id: "structure",
      title: "시장 구조",
      summary: AXIS_SUMMARIES.structure,
      pulses: structurePulseList,
      tone: strongestTone(structurePulseList),
      ready: feedReady.structure,
      asOf: latestDatedSourceDate(structurePulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "signals",
      title: "유동성·리스크",
      summary: AXIS_SUMMARIES.signals,
      pulses: signalPulseList,
      tone: strongestTone(signalPulseList),
      ready: feedReady.computed,
      asOf: latestDatedSourceDate(signalPulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "macro",
      title: "경기·금리",
      summary: AXIS_SUMMARIES.macro,
      pulses: macroPulseList,
      tone: strongestTone(macroPulseList),
      // Per-axis completeness: ready is AND over child feeds, so a missing
      // bond feed can never hide behind present macro pulses.
      ready: feedReady.macro && feedReady.bond,
      asOf: latestDatedSourceDate(macroPulseList.map((pulse) => pulse.asOf)),
    },
    {
      id: "valuation",
      title: "밸류에이션·보상",
      summary: AXIS_SUMMARIES.valuation,
      pulses: valuationPulseList,
      tone: strongestTone(valuationPulseList),
      // Per-axis completeness: ready is AND over child feeds (index band,
      // ERP insight, sentiment), never OR.
      ready: feedReady.valuation && feedReady.erp && feedReady.sentiment,
      asOf: latestDatedSourceDate(valuationPulseList.map((pulse) => pulse.asOf)),
    },
  ];

  const allPulses = axes.flatMap((axis) => axis.pulses);
  const gauge = gaugeReading(allPulses);
  const compositeAsOf = sharedDailyObservationDate;
  // This disclosure is deliberately separate from the composite basis date.
  // It includes only real observation/release dates: periods and manifest
  // collection clocks never enter either calculation.
  const oldestInputAsOf = oldestDatedSourceDate(allPulses.map((pulse) => pulse.asOf));

  const isLoading = !dataReady && !failed;
  const ready = !isLoading && !failed && gauge !== null;
  const partial = ready && (axes.some((axis) => !axis.ready) || compositeAsOf === null);
  const stale = ready && !partial && isStaleAsOf(compositeAsOf);
  const undatedStructure = axes[0].pulses.length > 0;
  // 주간 시황 기록 소스가 아직 없다(생산자·산출물·스키마 없음). 소스가 생겨 이
  // 배열이 채워지면 기록 패널이 자동으로 펼쳐진다.
  const historyArchive: RegimeHistoryWeek[] = [];

  return (
    <div className="rgm" data-regime-surface>
      <div className="rgm-head">
        <div className="rgm-title-block">
          <h1 className="rgm-title">시황</h1>
          <span className="rgm-verdict">{headerSentence(axes, gauge, isLoading, failed)}</span>
        </div>
        <div className="rgm-tabs">
          <MarketSectionNav active="regime" />
        </div>
      </div>

      <CompositePanel axes={axes} gauge={gauge} loading={isLoading} failed={failed} ready={ready} partial={partial} stale={stale} asOf={compositeAsOf} oldestInputAsOf={oldestInputAsOf} onRefetch={refetch} />
      <AxisTablePanel axes={axes} loading={isLoading} failed={failed} ready={ready} partial={partial} stale={stale} floor={compositeAsOf} undatedStructure={undatedStructure} onRefetch={refetch} />
      <HistoryPanel archive={historyArchive} onRefetch={refetch} />
      <ActionsPanel loading={isLoading} failed={failed} partial={partial} floor={compositeAsOf} onRefetch={refetch} />
    </div>
  );
}
