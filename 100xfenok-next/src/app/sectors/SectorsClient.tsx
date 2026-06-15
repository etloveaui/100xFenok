"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SmartMoneyPanel from "./SmartMoneyPanel";
import TransitionLink from "@/components/TransitionLink";
import { useSectorData } from "@/hooks/useSectorData";
import { MOMENTUM_WINDOWS, type MomentumWindow, type SectorRow, type SectorValuationBand } from "@/lib/sectors/types";
import { formatPercent, formatSignedPercentDecimal, getMarketStateMeta } from "@/lib/dashboard/formatters";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "—" : formatSignedPercentDecimal(value, digits);
}

function pp(value: number | null | undefined, digits = 1): string {
  const formatted = pct(value, digits);
  return formatted === "—" ? formatted : formatted.replace("%", "%p");
}

/** Continuous green/red heat scale over a momentum fraction. */
function heatStyle(value: number | null | undefined): CSSProperties {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { backgroundColor: "rgba(148,163,184,0.10)", color: "#94a3b8" };
  }
  const alpha = Math.min(Math.max(Math.abs(value) / 0.15, 0.1), 0.9);
  const strong = alpha > 0.5;
  if (value >= 0) {
    return { backgroundColor: `rgba(16,185,129,${alpha.toFixed(3)})`, color: strong ? "#ffffff" : "#065f46" };
  }
  return { backgroundColor: `rgba(244,63,94,${alpha.toFixed(3)})`, color: strong ? "#ffffff" : "#9f1239" };
}

function SectionCard({
  kicker,
  title,
  children,
  className,
}: {
  kicker: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-6",
        className,
      )}
    >
      <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{kicker}</p>
      <h2 className="mt-1 text-lg font-black tracking-tight text-slate-950 sm:text-xl">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LoadingSkeleton() {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-16px_rgba(15,23,42,0.18)]">
      <div className="h-3 w-32 animate-pulse rounded-full bg-slate-200" />
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div
            key={index}
            className="h-10 animate-pulse rounded-lg bg-slate-100"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

const valuationHelp = {
  pe: "Fwd P/E: 향후 12개월 예상 이익 대비 주가 배수",
  pb: "P/B: 장부가 대비 주가 배수",
  roe: "ROE: 자기자본이익률",
} as const;

function valuationTone(percentile: number | null | undefined): { label: string; className: string } {
  if (typeof percentile !== "number" || !Number.isFinite(percentile)) {
    return { label: "범위 없음", className: "bg-slate-100 text-slate-500" };
  }
  if (percentile <= 0.25) return { label: "저평가권", className: "bg-emerald-50 text-emerald-700" };
  if (percentile >= 0.75) return { label: "고평가권", className: "bg-rose-50 text-rose-700" };
  return { label: "평균권", className: "bg-slate-100 text-slate-600" };
}

function PeBandGauge({ value, band }: { value: number | null; band: SectorValuationBand | null }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="orbitron text-sm font-bold text-slate-400">—</span>;
  }
  if (!band) {
    return <span className="orbitron text-sm font-bold text-slate-900">{value.toFixed(1)}</span>;
  }
  const span = band.max - band.min;
  const position = span > 0 ? Math.min(100, Math.max(0, ((value - band.min) / span) * 100)) : 50;
  const percentile = Math.round(band.percentile * 100);
  const tone = valuationTone(band.percentile);
  return (
    <div
      className="ml-auto w-full max-w-[190px]"
      title={`역사적 Fwd P/E 백분위 ${percentile}% · ${tone.label} · 범위 ${band.min.toFixed(1)}~${band.max.toFixed(1)}`}
    >
      <div className="mb-1 flex items-center justify-end gap-2">
        <span className="orbitron text-sm font-black tabular-nums text-slate-950">{value.toFixed(1)}</span>
        <span className={cx("rounded-full px-2 py-0.5 text-[10px] font-black", tone.className)}>{tone.label}</span>
      </div>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-emerald-200 via-slate-200 to-rose-200">
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-navy shadow"
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-400">
        <span>{band.min.toFixed(1)}</span>
        <span>{percentile}%</span>
        <span>{band.max.toFixed(1)}</span>
      </div>
    </div>
  );
}

export default function SectorsClient() {
  const { rows, benchmarkMomentum, dataReady, failedSources, updatedAt } = useSectorData();
  const [sortWindow, setSortWindow] = useState<MomentumWindow>("1m");

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => (b.momentum[sortWindow] ?? -Infinity) - (a.momentum[sortWindow] ?? -Infinity),
      ),
    [rows, sortWindow],
  );
  const leaders = sorted.slice(0, 3);
  const laggards = sorted.filter((row) => row.momentum[sortWindow] !== null).slice(-3).reverse();
  const etfRows = useMemo(() => rows.filter((row) => row.etfInfo), [rows]);

  const isMuted = !dataReady;
  const benchmarksFailed = failedSources.includes("benchmarks");
  const dateLabel = updatedAt ? updatedAt.slice(0, 10) : null;
  const marketThreeMonth = benchmarkMomentum?.["3m"] ?? null;

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">섹터 인텔리전스</p>
          <h1 className="data-shell-title">섹터 히트맵</h1>
          <p className="data-shell-desc">
            11개 미국 업종의 다기간 성과를 한눈에. 업종 순환, 강·약 순위, 섹터 ETF를 비교합니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {dateLabel ? (
            <span
              className={cx(
                "data-shell-pill",
                benchmarksFailed ? "warn" : "ok",
              )}
            >
              <span />
              {dateLabel}
            </span>
          ) : null}
          <TransitionLink href="/" className="data-shell-link">
            홈
          </TransitionLink>
        </div>
      </section>

      {isMuted ? (
        <LoadingSkeleton />
      ) : null}

      {/* Heatmap */}
      <SectionCard kicker="모멘텀 히트맵" title="업종 × 기간 성과" className={isMuted ? "opacity-60" : undefined}>
        <p className="mb-3 text-xs text-slate-500">
          열 머리글을 누르면 해당 기간 기준으로 정렬됩니다. 초록=강세 · 빨강=약세, 진할수록 강합니다.
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 shadow-[8px_0_14px_-14px_rgba(15,23,42,0.45)]">
                  업종
                </th>
                <th className="px-2 py-2 text-right text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">당일</th>
                {MOMENTUM_WINDOWS.map((window) => {
                  const active = window.key === sortWindow;
                  return (
                    <th
                      key={window.key}
                      aria-sort={active ? "descending" : "none"}
                      className="px-1 py-2 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => setSortWindow(window.key)}
                        className={cx(
                          "inline-flex min-h-11 w-full items-center justify-center rounded-md px-2 text-[11px] font-black uppercase tracking-[0.08em] transition sm:min-h-7",
                          active
                            ? "bg-brand-navy text-white"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                        )}
                      >
                        {window.label}
                        {active ? " ↓" : ""}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {benchmarkMomentum ? (
                <tr className="border-b border-slate-200">
                  <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left shadow-[8px_0_14px_-14px_rgba(15,23,42,0.45)]">
                    <span className="block text-sm font-black text-slate-950">S&amp;P 500</span>
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">시장 기준선</span>
                  </th>
                  <td className="px-2 py-1.5 text-right text-xs font-black text-slate-400">기준</td>
                  {MOMENTUM_WINDOWS.map((window) => {
                    const value = benchmarkMomentum[window.key];
                    return (
                      <td key={window.key} className="px-1 py-1.5">
                        <div
                          className="orbitron flex min-h-9 items-center justify-center rounded-md px-1 text-[13px] font-black tabular-nums"
                          style={heatStyle(value)}
                        >
                          {pct(value, 1)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ) : null}
              {sorted.map((row) => {
                const state = getMarketStateMeta(row.marketState);
                const relativeThreeMonth =
                  typeof row.momentum["3m"] === "number" && typeof marketThreeMonth === "number"
                    ? row.momentum["3m"] - marketThreeMonth
                    : null;
                return (
                  <tr key={row.key}>
                    <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left shadow-[8px_0_14px_-14px_rgba(15,23,42,0.45)]">
                      <span className="block text-sm font-black text-slate-950">{row.name}</span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{row.etf}</span>
                      {relativeThreeMonth !== null ? (
                        <span
                          className={cx(
                            "ml-2 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-black",
                            relativeThreeMonth >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
                          )}
                          title="3개월 S&P 500 대비 성과"
                        >
                          S&amp;P {pp(relativeThreeMonth, 1)}
                        </span>
                      ) : null}
                    </th>
                    <td className="px-2 py-1.5 text-right">
                      {row.dayChange === null ? (
                        <span className="text-xs font-semibold text-slate-300">—</span>
                      ) : (
                        <span
                          className={cx(
                            "orbitron text-sm font-black",
                            row.dayChange >= 0 ? "text-emerald-600" : "text-rose-600",
                          )}
                        >
                          {pct(row.dayChange, 2)}
                        </span>
                      )}
                      {state ? <span className={cx("market-state-badge ml-1 align-middle", state.className)}>{state.label}</span> : null}
                    </td>
                    {MOMENTUM_WINDOWS.map((window) => {
                      const value = row.momentum[window.key];
                      return (
                        <td key={window.key} className="px-1 py-1.5">
                          <div
                            className="orbitron flex min-h-9 items-center justify-center rounded-md px-1 text-[13px] font-black tabular-nums"
                            style={heatStyle(value)}
                          >
                            {pct(value, 1)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Leaders / Laggards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard kicker="강세 리더" title={`강세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={leaders} window={sortWindow} tone="up" />
        </SectionCard>
        <SectionCard kicker="약세 업종" title={`약세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={laggards} window={sortWindow} tone="down" />
        </SectionCard>
      </div>

      {/* ETF comparison */}
      <SectionCard kicker="섹터 ETF" title="섹터 ETF 비교">
        {etfRows.length === 0 ? (
          <p className="text-sm text-slate-500">ETF 데이터를 불러오지 못했습니다.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                  <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left shadow-[8px_0_14px_-14px_rgba(15,23,42,0.45)]">ETF</th>
                  <th className="px-2 py-2 text-right">1M</th>
                  <th className="px-2 py-2 text-right">YTD</th>
                  <th className="px-2 py-2 text-right">1Y</th>
                  <th className="px-2 py-2 text-right">3Y CAGR</th>
                  <th className="px-2 py-2 text-right">5Y CAGR</th>
                  <th className="px-2 py-2 text-right">Beta</th>
                  <th className="px-2 py-2 text-right">보수율</th>
                </tr>
              </thead>
              <tbody>
                {etfRows.map((row) => {
                  const etf = row.etfInfo!;
                  return (
                    <tr key={row.key} className="border-b border-slate-100 last:border-0">
                      <td className="sticky left-0 z-10 bg-white px-2 py-2 text-left shadow-[8px_0_14px_-14px_rgba(15,23,42,0.45)]">
                        <span className="text-sm font-black text-slate-950">{row.etf}</span>
                        <span className="ml-2 text-xs font-semibold text-slate-500">{row.name}</span>
                      </td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns["1m"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns.ytd, 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.returns["1y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.cagr["3y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums">{pct(etf.cagr["5y"], 1)}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-700">
                        {typeof etf.beta === "number" && Number.isFinite(etf.beta) ? etf.beta.toFixed(2) : "—"}
                      </td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-500">
                        {typeof etf.expenseRatio === "number" && Number.isFinite(etf.expenseRatio) ? formatPercent(etf.expenseRatio * 100, 2) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-400">
          XLC(커뮤니케이션) · XLRE(부동산)는 추적 ETF 미수록 — 히트맵 성과만 표시됩니다.
        </p>
      </SectionCard>

      {/* Sector valuation */}
      <SectionCard kicker="밸류에이션" title="섹터 밸류에이션">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                <th className="px-2 py-2 text-left">업종</th>
                <th className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.pe} className="cursor-help no-underline">Fwd P/E</abbr>
                </th>
                <th className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.pb} className="cursor-help no-underline">P/B</abbr>
                </th>
                <th className="px-2 py-2 text-right">
                  <abbr title={valuationHelp.roe} className="cursor-help no-underline">ROE</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((row) => row.valuation)
                .map((row) => {
                  const v = row.valuation;
                  if (!v) return null;
                  return (
                    <tr key={row.key} className="border-b border-slate-100 last:border-0">
                      <td className="px-2 py-2 text-left">
                        <span className="text-sm font-bold text-slate-900">{row.name}</span>
                        <span className="ml-2 text-xs font-semibold text-slate-400">{row.etf}</span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <PeBandGauge value={v.pe} band={v.peBand} />
                      </td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-700">{typeof v.pb === "number" && Number.isFinite(v.pb) ? v.pb.toFixed(2) : "—"}</td>
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-600">{typeof v.roe === "number" && Number.isFinite(v.roe) ? formatPercent(v.roe * 100, 1) : "—"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          업종 지수 밸류에이션 (Bloomberg). 시장 전체 밸류는 <strong>시장 밸류에이션</strong> 페이지 참고.
        </p>
      </SectionCard>
      <SmartMoneyPanel />

    </div>
  );
}

function RankList({ rows, window, tone }: { rows: SectorRow[]; window: MomentumWindow; tone: "up" | "down" }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">데이터 없음</p>;
  }
  return (
    <ol className="space-y-2">
      {rows.map((row, index) => {
        const value = row.momentum[window];
        return (
          <li key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
              <span
                className={cx(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                  tone === "up" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700",
                )}
              >
                {index + 1}
              </span>
              <span className="truncate text-sm font-bold text-slate-900">{row.name}</span>
              <span className="shrink-0 text-[11px] font-bold uppercase text-slate-400">{row.etf}</span>
            </span>
              <span className={cx("orbitron shrink-0 text-sm font-black tabular-nums", tone === "up" ? "text-emerald-600" : "text-rose-600")}>
              {pct(value, 1)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
