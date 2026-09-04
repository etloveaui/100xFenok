"use client";

import { useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { Button, EmptyState, EvidenceRail, Panel, PanelHeader, Pill, Skeleton } from "@/components/ui";
import type { EvidenceRailFreshness } from "@/components/ui/EvidenceRail";
import PerBandBar from "@/components/screener/PerBandBar";
import { formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { ROUTES } from "@/lib/routes";
import { normalizeBandTuple } from "@/lib/screener/bands";
import {
  getQuestionCard,
  matchQuestionCard,
  SCREENER_QUESTION_CARDS,
  type QuestionCardDef,
  type QuestionCardId,
} from "@/lib/screener/question-cards";
import { formatScreenerSourceDateLabel } from "@/lib/screener/source-dates";
import type { ScreenerStock } from "@/lib/screener/types";

const DISCOVER_SOURCE = "Global Scouter · Fenok Signals · SEC 13F";
const STOCKS_ANALYZER_URL = "/data/global-scouter/core/stocks_analyzer.json";
const RESULT_LIMIT = 8;
const COMPARE_LIMIT = 4;

function openStocksAnalyzerEvidence() {
  window.open(STOCKS_ANALYZER_URL, "_blank", "noopener");
}

export interface ScreenerDiscoverProps {
  stocks: ScreenerStock[];
  dataReady: boolean;
  failed: boolean;
  sourceDate: string | null;
  marketFactsDate: string | null;
  activeCardId: QuestionCardId;
  onSelectCard: (id: QuestionCardId) => void;
  onShowConditions: (card: QuestionCardDef) => void;
  onOpenAnalyze: () => void;
  compareTickers: string[];
  onToggleCompare: (ticker: string) => void;
  onClearCompare: () => void;
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function finiteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtScore(value: number | null | undefined): string {
  return finiteNumber(value) ? String(Math.round(value)) : "—";
}

function fmtPrice(value: number | null | undefined): string {
  if (!finiteNumber(value)) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtYield(value: number | null | undefined): string {
  if (!finiteNumber(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtSignedFrac(value: number | null | undefined): string {
  if (!finiteNumber(value)) return "—";
  return formatSignedPercentDecimal(value, 1);
}

function fmtCount(value: number | null): string {
  return `${value === null ? "—" : value.toLocaleString("ko-KR")}개`;
}

function hasBand(stock: ScreenerStock): boolean {
  return normalizeBandTuple(stock.perBandCurrent, stock.perBandMin, stock.perBandMax) !== null;
}

function stockByTicker(stocks: ScreenerStock[], ticker: string): ScreenerStock | null {
  return stocks.find((stock) => stock.ticker === ticker) ?? null;
}

function resultsFreshness(results: ScreenerStock[], dataReady: boolean, failed: boolean): EvidenceRailFreshness {
  if (failed) return "error";
  if (!dataReady) return "pending";
  const partial = results.some(
    (stock) => !hasBand(stock) || !finiteNumber(stock.fenokConvictionScore) || !finiteNumber(stock.guruHolders),
  );
  return partial ? "partial" : "fresh";
}

function coverageText(results: ScreenerStock[]): string {
  const total = results.length;
  const band = results.filter(hasBand).length;
  const conviction = results.filter((stock) => finiteNumber(stock.fenokConvictionScore)).length;
  const holders = results.filter((stock) => finiteNumber(stock.guruHolders)).length;
  return `밴드 ${band}/${total} · 컨빅션 ${conviction}/${total} · 보유 ${holders}/${total}`;
}

function MomentumSpark({ stock }: { stock: ScreenerStock }) {
  const points = useMemo(() => {
    const values = [stock.momentum1m, stock.momentum3m, stock.momentum6m, stock.momentum12m].filter(finiteNumber);
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values.map((value, index) => ({
      x: (index / (values.length - 1)) * 100,
      y: 46 - ((value - min) / span) * 40,
    }));
  }, [stock.momentum1m, stock.momentum3m, stock.momentum6m, stock.momentum12m]);
  if (!points) return <span className="text-[12px] text-[var(--c-ink-3)]">모멘텀 미집계</span>;
  return (
    <svg viewBox="0 0 100 52" preserveAspectRatio="none" className="mt-2 h-[52px] w-full" role="img" aria-label="모멘텀 추이 1M·3M·6M·12M">
      {[13, 26, 39].map((y) => (
        <line key={y} x1="0" x2="100" y1={y} y2={y} style={{ stroke: "var(--c-line-2)" }} strokeWidth="1" />
      ))}
      <polyline
        fill="none"
        strokeWidth="1.5"
        style={{ stroke: "var(--c-brand)" }}
        points={points.map((point) => `${point.x},${point.y}`).join(" ")}
      />
    </svg>
  );
}

function ActionButtons({
  stock,
  compareTickers,
  onToggleCompare,
}: {
  stock: ScreenerStock;
  compareTickers: string[];
  onToggleCompare: (ticker: string) => void;
}) {
  const selected = compareTickers.includes(stock.ticker);
  const full = !selected && compareTickers.length >= COMPARE_LIMIT;
  return (
    <div className="ml-auto flex shrink-0 gap-1.5" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={() => onToggleCompare(stock.ticker)}
        disabled={full}
        aria-pressed={selected}
        title={selected ? "비교에서 제외" : full ? `비교는 최대 ${COMPARE_LIMIT}개` : "비교에 추가"}
        className={cx(
          "inline-flex h-9 items-center rounded-md border px-2 text-[11px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive",
          selected
            ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
            : "border-[var(--c-line)] bg-[var(--c-panel)] text-[var(--c-ink-2)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]",
          full && "cursor-not-allowed opacity-40 hover:border-[var(--c-line)] hover:text-[var(--c-ink-2)]",
        )}
      >
        비교
      </button>
      <TransitionLink
        href={ROUTES.portfolioTicker(stock.ticker)}
        title="관심 종목에 추가"
        className="inline-flex h-9 items-center rounded-md border border-[var(--c-line)] bg-[var(--c-panel)] px-2 text-[11px] font-semibold text-[var(--c-ink-2)] transition hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
      >
        관심
      </TransitionLink>
      <TransitionLink
        href={ROUTES.stock(stock.ticker)}
        title="종목 상세로 열기"
        className="inline-flex h-9 items-center rounded-md bg-[var(--c-brand)] px-2 text-[11px] font-semibold text-white transition"
      >
        열기
      </TransitionLink>
    </div>
  );
}

export default function ScreenerDiscover({
  stocks,
  dataReady,
  failed,
  sourceDate,
  marketFactsDate,
  activeCardId,
  onSelectCard,
  onShowConditions,
  onOpenAnalyze,
  compareTickers,
  onToggleCompare,
  onClearCompare,
}: ScreenerDiscoverProps) {
  const card = getQuestionCard(activeCardId);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const asOfLabel = formatScreenerSourceDateLabel(sourceDate, marketFactsDate, { pending: !dataReady });

  const cardStats = useMemo(() => {
    if (!dataReady || failed) return null;
    return new Map<QuestionCardId, { count: number; samples: string[] }>(
      SCREENER_QUESTION_CARDS.map((item) => {
        const matched = matchQuestionCard(stocks, item);
        return [item.id, { count: matched.length, samples: matched.slice(0, 3).map((stock) => stock.ticker) }];
      }),
    );
  }, [stocks, dataReady, failed]);

  const results = useMemo(() => {
    if (!dataReady) return [];
    // Fetch error keeps last-known-good rows: the rail flips to error with
    // retry while results stay on screen (same five-state rule as analyze).
    return matchQuestionCard(stocks, card);
  }, [stocks, card, dataReady]);
  const shown = results.slice(0, RESULT_LIMIT);
  const selected = (selectedTicker ? stockByTicker(stocks, selectedTicker) : null) ?? shown[0] ?? null;
  const compareStocks = compareTickers.map((ticker) => stockByTicker(stocks, ticker)).filter((stock): stock is ScreenerStock => stock !== null);
  const freshness = resultsFreshness(shown, dataReady, failed);

  if (failed && stocks.length === 0) {
    return (
      <Panel>
        <PanelHeader eyebrow="발견" title="질문 카드" />
        <div className="flex flex-col items-start gap-2 px-4 py-6" data-discover-error="true">
          <p className="text-[13px] font-semibold text-[var(--c-ink)]">스크리너 데이터를 불러오지 못했습니다</p>
          <p className="text-[12px] text-[var(--c-ink-3)]">잠시 후 다시 시도하거나 분석 모드에서 확인해 주세요.</p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            다시 시도
          </Button>
        </div>
        <EvidenceRail freshness="error" source={DISCOVER_SOURCE} asOf={asOfLabel} coverage="불러오기 실패" onRetry={() => window.location.reload()} onEvidence={openStocksAnalyzerEvidence} />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-discover="true">
      <section aria-label="Fenok 질문 카드">
        {!dataReady ? (
          <Panel>
            <Skeleton />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5" data-discover-cards="true">
            {SCREENER_QUESTION_CARDS.map((item) => {
              const stats = cardStats?.get(item.id);
              const active = item.id === card.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectCard(item.id)}
                  aria-pressed={active}
                  data-discover-card={item.id}
                  className={cx(
                    "flex min-h-11 flex-col items-start gap-2 rounded-lg border bg-[var(--c-panel)] p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive",
                    active
                      ? "border-[var(--c-brand)] shadow-[inset_2px_0_0_var(--c-brand)]"
                      : "border-[var(--c-line)] hover:border-[var(--c-brand)]",
                  )}
                >
                  <span className="flex w-full items-center gap-2">
                    <span
                      className={cx(
                        "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold",
                        active ? "bg-[var(--c-brand)] text-white" : "bg-[var(--c-surface-2)] text-[var(--c-ink-3)]",
                      )}
                    >
                      {item.index}
                    </span>
                    <span className={cx("ml-auto text-[11px] font-bold tabular-nums", active ? "text-[var(--c-brand)]" : "text-[var(--c-ink-3)]")}>
                      {stats ? fmtCount(stats.count) : "—"}
                    </span>
                  </span>
                  <span className="text-[12.5px] font-semibold leading-snug text-[var(--c-ink)]">{item.title}</span>
                  {stats && stats.samples.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {stats.samples.map((ticker) => (
                        <span
                          key={ticker}
                          className="inline-flex h-5 items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-2 font-mono text-[11px] font-medium text-[var(--c-ink-2)]"
                        >
                          {ticker}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span className="text-[10.5px] text-[var(--c-ink-3)]">마지막 갱신 {asOfLabel}</span>
                  <span className="text-[10.5px] leading-snug text-[var(--c-ink-3)]">{item.basis}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
        <div className="w-full min-w-0 flex-1">
          <Panel>
            <PanelHeader
              eyebrow={`Q${card.index} 결과`}
              title={`${card.title} · 상위 ${shown.length}`}
              right={
                <button
                  type="button"
                  onClick={() => onShowConditions(card)}
                  className="inline-flex min-h-11 items-center gap-1 text-[11px] font-semibold text-[var(--c-ink-3)] transition hover:text-[var(--c-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive"
                  data-discover-show-conditions="true"
                >
                  조건 보기
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              }
            />
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--c-line-2)] px-4 py-2.5" aria-label="적용된 조건">
              {card.chips.map((chip, index) => (
                <span key={chip} className="flex items-center gap-1.5">
                  {index > 0 ? <span className="text-[10px] font-semibold text-[var(--c-brand)]">AND</span> : null}
                  <span className="inline-flex h-[26px] items-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-2.5 text-[12px] text-[var(--c-ink-2)]">
                    {chip}
                  </span>
                </span>
              ))}
            </div>
            {!dataReady ? (
              <Skeleton />
            ) : shown.length === 0 ? (
              <EmptyState
                reason="조건에 맞는 종목이 없습니다"
                nextRefresh="다음 갱신에 다시 확인해 보세요"
                actionLabel="조건 보기"
                onAction={() => onShowConditions(card)}
              />
            ) : (
              <ol data-discover-results="true">
                {shown.map((stock, index) => (
                  <li
                    key={stock.ticker}
                    role="button"
                    tabIndex={0}
                    aria-label={`${index + 1}위 ${stock.ticker} 선택`}
                    onClick={() => setSelectedTicker(stock.ticker)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTicker(stock.ticker);
                      }
                    }}
                    className={cx(
                      "flex cursor-pointer flex-col gap-2 border-t border-[var(--c-line-2)] px-4 py-3 first:border-t-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive",
                      selected?.ticker === stock.ticker && "bg-[var(--c-surface-2)] shadow-[inset_2px_0_0_var(--c-brand)]",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-[var(--c-surface-2)] text-[11px] font-bold text-[var(--c-ink-2)]">
                        {index + 1}
                      </span>
                      <span className="min-w-[116px]">
                        <span className="block font-mono text-[13px] font-bold text-[var(--c-ink)]">{stock.ticker}</span>
                        <span className="block truncate text-[11px] text-[var(--c-ink-3)]">{stock.name}</span>
                      </span>
                      <span className="hidden min-w-11 flex-col items-end gap-px sm:flex">
                        <span className="text-[12px] font-semibold tabular-nums text-[var(--c-ink)]">{fmtPrice(stock.price)}</span>
                        <span className="text-[9.5px] text-[var(--c-ink-3)]">현재가</span>
                      </span>
                      <span className="hidden min-w-11 flex-col items-end gap-px sm:flex">
                        <span className="text-[12px] font-semibold tabular-nums text-[var(--c-ink-2)]">{fmtScore(stock.fenokShortTermScore)}</span>
                        <span className="text-[9.5px] text-[var(--c-ink-3)]">단기</span>
                      </span>
                      <span className="hidden min-w-11 flex-col items-end gap-px sm:flex">
                        <span className="text-[12px] font-semibold tabular-nums text-[var(--c-ink-2)]">{fmtScore(stock.fenokLongTermScore)}</span>
                        <span className="text-[9.5px] text-[var(--c-ink-3)]">장기</span>
                      </span>
                      <span className="inline-flex h-5 min-w-[34px] items-center justify-center rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] px-1.5 text-[11px] font-bold tabular-nums text-[var(--c-ink)]" title={`컨빅션 ${fmtScore(stock.fenokConvictionScore)}`}>
                        {fmtScore(stock.fenokConvictionScore)}
                      </span>
                      <span className="hidden w-24 shrink-0 md:block" title="PER 밴드 위치">
                        <PerBandBar current={stock.perBandCurrent} min={stock.perBandMin} avg={stock.perBandAvg} max={stock.perBandMax} />
                      </span>
                      <ActionButtons stock={stock} compareTickers={compareTickers} onToggleCompare={onToggleCompare} />
                    </span>
                    <span className="block text-[11.5px] leading-snug text-[var(--c-ink-2)]">{card.why(stock)}</span>
                    <span className="flex items-center gap-2.5">
                      <Pill tone="neutral">
                        신뢰 {stock.confidenceLabel ?? "—"} · 커버리지{" "}
                        {finiteNumber(stock.fenokSignalCoverageRatio) ? `${Math.round(stock.fenokSignalCoverageRatio * 100)}%` : "—"}
                      </Pill>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <EvidenceRail
              freshness={freshness}
              source={DISCOVER_SOURCE}
              asOf={asOfLabel}
              coverage={dataReady ? `${coverageText(shown)} · 상위 ${shown.length}/${results.length} 표시` : "불러오는 중"}
              onEvidence={openStocksAnalyzerEvidence}
              onRetry={failed ? () => window.location.reload() : undefined}
              lkgAsOf={failed ? asOfLabel : undefined}
            />
          </Panel>
        </div>

        <aside className="w-full shrink-0 lg:w-[360px]" aria-label="선택된 종목">
          {selected ? (
            <Panel>
              <PanelHeader
                title={selected.ticker}
                right={<span className="text-[11px] text-[var(--c-ink-3)]">선택된 카드</span>}
              />
              <div className="px-4 pt-3">
                <span className="text-[22px] font-bold tabular-nums text-[var(--c-ink)]">{fmtPrice(selected.price)}</span>
                <MomentumSpark stock={selected} />
              </div>
              <div className="mt-3 border-t border-[var(--c-line-2)] px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--c-ink-3)]">Fenok Edge 드라이버</p>
                <div className="mb-2 flex items-end gap-4">
                  <span>
                    <span className="block text-[18px] font-bold tabular-nums text-[var(--c-ink)]">{fmtScore(selected.fenokShortTermScore)}</span>
                    <span className="block text-[10.5px] text-[var(--c-ink-3)]">단기</span>
                  </span>
                  <span>
                    <span className="block text-[18px] font-bold tabular-nums text-[var(--c-ink)]">{fmtScore(selected.fenokLongTermScore)}</span>
                    <span className="block text-[10.5px] text-[var(--c-ink-3)]">장기</span>
                  </span>
                  <span>
                    <span className="block text-[18px] font-bold tabular-nums text-[var(--c-brand)]">{fmtScore(selected.fenokConvictionScore)}</span>
                    <span className="block text-[10.5px] text-[var(--c-ink-3)]">컨빅션</span>
                  </span>
                </div>
                <p className="text-[11.5px] leading-snug text-[var(--c-ink-2)]">{card.why(selected)}</p>
              </div>
              <div className="border-t border-[var(--c-line-2)] px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.04em] text-[var(--c-ink-3)]">13F 보유 최신</p>
                <p className="text-[12px] font-semibold tabular-nums text-[var(--c-ink)]">
                  보유 {finiteNumber(selected.guruHolders) ? selected.guruHolders.toLocaleString("ko-KR") : "—"}곳
                </p>
                <p className="mt-1 text-[10.5px] leading-snug text-[var(--c-ink-3)]">
                  신규·증가 내역은 분기 제출 단위로 부분 공개 — 보유 수는 guru 집계 기준
                </p>
              </div>
              <EvidenceRail
                freshness={dataReady ? "fresh" : "pending"}
                source={DISCOVER_SOURCE}
                asOf={asOfLabel}
                coverage={`${selected.ticker} 단일 종목`}
                onEvidence={openStocksAnalyzerEvidence}
              />
            </Panel>
          ) : (
            <Panel>
              <EmptyState reason={dataReady ? "카드를 선택하면 종목이 표시됩니다" : "불러오는 중"} />
            </Panel>
          )}
        </aside>
      </div>

      {compareStocks.length > 0 ? (
        <Panel>
          <PanelHeader
            title={`비교 ${compareStocks.length}/${COMPARE_LIMIT}`}
            right={
              <button
                type="button"
                onClick={onClearCompare}
                className="inline-flex min-h-11 items-center text-[11px] font-semibold text-[var(--c-ink-3)] transition hover:text-[var(--c-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive"
              >
                선택 해제
              </button>
            }
          />
          <div className="flex flex-wrap gap-1.5 px-4 pt-3" data-discover-compare-tray="true">
            {compareStocks.map((stock) => (
              <span
                key={stock.ticker}
                className="inline-flex min-h-[26px] items-center gap-1.5 rounded-full border border-[var(--c-line)] bg-[var(--c-panel)] py-0 pl-2.5 pr-1 text-[12px] text-[var(--c-ink-2)]"
              >
                <span className="font-mono font-semibold">{stock.ticker}</span>
                <button
                  type="button"
                  onClick={() => onToggleCompare(stock.ticker)}
                  aria-label={`${stock.ticker} 비교에서 제외`}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--c-surface-2)] text-[14px] text-[var(--c-ink-3)] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-interactive"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="overflow-x-auto px-4 py-3">
            <table className="w-full min-w-[520px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-[var(--c-line)]">
                  <th className="h-9 px-2 text-left font-semibold text-[var(--c-ink-3)]">지표</th>
                  {compareStocks.map((stock) => (
                    <th key={stock.ticker} className="h-9 px-2 text-right font-mono font-bold text-[var(--c-ink)]">
                      {stock.ticker}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[
                  { label: "컨빅션", get: (stock: ScreenerStock) => fmtScore(stock.fenokConvictionScore) },
                  { label: "단기", get: (stock: ScreenerStock) => fmtScore(stock.fenokShortTermScore) },
                  { label: "장기", get: (stock: ScreenerStock) => fmtScore(stock.fenokLongTermScore) },
                  { label: "현재가", get: (stock: ScreenerStock) => fmtPrice(stock.price) },
                  { label: "보유", get: (stock: ScreenerStock) => (finiteNumber(stock.guruHolders) ? String(stock.guruHolders) : "—") },
                  { label: "배당", get: (stock: ScreenerStock) => fmtYield(stock.dividendYield) },
                  { label: "12M", get: (stock: ScreenerStock) => fmtSignedFrac(stock.return12m) },
                ].map((row) => (
                  <tr key={row.label} className="border-t border-[var(--c-line-2)]">
                    <th className="h-11 px-2 text-left font-semibold text-[var(--c-ink-3)]">{row.label}</th>
                    {compareStocks.map((stock) => (
                      <td key={stock.ticker} className="h-11 px-2 text-right text-[var(--c-ink)]">
                        {row.get(stock)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <EvidenceRail
            freshness={freshness}
            source={DISCOVER_SOURCE}
            asOf={asOfLabel}
            coverage={`비교 ${compareStocks.length}/${COMPARE_LIMIT}`}
            onEvidence={openStocksAnalyzerEvidence}
          />
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          eyebrow="두 번째 모드 미리보기"
          title="분석 — 워크벤치"
          right={
            <Button variant="secondary" onClick={onOpenAnalyze}>
              분석 모드 열기 →
            </Button>
          }
        />
        <div className="px-4 py-3">
          <p className="text-[12px] leading-snug text-[var(--c-ink-2)]">
            발견 카드는 저장된 스크린입니다 — 조건 보기로 분석 모드에서 이어서 편집할 수 있습니다.
          </p>
        </div>
        <EvidenceRail
          freshness={freshness}
          source={DISCOVER_SOURCE}
          asOf={asOfLabel}
          coverage={`발견 카드 ${SCREENER_QUESTION_CARDS.length}종`}
          onEvidence={openStocksAnalyzerEvidence}
        />
      </Panel>
    </div>
  );
}
