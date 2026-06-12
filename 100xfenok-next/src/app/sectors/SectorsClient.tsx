"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import SmartMoneyPanel from "./SmartMoneyPanel";
import TransitionLink from "@/components/TransitionLink";
import { useSectorData } from "@/hooks/useSectorData";
import { MOMENTUM_WINDOWS, type MomentumWindow, type SectorRow } from "@/lib/sectors/types";
import { formatPercent, formatSignedPercentDecimal, getMarketStateMeta } from "@/lib/dashboard/formatters";

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pct(value: number | null | undefined, digits = 1): string {
  return typeof value !== "number" || !Number.isFinite(value) ? "—" : formatSignedPercentDecimal(value, digits);
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

export default function SectorsClient() {
  const { rows, dataReady, failedSources, updatedAt } = useSectorData();
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

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">Sector Intelligence</p>
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
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          섹터 데이터를 불러오는 중입니다.
        </div>
      ) : null}

      {/* Heatmap */}
      <SectionCard kicker="Momentum Heatmap" title="업종 × 기간 성과" className={isMuted ? "opacity-60" : undefined}>
        <p className="mb-3 text-xs text-slate-500">
          열 머리글을 누르면 해당 기간 기준으로 정렬됩니다. 초록=강세 · 빨강=약세, 진할수록 강합니다.
        </p>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">
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
              {sorted.map((row) => {
                const state = getMarketStateMeta(row.marketState);
                return (
                  <tr key={row.key}>
                    <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left">
                      <span className="block text-sm font-black text-slate-950">{row.name}</span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{row.etf}</span>
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
        <SectionCard kicker="Leaders" title={`강세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={leaders} window={sortWindow} tone="up" />
        </SectionCard>
        <SectionCard kicker="Laggards" title={`약세 업종 · ${MOMENTUM_WINDOWS.find((w) => w.key === sortWindow)?.label}`}>
          <RankList rows={laggards} window={sortWindow} tone="down" />
        </SectionCard>
      </div>

      {/* ETF comparison */}
      <SectionCard kicker="Sector ETFs" title="섹터 ETF 비교">
        {etfRows.length === 0 ? (
          <p className="text-sm text-slate-500">ETF 데이터를 불러오지 못했습니다.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-2 py-2 text-left">ETF</th>
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
                      <td className="px-2 py-2 text-left">
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
      <SectionCard kicker="Valuation" title="섹터 밸류에이션">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                <th className="px-2 py-2 text-left">업종</th>
                <th className="px-2 py-2 text-right">Fwd P/E</th>
                <th className="px-2 py-2 text-right">P/B</th>
                <th className="px-2 py-2 text-right">ROE</th>
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
                      <td className="orbitron px-2 py-2 text-right tabular-nums text-slate-900">{typeof v.pe === "number" && Number.isFinite(v.pe) ? v.pe.toFixed(1) : "—"}</td>
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
