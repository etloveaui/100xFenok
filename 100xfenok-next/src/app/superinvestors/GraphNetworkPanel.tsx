"use client";

import { useMemo } from "react";
import { EvidenceRail, Panel, PanelHeader, Pill, EmptyState, type EvidenceRailFreshness } from "@/components/ui";
import { formatCurrencyCompact, formatInteger, formatPercent } from "@/lib/format";
import type { GraphNetwork } from "./graphNetwork";

export interface GraphNetworkRail {
  freshness: EvidenceRailFreshness;
  source: string;
  asOf: string;
  coverage: string;
  onRetry?: () => void;
  onEvidence?: () => void;
}

export interface GraphNetworkPanelProps {
  network: GraphNetwork;
  selectedTicker: string | null;
  onSelectTicker: (ticker: string | null) => void;
  rail: GraphNetworkRail;
}

const MAX_INVESTORS = 14;
const MAX_TICKERS = 14;
const CARD_W = 160;
const CARD_H = 40;
const LEFT_X = 70;
const RIGHT_X = 670;
const FIRST_Y = 60;
const ROW_GAP = 66;
const CENTER_X = 450;
const CENTER_Y = 264;
const RING_RX = 178;
const RING_RY = 148;

function edgeWidth(weight: number): number {
  return Math.round((1 + Math.min(Math.max(weight, 0), 0.25) * 20) * 2) / 2;
}

function tickerRadius(holders: number): number {
  return Math.min(34, 14 + holders * 2);
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

export default function GraphNetworkPanel({ network, selectedTicker, onSelectTicker, rail }: GraphNetworkPanelProps) {
  const investors = useMemo(
    () => network.nodes.filter((node) => node.kind === "investor").slice(0, MAX_INVESTORS),
    [network],
  );
  const tickers = useMemo(
    () => network.nodes.filter((node) => node.kind === "ticker").slice(0, MAX_TICKERS),
    [network],
  );
  const displayedTickers = useMemo(
    () => new Set(tickers.flatMap((node) => (node.kind === "ticker" ? [node.ticker] : []))),
    [tickers],
  );
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of network.nodes) if (node.kind === "investor") map.set(node.investorId, node.label);
    return map;
  }, [network]);
  const topTickerOf = useMemo(() => {
    const best = new Map<string, { ticker: string; weight: number }>();
    for (const edge of network.edges) {
      if (!displayedTickers.has(edge.ticker)) continue;
      const prev = best.get(edge.investorId);
      if (!prev || edge.weight > prev.weight) best.set(edge.investorId, { ticker: edge.ticker, weight: edge.weight });
    }
    return best;
  }, [network, displayedTickers]);
  const shown = useMemo(() => {
    const investorIds = new Set(investors.map((node) => node.investorId));
    const tickerIds = new Set(tickers.map((node) => node.ticker));
    return network.edges.filter((edge) => investorIds.has(edge.investorId) && tickerIds.has(edge.ticker));
  }, [network, investors, tickers]);
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    investors.forEach((node, index) => {
      const side = index < MAX_INVESTORS / 2 ? 0 : 1;
      const row = side === 0 ? index : index - MAX_INVESTORS / 2;
      map.set(node.id, { x: side === 0 ? LEFT_X : RIGHT_X, y: FIRST_Y + row * ROW_GAP });
    });
    tickers.forEach((node, index) => {
      const angle = (index / Math.max(tickers.length, 1)) * Math.PI * 2 - Math.PI / 2;
      map.set(node.id, {
        x: CENTER_X + RING_RX * Math.cos(angle),
        y: CENTER_Y + RING_RY * Math.sin(angle),
      });
    });
    return map;
  }, [investors, tickers]);
  const selectedHolders = useMemo(
    () =>
      selectedTicker === null
        ? []
        : network.edges
            .filter((edge) => edge.ticker === selectedTicker)
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 8),
    [network, selectedTicker],
  );
  const selectedTotal = useMemo(
    () => (selectedTicker === null ? 0 : network.edges.filter((edge) => edge.ticker === selectedTicker).length),
    [network, selectedTicker],
  );
  const commonHoldings = useMemo(
    () => network.nodes.filter((node) => node.kind === "ticker").slice(0, 6),
    [network],
  );

  if (network.edges.length === 0) {
    return (
      <Panel>
        <div data-superinvestors-graph>
          <PanelHeader eyebrow="Graph Network" title="누가 무엇을 함께 들고 있나" />
          <EmptyState reason="연결된 공유 보유가 없습니다" nextRefresh="다음 분기 공시 후 다시 확인해 주세요" />
          <EvidenceRail
            freshness={rail.freshness}
            source={rail.source}
            asOf={rail.asOf}
            coverage={rail.coverage}
            onRetry={rail.onRetry}
            onEvidence={rail.onEvidence}
          />
        </div>
      </Panel>
    );
  }

  const capped = network.investorCount > investors.length || network.tickerCount > tickers.length;
  const caption =
    selectedTicker === null
      ? `공유 종목 ${formatInteger(network.tickerCount)}개 · 노드 선택 시 보유 비중 표시`
      : `선택: ${selectedTicker} — ${selectedHolders
          .map((edge) => `${labels.get(edge.investorId) ?? edge.investorId} ${formatPercent(edge.weight, { digits: 1 })}`)
          .join(" · ")}`;

  return (
    <div className="grn-grid">
      <Panel>
        <div data-superinvestors-graph>
          <PanelHeader
            eyebrow="Graph Network"
            title="누가 무엇을 함께 들고 있나"
            right={
              <span className="grn-head-meta">
                {`투자자 ${formatInteger(network.investorCount)}명 · ${formatInteger(network.tickerCount)}개 종목 연결${capped ? " · 상위 표시" : ""}`}
              </span>
            }
          />
          <svg className="grn-canvas" viewBox="0 0 900 560" role="group" aria-label={`투자자 종목 연결 그래프. ${caption}`}>
            <g stroke="var(--fnk-neutral-200)" strokeLinecap="round">
              {shown.map((edge) => {
                const from = positions.get(`investor:${edge.investorId}`);
                const to = positions.get(`ticker:${edge.ticker}`);
                if (!from || !to) return null;
                const leftSide = from.x < CENTER_X;
                return (
                  <line
                    key={`${edge.investorId}|${edge.ticker}`}
                    x1={leftSide ? from.x + CARD_W : from.x}
                    y1={from.y + CARD_H / 2}
                    x2={to.x}
                    y2={to.y}
                    strokeWidth={edgeWidth(edge.weight)}
                    stroke={edge.ticker === selectedTicker ? "var(--fnk-brand-interactive)" : undefined}
                  />
                );
              })}
            </g>
            <g>
              {investors.map((node) => {
                if (node.kind !== "investor") return null;
                const pos = positions.get(node.id);
                if (!pos) return null;
                const top = topTickerOf.get(node.investorId)?.ticker ?? null;
                const sub = node.aum !== null ? `${formatCurrencyCompact(node.aum, "USD")} · ${formatInteger(node.holdings)}종목` : "—";
                const activate = () => onSelectTicker(top === selectedTicker ? null : top);
                return (
                  <g
                    key={node.id}
                    className="grn-node"
                    tabIndex={0}
                    role="button"
                    aria-pressed={top !== null && top === selectedTicker}
                    aria-label={`투자자 ${node.label}. ${sub}${node.stale ? ". 지연 공시" : ""}. 선택 시 최대 보유 종목 표시`}
                    onClick={activate}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        activate();
                      } else if (event.key === "Escape") onSelectTicker(null);
                    }}
                  >
                    <rect
                      x={pos.x}
                      y={pos.y}
                      width={CARD_W}
                      height={CARD_H}
                      rx={6}
                      className={node.unprofiled ? "grn-inv-card grn-inv-unprofiled" : "grn-inv-card"}
                    />
                    <text x={pos.x + CARD_W / 2} y={pos.y + 17} textAnchor="middle" className="grn-inv-label">
                      {shortLabel(node.label)}
                    </text>
                    <text x={pos.x + CARD_W / 2} y={pos.y + 31} textAnchor="middle" className="grn-inv-sub">
                      {sub}
                    </text>
                    {node.stale ? <circle cx={pos.x + CARD_W - 10} cy={pos.y + 10} r={3} className="grn-stale-dot" /> : null}
                  </g>
                );
              })}
            </g>
            <g>
              {tickers.map((node) => {
                if (node.kind !== "ticker") return null;
                const pos = positions.get(node.id);
                if (!pos) return null;
                const selected = node.ticker === selectedTicker;
                const radius = tickerRadius(node.holdersCount);
                return (
                  <g
                    key={node.id}
                    className="grn-node"
                    tabIndex={0}
                    role="button"
                    aria-pressed={selected}
                    aria-label={`종목 ${node.ticker}. 보유 투자자 ${node.holdersCount}명${selected ? ". 선택됨" : ""}`}
                    onClick={() => onSelectTicker(selected ? null : node.ticker)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectTicker(selected ? null : node.ticker);
                      } else if (event.key === "Escape") onSelectTicker(null);
                    }}
                  >
                    <circle cx={pos.x} cy={pos.y} r={radius} className={selected ? "grn-tick-circle grn-tick-selected" : "grn-tick-circle"} />
                    <text x={pos.x} y={pos.y - 1} textAnchor="middle" className={selected ? "grn-tick-label grn-tick-label-selected" : "grn-tick-label"}>
                      {node.ticker}
                    </text>
                    <text x={pos.x} y={pos.y + 13} textAnchor="middle" className={selected ? "grn-tick-sub grn-tick-label-selected" : "grn-tick-sub"}>
                      투자자 {node.holdersCount}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <p className="grn-cap">
            <span className="tabular-nums">{caption}</span>
            <span className="grn-cap-note">선 굵기 = 포트폴리오 비중 · 점 크기 = 보유 투자자 수 · Enter 선택, Esc 해제</span>
          </p>
          <EvidenceRail
            freshness={rail.freshness}
            source={rail.source}
            asOf={rail.asOf}
            coverage={rail.coverage}
            onRetry={rail.onRetry}
            onEvidence={rail.onEvidence}
          />
        </div>
      </Panel>

      <div className="grn-side">
        <Panel>
          <PanelHeader
            eyebrow="Selected"
            title={selectedTicker ?? "종목을 선택하세요"}
            right={
              selectedTicker === null ? undefined : (
                <span className="grn-head-meta">
                  {`투자자 ${formatInteger(selectedTotal)}명${selectedTotal > selectedHolders.length ? " · 상위 8" : ""}`}
                </span>
              )
            }
          />
          {selectedTicker === null ? (
            <p className="grn-side-empty">그래프에서 종목 노드를 선택하면 보유 투자자와 비중이 표시됩니다.</p>
          ) : (
            <>
              <ul className="grn-kv-list">
                {selectedHolders.map((edge) => (
                  <li key={edge.investorId} className="grn-kv">
                    <span className="grn-kv-name">{labels.get(edge.investorId) ?? edge.investorId}</span>
                    <span className="tabular-nums grn-kv-num">{formatPercent(edge.weight, { digits: 1 })}</span>
                  </li>
                ))}
              </ul>
              <p className="grn-side-note">보유 비중만 제공 · 분기 변화율 미제공</p>
            </>
          )}
        </Panel>

        <Panel>
          <PanelHeader eyebrow="Common Holdings" title="가장 많이 겹치는 종목" />
          <ul className="grn-kv-list">
            {commonHoldings.map((node) => {
              if (node.kind !== "ticker") return null;
              const topWeight = Math.max(
                ...network.edges.filter((edge) => edge.ticker === node.ticker).map((edge) => edge.weight),
                0,
              );
              return (
                <li key={node.ticker}>
                  <button
                    type="button"
                    className="grn-kv grn-kv-action"
                    onClick={() => onSelectTicker(node.ticker === selectedTicker ? null : node.ticker)}
                    aria-pressed={node.ticker === selectedTicker}
                  >
                    <span>
                      <span className="grn-ticker">{node.ticker}</span>
                      <span className="grn-kv-sub">{node.holdersCount}명 보유</span>
                    </span>
                    <span className="tabular-nums grn-kv-num" title="최대 보유 비중">{formatPercent(topWeight, { digits: 1 })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
        <p className="grn-hint">종목 클릭 → 보유 목록 · 투자자 카드는 최대 보유 종목 선택 · 관심 종목은 기존 테이블에서 추가 · 가격·수익률 미제공</p>
        {network.excludedCount > 0 || network.feeds.summary === false || network.feeds.byTicker === false ? (
          <Pill tone="warn">
            {network.feeds.byTicker === false
              ? "보유 피드 없음"
              : `부분 커버리지 · 제외 ${formatInteger(network.excludedCount)}명`}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}

export type GraphNetworkTeaserStatus = "pending" | "error" | "ready";

export interface GraphNetworkTeaserProps {
  network: GraphNetwork;
  href: string;
  status: GraphNetworkTeaserStatus;
  source: string;
  asOf: string;
  coverage: string;
  onRetry?: () => void;
}

export function GraphNetworkTeaser({ network, href, status, source, asOf, coverage, onRetry }: GraphNetworkTeaserProps) {
  const found = network.nodes.find((node) => node.kind === "ticker");
  const top = found !== undefined && found.kind === "ticker" ? found : null;
  return (
    <Panel>
      <div data-superinvestors-graph-teaser>
        <PanelHeader
          eyebrow="Graph Network"
          title="누가 무엇을 함께 들고 있나"
          right={<a className="grn-teaser-cta" href={href}>그래프 보기</a>}
        />
        {status === "error" ? (
          <p className="grn-side-empty">
            그래프를 불러오지 못했습니다.
            {onRetry ? <button type="button" className="grn-teaser-retry" onClick={onRetry}>다시 시도</button> : null}
          </p>
        ) : status === "pending" || top === null ? (
          <p className="grn-side-empty">
            {status === "pending" ? "그래프 데이터를 불러오는 중입니다." : "연결된 공유 보유가 없습니다."}
          </p>
        ) : (
          <p className="grn-teaser-top">
            <span className="grn-ticker">{top.ticker}</span>
            <span className="grn-kv-sub">
              {`보유 ${top.holdersCount}명 · 투자자 ${formatInteger(network.investorCount)}명 · ${formatInteger(network.tickerCount)}개 종목 연결`}
            </span>
          </p>
        )}
        <p className="grn-teaser-cap">선 굵기 = 포트폴리오 비중 · 클릭 시 종목·투자자 상세로 이동</p>
        <p className="grn-teaser-src">{`출처 ${source} · 기준 ${asOf} · 커버리지 ${coverage}`}</p>
      </div>
    </Panel>
  );
}
