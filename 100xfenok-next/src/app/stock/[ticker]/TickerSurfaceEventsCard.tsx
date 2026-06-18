"use client";

import { useEffect, useMemo, useState } from "react";

export type SectionKey = "earnings" | "actions" | "markets" | "etfs" | "ipo" | "industry";
export type AssetKind = "stock" | "etf";

export type SurfaceMatch = {
  surface: string;
  label: string;
  fetched_at?: string | null;
  match_count: number;
  matches: Array<Record<string, unknown>>;
};

export type TickerSurfacePayload = {
  ticker: string;
  generated_at?: string | null;
  counts?: {
    rows_returned?: number | null;
  } | null;
  sections?: Partial<Record<SectionKey, SurfaceMatch[]>>;
};

const SECTION_LABELS: Record<SectionKey, string> = {
  earnings: "어닝",
  actions: "이벤트",
  markets: "무버",
  etfs: "ETF",
  ipo: "IPO",
  industry: "산업",
};

const SECTION_ORDER: SectionKey[] = ["earnings", "actions", "markets", "etfs", "ipo", "industry"];

const surfaceCache: Record<string, TickerSurfacePayload | null> = {};
const surfacePending: Record<string, Promise<TickerSurfacePayload | null>> = {};

export function loadTickerSurfaces(ticker: string, assetKind?: AssetKind): Promise<TickerSurfacePayload | null> {
  const symbol = ticker.trim().toUpperCase();
  const cacheKey = `${symbol}:${assetKind ?? "all"}`;
  if (!symbol) return Promise.resolve(null);
  if (cacheKey in surfaceCache) return Promise.resolve(surfaceCache[cacheKey]);
  if (cacheKey in surfacePending) return surfacePending[cacheKey];

  const query = assetKind ? `?asset=${assetKind}` : "";
  const request = fetch(`/api/data/stockanalysis/ticker/${encodeURIComponent(symbol)}/surfaces${query}`, { cache: "no-store" })
    .then((res) => (res.ok ? res.json() as Promise<TickerSurfacePayload> : null))
    .then((payload) => {
      surfaceCache[cacheKey] = payload;
      delete surfacePending[cacheKey];
      return payload;
    })
    .catch(() => {
      delete surfacePending[cacheKey];
      return null;
    });

  surfacePending[cacheKey] = request;
  return request;
}

function text(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("ko-KR");
  if (typeof value === "string" && value.trim()) return value.trim();
  return "-";
}

function dateText(value: unknown): string {
  const raw = text(value);
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function pickName(row: Record<string, unknown>): string {
  return text(row.name ?? row.company_name ?? row.fund_name ?? row.n ?? row.symbol ?? row.s);
}

function pickTicker(row: Record<string, unknown>): string {
  return text(row.symbol ?? row.s).replace(/^\$/, "");
}

function rowLine(section: SectionKey, row: Record<string, unknown>): string {
  if (section === "earnings") {
    return `${dateText(row.date)} · ${text(row.timing)} · EPS ${text(row.eps_estimate)} · 매출 ${text(row.revenue_estimate)}`;
  }
  if (section === "actions") {
    return `${dateText(row.date)} · ${text(row.type)} · ${text(row.text ?? row.other ?? row.split_ratio)}`;
  }
  if (section === "markets") {
    return `${text(row.pct_change ?? row.change_1w ?? row.change_1m ?? row.change_ytd)} · 가격 ${text(row.stock_price)} · 거래 ${text(row.volume)}`;
  }
  if (section === "etfs") {
    return `${text(row.assetClass ?? row.inceptionDate ?? row.exp_ratio)} · AUM ${text(row.aum ?? row.assets)} · 보유 ${text(row.holdings)}`;
  }
  if (section === "ipo") {
    return `${dateText(row.ipo_date ?? row.withdrawn_date ?? row.date)} · ${text(row.price_range ?? row.price)} · ${text(row.deal_size ?? row.market_cap ?? row.shares_offered)}`;
  }
  return `시총 ${text(row.market_cap)} · 매출 ${text(row.revenue)} · ${text(row.pct_change)}`;
}

function flattenSection(payload: TickerSurfacePayload | null, section: SectionKey) {
  return (payload?.sections?.[section] ?? []).flatMap((surface) => (
    surface.matches.map((row) => ({ surface, row }))
  ));
}

export default function TickerSurfaceEventsCard({
  ticker,
  compact = false,
  assetKind,
}: {
  ticker: string;
  compact?: boolean;
  assetKind?: AssetKind;
}) {
  const symbol = ticker.trim().toUpperCase();
  const requestKey = `${symbol}:${assetKind ?? "all"}`;
  const [state, setState] = useState<{ key: string; payload: TickerSurfacePayload | null; loaded: boolean }>({
    key: requestKey,
    payload: null,
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadTickerSurfaces(symbol, assetKind).then((next) => {
      if (!cancelled) {
        setState({ key: requestKey, payload: next, loaded: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [assetKind, requestKey, symbol]);

  const loaded = state.loaded && state.key === requestKey;
  const payload = loaded ? state.payload : null;

  const sections = useMemo(
    () => SECTION_ORDER
      .map((section) => ({ section, rows: flattenSection(payload, section).slice(0, compact ? 2 : 4) }))
      .filter((item) => item.rows.length > 0),
    [payload, compact],
  );
  const rowsReturned = payload?.counts?.rows_returned ?? 0;

  if (!loaded) {
    return (
      <section className="panel stock-section">
        <div className="panel-h"><h2>표면 이벤트</h2></div>
        <div className="panel-b">
          <p className="text-xs font-semibold text-slate-400">티커별 표면 데이터를 확인하고 있습니다.</p>
        </div>
      </section>
    );
  }

  if (!payload || rowsReturned === 0 || sections.length === 0) return null;

  return (
    <section className="panel stock-section">
      <div className="panel-h">
        <h2>표면 이벤트</h2>
        <span className="desc">{payload.ticker} · {rowsReturned.toLocaleString("ko-KR")}행</span>
      </div>
      <div className="panel-b space-y-3">
        {sections.map(({ section, rows }) => (
          <div key={section}>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
              {SECTION_LABELS[section]}
            </p>
            <div className="space-y-1.5">
              {rows.map(({ surface, row }, index) => (
                <div key={`${surface.surface}-${index}`} className="rounded-lg border border-slate-200 bg-white/70 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px] font-black text-slate-800">
                      {pickName(row)}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] text-slate-500">
                      {surface.label}
                    </span>
                  </div>
                  <p className="mt-1 min-w-0 truncate text-[10px] font-semibold text-slate-500">
                    {pickTicker(row)} · {rowLine(section, row)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-[9px] font-semibold text-slate-400">
          전체 surface JSON은 서버에서 티커별로 필터링되어 전송됩니다.
        </p>
      </div>
    </section>
  );
}
