"use client";

import { Fragment, useMemo, useState, useEffect } from "react";
import TransitionLink from "@/components/TransitionLink";
import { useScreenerData } from "@/hooks/useScreenerData";
import type { ScreenerSortKey, SortDir, ScreenerStock } from "@/lib/screener/types";
import { formatPercent, formatSignedPercentDecimal } from "@/lib/dashboard/formatters";
import { bandPct, bandClass, bandLabel, normalizeBandTuple, BAND_CHEAP, BAND_RICH } from "@/lib/screener/bands";
import StockDetailPanel from "./StockDetailPanel";

const PAGE_SIZE = 50;

interface ActionRow {
  symbol: string;
  actionScore?: number | null;
  confidenceLabel?: string | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  lowEvidence?: boolean | null;
  guruHolders?: number | null;
  forwardPeFy1?: number | null;
  forwardEpsFy1?: number | null;
  revenueGrowthFy1?: number | null;
  epsGrowthFy1?: number | null;
}
interface ActionSummaryDoc {
  fields?: string[];
  rows?: Array<ActionRow | unknown[]>;
}
type ActionFilter = "" | "smart_money" | "value_momentum" | "index_core" | "income" | "momentum" | "watch";

function normalizeActionRow(row: ActionRow | unknown[], fields: string[]): ActionRow | null {
  if (!Array.isArray(row)) return row.symbol ? row : null;
  const value = (key: string): unknown => {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  };
  const symbol = value("symbol");
  if (typeof symbol !== "string" || symbol.length === 0) return null;
  const actionReasons = value("actionReasons");
  return {
    symbol,
    actionScore: typeof value("actionScore") === "number" ? value("actionScore") as number : null,
    confidenceLabel: typeof value("confidenceLabel") === "string" ? value("confidenceLabel") as string : null,
    actionLabel: typeof value("actionLabel") === "string" ? value("actionLabel") as string : null,
    actionBucket: typeof value("actionBucket") === "string" ? value("actionBucket") as string : null,
    actionReasons: Array.isArray(actionReasons) ? actionReasons.filter((item): item is string => typeof item === "string") : [],
    lowEvidence: typeof value("lowEvidence") === "boolean" ? value("lowEvidence") as boolean : false,
    guruHolders: typeof value("guruHolders") === "number" ? value("guruHolders") as number : null,
    forwardPeFy1: typeof value("forwardPeFy1") === "number" ? value("forwardPeFy1") as number : null,
    forwardEpsFy1: typeof value("forwardEpsFy1") === "number" ? value("forwardEpsFy1") as number : null,
    revenueGrowthFy1: typeof value("revenueGrowthFy1") === "number" ? value("revenueGrowthFy1") as number : null,
    epsGrowthFy1: typeof value("epsGrowthFy1") === "number" ? value("epsGrowthFy1") as number : null,
  };
}

const COUNTRY_LABEL: Record<string, string> = {
  US: "미국",
  KR: "한국",
  JP: "일본",
  CN: "중국",
  HK: "홍콩",
  XX: "기타",
};

const COLUMNS: ReadonlyArray<{ key: ScreenerSortKey; label: string; align: "left" | "right" }> = [
  { key: "ticker", label: "티커", align: "left" },
  { key: "actionScore", label: "액션", align: "left" },
  { key: "name", label: "종목", align: "left" },
  { key: "sector", label: "섹터", align: "left" },
  { key: "country", label: "국가", align: "left" },
  { key: "price", label: "가격", align: "right" },
  { key: "marketCap", label: "시총", align: "right" },
  { key: "per", label: "PER", align: "right" },
  { key: "pbr", label: "PBR", align: "right" },
  { key: "dividendYield", label: "배당", align: "right" },
  { key: "return12m", label: "12M", align: "right" },
  { key: "roe", label: "ROE", align: "right" },
  { key: "opm", label: "OPM", align: "right" },
  { key: "eps", label: "EPS", align: "right" },
  { key: "growthRate", label: "3M", align: "right" },
  { key: "momentum1m", label: "1M", align: "right" },
  { key: "momentum6m", label: "6M", align: "right" },
  { key: "momentum12m", label: "12M", align: "right" },
  { key: "rank", label: "Rank", align: "right" },
  { key: "guruHolders", label: "구루", align: "right" },
  { key: "perBandCurrent", label: "PER밴드", align: "left" },
  { key: "peForward", label: "Fwd PER", align: "right" },
  { key: "epsForward", label: "Fwd EPS", align: "right" },
  { key: "forwardPeFy1", label: "FY+1 PER", align: "right" },
  { key: "forwardEpsFy1", label: "FY+1 EPS", align: "right" },
  { key: "revenueGrowthFy1", label: "매출+1", align: "right" },
  { key: "epsGrowthFy1", label: "EPS+1", align: "right" },
  { key: "dividendTtm", label: "Div TTM", align: "right" },
  { key: "ret1y", label: "1Y", align: "right" },
  { key: "ret3y", label: "3Y", align: "right" },
  { key: "ret5y", label: "5Y", align: "right" },
];

type ColumnPreset = "basic" | "action" | "value" | "estimate" | "momentum" | "dividend" | "guru";

const PRESET_KEYS: Record<ColumnPreset, ScreenerSortKey[]> = {
  basic: ["ticker", "actionScore", "name", "sector", "country", "price", "marketCap", "per", "pbr", "dividendYield", "return12m"],
  action: ["ticker", "actionScore", "name", "sector", "guruHolders", "perBandCurrent", "return12m", "ret1y", "dividendYield", "marketCap"],
  value: ["ticker", "name", "sector", "per", "peForward", "forwardPeFy1", "pbr", "roe", "opm", "perBandCurrent", "rank"],
  estimate: ["ticker", "actionScore", "name", "sector", "forwardPeFy1", "forwardEpsFy1", "revenueGrowthFy1", "epsGrowthFy1", "perBandCurrent", "marketCap"],
  momentum: ["ticker", "name", "sector", "growthRate", "momentum1m", "momentum6m", "momentum12m", "rank"],
  dividend: ["ticker", "name", "sector", "dividendYield", "dividendTtm", "ret1y", "ret3y", "ret5y", "per", "pbr", "marketCap"],
  guru: ["ticker", "name", "sector", "guruHolders", "per", "peForward", "perBandCurrent", "roe", "marketCap", "return12m"],
};

const PRESET_LABEL: Record<ColumnPreset, string> = {
  basic: "기본",
  action: "액션",
  value: "밸류",
  estimate: "추정치",
  momentum: "모멘텀",
  dividend: "배당",
  guru: "구루픽",
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function fmtMarketCap(mn: number | null): string {
  if (mn === null) return "—";
  if (mn >= 1_000_000) return `$${(mn / 1_000_000).toFixed(2)}T`;
  if (mn >= 1_000) return `$${(mn / 1_000).toFixed(1)}B`;
  return `$${Math.round(mn)}M`;
}
function fmtNum(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}
function fmtSignedPct(value: number | null): string {
  return value === null ? "—" : formatSignedPercentDecimal(value, 1);
}
function fmtYield(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 2);
}
function fmtRoe(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtOpm(value: number | null): string {
  return value === null ? "—" : formatPercent(value * 100, 1);
}
function fmtEps(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
function fmtRank(value: number | null): string {
  return value === null ? "—" : value.toLocaleString();
}

function confidenceText(label: string | null | undefined): string {
  if (label === "high") return "신뢰 높음";
  if (label === "medium") return "신뢰 중간";
  if (label === "low") return "신뢰 낮음";
  return "신뢰 미정";
}

function confidenceClass(label: string | null | undefined, lowEvidence: boolean): string {
  if (lowEvidence || label === "low") return "text-slate-400";
  if (label === "medium") return "text-amber-600";
  if (label === "high") return "text-emerald-600";
  return "text-slate-400";
}

function actionTone(bucket: string | null | undefined, confidenceLabel?: string | null, lowEvidence = false): string {
  if (lowEvidence || confidenceLabel === "low") return "border-slate-200 bg-slate-50 text-slate-500";
  if (bucket === "smart_money") return "border-violet-200 bg-violet-50 text-violet-700";
  if (bucket === "value_momentum") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (bucket === "index_core") return "border-sky-200 bg-sky-50 text-sky-700";
  if (bucket === "income") return "border-amber-200 bg-amber-50 text-amber-700";
  if (bucket === "momentum") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function getMomentumClass(value: number | null): string {
  if (value === null) return "text-slate-300";
  return value >= 0 ? "text-emerald-600" : "text-rose-600";
}

const BADGE_CLASS_MAP: Record<string, string> = {
  emerald: "bg-emerald-100 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
  rose: "bg-rose-100 text-rose-700",
};

const DOT_CLASS_MAP: Record<string, string> = {
  emerald: "bg-emerald-500",
  slate: "bg-slate-500",
  rose: "bg-rose-500",
};

function PerBandBar({ current, min, avg, max }: { current: number | null; min: number | null; avg: number | null; max: number | null }) {
  const band = normalizeBandTuple(current, min, max);
  if (!band) {
    return <span className="text-slate-300">—</span>;
  }
  const [safeCurrent, safeMin, safeMax] = band;
  const pct = bandPct(safeCurrent, safeMin, safeMax);
  const avgBand = normalizeBandTuple(avg, safeMin, safeMax);
  const safeAvg = avgBand?.[0] ?? null;
  const avgPct = safeAvg !== null ? bandPct(safeAvg, safeMin, safeMax) : null;
  const cls = bandClass(pct);
  const label = bandLabel(pct);
  const badgeClass = BADGE_CLASS_MAP[cls];
  const dotClass = DOT_CLASS_MAP[cls];
  const title = `현재 ${safeCurrent.toFixed(1)} · 평균 ${safeAvg !== null ? safeAvg.toFixed(1) : "—"} · 8Y ${safeMin.toFixed(1)}~${safeMax.toFixed(1)} · ${Math.round(pct * 100)}%`;
  const isClampedHigh = pct >= 1;
  const isClampedLow = pct <= 0;

  return (
    <div className="inline-flex min-w-[176px] flex-col items-start gap-1" title={title} role="img" aria-label={title}>
      <div className="flex max-w-full items-center gap-1.5">
        <div className="relative h-2 w-20 shrink-0 overflow-hidden rounded-full">
          {/* 3-zone shading */}
          <div className="absolute inset-y-0 left-0 bg-emerald-100" style={{ width: `${BAND_CHEAP * 100}%` }} />
          <div className="absolute inset-y-0 bg-slate-100" style={{ left: `${BAND_CHEAP * 100}%`, width: `${(BAND_RICH - BAND_CHEAP) * 100}%` }} />
          <div className="absolute inset-y-0 right-0 bg-rose-100" style={{ width: `${(1 - BAND_RICH) * 100}%` }} />

          {/* avg line */}
          {avgPct !== null && (
            <div className="absolute top-0 h-full w-[1.5px] bg-slate-500" style={{ left: `${avgPct * 100}%` }} />
          )}

          {/* edge marker or dot */}
          {isClampedHigh ? (
            <div
              className="absolute top-1/2 border-y-4 border-l-[6px] border-y-transparent border-l-rose-500"
              style={{ right: 0, transform: "translateY(-50%)" }}
            />
          ) : isClampedLow ? (
            <div
              className="absolute top-1/2 border-y-4 border-r-[6px] border-y-transparent border-r-emerald-500"
              style={{ left: 0, transform: "translateY(-50%)" }}
            />
          ) : (
            <div
              className={cx("absolute top-1/2 h-2.5 w-2.5 rounded-full border-2 border-white", dotClass)}
              style={{ left: `${pct * 100}%`, transform: "translate(-50%, -50%)" }}
            />
          )}
        </div>

        <span className="orbitron shrink-0 tabular-nums text-[9px] font-black text-slate-600">
          현재 {safeCurrent.toFixed(1)}x
        </span>

        <span className={cx("orbitron shrink-0 tabular-nums rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide", badgeClass)}>
          {label} {Math.round(pct * 100)}%
        </span>
      </div>
      <span className="max-w-full truncate text-[9px] font-bold tabular-nums text-slate-400">
        평균 {safeAvg !== null ? safeAvg.toFixed(1) : "—"} · 8Y {safeMin.toFixed(1)}~{safeMax.toFixed(1)}
      </span>
    </div>
  );
}

function renderCell(stock: ScreenerStock, key: ScreenerSortKey): React.ReactNode {
  switch (key) {
    case "ticker":
      return <span className="text-sm font-black text-slate-950">{stock.ticker}</span>;
    case "name":
      return <span className="block max-w-[180px] truncate text-sm font-semibold text-slate-700">{stock.name}</span>;
    case "actionScore": {
      const lowEvidence = stock.lowEvidence === true;
      const confidence = confidenceText(stock.confidenceLabel);
      const detail = [confidence, lowEvidence ? "증거 부족" : null].filter(Boolean).join(" · ");
      const title = [...(stock.actionReasons ?? []), detail].filter(Boolean).join(" · ");
      return (
        <span className="flex min-w-0 max-w-[150px] flex-col items-start gap-1" title={title}>
          <span className={cx("max-w-full truncate rounded-full border px-2 py-0.5 text-[10px] font-black", actionTone(stock.actionBucket, stock.confidenceLabel, lowEvidence))}>
            {stock.actionLabel ?? "관찰"} · {stock.actionScore != null ? Math.round(stock.actionScore) : "—"}
          </span>
          <span className={cx("max-w-full truncate text-[10px] font-black", confidenceClass(stock.confidenceLabel, lowEvidence))}>
            {detail}
          </span>
          {stock.actionReasons?.[0] ? <span className="max-w-full truncate text-[10px] font-semibold text-slate-400">{stock.actionReasons[0]}</span> : null}
        </span>
      );
    }
    case "sector":
      return <span className="text-xs font-bold text-slate-500">{stock.sector || "—"}</span>;
    case "country":
      return <span className="text-xs font-bold text-slate-500">{COUNTRY_LABEL[stock.country] ?? stock.country ?? "—"}</span>;
    case "price":
      return <span className="orbitron tabular-nums text-slate-900">{stock.price === null ? "—" : `$${stock.price.toFixed(2)}`}</span>;
    case "marketCap":
      return <span className="orbitron tabular-nums text-slate-700">{fmtMarketCap(stock.marketCap)}</span>;
    case "per":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.per, 1)}</span>;
    case "pbr":
      return <span className="orbitron tabular-nums text-slate-700">{fmtNum(stock.pbr, 2)}</span>;
    case "dividendYield":
      return <span className="orbitron tabular-nums text-slate-600">{fmtYield(stock.dividendYield)}</span>;
    case "return12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.return12m))}>{fmtSignedPct(stock.return12m)}</span>;
    case "roe":
      return <span className="orbitron tabular-nums text-slate-900">{fmtRoe(stock.roe)}</span>;
    case "opm":
      return <span className="orbitron tabular-nums text-slate-700">{fmtOpm(stock.opm)}</span>;
    case "eps":
      return <span className="orbitron tabular-nums text-slate-900">{fmtEps(stock.eps)}</span>;
    case "growthRate":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.growthRate))}>{fmtSignedPct(stock.growthRate)}</span>;
    case "momentum1m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum1m))}>{fmtSignedPct(stock.momentum1m)}</span>;
    case "momentum6m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum6m))}>{fmtSignedPct(stock.momentum6m)}</span>;
    case "momentum12m":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.momentum12m))}>{fmtSignedPct(stock.momentum12m)}</span>;
    case "guruHolders":
      return stock.guruHolders != null ? (
        <span className="orbitron tabular-nums font-bold text-violet-700">{stock.guruHolders}</span>
      ) : (
        <span className="text-slate-300">—</span>
      );
    case "rank":
      return <span className="orbitron tabular-nums text-slate-600">{fmtRank(stock.rank)}</span>;
    case "perBandCurrent":
      return <PerBandBar current={stock.perBandCurrent} min={stock.perBandMin} avg={stock.perBandAvg} max={stock.perBandMax} />;
    case "peForward":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.peForward, 1)}</span>;
    case "epsForward":
      return <span className="orbitron tabular-nums text-slate-700">{fmtEps(stock.epsForward)}</span>;
    case "forwardPeFy1":
      return <span className="orbitron tabular-nums text-slate-900">{fmtNum(stock.forwardPeFy1 ?? null, 1)}</span>;
    case "forwardEpsFy1":
      return <span className="orbitron tabular-nums text-slate-700">{fmtEps(stock.forwardEpsFy1 ?? null)}</span>;
    case "revenueGrowthFy1":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.revenueGrowthFy1 ?? null))}>{fmtSignedPct(stock.revenueGrowthFy1 ?? null)}</span>;
    case "epsGrowthFy1":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.epsGrowthFy1 ?? null))}>{fmtSignedPct(stock.epsGrowthFy1 ?? null)}</span>;
    case "dividendTtm":
      return <span className="orbitron tabular-nums text-slate-600">{stock.dividendTtm === null ? "—" : `$${stock.dividendTtm.toFixed(2)}`}</span>;
    case "ret1y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret1y))}>{fmtSignedPct(stock.ret1y)}</span>;
    case "ret3y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret3y))}>{fmtSignedPct(stock.ret3y)}</span>;
    case "ret5y":
      return <span className={cx("orbitron font-black tabular-nums", getMomentumClass(stock.ret5y))}>{fmtSignedPct(stock.ret5y)}</span>;
    default:
      return "—";
  }
}

export default function ScreenerClient({ initialSearch = "" }: { initialSearch?: string }) {
  const { stocks: rawStocks, dataReady, failed, sourceDate, sectors, countries } = useScreenerData();
  const [guruMap, setGuruMap] = useState<Record<string, number> | null>(null);
  const [actionMap, setActionMap] = useState<Record<string, ActionRow> | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/sec-13f/analytics/guru_holders_index.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.holders) setGuruMap(j.holders as Record<string, number>);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/computed/stock_action_summary.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ActionSummaryDoc | null) => {
        if (cancelled || !Array.isArray(j?.rows)) return;
        const next: Record<string, ActionRow> = {};
        j.rows.forEach((row) => {
          const normalized = normalizeActionRow(row, j.fields ?? []);
          if (normalized?.symbol) next[normalized.symbol] = normalized;
        });
        setActionMap(next);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stocks = useMemo(() => {
    if (!guruMap && !actionMap) return rawStocks;
    return rawStocks.map((s) => {
      const action = actionMap?.[s.ticker];
      return {
        ...s,
        guruHolders: action?.guruHolders ?? guruMap?.[s.ticker] ?? null,
        actionScore: action?.actionScore ?? null,
        confidenceLabel: action?.confidenceLabel ?? null,
        actionLabel: action?.actionLabel ?? null,
        actionBucket: action?.actionBucket ?? null,
        actionReasons: action?.actionReasons ?? [],
        lowEvidence: action?.lowEvidence ?? null,
        forwardPeFy1: action?.forwardPeFy1 ?? s.peForward ?? null,
        forwardEpsFy1: action?.forwardEpsFy1 ?? s.epsForward ?? null,
        revenueGrowthFy1: action?.revenueGrowthFy1 ?? null,
        epsGrowthFy1: action?.epsGrowthFy1 ?? null,
      };
    });
  }, [rawStocks, guruMap, actionMap]);

  const [search, setSearch] = useState(initialSearch);
  const [sector, setSector] = useState("");
  const [country, setCountry] = useState("");
  const [perMax, setPerMax] = useState("");
  const [forwardPerMax, setForwardPerMax] = useState("");
  const [revenueGrowthMin, setRevenueGrowthMin] = useState("");
  const [epsGrowthMin, setEpsGrowthMin] = useState("");
  const [profitableOnly, setProfitableOnly] = useState(false);
  const [bandFilter, setBandFilter] = useState<"" | "cheap" | "fair" | "rich">("");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("");
  const [sortKey, setSortKey] = useState<ScreenerSortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(() => initialSearch || null);
  const [prevInitialSearch, setPrevInitialSearch] = useState(initialSearch);

  if (prevInitialSearch !== initialSearch) {
    setPrevInitialSearch(initialSearch);
    setSearch(initialSearch);
    setExpandedTicker(initialSearch || null);
  }

  const [preset, setPreset] = useState<ColumnPreset>(() => {
    if (typeof window === "undefined") return "basic";
    const saved = localStorage.getItem("screener-preset") as ColumnPreset | null;
    return saved && PRESET_KEYS[saved] ? saved : "basic";
  });

  const activeColumns = useMemo(() => {
    const keys = new Set(PRESET_KEYS[preset]);
    return COLUMNS.filter((c) => keys.has(c.key));
  }, [preset]);

  function handlePresetChange(next: ColumnPreset) {
    setPreset(next);
    localStorage.setItem("screener-preset", next);
    // Reset sort to a column that exists in the new preset
    const validKeys = PRESET_KEYS[next];
    if (!validKeys.includes(sortKey)) {
      setSortKey("marketCap");
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const perMaxValue = perMax.trim() === "" ? null : Number(perMax);
    const perMaxValid = perMaxValue !== null && !Number.isNaN(perMaxValue);
    const forwardPerMaxValue = forwardPerMax.trim() === "" ? null : Number(forwardPerMax);
    const forwardPerMaxValid = forwardPerMaxValue !== null && !Number.isNaN(forwardPerMaxValue);
    const revenueGrowthMinValue = revenueGrowthMin.trim() === "" ? null : Number(revenueGrowthMin);
    const revenueGrowthMinValid = revenueGrowthMinValue !== null && !Number.isNaN(revenueGrowthMinValue);
    const epsGrowthMinValue = epsGrowthMin.trim() === "" ? null : Number(epsGrowthMin);
    const epsGrowthMinValid = epsGrowthMinValue !== null && !Number.isNaN(epsGrowthMinValue);
    return stocks.filter((stock) => {
      if (query && !stock.ticker.toLowerCase().includes(query) && !stock.name.toLowerCase().includes(query)) {
        return false;
      }
      if (sector && stock.sector !== sector) return false;
      if (country && stock.country !== country) return false;
      if (profitableOnly && (stock.per === null || stock.per <= 0)) return false;
      if (actionFilter && stock.actionBucket !== actionFilter) return false;
      if (perMaxValid && (stock.per === null || stock.per <= 0 || stock.per > (perMaxValue as number))) return false;
      if (forwardPerMaxValid && ((stock.forwardPeFy1 ?? null) === null || (stock.forwardPeFy1 as number) <= 0 || (stock.forwardPeFy1 as number) > (forwardPerMaxValue as number))) return false;
      if (revenueGrowthMinValid && ((stock.revenueGrowthFy1 ?? null) === null || (stock.revenueGrowthFy1 as number) < (revenueGrowthMinValue as number))) return false;
      if (epsGrowthMinValid && ((stock.epsGrowthFy1 ?? null) === null || (stock.epsGrowthFy1 as number) < (epsGrowthMinValue as number))) return false;
      if (bandFilter) {
        const band = normalizeBandTuple(stock.perBandCurrent, stock.perBandMin, stock.perBandMax);
        if (!band) return false;
        const pct = bandPct(...band);
        if (bandFilter === "cheap" && pct > BAND_CHEAP) return false;
        if (bandFilter === "fair" && (pct <= BAND_CHEAP || pct >= BAND_RICH)) return false;
        if (bandFilter === "rich" && pct < BAND_RICH) return false;
      }
      return true;
    });
  }, [stocks, search, sector, country, perMax, forwardPerMax, revenueGrowthMin, epsGrowthMin, profitableOnly, bandFilter, actionFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const stateKey = `${search}|${sector}|${country}|${perMax}|${forwardPerMax}|${revenueGrowthMin}|${epsGrowthMin}|${profitableOnly}|${bandFilter}|${actionFilter}|${sortKey}|${sortDir}|${preset}`;
  const [prevStateKey, setPrevStateKey] = useState(stateKey);
  if (prevStateKey !== stateKey) {
    setPrevStateKey(stateKey);
    if (page !== 0) setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(key: ScreenerSortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      const textColumn = key === "ticker" || key === "name" || key === "sector" || key === "country";
      setSortDir(textColumn || key === "rank" ? "asc" : "desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setSector("");
    setCountry("");
    setPerMax("");
    setForwardPerMax("");
    setRevenueGrowthMin("");
    setEpsGrowthMin("");
    setProfitableOnly(false);
    setBandFilter("");
    setActionFilter("");
  }

  const hasFilters = Boolean(search || sector || country || perMax || forwardPerMax || revenueGrowthMin || epsGrowthMin || profitableOnly || bandFilter || actionFilter);

  return (
    <div className="data-shell-page">
      <section className="panel data-shell-header">
        <div className="data-shell-head-main">
          <p className="data-shell-kicker">Stock Screener</p>
          <h1 className="data-shell-title">종목 스크리너</h1>
          <p className="data-shell-desc">
            글로벌 {stocks.length.toLocaleString()}개 종목을 PER·PBR·배당·수익률로 거르고 줄세웁니다.
          </p>
        </div>
        <div className="data-shell-head-actions">
          {sourceDate ? (
            <span className="data-shell-pill ok">
              <span />
              {sourceDate}
            </span>
          ) : null}
          <TransitionLink href="/sectors" className="data-shell-link">
            섹터
          </TransitionLink>
        </div>
      </section>

      {failed ? (
        <div className="rounded-[1.2rem] border border-slate-300 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
          종목 데이터를 불러오지 못했습니다.
        </div>
      ) : null}

      {/* Filter bar */}
      <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">검색</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="티커 또는 종목명"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">섹터</span>
            <select
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 섹터</option>
              {sectors.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">국가</span>
            <select
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 국가</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {COUNTRY_LABEL[code] ?? code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">PER 최대</span>
            <input
              type="number"
              inputMode="decimal"
              value={perMax}
              onChange={(event) => setPerMax(event.target.value)}
              placeholder="예: 20"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">FY+1 PER 최대</span>
            <input
              type="number"
              inputMode="decimal"
              value={forwardPerMax}
              onChange={(event) => setForwardPerMax(event.target.value)}
              placeholder="예: 25"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">매출+1 최소</span>
            <input
              type="number"
              inputMode="decimal"
              value={revenueGrowthMin}
              onChange={(event) => setRevenueGrowthMin(event.target.value)}
              placeholder="예: 10"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">EPS+1 최소</span>
            <input
              type="number"
              inputMode="decimal"
              value={epsGrowthMin}
              onChange={(event) => setEpsGrowthMin(event.target.value)}
              placeholder="예: 10"
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">PER 밴드</span>
            <select
              value={bandFilter}
              onChange={(event) => setBandFilter(event.target.value as "" | "cheap" | "fair" | "rich")}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 밴드</option>
              <option value="cheap">저평가 (하위 25%)</option>
              <option value="fair">적정 (중간 50%)</option>
              <option value="rich">고평가 (상위 25%)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">액션</span>
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
              className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-brand-interactive"
            >
              <option value="">전체 액션</option>
              <option value="smart_money">구루/13F 주목</option>
              <option value="value_momentum">저평가+모멘텀</option>
              <option value="index_core">지수 핵심</option>
              <option value="income">배당 점검</option>
              <option value="momentum">모멘텀 리더</option>
              <option value="watch">관찰</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={profitableOnly}
              onChange={(event) => setProfitableOnly(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-interactive"
            />
            흑자 종목만 (PER &gt; 0)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-slate-500">
              <strong className="orbitron text-slate-900">{sorted.length.toLocaleString()}</strong>개 종목
            </span>
            {hasFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-600 transition hover:border-rose-300 hover:text-rose-600 sm:min-h-8"
              >
                초기화
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Preset selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-500">뷰</span>
        {(Object.keys(PRESET_KEYS) as ColumnPreset[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePresetChange(p)}
            className={cx(
              "inline-flex min-h-11 items-center rounded-full px-3 text-[11px] font-black uppercase tracking-[0.1em] transition sm:min-h-7",
              preset === p
                ? "border border-brand-interactive bg-brand-interactive/10 text-brand-interactive"
                : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
            )}
          >
            {PRESET_LABEL[p]}
          </button>
        ))}
      </div>

      {/* Table */}
      <section className={cx("rounded-[1.5rem] border border-slate-200 bg-white p-2 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)] sm:p-3", !dataReady && "opacity-60")}>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                {activeColumns.map((column) => {
                  const active = column.key === sortKey;
                  return (
                    <th
                      key={column.key}
                      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                      className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cx(
                          "inline-flex items-center gap-1 transition hover:text-slate-900",
                          column.align === "right" && "flex-row-reverse",
                          active && "text-brand-interactive",
                        )}
                      >
                        {column.label}
                        <span className="text-[9px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((stock) => {
                const expanded = expandedTicker === stock.ticker;
                const detailId = `screener-detail-${stock.ticker}`;
                return (
                <Fragment key={stock.ticker}>
                  <tr
                    onClick={() =>
                      setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker))
                    }
                    className="cursor-pointer border-b border-slate-100 transition last:border-0 hover:bg-slate-50"
                  >
                    {activeColumns.map((column) => (
                      <td
                        key={column.key}
                        className={cx("px-2 py-2", column.align === "right" ? "text-right" : "text-left")}
                      >
                        {column.key === "ticker" ? (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={detailId}
                            aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedTicker((prev) => (prev === stock.ticker ? null : stock.ticker));
                            }}
                            className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-md px-1.5 text-left text-sm font-black text-slate-950 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
                          >
                            <span className="w-3 text-center text-[10px] text-slate-400" aria-hidden="true">{expanded ? "-" : "+"}</span>
                            <span className="truncate">{stock.ticker}</span>
                          </button>
                        ) : renderCell(stock, column.key)}
                      </td>
                    ))}
                  </tr>
                  {expanded ? (
                    <tr id={detailId}>
                      <td colSpan={activeColumns.length} className="p-0">
                        <StockDetailPanel ticker={stock.ticker} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
                );
              })}
              {dataReady && pageRows.length === 0 ? (
                <tr>
                  <td colSpan={activeColumns.length} className="px-2 py-10 text-center text-sm font-semibold text-slate-500">
                    조건에 맞는 종목이 없습니다.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {sorted.length > PAGE_SIZE ? (
          <div className="mt-3 flex items-center justify-between gap-3 px-2">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(0, value - 1))}
              disabled={safePage === 0}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              이전
            </button>
            <span className="orbitron text-xs font-bold tabular-nums text-slate-600">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              disabled={safePage >= pageCount - 1}
              className="inline-flex min-h-9 items-center rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-[0.1em] text-slate-700 transition enabled:hover:border-brand-interactive disabled:opacity-40"
            >
              다음
            </button>
          </div>
        ) : null}
      </section>

      <p className="px-1 text-[11px] text-slate-400">
        데이터: Global Scouter · SlickCharts · SEC 13F · YF quarter closes · computed stock action index. 정렬 시 결측치는 항상 뒤로 정렬됩니다.
      </p>
    </div>
  );
}
