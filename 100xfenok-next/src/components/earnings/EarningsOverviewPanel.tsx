"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import {
  buildIncomeFlow,
  earningsYearOverYear,
  validEarningsSegments,
} from "../../lib/earnings/model";
import type {
  EarningsDocument,
  EarningsIncome,
  EarningsMetric,
  EarningsPeriod,
  IncomeFlow,
  IncomeFlowLink,
  IncomeFlowNode,
} from "../../lib/earnings/types";

import styles from "./EarningsOverview.module.css";

type EarningsOverviewPanelProps = {
  document: EarningsDocument;
  compact?: boolean;
};

type SummaryMetric = {
  id: EarningsMetric | "operatingMargin";
  label: string;
  value: string;
  detail?: string;
  tone?: "blue" | "orange" | "neutral" | "negative";
};

type NodeLayout = {
  node: IncomeFlowNode;
  x: number;
  y: number;
  width: number;
  height: number;
  slotY: number;
  slotHeight: number;
};

type FlowGeometry = {
  layouts: NodeLayout[];
  width: number;
  height: number;
  valueScale: number;
};

const flowLabels: Record<string, string> = {
  revenue: "매출",
  costOfRevenue: "매출원가",
  grossProfit: "매출총이익",
  operatingExpenses: "영업비용",
  operatingIncome: "영업이익",
  pretaxIncome: "세전이익",
  incomeTax: "법인세",
  afterTaxOther: "세후 기타손익",
  netIncome: "순이익",
  nonOperatingIncome: "영업외 수익",
  nonOperatingExpense: "영업외 비용",
};

const flowColors = {
  income: "#3679c9",
  profit: "#e58b3b",
  expense: "#b77950",
} as const;

const toneClasses: Record<NonNullable<SummaryMetric["tone"]>, string> = {
  blue: styles.toneBlue,
  orange: styles.toneOrange,
  neutral: styles.toneNeutral,
  negative: styles.toneNegative,
};

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatScaled(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000_000) return `${(absolute / 1_000_000_000_000).toFixed(1)}T`;
  if (absolute >= 1_000_000_000) return `${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000) return `${(absolute / 1_000_000).toFixed(1)}M`;
  return Math.round(absolute).toLocaleString("en-US");
}

function formatUsd(value: number | null): string {
  if (!isFiniteNumber(value)) return "—";
  return `$${value < 0 ? "−" : ""}${formatScaled(value)}`;
}

function formatFlowValue(value: number): string {
  if (!isFiniteNumber(value)) return "—";
  return `$${value < 0 ? "−" : ""}${formatScaled(value)}`;
}

function formatEps(value: number | null): string {
  if (!isFiniteNumber(value)) return "—";
  return `$${value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
}

function formatPercent(value: number | null): string {
  if (!isFiniteNumber(value)) return "—";
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

function operatingMargin(income: EarningsIncome): number | null {
  if (!isFiniteNumber(income.operatingIncome) || !isFiniteNumber(income.revenue) || income.revenue === 0) {
    return null;
  }
  return (income.operatingIncome / income.revenue) * 100;
}

function changePercent(current: number | null, previous: number | null): number | null {
  if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function comparisonText(current: number | null, previous: number | null, formatter: (value: number | null) => string): string {
  if (!isFiniteNumber(previous)) return "직전 분기 비교값 —";
  if (!isFiniteNumber(current)) return `직전 분기 ${formatter(previous)} · 비교값 없음`;
  if (previous < 0) {
    if (current > 0) return `직전 분기 ${formatter(previous)} · 흑자 전환`;
    if (current === 0) return `직전 분기 ${formatter(previous)} · 손익분기 전환`;
    return `직전 분기 ${formatter(previous)} · 적자 지속`;
  }
  const change = changePercent(current, previous);
  return `직전 분기 ${formatter(previous)} · ${change === null ? "전분기 대비 비교율 없음" : `전분기 대비 ${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`}`;
}

function yearOverYearText(period: EarningsPeriod, periods: EarningsPeriod[], metric: EarningsMetric): string {
  const change = earningsYearOverYear(period, periods, metric);
  return change === null ? "전년 동기 비교율 없음" : `전년 동기 ${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`;
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return "—";
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : value;
}

function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "earnings-overview";
}

function displayFlow(flow: IncomeFlow, period: EarningsPeriod): IncomeFlow {
  if (validEarningsSegments(period)) return flow;
  const nodes = flow.nodes.filter((node) => !node.id.startsWith("segment-"));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = flow.links.filter((link) => nodeIds.has(link.from) && nodeIds.has(link.to));
  return { ...flow, nodes, links };
}

function makeSummaryMetrics(period: EarningsPeriod, periods: EarningsPeriod[]): SummaryMetric[] {
  const income = period.income;
  return [
    {
      id: "revenue",
      label: "매출",
      value: formatUsd(income.revenue),
      detail: yearOverYearText(period, periods, "revenue"),
      tone: "blue",
    },
    {
      id: "dilutedEps",
      label: "EPS",
      value: formatEps(income.dilutedEps),
      detail: yearOverYearText(period, periods, "dilutedEps"),
      tone: "orange",
    },
    {
      id: "operatingMargin",
      label: "영업이익률",
      value: formatPercent(operatingMargin(income)),
      detail: "영업이익 ÷ 매출",
      tone: "neutral",
    },
    {
      id: "netIncome",
      label: "순이익",
      value: formatUsd(income.netIncome),
      detail: yearOverYearText(period, periods, "netIncome"),
      tone: isFiniteNumber(income.netIncome) && income.netIncome < 0 ? "negative" : "orange",
    },
  ];
}

function nodeLabel(node: IncomeFlowNode): string {
  if (node.id.startsWith("segment-")) return node.label;
  return flowLabels[node.id] ?? node.label;
}

function nodeTone(node: IncomeFlowNode): "income" | "profit" | "expense" {
  return node.kind;
}

function periodTimestamp(end: string): number {
  const timestamp = Date.parse(`${end}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function priorQuarterPeriod(current: EarningsPeriod, periods: EarningsPeriod[]): EarningsPeriod | undefined {
  const currentTimestamp = periodTimestamp(current.end);
  if (!Number.isFinite(currentTimestamp)) return undefined;
  return periods
    .filter((period) => period.end !== current.end)
    .filter((period) => {
      const timestamp = periodTimestamp(period.end);
      const gapDays = (currentTimestamp - timestamp) / 86_400_000;
      return Number.isFinite(timestamp) && gapDays >= 45 && gapDays <= 150;
    })
    .sort((left, right) => periodTimestamp(right.end) - periodTimestamp(left.end))[0];
}

function makeNodeLayouts(nodes: IncomeFlowNode[]): FlowGeometry {
  const columns = Array.from(new Set(nodes.map((node) => node.column))).sort((left, right) => left - right);
  const width = Math.max(900, 48 + columns.length * 154 + Math.max(0, columns.length - 1) * 44);
  const nodeWidth = 14;
  const horizontalPadding = 24;
  const columnStride = 198;
  const nodeGap = 12;
  const labelSlotHeight = 60;
  const maxColumnTotal = Math.max(
    1,
    ...columns.map((column) => nodes
      .filter((node) => node.column === column)
      .reduce((total, node) => total + Math.abs(node.value), 0)),
  );
  const targetBarTotalHeight = 206;
  const valueScale = targetBarTotalHeight / maxColumnTotal;
  const groupLayouts = columns.map((column) => {
    const group = nodes.filter((node) => node.column === column);
    const slotTotalHeight = group.reduce((sum, node) => sum + Math.max(labelSlotHeight, Math.abs(node.value) * valueScale), 0) + Math.max(0, group.length - 1) * nodeGap;
    return { column, group, slotTotalHeight };
  });
  const height = Math.max(320, ...groupLayouts.map((group) => group.slotTotalHeight + 68));
  const layouts: NodeLayout[] = [];
  for (const { column, group, slotTotalHeight } of groupLayouts) {
    let slotY = (height - slotTotalHeight) / 2;
    const x = horizontalPadding + columns.indexOf(column) * columnStride;
    for (const node of group) {
      const nodeHeight = Math.abs(node.value) * valueScale;
      const slotHeight = Math.max(labelSlotHeight, nodeHeight);
      const barY = slotY + (slotHeight - nodeHeight) / 2;
      layouts.push({ node, x, y: barY, width: nodeWidth, height: nodeHeight, slotY, slotHeight });
      slotY += slotHeight + nodeGap;
    }
  }
  return { layouts, width, height, valueScale };
}

function ribbonPath(source: NodeLayout, target: NodeLayout, sourceOffset: number, targetOffset: number, thickness: number): string {
  const startX = source.x + source.width;
  const endX = target.x;
  const sourceTop = source.y + sourceOffset;
  const sourceBottom = sourceTop + thickness;
  const targetTop = target.y + targetOffset;
  const targetBottom = targetTop + thickness;
  const control = Math.max(30, (endX - startX) * 0.46);
  return [
    `M ${startX} ${sourceTop}`,
    `C ${startX + control} ${sourceTop}, ${endX - control} ${targetTop}, ${endX} ${targetTop}`,
    `L ${endX} ${targetBottom}`,
    `C ${endX - control} ${targetBottom}, ${startX + control} ${sourceBottom}, ${startX} ${sourceBottom}`,
    "Z",
  ].join(" ");
}

function makeRibbonLayouts(flow: IncomeFlow, geometry: FlowGeometry): Array<{ link: IncomeFlowLink; path: string; thickness: number }> {
  const byId = new Map(geometry.layouts.map((layout) => [layout.node.id, layout]));
  const outgoingOffsets = new Map<string, number>();
  const incomingOffsets = new Map<string, number>();
  return flow.links.flatMap((link) => {
    const source = byId.get(link.from);
    const target = byId.get(link.to);
    if (!source || !target || link.value <= 0) return [];
    const thickness = link.value * geometry.valueScale;
    const sourceOffset = outgoingOffsets.get(link.from) ?? 0;
    const targetOffset = incomingOffsets.get(link.to) ?? 0;
    outgoingOffsets.set(link.from, sourceOffset + thickness);
    incomingOffsets.set(link.to, targetOffset + thickness);
    return [{ link, thickness, path: ribbonPath(source, target, sourceOffset, targetOffset, thickness) }];
  });
}

function truncatedFlowLabel(node: IncomeFlowNode): string {
  const label = nodeLabel(node);
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

function FlowLegend(): ReactNode {
  return (
    <div className={styles.flowLegend} aria-label="손익 흐름 범례">
      <span><i className={`${styles.legendDot} ${styles.legendBlue}`} />수익·매출</span>
      <span><i className={`${styles.legendDot} ${styles.legendOrange}`} />이익</span>
      <span><i className={`${styles.legendDot} ${styles.legendCost}`} />비용</span>
    </div>
  );
}

function SankeyFlow({ flow, period }: { flow: IncomeFlow; period: EarningsPeriod }): ReactNode {
  const geometry = makeNodeLayouts(flow.nodes);
  const { layouts, width, height } = geometry;
  const ribbons = makeRibbonLayouts(flow, geometry);

  return (
    <section className={styles.flowSection} data-earnings-flow="sankey" aria-label="수익에서 순이익까지 손익 흐름">
      <div className={styles.flowHeading}>
        <div>
          <span className={styles.eyebrow}>INCOME FLOW</span>
          <h3>매출에서 순이익까지</h3>
          <p>실제 공시값을 단계별로 연결해 보여줍니다. 영업비용은 매출원가를 제외한 금액입니다.</p>
        </div>
        <FlowLegend />
      </div>
      <p className={styles.flowScrollHint}>좌우로 움직여 전체 흐름을 확인하세요.</p>
      <div className={styles.flowViewport} tabIndex={0} role="region" aria-label="손익 흐름 가로 스크롤">
        <svg
          className={styles.flowSvg}
          style={{ "--earnings-flow-width": `${width}px` } as CSSProperties}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${period.label} 실제 손익 흐름`}
        >
          <title>{`${period.label} 손익 흐름`}</title>
          <g className={styles.flowLinks} aria-hidden="true">
            {ribbons.map(({ link, path, thickness }) => {
              const source = layouts.find((layout) => layout.node.id === link.from);
              const sourceKind = source?.node.kind ?? "income";
              return (
                <path
                  key={`${link.from}-${link.to}`}
                  d={path}
                  data-earnings-flow-link={`${link.from}:${link.to}`}
                  data-flow-ribbon-thickness={String(thickness)}
                  fill={flowColors[sourceKind]}
                  opacity="0.3"
                />
              );
            })}
          </g>
          <g className={styles.flowNodes}>
            {layouts.map((layout) => {
              const { node } = layout;
              const fill = flowColors[nodeTone(node)];
              return (
                <g
                  key={node.id}
                  data-earnings-flow-node={node.id}
                  data-flow-value={String(node.value)}
                  data-flow-column={String(node.column)}
                  data-flow-x={String(layout.x)}
                  data-flow-width={String(layout.width)}
                  data-flow-bar-height={String(layout.height)}
                  className={styles.flowNode}
                >
                  <title>{`${nodeLabel(node)} · ${formatFlowValue(node.value)}`}</title>
                  <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} rx="7" fill={fill} opacity="0.96" />
                  <text x={layout.x + layout.width + 13} y={layout.slotY + layout.slotHeight / 2 - 2} textAnchor="start" className={styles.flowNodeLabel}>
                    {truncatedFlowLabel(node)}
                  </text>
                  <text x={layout.x + layout.width + 13} y={layout.slotY + layout.slotHeight / 2 + 13} textAnchor="start" className={styles.flowNodeValue}>
                    {formatFlowValue(node.value)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}

function BridgeFlow({ flow, period }: { flow: IncomeFlow; period: EarningsPeriod }): ReactNode {
  const flowNodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const nodes = [
    "revenue",
    "costOfRevenue",
    "grossProfit",
    "operatingExpenses",
    "operatingIncome",
    "nonOperatingIncome",
    "nonOperatingExpense",
    "pretaxIncome",
    "incomeTax",
    "afterTaxOther",
    "netIncome",
  ].flatMap((id) => {
    const existing = flowNodesById.get(id);
    const value = existing?.value ?? period.income[id as EarningsMetric];
    if (!isFiniteNumber(value)) return [];
    const kind: IncomeFlowNode["kind"] = existing?.kind ?? (value < 0 ? "expense" : "income");
    return [{
      id,
      label: existing?.label ?? flowLabels[id],
      value,
      column: existing?.column ?? 0,
      kind,
    }];
  });

  return (
    <section className={styles.flowSection} aria-label="부호를 포함한 손익 브리지" data-earnings-flow="bridge">
      <div className={styles.flowHeading}>
        <div>
          <span className={styles.eyebrow}>SIGNED BRIDGE</span>
          <h3>부호를 포함한 손익 흐름</h3>
          <p>{period.label}에는 손실 또는 음수 법인세가 있어 금액의 부호를 그대로 표시합니다.</p>
        </div>
      </div>
      <div className={styles.bridgeGrid} role="list">
        {nodes.map((node) => (
          <div key={node.id} className={styles.bridgeItem} data-earnings-flow-node={node.id} data-flow-value={String(node.value)} role="listitem">
            <span>{nodeLabel(node)}</span>
            <strong className={node.value < 0 ? styles.negativeValue : undefined}>{formatFlowValue(node.value)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function IncomeFlowView({ flow, period }: { flow: IncomeFlow; period: EarningsPeriod }): ReactNode {
  const visibleFlow = displayFlow(flow, period);
  if (visibleFlow.kind === "sankey" && visibleFlow.nodes.length > 0) {
    return <SankeyFlow flow={visibleFlow} period={period} />;
  }
  if (visibleFlow.kind === "bridge") return <BridgeFlow flow={visibleFlow} period={period} />;
  return (
    <section className={styles.flowUnavailable} data-earnings-flow="unavailable" aria-label="손익 흐름 데이터 없음">
      <span className={styles.eyebrow}>INCOME FLOW</span>
      <strong>손익 흐름을 표시할 수 없습니다.</strong>
      <p>{visibleFlow.reason ?? "필요한 실제 값이 아직 충분하지 않습니다."}</p>
    </section>
  );
}

function SummaryCard({ metric }: { metric: SummaryMetric }): ReactNode {
  return (
    <article className={`${styles.summaryCard} ${metric.tone ? toneClasses[metric.tone] : ""}`} data-earnings-metric={metric.id}>
      <div className={styles.summaryLabel}>{metric.label}</div>
      <strong className={styles.summaryValue}>{metric.value}</strong>
      {metric.detail ? <span className={styles.summaryDetail}>{metric.detail}</span> : null}
    </article>
  );
}

function ComparisonMiniBar({
  label,
  current,
  previous,
  formatter,
}: {
  label: string;
  current: number | null;
  previous: number | null;
  formatter: (value: number | null) => string;
}): ReactNode {
  const values = [current, previous].filter(isFiniteNumber);
  const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));
  const baseline = 39;
  const scale = 27 / maxValue;
  const bar = (value: number | null, x: number, color: string, id: string): ReactNode => {
    if (!isFiniteNumber(value)) return <rect key={id} x={x} y={baseline} width="22" height="2" rx="1" fill="#d9e3ef" opacity="0.8" />;
    const height = Math.abs(value) * scale;
    return <rect key={id} x={x} y={value >= 0 ? baseline - height : baseline} width="22" height={height} rx="5" fill={color} opacity="0.9" data-comparison-value={String(value)} />;
  };

  return (
    <div className={styles.miniChartWrap}>
      <svg className={styles.miniChart} viewBox="0 0 116 76" role="img" aria-label={`${label} 최근 분기 비교 차트`}>
        <line x1="7" x2="109" y1={baseline} y2={baseline} stroke="#cbd8e7" strokeWidth="1" />
        {bar(previous, 23, "#a8bfdc", "previous")}
        {bar(current, 71, "#e58b3b", "current")}
        <text x="34" y="66" textAnchor="middle" className={styles.miniChartLabel}>직전</text>
        <text x="82" y="66" textAnchor="middle" className={styles.miniChartLabel}>선택</text>
      </svg>
      <div className={styles.miniChartLegend}>
        <span><i className={`${styles.miniChartDot} ${styles.miniChartPrevious}`} />{formatter(previous)}</span>
        <span><i className={`${styles.miniChartDot} ${styles.miniChartCurrent}`} />{formatter(current)}</span>
      </div>
    </div>
  );
}

function RecentQuarterComparison({ current, previous }: { current: EarningsPeriod; previous?: EarningsPeriod }): ReactNode {
  return (
    <section className={styles.comparisonSection} aria-label="최근 분기 매출과 EPS 비교" data-earnings-comparison="recent-quarter">
      <div className={styles.comparisonHeading}>
        <div>
          <span className={styles.eyebrow}>RECENT QUARTER</span>
          <h3>최근 분기 비교</h3>
        </div>
        {previous ? <span className={styles.comparisonHint}>{previous.label} · {previous.end}</span> : <span className={styles.comparisonHint}>비교값 없음</span>}
      </div>
      <div className={styles.comparisonGrid}>
        <div className={styles.comparisonRow}>
          <span>매출</span>
          <strong>{formatUsd(current.income.revenue)}</strong>
          <span className={styles.comparisonPrevious}>{comparisonText(current.income.revenue, previous?.income.revenue ?? null, formatUsd)}</span>
          <ComparisonMiniBar label="매출" current={current.income.revenue} previous={previous?.income.revenue ?? null} formatter={formatUsd} />
        </div>
        <div className={styles.comparisonRow}>
          <span>EPS</span>
          <strong>{formatEps(current.income.dilutedEps)}</strong>
          <span className={styles.comparisonPrevious}>{comparisonText(current.income.dilutedEps, previous?.income.dilutedEps ?? null, formatEps)}</span>
          <ComparisonMiniBar label="EPS" current={current.income.dilutedEps} previous={previous?.income.dilutedEps ?? null} formatter={formatEps} />
        </div>
      </div>
    </section>
  );
}

export function EarningsOverviewPanel({ document, compact = false }: EarningsOverviewPanelProps) {
  const periods = useMemo(() => [...(document.periods ?? [])].sort((a, b) => b.end.localeCompare(a.end)), [document.periods]);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const [flowExpanded, setFlowExpanded] = useState(false);
  const selectedIndex = Math.max(0, periods.findIndex((period) => period.end === selectedEnd));
  const selectedPeriod = periods[selectedIndex];
  const previousPeriod = selectedPeriod ? priorQuarterPeriod(selectedPeriod, periods) : undefined;
  const flow = useMemo(() => (selectedPeriod ? buildIncomeFlow(selectedPeriod) : null), [selectedPeriod]);
  const headingId = `earnings-${safeId(document.ticker)}-heading`;

  if (!selectedPeriod) {
    return (
      <section className={styles.panel} data-earnings-overview={document.ticker} data-earnings-compact={String(compact)} aria-label="실적 요약">
        <div className={styles.emptyState}>
          <span className={styles.eyebrow}>EARNINGS</span>
          <strong>실적 데이터가 없습니다.</strong>
          <p>확인 가능한 실제 분기가 준비되면 여기에 표시됩니다.</p>
        </div>
      </section>
    );
  }

  const metrics = makeSummaryMetrics(selectedPeriod, periods);
  const sourceHref = safeHref(selectedPeriod.source.url);

  return (
    <section className={styles.panel} data-earnings-overview={document.ticker} data-earnings-compact={String(compact)} aria-labelledby={headingId}>
      <header className={styles.panelHeader}>
        <div className={styles.identity}>
          <div className={styles.tickerBadge}>{document.ticker}</div>
          <div className={styles.identityCopy}>
            <h2 id={headingId}>{document.companyName}</h2>
            <div className={styles.identityMeta}><span>실제 분기 실적</span><span className={styles.dot} aria-hidden="true" /> <span>{document.currency} · USD 단위</span></div>
          </div>
        </div>
        <div className={styles.periodControl}>
          <label htmlFor={`${headingId}-period`}>실적 기간</label>
          <select
            id={`${headingId}-period`}
            aria-label={`${document.companyName} 실적 기간 선택`}
            value={selectedPeriod.end}
            onChange={(event) => {
              setSelectedEnd(event.currentTarget.value);
              setFlowExpanded(false);
            }}
          >
            {periods.map((period) => <option key={period.end} value={period.end}>{period.label} · {period.end}</option>)}
          </select>
        </div>
      </header>

      <div className={styles.periodRail}>
        <span className={styles.periodPill}>실제 공시</span>
        <span className={styles.periodLabel}>{selectedPeriod.label}</span>
        <span className={styles.periodEnd}>분기 종료 {selectedPeriod.end}</span>
        <span className={styles.railSeparator} aria-hidden="true" />
        {sourceHref ? <a href={sourceHref} target="_blank" rel="noreferrer noopener" className={styles.sourceLink}>{selectedPeriod.source.name}<span aria-hidden="true">↗</span></a> : <span className={styles.sourceText}>{selectedPeriod.source.name}</span>}
        <span className={styles.sourceMeta}>제출 {dateOnly(selectedPeriod.source.filedAt)} · 갱신 {dateOnly(document.updatedAt)}</span>
        {document.status === "retained" ? <span className={styles.retainedPill}>이전 값 유지</span> : null}
      </div>

      {document.notice ? <div className={styles.notice} role="status">{document.notice}</div> : null}

      <div className={styles.summaryGrid} aria-label="핵심 실적 요약">
        {metrics.map((metric) => <SummaryCard key={metric.id} metric={metric} />)}
      </div>

      <RecentQuarterComparison current={selectedPeriod} previous={previousPeriod} />

      {compact ? (
        <details
          className={styles.expandable}
          open={flowExpanded}
          onToggle={(event) => setFlowExpanded(event.currentTarget.open)}
        >
          <summary>상세 손익 흐름 보기 <span aria-hidden="true">＋</span></summary>
          {flowExpanded && flow ? <IncomeFlowView flow={flow} period={selectedPeriod} /> : null}
        </details>
      ) : flow ? <IncomeFlowView flow={flow} period={selectedPeriod} /> : null}

      {selectedPeriod.notes.length > 0 ? (
        <details className={styles.notesDetails}>
          <summary>공시 메모 <span aria-hidden="true">＋</span></summary>
          <ul>{selectedPeriod.notes.filter((note) => typeof note === "string" && note.length > 0).map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}</ul>
        </details>
      ) : null}
      <footer className={styles.panelFooter}>금액 USD · EPS USD/주 · 분기 종료일과 출처는 선택한 실제 기간 기준</footer>
    </section>
  );
}

export default EarningsOverviewPanel;
