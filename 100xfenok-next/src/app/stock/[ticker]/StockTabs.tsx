"use client";

import { useState } from "react";
import MetricHelp from "@/components/MetricHelp";
import { formatPlainPercent, formatSignedPercent } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */

type YfData = Record<string, any>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function fmtNum(value: unknown, decimals = 1): string {
  const v = finiteNumber(value);
  if (v === null) return "—";
  if (v >= 1_000_000_000_000) return `${(v / 1_000_000_000_000).toFixed(2)}T`;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}M`;
  return v.toFixed(decimals);
}

function fmtPct(value: unknown, isFraction = true): string {
  return formatPlainPercent(value, { digits: 1, fraction: isFraction });
}

function fmtSignedPct(value: unknown, isFraction = true): string {
  return formatSignedPercent(value, { digits: 1, fraction: isFraction });
}

const ZERO_DECIMAL_CURRENCIES = new Set(["KRW", "JPY", "TWD", "VND", "IDR"]);
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  KRW: "₩",
  JPY: "¥",
  HKD: "HK$",
  TWD: "NT$",
  CNY: "CN¥",
  EUR: "€",
  GBP: "£",
};

function normalizeCurrency(currency: unknown): string {
  return typeof currency === "string" && /^[A-Z]{3}$/.test(currency.trim().toUpperCase())
    ? currency.trim().toUpperCase()
    : "USD";
}

function defaultCurrencyDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
}

export function formatMoney(value: unknown, currency: unknown = "USD", digits?: number): string {
  const v = finiteNumber(value);
  if (v === null) return "—";
  const code = normalizeCurrency(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: digits ?? defaultCurrencyDigits(code),
    }).format(v);
  } catch {
    const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
    return `${symbol}${v.toLocaleString(undefined, { maximumFractionDigits: digits ?? defaultCurrencyDigits(code) })}`;
  }
}

function getCurrencyFn(currency: string) {
  return (value: unknown) => formatCompactMoney(value, currency);
}

export function formatCompactMoney(value: unknown, currency: unknown = "USD"): string {
  const v = finiteNumber(value);
  if (v === null) return "—";
  const code = normalizeCurrency(currency);
  if (code === "KRW") {
    const abs = Math.abs(v);
    const prefix = v < 0 ? "-" : "";
    const n = Math.abs(v);
    if (abs >= 1_000_000_000_000) return `${prefix}₩${(n / 1_000_000_000_000).toFixed(n >= 10_000_000_000_000 ? 0 : 2)}조`;
    if (abs >= 100_000_000) return `${prefix}₩${(n / 100_000_000).toFixed(n >= 1_000_000_000 ? 0 : 1)}억`;
    return `${prefix}₩${Math.round(n).toLocaleString()}`;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      compactDisplay: "short",
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 1,
    }).format(v);
  } catch {
    const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
    return `${symbol}${fmtNum(v, 1)}`;
  }
}

// ---------------------------------------------------------------------------
// Industry benchmarks (damodaran extract — build-industry-benchmarks.mjs)
// ---------------------------------------------------------------------------

export interface IndustryBench {
  name: string;
  num_firms: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  roe: number | null;
  cost_of_capital: number | null;
  operating_margin: number | null;
  net_margin: number | null;
}

type BenchDoc = {
  yf_industry_map?: Record<string, string>;
  industries?: Record<string, Omit<IndustryBench, "name">>;
};

let benchCache: BenchDoc | null = null;
let benchPending: Promise<BenchDoc | null> | null = null;
export function loadIndustryBenchmarks(): Promise<BenchDoc | null> {
  if (benchCache) return Promise.resolve(benchCache);
  if (benchPending) return benchPending;
  benchPending = fetch("/data/damodaran/industry_benchmarks.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { benchCache = d; return d; })
    .catch(() => { benchPending = null; return null; });
  return benchPending;
}

export function resolveIndustryBench(doc: BenchDoc | null, yfIndustry: string | undefined | null): IndustryBench | null {
  if (!doc || !yfIndustry) return null;
  const key = doc.yf_industry_map?.[yfIndustry];
  const row = key ? doc.industries?.[key] : undefined;
  return key && row ? { name: key, ...row } : null;
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

  type RowDef = [string, string];
  const incomeRows: RowDef[] = [
    ["Total Revenue", "매출"],
    ["Cost Of Revenue", "매출원가"],
    ["Gross Profit", "매출총이익"],
    ["Operating Expense", "영업비용"],
    ["Operating Income", "영업이익"],
    ["Net Income", "순이익"],
    ["Diluted EPS", "희석 EPS"],
    ["EBITDA", "EBITDA"],
    ["Research And Development", "R&D"],
  ];
  const balanceRows: RowDef[] = [
    ["Total Assets", "총자산"],
    ["Total Liabilities Net Minority Interest", "총부채"],
    ["Stockholders Equity", "자본"],
    ["Total Debt", "총차입금"],
    ["Cash And Cash Equivalents", "현금성자산"],
    ["Cash Cash Equivalents And Short Term Investments", "현금+단기투자"],
    ["Net Debt", "순차입금"],
    ["Current Assets", "유동자산"],
    ["Current Liabilities", "유동부채"],
    ["Working Capital", "운전자본"],
    ["Invested Capital", "투하자본"],
    ["Ordinary Shares Number", "보통주식수"],
  ];
  const cashRows: RowDef[] = [
    ["Operating Cash Flow", "영업CF"],
    ["Investing Cash Flow", "투자CF"],
    ["Financing Cash Flow", "재무CF"],
    ["Free Cash Flow", "FCF"],
    ["Capital Expenditure", "CAPEX"],
    ["Issuance Of Debt", "차입 발행"],
    ["Repayment Of Debt", "차입 상환"],
    ["Cash Dividends Paid", "배당지급"],
    ["Repurchase Of Capital Stock", "자사주매입"],
  ];

  function renderTable(
    rows: RowDef[],
    source: Record<string, Record<string, number>> | null,
    formatFn: (v: number | null | undefined, eng: string) => string,
  ) {
    const sourceDates = Object.keys(source ?? {}).sort();
    const revDates = [...sourceDates].reverse();
    if (!source || revDates.length === 0) return <p className="text-xs text-slate-400">데이터 없음</p>;
    return (
      <div className="-mx-1 overflow-x-auto px-1">
        <table data-stock-financial-table="yf" className="w-full min-w-[500px] text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
              <th className="sticky left-0 z-20 min-w-[5.5rem] bg-[var(--c-panel)] px-2 py-1.5 text-left shadow-[2px_0_0_var(--c-line-2)]" />
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
                  <td className="sticky left-0 z-10 min-w-[5.5rem] bg-[var(--c-panel)] px-2 py-1.5 text-[10px] font-bold text-slate-700 shadow-[2px_0_0_var(--c-line-2)]">{ko}</td>
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
    return formatCompactMoney(v, currency);
  };

  const fmtEps = (value: number | null | undefined) => {
    const v = finiteNumber(value);
    if (v === null) return "—";
    return formatMoney(v, currency);
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
            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-8 ${period === p ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive" : "border-slate-200 bg-white text-slate-600 hover:border-brand-interactive"}`}
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
        {renderTable(balanceRows, balanceData, (v, eng) => (eng === "Ordinary Shares Number" ? fmtNum(v, 1) : fmtFin(v)))}
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

function IndustryCompareBlock({ info, industry }: { info: Record<string, any>; industry: IndustryBench }) {
  const rows: Array<{ label: string; stock: number | null; ind: number | null; isFraction: boolean; lowerBetter: boolean }> = [
    { label: "Trailing P/E", stock: finiteNumber(info.trailingPE), ind: finiteNumber(industry.trailing_pe), isFraction: false, lowerBetter: true },
    { label: "Forward P/E", stock: finiteNumber(info.forwardPE), ind: finiteNumber(industry.forward_pe), isFraction: false, lowerBetter: true },
    { label: "ROE", stock: finiteNumber(info.returnOnEquity), ind: finiteNumber(industry.roe), isFraction: true, lowerBetter: false },
    { label: "영업이익률", stock: finiteNumber(info.operatingMargins), ind: finiteNumber(industry.operating_margin), isFraction: true, lowerBetter: false },
    { label: "순이익률", stock: finiteNumber(info.profitMargins), ind: finiteNumber(industry.net_margin), isFraction: true, lowerBetter: false },
  ].filter((r) => r.stock !== null && r.ind !== null);
  if (rows.length === 0) return null;
  const fmt = (v: number, frac: boolean) => (frac ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
        산업 대비 — {industry.name}{industry.num_firms ? ` (${industry.num_firms}개사, 다모다란)` : " (다모다란)"}
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const better = r.lowerBetter ? (r.stock as number) < (r.ind as number) : (r.stock as number) > (r.ind as number);
          return (
            <div key={r.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2">
              <MetricHelp label={r.label} className="text-[10px] font-medium text-slate-500" />
              <span className="orbitron tabular-nums text-[11px] font-black">
                <span className={better ? "text-emerald-700" : "text-slate-900"}>{fmt(r.stock as number, r.isFraction)}</span>
                <span className="mx-1 font-semibold text-slate-300">/</span>
                <span className="font-bold text-slate-400">산업 {fmt(r.ind as number, r.isFraction)}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatisticsTab({ data, industry }: { data: YfData; industry?: IndustryBench | null }) {
  const info = data.info ?? {};

  const isFractionKey = (k: string) =>
    ["returnOnEquity", "returnOnAssets", "profitMargins", "grossMargins", "operatingMargins", "ebitdaMargins", "revenueGrowth", "earningsGrowth", "payoutRatio", "heldPercentInsiders", "heldPercentInstitutions"].includes(k);
  const isPercentPointKey = (k: string) =>
    ["dividendYield", "fiveYearAvgDividendYield", "fiftyTwoWeekChangePercent"].includes(k);
  const isMoneyKey = (k: string) =>
    ["marketCap", "enterpriseValue", "totalRevenue", "ebitda", "totalCash", "totalDebt", "freeCashflow", "bookValue", "totalCashPerShare"].includes(k);
  const isCountKey = (k: string) =>
    ["averageVolume", "averageVolume10days", "sharesOutstanding", "floatShares", "fullTimeEmployees"].includes(k);

  const sections: Array<{ title: string; items: Array<[string, string]> }> = [
    {
      title: "밸류에이션",
      items: [
        ["trailingPE", "Trailing P/E"], ["forwardPE", "Forward P/E"],
        ["priceToBook", "P/B"], ["pegRatio", "PEG"],
        ["enterpriseToRevenue", "EV/매출"], ["enterpriseToEbitda", "EV/EBITDA"],
        ["bookValue", "주당 장부가"], ["enterpriseValue", "EV"],
      ],
    },
    {
      title: "수익성",
      items: [
        ["returnOnEquity", "ROE"], ["returnOnAssets", "ROA"],
        ["profitMargins", "순이익률"], ["grossMargins", "매출총이익률"],
        ["operatingMargins", "영업이익률"], ["ebitdaMargins", "EBITDA 마진"],
        ["revenueGrowth", "매출 성장"], ["earningsGrowth", "이익 성장"],
      ],
    },
    {
      title: "재무건전성",
      items: [
        ["currentRatio", "유동비율"], ["debtToEquity", "부채비율(%)"],
        ["totalCash", "현금"], ["totalCashPerShare", "주당 현금"],
        ["totalDebt", "총부채"], ["freeCashflow", "FCF"],
      ],
    },
    {
      title: "배당",
      items: [
        ["dividendYield", "배당수익률"], ["payoutRatio", "배당성향"],
        ["fiveYearAvgDividendYield", "5년 평균 배당률"],
      ],
    },
    {
      title: "거래·규모",
      items: [
        ["marketCap", "시가총액"], ["totalRevenue", "매출"],
        ["ebitda", "EBITDA"], ["averageVolume", "평균 거래량"],
        ["averageVolume10days", "10일 거래량"], ["sharesOutstanding", "발행주식"],
        ["floatShares", "유통주식"], ["fiftyTwoWeekChangePercent", "52주 수익률"],
        ["beta", "베타"], ["fullTimeEmployees", "직원수"],
      ],
    },
  ];

  const currency = info.currency ?? "USD";
  const fmt = getCurrencyFn(currency);

  return (
    <div className="space-y-5">
      {industry ? <IndustryCompareBlock info={info} industry={industry} /> : null}
      {sections.map((sec) => {
        const hasData = sec.items.some(([k]) => finiteNumber(info[k]) !== null);
        if (!hasData) return null;
        return (
          <div key={sec.title}>
            <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">{sec.title}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sec.items.map(([k, label]) => {
                const v = finiteNumber(info[k]);
                if (v === null) return null;
                let display: string;
                if (isFractionKey(k)) display = fmtPct(v, true);
                else if (isPercentPointKey(k)) display = k === "fiftyTwoWeekChangePercent" ? fmtSignedPct(v, false) : fmtPct(v, false);
                else if (isMoneyKey(k)) display = fmt(v);
                else if (isCountKey(k)) display = v.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
  const ih = asArray(data.institutional_holders);
  const currency = data.info?.currency ?? "USD";

  return (
    <div className="space-y-5">
      {/* Major holders summary */}
      <div>
        <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">주요 보유 현황</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["기관 보유율", fmtPct(mh.institutionsPercentHeld, true)],
            ["유통주 기관 보유", fmtPct(mh.institutionsFloatPercentHeld, true)],
            ["내부자 보유율", fmtPct(mh.insidersPercentHeld, true)],
            ["기관 수", finiteNumber(mh.institutionsCount)?.toLocaleString() ?? "—"],
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
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                  <th className="px-2 py-1.5 text-left">Holder</th>
                  <th className="px-2 py-1.5 text-right">지분율</th>
                  <th className="px-2 py-1.5 text-right">Shares</th>
                  <th className="px-2 py-1.5 text-right">평가액</th>
                  <th className="px-2 py-1.5 text-right">증감</th>
                  <th className="px-2 py-1.5 text-right">보고일</th>
                </tr>
              </thead>
              <tbody>
                {ih.slice(0, 10).map((h: any, i: number) => {
                  // yf pctChange is a fraction (-0.0086 = -0.86%)
                  const pctHeld = finiteNumber(h.pctHeld);
                  const shares = finiteNumber(h.Shares);
                  const value = finiteNumber(h.Value);
                  const pctChangeRaw = finiteNumber(h.pctChange);
                  const pctChange = pctChangeRaw !== null ? pctChangeRaw * 100 : null;
                  return (
                    <tr key={i} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-2 py-1.5 max-w-[180px] truncate text-[10px] font-bold text-slate-700">{h.Holder}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">{pctHeld !== null ? `${(pctHeld * 100).toFixed(2)}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-600">{shares !== null ? shares.toLocaleString() : "—"}</td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold text-slate-600">{value !== null ? formatCompactMoney(value, currency) : "—"}</td>
                      <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${pctChange != null ? (pctChange >= 0 ? "text-emerald-700" : "text-rose-700") : "text-slate-400"}`}>
                        {pctChange != null ? `${pctChange > 0 ? "+" : ""}${pctChange.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right orbitron tabular-nums text-[10px] font-semibold text-slate-500">{h["Date Reported"] ?? "—"}</td>
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
  const infoCurrency = normalizeCurrency(data.info?.currency ?? "USD");
  const targets = data.analyst_price_targets ?? {};
  const earnings = asArray(data.earnings_estimate);
  const revenue = asArray(data.revenue_estimate);
  const recs = asArray(data.recommendations);
  const lastRec = recs.length > 0 ? recs[recs.length - 1] : null;
  const targetLow = finiteNumber(targets.low);
  const targetMean = finiteNumber(targets.mean);
  const targetHigh = finiteNumber(targets.high);
  const targetCurrent = finiteNumber(targets.current);
  const targetMedian = finiteNumber(targets.median);
  const targetRangeValid = targetLow !== null && targetHigh !== null && targetCurrent !== null && targetHigh > targetLow;
  const targetPct = targetRangeValid ? clamp(((targetCurrent - targetLow) / (targetHigh - targetLow)) * 100) : null;

  const indexLabels: Record<string, string> = { "0q": "이번분기", "+1q": "다음분기", "0y": "올해", "+1y": "내년" };

  return (
    <div className="space-y-5">
      {/* Analyst price targets banner */}
      {targetCurrent !== null ? (
        <div>
          <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">애널리스트 목표가</h3>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-bold text-slate-500">
              <span>Low {formatMoney(targetLow, infoCurrency)}</span>
              <span>Mean {formatMoney(targetMean, infoCurrency)}</span>
              <span>High {formatMoney(targetHigh, infoCurrency)}</span>
            </div>
            <div className="relative mt-2 h-3 rounded-full bg-slate-100">
              {targetPct !== null ? (
                <>
                  <div className="absolute top-0 h-3 rounded-full bg-slate-300" style={{ left: 0, width: "100%" }} />
                  <div
                    className="absolute top-0 h-3 w-3 rounded-full border-2 border-white bg-brand-interactive"
                    style={{ left: `${targetPct}%`, transform: "translateX(-50%)" }}
                  />
                </>
              ) : null}
            </div>
            <p className="mt-1 text-center text-[10px] font-bold text-slate-500">
              현재가 {formatMoney(targetCurrent, infoCurrency)} · 중간값 {formatMoney(targetMedian, infoCurrency)}
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
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                    <th className="px-2 py-1.5 text-left" />
                    <th className="px-2 py-1.5 text-right">Avg</th>
                    <th className="px-2 py-1.5 text-right">Low</th>
                    <th className="px-2 py-1.5 text-right">High</th>
                    <th className="px-2 py-1.5 text-right">전년</th>
                    <th className="px-2 py-1.5 text-right">분석가</th>
                    <th className="px-2 py-1.5 text-right">성장률</th>
                  </tr>
                </thead>
                <tbody>
                  {earnings.map((e: any) => {
                    const growth = finiteNumber(e.growth);
                    const rowCurrency = normalizeCurrency(e.currency ?? infoCurrency);
                    return (
                      <tr key={e._index} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{indexLabels[e._index] ?? e._index}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">{formatMoney(e.avg, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatMoney(e.low, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatMoney(e.high, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatMoney(e.yearAgoEps, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{finiteNumber(e.numberOfAnalysts)?.toLocaleString() ?? "—"}</td>
                        <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${growth !== null ? (growth >= 0 ? "text-emerald-700" : "text-rose-700") : ""}`}>
                          {fmtSignedPct(growth, true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {revenue.length > 0 ? (
          <div>
            <h3 className="mb-2 text-[12px] font-black uppercase tracking-[0.08em] text-slate-500">매출 추정치</h3>
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[580px] text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">
                    <th className="px-2 py-1.5 text-left" />
                    <th className="px-2 py-1.5 text-right">Avg</th>
                    <th className="px-2 py-1.5 text-right">Low</th>
                    <th className="px-2 py-1.5 text-right">High</th>
                    <th className="px-2 py-1.5 text-right">전년</th>
                    <th className="px-2 py-1.5 text-right">분석가</th>
                    <th className="px-2 py-1.5 text-right">성장률</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.map((r: any) => {
                    const growth = finiteNumber(r.growth);
                    const rowCurrency = normalizeCurrency(r.currency ?? infoCurrency);
                    return (
                      <tr key={r._index} className="border-b border-slate-100 last:border-b-0">
                        <td className="px-2 py-1.5 text-[10px] font-bold text-slate-700">{indexLabels[r._index] ?? r._index}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs font-semibold">{formatCompactMoney(r.avg, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatCompactMoney(r.low, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatCompactMoney(r.high, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{formatCompactMoney(r.yearAgoRevenue, rowCurrency)}</td>
                        <td className="px-2 py-1.5 text-right orbitron tabular-nums text-xs text-slate-500">{finiteNumber(r.numberOfAnalysts)?.toLocaleString() ?? "—"}</td>
                        <td className={`px-2 py-1.5 text-right orbitron tabular-nums text-xs font-bold ${growth !== null ? (growth >= 0 ? "text-emerald-700" : "text-rose-700") : ""}`}>
                          {fmtSignedPct(growth, true)}
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
  const low = finiteNumber(info.fiftyTwoWeekLow);
  const high = finiteNumber(info.fiftyTwoWeekHigh);
  const current = finiteNumber(info.currentPrice);

  if (low === null || high === null || current === null || high <= low) return null;

  const pct = clamp(((current - low) / (high - low)) * 100);
  const currency = normalizeCurrency(info.currency ?? "USD");
  const fmtBound = (v: number) => (Math.abs(v) >= 100_000 ? formatCompactMoney(v, currency) : formatMoney(v, currency, 0));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-bold text-slate-500 mb-1">52주 범위</p>
      <div className="flex items-center gap-2">
        <span className="max-w-[5.5rem] truncate text-[10px] orbitron font-semibold text-slate-500">{fmtBound(low)}</span>
        <div className="relative h-2 flex-1 rounded-full bg-slate-100">
          <div
            className="absolute top-0 h-2 w-2 rounded-full bg-brand-interactive"
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <span className="max-w-[5.5rem] truncate text-[10px] orbitron font-semibold text-slate-500">{fmtBound(high)}</span>
      </div>
      <p className="mt-1 text-center text-[10px] font-bold text-slate-600">
        52주 범위 {pct >= 50 ? "상단" : "하단"} {Math.round(pct >= 50 ? pct : 100 - pct)}% 구간
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SummaryScoreCard — 5-area binary-check score (Snowflake-style, deep-research claim 2)
// ---------------------------------------------------------------------------
// Field units verified by jq (2026-06-11): dividendYield = PERCENT,
// payoutRatio/ROE/margins/estimate growth = fraction, debtToEquity = x100.

interface ScoreCheck { label: string; pass: boolean }
interface AreaScore { area: string; score: number; total: number; checks: ScoreCheck[] }
export type SummaryScoreTabTarget = "statistics" | "estimates" | "financials" | "ownership";

const SUMMARY_SCORE_AREA_TARGETS: Record<string, { tab: SummaryScoreTabTarget; label: string; description: string; hash?: string }> = {
  "밸류에이션": { tab: "statistics", label: "밸류", description: "PER 밴드·비교" },
  "미래 성장": { tab: "estimates", label: "추정치", description: "FY+1 전망" },
  "과거 실적": { tab: "financials", label: "재무", description: "8Y 추이" },
  "재무 건전성": { tab: "financials", label: "재무", description: "현금·부채" },
  "배당": { tab: "financials", label: "재무", description: "배당 이력", hash: "#dividend" },
};

function pushCheck(checks: ScoreCheck[], label: string, pass: boolean | null) {
  if (pass === null) return; // data missing -> check excluded from total
  checks.push({ label, pass });
}

function estGrowth(rows: any[] | null | undefined, idx: string): number | null {
  const r = asArray(rows).find((e: any) => e._index === idx);
  return finiteNumber(r?.growth);
}

export function computeSummaryScores(
  data: YfData,
  perBand: { current: number; min: number; max: number } | null,
  industry?: IndustryBench | null,
): AreaScore[] {
  const info = data.info ?? {};
  const n = (v: any): number | null => finiteNumber(v);
  const gt = (v: any, t: number): boolean | null => {
    const value = n(v);
    return value === null ? null : value > t;
  };
  const lt = (v: any, t: number): boolean | null => {
    const value = n(v);
    return value === null ? null : value < t;
  };

  const areas: AreaScore[] = [];
  const area = (name: string, build: (c: ScoreCheck[]) => void) => {
    const checks: ScoreCheck[] = [];
    build(checks);
    areas.push({ area: name, score: checks.filter((c) => c.pass).length, total: checks.length, checks });
  };

  area("밸류에이션", (c) => {
    pushCheck(c, "PER 역사 밴드 하단권", perBand && perBand.current > 0 ? perBand.current < (perBand.min + perBand.max) / 2 : null);
    const target = n(data.analyst_price_targets?.mean);
    const price = n(info.currentPrice);
    pushCheck(c, "애널리스트 목표가 대비 상승 여력", target !== null && price !== null ? target > price : null);
    pushCheck(c, "PER 25배 미만", lt(info.trailingPE, 25));
    pushCheck(c, "EV/EBITDA 15배 미만", lt(info.enterpriseToEbitda, 15));
    const indPe = finiteNumber(industry?.trailing_pe);
    const pe = n(info.trailingPE);
    pushCheck(c, "PER 산업 평균 미만 (다모다란)", indPe !== null && pe !== null ? pe < indPe : null);
  });

  area("미래 성장", (c) => {
    pushCheck(c, "내년 EPS 성장 전망 +10% 초과", gt(estGrowth(data.earnings_estimate, "+1y"), 0.10));
    pushCheck(c, "내년 매출 성장 전망 +5% 초과", gt(estGrowth(data.revenue_estimate, "+1y"), 0.05));
    pushCheck(c, "애널리스트 매수 우위", lt(info.recommendationMean, 2.5));
    const fwd = n(info.forwardPE);
    const trl = n(info.trailingPE);
    pushCheck(c, "이익 성장 반영 (선행 PER < 후행 PER)", fwd !== null && trl !== null ? fwd < trl : null);
  });

  area("과거 실적", (c) => {
    const inc = data.income_statement ?? null;
    const dates = inc ? Object.keys(inc).sort() : [];
    const first = dates.length >= 2 ? inc[dates[0]] : null;
    const last = dates.length >= 2 ? inc[dates[dates.length - 1]] : null;
    const grew = (key: string): boolean | null => {
      const a = n(first?.[key]);
      const b = n(last?.[key]);
      return a !== null && b !== null ? b > a : null;
    };
    pushCheck(c, `매출 증가 추세 (${dates.length}년)`, grew("Total Revenue"));
    pushCheck(c, "순이익 증가 추세", grew("Net Income"));
    pushCheck(c, "ROE 12% 초과", gt(info.returnOnEquity, 0.12));
    pushCheck(c, "영업이익률 10% 초과", gt(info.operatingMargins, 0.10));
  });

  area("재무 건전성", (c) => {
    pushCheck(c, "부채비율 100% 미만", lt(info.debtToEquity, 100));
    pushCheck(c, "유동비율 1배 초과", gt(info.currentRatio, 1));
    pushCheck(c, "잉여현금흐름 흑자", gt(info.freeCashflow, 0));
    const cash = n(info.totalCash);
    const debt = n(info.totalDebt);
    pushCheck(c, "현금이 차입금의 30% 이상", cash !== null && debt !== null ? cash >= debt * 0.3 : null);
  });

  area("배당", (c) => {
    pushCheck(c, "배당 지급 중", gt(info.dividendYield, 0));
    pushCheck(c, "배당수익률 2% 초과", gt(info.dividendYield, 2)); // percent unit
    pushCheck(c, "배당성향 60% 미만 (지속 가능)", info.dividendYield ? lt(info.payoutRatio, 0.6) : null);
    const divDates = data.dividends ? Object.keys(data.dividends).sort() : [];
    const spanYears = divDates.length >= 2 ? (new Date(divDates[divDates.length - 1]).getTime() - new Date(divDates[0]).getTime()) / 31557600000 : 0;
    pushCheck(c, "5년 이상 배당 이력", divDates.length ? spanYears >= 5 : null);
  });

  return areas.filter((a) => a.total > 0);
}

function scoreColor(ratio: number): string {
  if (ratio >= 0.75) return "var(--c-up)";
  if (ratio >= 0.5) return "var(--c-warn)";
  return "var(--c-down)";
}

export function SummaryScoreCard({ data, perBand, industry, onAreaSelect }: {
  data: YfData;
  perBand: { current: number; min: number; max: number } | null;
  industry?: IndustryBench | null;
  onAreaSelect?: (tab: SummaryScoreTabTarget, hash?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const areas = computeSummaryScores(data, perBand, industry);
  if (areas.length === 0) return null;
  const score = areas.reduce((s, a) => s + a.score, 0);
  const total = areas.reduce((s, a) => s + a.total, 0);
  const ratio = total > 0 ? score / total : 0;
  const verdict = ratio >= 0.75 ? "우량 신호 우세" : ratio >= 0.5 ? "혼조 — 강점·약점 공존" : "주의 신호 우세";

  return (
    <div className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <p className="text-[10px] font-bold text-slate-500">투자 체크 요약</p>
          <p className="text-sm font-black text-slate-900">
            {score}/{total} 통과 · <span style={{ color: scoreColor(ratio) }}>{verdict}</span>
          </p>
        </div>
        <span className="text-[10px] font-bold text-slate-500">{open ? "접기 ▲" : "상세 ▼"}</span>
      </button>

      <div className="mt-2 grid gap-1.5 sm:grid-cols-5">
        {areas.map((a) => {
          const r = a.total > 0 ? a.score / a.total : 0;
          const target = SUMMARY_SCORE_AREA_TARGETS[a.area];
          return (
            <button
              key={a.area}
              type="button"
              data-stock-summary-axis-link
              data-stock-summary-axis={a.area}
              data-stock-summary-axis-tab={target?.tab ?? ""}
              data-stock-summary-axis-hash={target?.hash ?? ""}
              onClick={() => target ? onAreaSelect?.(target.tab, target.hash) : undefined}
              className="min-h-11 rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5 text-left transition hover:border-brand-interactive hover:bg-white"
              aria-label={`${a.area} 체크 ${a.score}/${a.total}, ${target ? `${target.label} 섹션으로 이동` : "상세 확인"}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-bold text-slate-600">{a.area}</span>
                <span className="orbitron tabular-nums text-[10px] font-black text-slate-700">{a.score}/{a.total}</span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full" style={{ width: `${r * 100}%`, backgroundColor: scoreColor(r) }} />
              </div>
              {target ? <span className="mt-1 block text-[9px] font-bold text-slate-500">{target.label} · {target.description}</span> : null}
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-5">
          {areas.map((a) => (
            <div key={a.area}>
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.06em] text-slate-500">{a.area}</p>
              <ul className="space-y-1">
                {a.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-1.5 text-[10px] font-semibold">
                    <span className={c.pass ? "text-emerald-600" : "text-rose-500"}>{c.pass ? "✓" : "✗"}</span>
                    <span className={c.pass ? "text-slate-700" : "text-slate-500"}>{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-2 text-[9px] font-semibold text-slate-500">데이터 없는 항목은 채점에서 제외 · 투자 참고용 단순 체크리스트</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThreeSecondSummary — meaning-first verdict paragraph (deep-research claim 2:
// summary module at top; numbers stay below in their existing sections)
// ---------------------------------------------------------------------------

function bandPhrase(current: number, min: number, max: number): string | null {
  if (!(current > 0) || !(max > min)) return null;
  const pct = ((current - min) / (max - min)) * 100;
  if (pct >= 80) return "역사적 밴드 상단 — 비싸게 거래";
  if (pct >= 55) return "밴드 중상단 — 다소 프리미엄";
  if (pct >= 35) return "역사적 밴드 중간 — 평년 수준";
  return "밴드 하단 — 역사 대비 싼 구간";
}

export function buildThreeSecondSummary(
  data: YfData,
  perBand: { current: number; min: number; max: number } | null,
  guruCount: number,
  industry?: IndustryBench | null,
): string[] {
  const info = data.info ?? {};
  const sentences: string[] = [];

  // 1) valuation now
  const val: string[] = [];
  const band = perBand ? bandPhrase(perBand.current, perBand.min, perBand.max) : null;
  if (band) val.push(band);
  const industryPe = finiteNumber(industry?.trailing_pe);
  const trailingPe = finiteNumber(info.trailingPE);
  if (industryPe !== null && industryPe > 0 && trailingPe !== null) {
    const ratio = trailingPe / industryPe;
    if (ratio <= 0.85) val.push(`산업 평균 PER(${industryPe.toFixed(0)}배)보다 싸게 거래`);
    else if (ratio >= 1.15) val.push(`산업 평균 PER(${industryPe.toFixed(0)}배)의 ${ratio.toFixed(1)}배 수준`);
  }
  const target = finiteNumber(data.analyst_price_targets?.mean);
  const price = finiteNumber(info.currentPrice);
  if (target !== null && price !== null && price > 0) {
    const up = (target / price - 1) * 100;
    val.push(`애널리스트 목표가까지 ${up >= 0 ? "+" : ""}${up.toFixed(0)}%`);
  }
  if (val.length) sentences.push(`${val.join(", ")}.`);

  // 2) fundamentals direction
  const fun: string[] = [];
  const g = finiteNumber(asArray(data.earnings_estimate).find((e: any) => e._index === "+1y")?.growth);
  if (g !== null) {
    fun.push(g > 0.05 ? `내년 EPS ${(g * 100).toFixed(0)}% 성장 전망` : g < 0 ? "내년 이익 감소 전망" : "내년 이익 정체 전망");
  }
  const scores = computeSummaryScores(data, perBand, industry);
  if (scores.length) {
    const total = scores.reduce((s, a) => s + a.total, 0);
    const score = scores.reduce((s, a) => s + a.score, 0);
    const weakest = [...scores].sort((a, b) => a.score / a.total - b.score / b.total)[0];
    fun.push(`체크 ${score}/${total} 통과 (약점: ${weakest.area})`);
  }
  if (fun.length) sentences.push(`${fun.join(", ")}.`);

  // 3) smart money
  if (guruCount > 0) sentences.push(`슈퍼인베스터 ${guruCount}명이 보유 중.`);

  return sentences;
}

export function ThreeSecondSummary({ data, perBand, guruCount, industry }: {
  data: YfData;
  perBand: { current: number; min: number; max: number } | null;
  guruCount: number;
  industry?: IndustryBench | null;
}) {
  const sentences = buildThreeSecondSummary(data, perBand, guruCount, industry);
  if (sentences.length === 0) return null;
  return (
    <div className="rounded-lg border border-brand-interactive/20 bg-brand-interactive/[0.03] p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-brand-interactive">3초 요약</p>
      <p className="mt-1 text-[13px] font-bold leading-6 text-slate-800">{sentences.join(" ")}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function renderYfTab(tab: string, data: YfData, industry?: IndustryBench | null) {
  if (!data) return null;
  switch (tab) {
    case "financials": return <FinancialsTab data={data} />;
    case "statistics": return <StatisticsTab data={data} industry={industry} />;
    case "ownership": return <OwnershipTab data={data} />;
    case "estimates": return <EstimatesTab data={data} />;
    default: return null;
  }
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-2">
      <MetricHelp label={label} className="text-[10px] font-medium text-slate-500" />
      <span className="orbitron tabular-nums text-xs font-black text-slate-900">{value}</span>
    </div>
  );
}
