"use client";

import TransitionLink from "@/components/TransitionLink";
import DataProvenanceNote from "@/components/DataProvenanceNote";
import { DataStateBadge } from "@/components/DataStateNotice";
import TickerChip from "@/components/TickerChip";
import { stockConnectionFreshnessState, type StockConnectionFreshnessSource } from "@/lib/data-entity-graph/freshness";
import { ROUTES } from "@/lib/routes";
import type {
  StockConnectionEntry,
  StockServiceEtfLink,
  StockServicesEntry,
} from "@/lib/data-entity-graph/stock-index";

export type ConnectedViewVariant = "page" | "drawer" | "cockpit-tile";

export interface ConnectedViewProps {
  ticker: string;
  entry: StockConnectionEntry | null | undefined;
  services?: StockServicesEntry | null;
  variant: ConnectedViewVariant;
  compact?: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtDateish(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "—";
  return value.trim();
}

function buildSingleStockEtfHref(links: StockServiceEtfLink[]): string | null {
  const tickers = links.map((link) => link.ticker).filter(Boolean);
  if (tickers.length >= 2) return `/etfs/compare?tickers=${encodeURIComponent(tickers.slice(0, 4).join(","))}`;
  if (tickers.length === 1) return links[0]?.route || `/etfs/${encodeURIComponent(tickers[0])}`;
  return "/etfs";
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadSingleStockEtfCsv(ticker: string, links: StockServiceEtfLink[]) {
  const rows = [
    [
      "stock_ticker",
      "etf_ticker",
      "etf_name",
      "category",
      "confidence",
      "classification_source",
      "raw_underlying",
      "resolution_method",
      "resolution_source",
      "matched_alias",
      "etf_universe_as_of",
    ],
    ...links.map((link) => [
      ticker,
      link.ticker,
      link.label ?? "",
      link.category ?? "",
      link.confidence ?? "",
      link.classification_source ?? "",
      link.raw_underlying ?? "",
      link.resolution_method ?? "",
      link.resolution_source ?? "",
      link.matched_alias ?? "",
      link.as_of?.etf_universe ?? "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100xfenok-${ticker.toLowerCase()}-single-stock-etfs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ConnectedView({
  ticker,
  entry,
  services,
  variant,
  compact = false,
}: ConnectedViewProps) {
  const isPageVariant = variant === "page";

  if (entry === undefined) {
    return (
      <section className="panel stock-section" data-connected-variant={variant}>
        <div className="panel-h"><h2>데이터 연결</h2></div>
        <div className="panel-b">
          <p className="text-xs font-semibold text-slate-500">연결 인덱스를 확인하고 있습니다.</p>
        </div>
      </section>
    );
  }

  if (!entry) return null;

  const flags = entry.flags ?? {};
  const singleStockEtfs = services?.single_stock_etfs ?? [];
  const etfCount = singleStockEtfs.length || entry.service_count || 0;
  const etfCompareHref = buildSingleStockEtfHref(singleStockEtfs);
  const highConfidenceEtfs = singleStockEtfs.filter((etf) => etf.confidence === "high").length;
  const etfAsOf = services?.as_of?.etf_universe
    ?? singleStockEtfs.find((etf) => typeof etf.as_of?.etf_universe === "string")?.as_of?.etf_universe
    ?? null;
  const etfProvenanceDetails = [
    etfAsOf ? `기준 ${fmtDateish(etfAsOf)}` : null,
    singleStockEtfs.length ? `분류 신뢰도 high ${highConfidenceEtfs}/${singleStockEtfs.length}` : null,
  ];
  const connected = [
    flags.market_facts ? { label: "시장팩트", tone: "border-sky-200 bg-sky-50 text-sky-700", href: null } : null,
    flags.filings ? { label: "공시", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", href: ROUTES.stockFilings(ticker) } : null,
    flags.sec_13f ? { label: "13F", tone: "border-violet-200 bg-violet-50 text-violet-700", href: `/superinvestors?tab=by-ticker&ticker=${encodeURIComponent(ticker)}` } : null,
    flags.index_membership ? { label: "지수", tone: "border-amber-200 bg-amber-50 text-amber-700", href: null } : null,
    flags.single_stock_etfs ? { label: `ETF${etfCount ? ` ${etfCount}` : ""}`, tone: "border-cyan-200 bg-cyan-50 text-cyan-700", href: etfCompareHref } : null,
  ].filter(Boolean) as Array<{ label: string; tone: string; href: string | null }>;
  let traversableCount = 0;
  const visibleConnected = connected.map((item) => {
    if (!item.href) return item;
    if (!isPageVariant && traversableCount >= 3) return { ...item, href: null };
    traversableCount += 1;
    return item;
  });
  const etfChipLimit = isPageVariant ? (compact ? 3 : 6) : Math.max(0, 3 - traversableCount);
  const asOfRows = [
    { label: "프로필", value: entry.as_of?.profile, source: "profile" },
    { label: "시장팩트", value: entry.as_of?.market_facts, source: "market_facts" },
    { label: "공시", value: entry.as_of?.filings, source: "filings" },
    { label: "13F", value: entry.as_of?.sec_13f, source: "sec_13f" },
    { label: "ETF", value: services?.as_of?.etf_universe, source: "etf_universe" },
  ].filter((row): row is { label: string; value: string; source: StockConnectionFreshnessSource } => typeof row.value === "string" && row.value.length > 0);

  return (
    <section className="panel stock-section" data-connected-variant={variant}>
      <div className="panel-h">
        <h2>데이터 연결</h2>
        <span className="desc">{entry.connection_count ?? connected.length}개</span>
      </div>
      <div className="panel-b space-y-3">
        <div className="flex flex-wrap gap-2">
          {visibleConnected.map((item) => item.href ? (
            <TransitionLink
              key={item.label}
              href={item.href}
              className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-[10px] font-black transition hover:border-brand-interactive hover:text-brand-interactive ${item.tone}`}
            >
              {item.label}
            </TransitionLink>
          ) : (
            <span key={item.label} className={`inline-flex min-h-8 items-center rounded-full border px-2.5 text-[10px] font-black ${item.tone}`}>
              {item.label}
            </span>
          ))}
        </div>
        {asOfRows.length > 0 ? (
          <div className={compact ? "grid gap-1.5 text-[10px]" : "grid gap-1.5 text-xs"}>
            {asOfRows.map((row) => (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 font-semibold text-slate-500">
                <span>{row.label}</span>
                <DataStateBadge
                  state={stockConnectionFreshnessState(row.source, row.value)}
                  prefix=""
                  className="px-1.5 py-0.5"
                />
              </div>
            ))}
          </div>
        ) : null}
        {singleStockEtfs.length > 0 && etfChipLimit > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {singleStockEtfs.slice(0, etfChipLimit).map((etf) => (
              <span
                key={etf.ticker}
                title={[
                  etf.label ?? etf.ticker,
                  etf.raw_underlying ? `분류 원문 ${etf.raw_underlying}` : null,
                  etf.classification_source ? `분류 출처 ${etf.classification_source}` : null,
                ].filter(Boolean).join(" · ")}
              >
                <TickerChip ticker={etf.ticker} variant="pill" />
              </span>
            ))}
            {singleStockEtfs.length > etfChipLimit ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-500">
                +{singleStockEtfs.length - etfChipLimit}
              </span>
            ) : null}
          </div>
        ) : null}
        {singleStockEtfs.length > 0 ? (
          <DataProvenanceNote title="분류 기반 연결" details={etfProvenanceDetails}>
            단일종목 ETF 연결은 ETF 전체 목록의 분류와 기초자산 매칭으로 만든 연결이며 추천이 아닙니다.
          </DataProvenanceNote>
        ) : null}
        {singleStockEtfs.length > 0 && isPageVariant ? (
          <div className="flex flex-wrap gap-2">
            {etfCompareHref ? (
              <TransitionLink
                href={etfCompareHref}
                className="inline-flex min-h-8 items-center rounded-full border border-cyan-200 bg-cyan-50 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-cyan-700 transition hover:border-brand-interactive hover:text-brand-interactive"
              >
                ETF 비교
              </TransitionLink>
            ) : null}
            <button
              type="button"
              onClick={() => downloadSingleStockEtfCsv(ticker, singleStockEtfs)}
              className="inline-flex min-h-8 items-center rounded-full border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-600 transition hover:border-brand-interactive hover:text-brand-interactive"
            >
              ETF CSV
            </button>
          </div>
        ) : null}
        {entry.confidence?.label ? (
          <p className="text-[10px] font-semibold text-slate-500">
            신호 신뢰도 {entry.confidence.label}
            {isFiniteNumber(entry.confidence.coverage_ratio) ? ` · 커버리지 ${(entry.confidence.coverage_ratio * 100).toFixed(0)}%` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default ConnectedView;
