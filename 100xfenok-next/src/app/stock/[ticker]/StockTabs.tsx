"use client";

import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */

type YfData = Record<string, any>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtUSD(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `$${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(0)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

function fmtKRW(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(2)}조`;
  if (abs >= 100_000_000) return `${(v / 100_000_000).toFixed(0)}억`;
  return `${Math.round(v).toLocaleString()}`;
}

function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  return v.toFixed(decimals);
}

function fmtPct(v: number | null | undefined, isFraction = true): string {
  if (v == null) return "—";
  const pct = isFraction ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

function getCurrencyFn(currency: string) {
  return currency === "KRW" || currency === "JPY" ? fmtKRW : fmtUSD;
}

// ---------------------------------------------------------------------------
// Financials tab
// ---------------------------------------------------------------------------

function FinancialsTab({ data }: { data: YfData }) {
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const currency: string = data.info?.currency ?? "USD";

  const incomeData = period === "annual" ? data.income_statement : data.quarterly_income_statement;
  const balanceData = period === "annual" ? data.balance_sheet : data.quarterly_balance_sheet;
  const cashData = period === "annual" ? data.cash_flow : data.quarterly_cash_flow;

  const dates = Object.keys(incomeData ?? {}).sort();
  const revDates = [...dates].reverse();

  type RowDef = [string, string];
  const incomeRows: RowDef[] = [
    ["Total Revenue", "매출"],
    ["Gross Profit", "매출총이익"],
    ["Operating Income", "영업이익"],
    ["Net Income", "순이익"],
    ["Diluted EPS", "희석 EPS"],
    ["EBITDA", "EBITDA"],
  ];
  const balanceRows: RowDef[] = [
    ["Total Assets", "총자산"],
    ["Total Liabilities Net Minority Interest", "총부채"],
    ["Stockholders Equity", "자본"],
    ["Total Debt", "총차입금"],
    ["Cash And Cash Equivalents", "현금성자산"],
  ];
  const cashRows: RowDef[] = [
    ["Operating Cash Flow", "영업CF"],
    ["Free Cash Flow", "FCF"],
    ["Capital Expenditure", "CAPEX"],
    ["Cash Dividends Paid", "배당지급"],
    ["Repurchase Of Capital Stock", "자사주매입"],
  ];

  function renderTable(
    rows: RowDef[],
    source: Record<string, Record<string, number>> | null,
    formatFn: (v: number | null | undefined, eng: string) => string,
  ) {
    if (!source || dates.length === 0) return <p className="text-xs text-slate-400">데이터 없음</p>;
    return (
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[500px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="px-2 py-1.5 text-left" />
              {revDates.map((d) => (
                <th key={d} className="px-2 py-1.5 text-right">{d.slice(0, 7)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([eng, ko]) => {
              const vals = revDates.map((d) => source[d]?.[eng]);
              const hasData = vals.some((v) => v != null);
              if (!hasData) return null;
              return (
                <tr key={eng} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{ko}</td>
                  {vals.map((v, i) => (
                    <td key={i} className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-900">
                      {formatFn(v, eng)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const fmtFin = (v: number | null | undefined) => {
    if (v == null) return "—";
    if (currency === "KRW" || currency === "JPY") return fmtKRW(v);
    return fmtUSD(v);
  };

  const fmtEps = (v: number | null | undefined) => {
    if (v == null) return "—";
    if (currency === "KRW" || currency === "JPY") return Math.round(v).toLocaleString();
    return `$${v.toFixed(2)}`;
  };

  return (
    <div className="space-y-5">
      {/* Toggle */}
      <div className="flex gap-2">
        {(["annual", "quarterly"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition ${period === p ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive" : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive"}`}
          >
            {p === "annual" ? "연간" : "분기"}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-semibold text-slate-400">{currency}</span>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">손익계산서</h3>
        {renderTable(incomeRows, incomeData, (v, eng) => (eng === "Diluted EPS" ? fmtEps(v) : fmtFin(v)))}
      </div>
      <div>
        <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">재무상태표</h3>
        {renderTable(balanceRows, balanceData, fmtFin)}
      </div>
      <div>
        <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">현금흐름표</h3>
        {renderTable(cashRows, cashData, fmtFin)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics tab
// ---------------------------------------------------------------------------

function StatisticsTab({ data }: { data: YfData }) {
  const info = data.info ?? {};

  const isFractionKey = (k: string) =>
    ["returnOnEquity", "returnOnAssets", "profitMargins", "grossMargins", "operatingMargins", "dividendYield", "payoutRatio", "fiveYearAvgDividendYield", "heldPercentInsiders", "heldPercentInstitutions"].includes(k);

  const sections: Array<{ title: string; items: Array<[string, string]> }> = [
    {
      title: "밸류에이션",
      items: [
        ["trailingPE", "Trailing P/E"], ["forwardPE", "Forward P/E"],
        ["priceToBook", "P/B"], ["pegRatio", "PEG"],
        ["enterpriseToEbitda", "EV/EBITDA"],
      ],
    },
    {
      title: "수익성",
      items: [
        ["returnOnEquity", "ROE"], ["returnOnAssets", "ROA"],
        ["profitMargins", "순이익률"], ["grossMargins", "매출총이익률"],
        ["operatingMargins", "영업이익률"],
      ],
    },
    {
      title: "재무건전성",
      items: [
        ["currentRatio", "유동비율"], ["debtToEquity", "부채비율(%)"],
        ["totalCash", "현금"], ["totalDebt", "총부채"],
        ["freeCashflow", "FCF"],
      ],
    },
    {
      title: "배당",
      items: [
        ["dividendYield", "배당수익률"], ["payoutRatio", "배당성향"],
        ["fiveYearAvgDividendYield", "5년 평균 배당률"],
      ],
    },
  ];

  const currency = info.currency ?? "USD";
  const fmt = getCurrencyFn(currency);

  return (
    <div className="space-y-5">
      {sections.map((sec) => {
        const hasData = sec.items.some(([k]) => info[k] != null);
        if (!hasData) return null;
        return (
          <div key={sec.title}>
            <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">{sec.title}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sec.items.map(([k, label]) => {
                const v = info[k];
                if (v == null) return null;
                let display: string;
                if (isFractionKey(k)) display = fmtPct(v, true);
                else if (["totalCash", "totalDebt", "freeCashflow"].includes(k)) display = fmt(v);
                else display = v.toFixed(2);
                return <KV key={k} label={label} value={display} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ownership tab
// ---------------------------------------------------------------------------

function OwnershipTab({ data }: { data: YfData }) {
  const mh = data.major_holders ?? {};
  const ih = (data.institutional_holders ?? []) as any[];

  return (
    <div className="space-y-5">
      {/* Major holders summary */}
      <div>
        <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">주요 보유 현황</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["기관 보유율", mh.institutionsPercentHeld != null ? `${(Number(mh.institutionsPercentHeld) * 100).toFixed(1)}%` : "—"],
            ["내부자 보유율", mh.insidersPercentHeld != null ? `${(Number(mh.insidersPercentHeld) * 100).toFixed(1)}%` : "—"],
            ["기관 수", mh.institutionsCount != null ? Number(mh.institutionsCount).toLocaleString() : "—"],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
              <p className="text-[10px] font-bold text-slate-500">{label as string}</p>
              <p className="orbitron mt-1 text-lg font-black text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Institutional holders table */}
      {ih.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">기관 보유 TOP 10</h3>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[450px] text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-2 py-1.5 text-left">Holder</th>
                  <th className="px-2 py-1.5 text-right">지분율</th>
                  <th className="px-2 py-1.5 text-right">Shares</th>
                  <th className="px-2 py-1.5 text-right">증감</th>
                </tr>
              </thead>
              <tbody>
                {ih.slice(0, 10).map((h: any, i: number) => {
                  // yf pctChange is a fraction (-0.0086 = -0.86%)
                  const pctChange = h.pctChange != null ? Number(h.pctChange) * 100 : null;
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5 max-w-[180px] truncate text-[10px] font-bold text-slate-700">{h.Holder}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">{h.pctHeld != null ? `${(Number(h.pctHeld) * 100).toFixed(2)}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-600">{h.Shares != null ? Number(h.Shares).toLocaleString() : "—"}</td>
                      <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${pctChange != null ? (pctChange >= 0 ? "text-emerald-700" : "text-rose-700") : "text-slate-400"}`}>
                        {pctChange != null ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estimates tab
// ---------------------------------------------------------------------------

function EstimatesTab({ data }: { data: YfData }) {
  const targets = data.analyst_price_targets ?? {};
  const earnings = (data.earnings_estimate ?? []) as any[];
  const revenue = (data.revenue_estimate ?? []) as any[];
  const recs = (data.recommendations ?? []) as any[];
  const lastRec = recs.length > 0 ? recs[recs.length - 1] : null;

  const indexLabels: Record<string, string> = { "0q": "이번분기", "+1q": "다음분기", "0y": "올해", "+1y": "내년" };

  return (
    <div className="space-y-5">
      {/* Analyst price targets banner */}
      {targets.current != null ? (
        <div>
          <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">애널리스트 목표가</h3>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500">
              <span>Low ${targets.low?.toFixed(0) ?? "—"}</span>
              <span>Mean ${targets.mean?.toFixed(0) ?? "—"}</span>
              <span>High ${targets.high?.toFixed(0) ?? "—"}</span>
            </div>
            <div className="relative mt-2 h-3 rounded-full bg-slate-100">
              {targets.low != null && targets.high != null && targets.current != null ? (
                <>
                  <div className="absolute top-0 h-3 rounded-full bg-slate-300" style={{ left: 0, width: "100%" }} />
                  <div
                    className="absolute top-0 h-3 w-3 rounded-full border-2 border-white bg-brand-interactive"
                    style={{ left: `${((targets.current - targets.low) / (targets.high - targets.low)) * 100}%`, transform: "translateX(-50%)" }}
                  />
                </>
              ) : null}
            </div>
            <p className="mt-1 text-center text-[10px] font-bold text-slate-500">
              현재가 ${targets.current?.toFixed(2)} · 중간값 ${targets.median?.toFixed(0) ?? "—"}
            </p>
          </div>
        </div>
      ) : null}

      {/* Earnings & Revenue estimate table */}
      <div className="grid gap-5 lg:grid-cols-2">
        {earnings.length > 0 ? (
          <div>
            <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">EPS 추정치</h3>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                    <th className="px-2 py-1.5 text-left" />
                    <th className="px-2 py-1.5 text-right">Avg</th>
                    <th className="px-2 py-1.5 text-right">Low</th>
                    <th className="px-2 py-1.5 text-right">High</th>
                    <th className="px-2 py-1.5 text-right">성장률</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((e: any) => (
                    <tr key={e._index} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{indexLabels[e._index] ?? e._index}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">${e.avg?.toFixed(2) ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">${e.low?.toFixed(2) ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">${e.high?.toFixed(2) ?? "—"}</td>
                      <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${e.growth != null ? (e.growth >= 0 ? "text-emerald-700" : "text-rose-700") : ""}`}>
                        {e.growth != null ? `${(e.growth * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {revenue.length > 0 ? (
          <div>
            <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">매출 추정치</h3>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                    <th className="px-2 py-1.5 text-left" />
                    <th className="px-2 py-1.5 text-right">Avg</th>
                    <th className="px-2 py-1.5 text-right">Low</th>
                    <th className="px-2 py-1.5 text-right">High</th>
                    <th className="px-2 py-1.5 text-right">성장률</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.map((r: any) => (
                    <tr key={r._index} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{indexLabels[r._index] ?? r._index}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">{fmtNum(r.avg, 1)}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{fmtNum(r.low, 1)}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{fmtNum(r.high, 1)}</td>
                      <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${r.growth != null ? (r.growth >= 0 ? "text-emerald-700" : "text-rose-700") : ""}`}>
                        {r.growth != null ? `${(r.growth * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {/* Recommendations bar */}
      {lastRec ? (
        <div>
          <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">애널리스트 추천</h3>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex h-6 overflow-hidden rounded-full">
              {[
                ["strongBuy", "bg-emerald-600"],
                ["buy", "bg-emerald-400"],
                ["hold", "bg-slate-300"],
                ["sell", "bg-rose-400"],
                ["strongSell", "bg-rose-600"],
              ].map(([key, cls]) => {
                const count = Number(lastRec[key]) || 0;
                const total = ["strongBuy", "buy", "hold", "sell", "strongSell"].reduce((s, k) => s + (Number(lastRec[k]) || 0), 0);
                const pct = total > 0 ? (count / total) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <div key={key} className={`${cls} flex items-center justify-center text-[10px] font-bold text-white`} style={{ width: `${pct}%` }}>
                    {pct > 10 ? count : ""}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-[9px] font-bold text-slate-500">
              <span>Strong Buy</span>
              <span>Buy</span>
              <span>Hold</span>
              <span>Sell</span>
              <span>Strong Sell</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 52-week range bar
// ---------------------------------------------------------------------------

export function FiftyTwoWeekBar({ info }: { info: Record<string, any> }) {
  const low = info.fiftyTwoWeekLow;
  const high = info.fiftyTwoWeekHigh;
  const current = info.currentPrice;

  if (low == null || high == null || current == null) return null;

  const range = high - low || 1;
  const pct = ((current - low) / range) * 100;
  const isUsd = (info.currency ?? "USD") === "USD";
  const fmtBound = (v: number) =>
    isUsd ? `$${v.toFixed(0)}` : `${Math.round(v).toLocaleString()} ${info.currency}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-bold text-slate-500 mb-1">52주 범위</p>
      <div className="flex items-center gap-2">
        <span className="text-[10px] orbitron font-semibold text-slate-500">{fmtBound(low)}</span>
        <div className="relative h-2 flex-1 rounded-full bg-slate-100">
          <div
            className="absolute top-0 h-2 w-2 rounded-full bg-brand-interactive"
            style={{ left: `${Math.min(100, Math.max(0, pct))}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <span className="text-[10px] orbitron font-semibold text-slate-500">{fmtBound(high)}</span>
      </div>
      <p className="mt-1 text-center text-[10px] font-bold text-slate-600">
        52주 범위 {pct >= 50 ? "상단" : "하단"} {Math.round(pct >= 50 ? pct : 100 - pct)}% 구간
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function renderYfTab(tab: string, data: YfData) {
  if (!data) return null;
  switch (tab) {
    case "financials": return <FinancialsTab data={data} />;
    case "statistics": return <StatisticsTab data={data} />;
    case "ownership": return <OwnershipTab data={data} />;
    case "estimates": return <EstimatesTab data={data} />;
    default: return null;
  }
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2">
      <span className="text-[10px] font-medium text-slate-500">{label}</span>
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}
