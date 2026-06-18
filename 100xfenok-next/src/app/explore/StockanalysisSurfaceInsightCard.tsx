"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface SurfaceDoc<T> {
  fetched_at?: string | null;
  counts?: {
    records?: number | null;
    rows?: number | null;
    tables?: number | null;
  } | null;
  records?: T[];
  tables?: Array<{
    records?: T[];
  }>;
}

interface MarketMover {
  symbol?: string;
  company_name?: string;
  pct_change?: string;
  change_1w?: string;
  change_1m?: string;
  change_ytd?: string;
  stock_price?: string;
  volume?: string;
  market_cap?: string;
  revenue?: string;
}

interface IpoRow {
  ipo_date?: string;
  filing_date?: string;
  symbol?: string;
  company_name?: string;
  price_range?: string;
  shares_offered?: string;
  deal_size?: string;
  market_cap?: string;
  revenue?: string;
  current?: string;
  return?: string;
}

interface IndustryRow {
  industry_name?: string;
  stocks?: string;
  market_cap?: string;
  pe_ratio?: string;
  profit_margin?: string;
  "1d_change"?: string;
  "1y_change"?: string;
}

interface SurfaceInsightsData {
  gainers: SurfaceDoc<MarketMover> | null;
  losers: SurfaceDoc<MarketMover> | null;
  active: SurfaceDoc<MarketMover> | null;
  gainersWeek: SurfaceDoc<MarketMover> | null;
  gainersMonth: SurfaceDoc<MarketMover> | null;
  losersYtd: SurfaceDoc<MarketMover> | null;
  ipoCalendar: SurfaceDoc<IpoRow> | null;
  ipoRecent: SurfaceDoc<IpoRow> | null;
  ipoFilings: SurfaceDoc<IpoRow> | null;
  industries: SurfaceDoc<IndustryRow> | null;
  semiconductors: SurfaceDoc<MarketMover> | null;
}

let insightsCache: SurfaceInsightsData | null = null;
let insightsPending: Promise<SurfaceInsightsData> | null = null;

function loadJson<T>(surface: string): Promise<SurfaceDoc<T> | null> {
  return fetch(`/api/data/stockanalysis/surfaces/${surface}`, { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<SurfaceDoc<T>> : null))
    .catch(() => null);
}

function loadSurfaceInsights(): Promise<SurfaceInsightsData> {
  if (insightsCache) return Promise.resolve(insightsCache);
  if (insightsPending) return insightsPending;
  insightsPending = Promise.all([
    loadJson<MarketMover>("market_gainers"),
    loadJson<MarketMover>("market_losers"),
    loadJson<MarketMover>("market_active"),
    loadJson<MarketMover>("market_gainers_week"),
    loadJson<MarketMover>("market_gainers_month"),
    loadJson<MarketMover>("market_losers_ytd"),
    loadJson<IpoRow>("ipos_calendar"),
    loadJson<IpoRow>("ipos_recent"),
    loadJson<IpoRow>("ipos_filings"),
    loadJson<IndustryRow>("industries_all"),
    loadJson<MarketMover>("industry_semiconductors"),
  ]).then(([gainers, losers, active, gainersWeek, gainersMonth, losersYtd, ipoCalendar, ipoRecent, ipoFilings, industries, semiconductors]) => {
    insightsCache = { gainers, losers, active, gainersWeek, gainersMonth, losersYtd, ipoCalendar, ipoRecent, ipoFilings, industries, semiconductors };
    return insightsCache;
  });
  return insightsPending;
}

function rows<T>(doc: SurfaceDoc<T> | null | undefined): T[] {
  if (Array.isArray(doc?.records)) return doc.records;
  if (Array.isArray(doc?.tables)) {
    return doc.tables.flatMap((table) => (Array.isArray(table.records) ? table.records : []));
  }
  return [];
}

function fmtCount(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
}

function countRows<T>(doc: SurfaceDoc<T> | null | undefined): number | null {
  const value = doc?.counts?.records ?? doc?.counts?.rows;
  return typeof value === "number" ? value : rows(doc).length || null;
}

function short(value: string | null | undefined, max = 28): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "-") return "-";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function cleanSymbol(value: string | null | undefined): string {
  return String(value || "").replace(/^\$/, "").trim().toUpperCase();
}

function moverPct(row: MarketMover): string {
  return row.pct_change || row.change_1w || row.change_1m || row.change_ytd || "-";
}

function parsePct(value: string | null | undefined): number {
  const parsed = Number(String(value || "").replace("%", "").replace(",", "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function asOf(...values: Array<string | null | undefined>): string {
  const hit = values.find((value) => typeof value === "string" && value.length >= 10);
  return hit ? hit.slice(0, 10) : "-";
}

function StockLink({
  symbol,
  name,
  detail,
  value,
}: {
  symbol?: string;
  name?: string;
  detail?: string;
  value?: string;
}) {
  const ticker = cleanSymbol(symbol);
  const body = (
    <>
      <span className="co">
        <div className="n">{short(name || ticker, 34)}</div>
        <div className="tk">{ticker || "-"} · {detail || "-"}</div>
      </span>
      <span className={`pc num ${String(value || "").startsWith("-") ? "down" : "up"}`}>{value || "-"}</span>
    </>
  );
  return ticker ? (
    <TransitionLink href={`/stock/${encodeURIComponent(ticker)}`} className="mv-row">
      {body}
    </TransitionLink>
  ) : (
    <div className="mv-row">{body}</div>
  );
}

export default function StockanalysisSurfaceInsightCard() {
  const [data, setData] = useState<SurfaceInsightsData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSurfaceInsights().then((payload) => {
      if (!cancelled) {
        setData(payload);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gainers = useMemo(() => rows(data?.gainers).slice(0, 3), [data]);
  const losers = useMemo(() => rows(data?.losers).slice(0, 2), [data]);
  const active = useMemo(() => rows(data?.active).slice(0, 2), [data]);
  const gainersWeek = useMemo(() => rows(data?.gainersWeek).slice(0, 4), [data]);
  const gainersMonth = useMemo(() => rows(data?.gainersMonth).slice(0, 4), [data]);
  const losersYtd = useMemo(() => rows(data?.losersYtd).slice(0, 4), [data]);
  const ipoCalendar = useMemo(() => rows(data?.ipoCalendar).slice(0, 3), [data]);
  const ipoRecent = useMemo(() => rows(data?.ipoRecent).slice(0, 2), [data]);
  const ipoFilings = useMemo(() => rows(data?.ipoFilings).slice(0, 4), [data]);
  const industryLeaders = useMemo(
    () => rows(data?.industries)
      .filter((row) => row.industry_name)
      .sort((a, b) => parsePct(b["1y_change"]) - parsePct(a["1y_change"]))
      .slice(0, 3),
    [data],
  );
  const semis = useMemo(() => rows(data?.semiconductors).slice(0, 3), [data]);

  const totalRows =
    (countRows(data?.gainers) ?? 0)
    + (countRows(data?.losers) ?? 0)
    + (countRows(data?.active) ?? 0)
    + (countRows(data?.gainersWeek) ?? 0)
    + (countRows(data?.gainersMonth) ?? 0)
    + (countRows(data?.losersYtd) ?? 0)
    + (countRows(data?.ipoCalendar) ?? 0)
    + (countRows(data?.ipoRecent) ?? 0)
    + (countRows(data?.ipoFilings) ?? 0)
    + (countRows(data?.industries) ?? 0)
    + (countRows(data?.semiconductors) ?? 0);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>시장 표면 인사이트</h2>
        <span className="desc">
          {asOf(data?.gainers?.fetched_at, data?.ipoCalendar?.fetched_at, data?.industries?.fetched_at)} · {fmtCount(totalRows)}행
        </span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">표면 데이터 확인 중</div>
            <div className="tk">무버·IPO·산업 데이터를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : (
        <div className="panel-b grid gap-3 lg:grid-cols-2">
          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">오늘 무버</div>
            {gainers.map((row) => (
              <StockLink
                key={`g-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`가격 ${row.stock_price || "-"} · 거래 ${row.volume || "-"}`}
                value={row.pct_change}
              />
            ))}
            {losers.map((row) => (
              <StockLink
                key={`l-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`가격 ${row.stock_price || "-"} · 거래 ${row.volume || "-"}`}
                value={row.pct_change}
              />
            ))}
            {active.slice(0, 1).map((row) => (
              <StockLink
                key={`a-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`거래량 ${row.volume || "-"} · 시총 ${row.market_cap || "-"}`}
                value={row.pct_change}
              />
            ))}
          </div>

          {(gainersWeek.length > 0 || gainersMonth.length > 0 || losersYtd.length > 0) && (
            <div className="mv-col">
              <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">기간 모멘텀</div>
              {gainersWeek.length > 0 && (
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">주간 상승</div>
              )}
              {gainersWeek.map((row) => (
                <StockLink
                  key={`gw-${row.symbol}`}
                  symbol={row.symbol}
                  name={row.company_name}
                  detail={`가격 ${row.stock_price || "-"} · 거래 ${row.volume || "-"}`}
                  value={moverPct(row)}
                />
              ))}
              {gainersMonth.length > 0 && (
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">월간 상승</div>
              )}
              {gainersMonth.map((row) => (
                <StockLink
                  key={`gm-${row.symbol}`}
                  symbol={row.symbol}
                  name={row.company_name}
                  detail={`가격 ${row.stock_price || "-"} · 거래 ${row.volume || "-"}`}
                  value={moverPct(row)}
                />
              ))}
              {losersYtd.length > 0 && (
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">YTD 하락</div>
              )}
              {losersYtd.map((row) => (
                <StockLink
                  key={`ly-${row.symbol}`}
                  symbol={row.symbol}
                  name={row.company_name}
                  detail={`가격 ${row.stock_price || "-"} · 거래 ${row.volume || "-"}`}
                  value={moverPct(row)}
                />
              ))}
            </div>
          )}

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">IPO 파이프라인</div>
            {ipoCalendar.map((row) => (
              <StockLink
                key={`ipo-c-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`${row.ipo_date || "-"} · ${row.price_range || row.deal_size || "-"}`}
                value={row.deal_size || row.market_cap || "-"}
              />
            ))}
            {ipoRecent.map((row) => (
              <StockLink
                key={`ipo-r-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`최근 IPO · 현재 ${row.current || "-"}`}
                value={row.return || "-"}
              />
            ))}
            {ipoFilings.length > 0 && (
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">예정 상장(파일링)</div>
            )}
            {ipoFilings.map((row) => (
              <StockLink
                key={`ipo-f-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`${row.filing_date || "-"} · ${row.price_range || "-"}`}
                value={row.shares_offered || row.deal_size || "-"}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">산업 1년 강세</div>
            {industryLeaders.map((row) => (
              <div key={`ind-${row.industry_name}`} className="mv-row">
                <span className="co">
                  <div className="n">{short(row.industry_name, 34)}</div>
                  <div className="tk">종목 {row.stocks || "-"} · 시총 {row.market_cap || "-"}</div>
                </span>
                <span className={`pc num ${String(row["1y_change"] || "").startsWith("-") ? "down" : "up"}`}>
                  {row["1y_change"] || "-"}
                </span>
              </div>
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">반도체 표면</div>
            {semis.map((row) => (
              <StockLink
                key={`semi-${row.symbol}`}
                symbol={row.symbol}
                name={row.company_name}
                detail={`시총 ${row.market_cap || "-"} · 매출 ${row.revenue || "-"}`}
                value={row.pct_change}
              />
            ))}
          </div>
        </div>
      )}

      <div className="panel-foot">
        <span>무버·IPO·업종 JSON은 DataPack 갱신 시 자동 반영됩니다</span>
      </div>
    </section>
  );
}
