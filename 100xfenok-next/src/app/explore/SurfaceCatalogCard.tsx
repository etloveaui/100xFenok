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
    .catch(() => null);
  return catalogPending;
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
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
      return "시장 무버";
    case "earnings":
      return "어닝";
    case "industry":
      return "산업";
    default:
      return value || "기타";
  }
}

function surfaceLabel(value: string | null | undefined): string {
  return String(value || "").replaceAll("_", " ");
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
        <h2>시장 데이터 카탈로그</h2>
        <span className="desc">
          {fmtNumber(counts?.ok)} / {fmtNumber(counts?.surfaces_requested)} · {fmtNumber(counts?.rows)}행
        </span>
      </div>

      <div className="mv-col">
        {!loaded ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">카탈로그 확인 중</div>
              <div className="tk">로컬 데이터팩을 읽고 있습니다</div>
            </span>
            <span className="pc num neutral">...</span>
          </div>
        ) : (
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
        )}
      </div>

      {grouped.length ? (
        <div className="panel-foot">
          <span>{fmtNumber(grouped.reduce((sum, bucket) => sum + bucket.items.length, 0))}개 데이터 묶음</span>
          <a href="/data/stockanalysis/surfaces/index.json" style={{ marginLeft: 8, fontWeight: 900 }}>
            JSON
          </a>
        </div>
      ) : null}
    </section>
  );
}
