"use client";

import { useEffect, useMemo, useState } from "react";

interface SurfaceResult {
  surface?: string;
  group?: string;
  rows?: number | null;
  status?: string | null;
}

interface StockanalysisManifest {
  surfaces?: {
    generated_at?: string | null;
    counts?: {
      surfaces_requested?: number | null;
      ok?: number | null;
      failed?: number | null;
      rows?: number | null;
    } | null;
    sample_results?: SurfaceResult[];
  } | null;
}

let catalogCache: StockanalysisManifest | null = null;
let catalogPending: Promise<StockanalysisManifest | null> | null = null;

function loadCatalogData(): Promise<StockanalysisManifest | null> {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (catalogPending) return catalogPending;
  catalogPending = fetch("/api/data/stockanalysis", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<StockanalysisManifest> : null))
    .then((payload) => {
      catalogCache = payload;
      return payload;
    })
    .catch(() => { catalogPending = null; return null; });
  return catalogPending;
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function groupLabel(value: string | null | undefined): string {
  switch (value) {
    case "etf":
      return "ETF";
    case "etf_provider":
      return "운용사";
    case "theme_list":
      return "테마";
    case "ipo":
      return "IPO";
    case "corporate_actions":
      return "기업 이벤트";
    case "market_movers":
      return "시장 급등락";
    case "earnings":
      return "어닝";
    case "industry":
      return "산업";
    default:
      return value || "기타";
  }
}

function surfaceLabel(value: string | null | undefined): string {
  switch (value) {
    case "new_etfs":
      return "신규 상장 ETF";
    case "etf_screener":
      return "ETF 전체 목록";
    case "etf_provider_blackrock":
      return "BlackRock ETF";
    case "etf_provider_proshares":
      return "ProShares ETF";
    case "list_bitcoin_etfs":
      return "비트코인 ETF";
    case "ipos_recent":
      return "최근 IPO";
    case "ipos_statistics":
      return "IPO 통계";
    case "ipos_calendar":
      return "IPO 일정";
    case "ipos_filings":
      return "IPO 신청";
    case "ipos_withdrawn":
      return "철회된 IPO";
    case "actions_recent":
      return "최근 기업 이벤트";
    case "actions_splits":
      return "주식분할";
    case "market_gainers":
      return "상승률 상위";
    case "market_losers":
      return "하락률 상위";
    case "market_active":
      return "거래대금 상위";
    case "market_premarket":
      return "장전 급등락";
    case "market_afterhours":
      return "장후 급등락";
    case "market_gainers_week":
      return "주간 상승률";
    case "market_gainers_month":
      return "월간 상승률";
    case "market_losers_ytd":
      return "연초 이후 하락률";
    case "earnings_calendar":
      return "어닝 일정";
    case "industries":
      return "산업 분류";
    case "industries_all":
      return "전체 산업";
    case "industry_semiconductors":
      return "반도체 산업";
    case "sector_technology":
      return "기술 섹터";
    default:
      return String(value || "데이터 항목").replaceAll("_", " ");
  }
}

export default function SurfaceCatalogCard() {
  const [data, setData] = useState<StockanalysisManifest | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCatalogData().then((payload) => {
      if (!cancelled) {
        setData(payload);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const rows = data?.surfaces?.sample_results ?? [];
    const buckets = new Map<string, SurfaceResult[]>();
    for (const row of rows) {
      const group = row.group || "other";
      const bucket = buckets.get(group) ?? [];
      bucket.push(row);
      buckets.set(group, bucket);
    }
    return Array.from(buckets.entries()).map(([group, items]) => ({
      group,
      items,
      rows: items.reduce((sum, item) => sum + (typeof item.rows === "number" ? item.rows : 0), 0),
    }));
  }, [data]);

  const counts = data?.surfaces?.counts;

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>데이터 수집 현황</h2>
        <span className="desc">
          {fmtNumber(counts?.ok)} / {fmtNumber(counts?.surfaces_requested)} · {fmtNumber(counts?.rows)}행
        </span>
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">수집 항목 확인 중</div>
              <div className="tk">데이터 항목을 읽고 있습니다</div>
            </span>
            <span className="pc num neutral">...</span>
          </div>
        ) : grouped.length > 0 ? (
          grouped.map((bucket) => (
            <div key={bucket.group} className="mv-row">
              <span className="co">
                <div className="n">{groupLabel(bucket.group)}</div>
                <div className="tk">
                  {bucket.items.slice(0, 3).map((item) => surfaceLabel(item.surface)).join(" · ")}
                </div>
              </span>
              <span className="pc num neutral">{fmtNumber(bucket.rows)}</span>
            </div>
          ))
        ) : (
          <div className="mv-row">
            <span className="co">
              <div className="n">표시할 데이터 항목이 없습니다</div>
            </span>
            <span className="pc num neutral">—</span>
          </div>
        )}
      </div>

      {grouped.length ? (
        <div className="panel-foot">
          <span>{fmtNumber(grouped.reduce((sum, bucket) => sum + bucket.items.length, 0))}개 데이터 항목</span>
          <a href="/data/stockanalysis/surfaces/index.json" style={{ marginLeft: "var(--s2)", fontWeight: 900 }}>
            원본 JSON
          </a>
        </div>
      ) : null}
    </section>
  );
}
