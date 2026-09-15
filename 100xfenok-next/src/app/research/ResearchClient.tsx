"use client";

import { useEffect, useState } from "react";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import { ROUTES } from "@/lib/routes";

type ResearchItemStatus = "live" | "coming-soon";

type ResearchItem = {
  id: string;
  kind: string;
  title: string;
  ticker: string | null;
  date: string | null;
  status: ResearchItemStatus;
  href: string | null;
};

type ResearchCatalog = {
  schema_version: string;
  generated_at: string;
  items: ResearchItem[];
};

type ResearchFilter = "all" | "companies" | "products";

const FILTERS: { key: ResearchFilter; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "companies", label: "기업 리서치" },
  { key: "products", label: "제품" },
];

const KIND_LABEL: Record<string, string> = {
  "valuation-card": "밸류카드",
  coverage: "커버리지",
  "market-note": "마켓노트",
  "weekly-armament": "위클리",
  "macro-signal": "매크로",
  design: "디자인",
  workbench: "워크벤치",
  other: "기타",
  product: "제품",
};

function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export default function ResearchClient() {
  const [catalog, setCatalog] = useState<ResearchCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ResearchFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${ROUTES.research}/catalog.json`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ResearchCatalog;
        if (!cancelled) setCatalog(Array.isArray(json?.items) ? json : null);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = catalog?.items ?? [];
  const visible = items.filter((item) => {
    if (filter === "companies") return item.kind !== "product";
    if (filter === "products") return item.kind === "product";
    return true;
  });
  const liveCount = items.filter((item) => item.status === "live").length;
  const opened = openId ? items.find((item) => item.id === openId && item.status === "live" && item.href) ?? null : null;

  return (
    <div data-research-root="true">
      <p className="text-sm text-slate-600">기업 리서치 아티팩트와 제품 브리프를 모은 목록입니다.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="리서치 분류">
        {FILTERS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-pressed={filter === tab.key}
            onClick={() => {
              setFilter(tab.key);
              setOpenId(null);
            }}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-bold transition ${
              filter === tab.key
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
          실물 {liveCount} · 전체 {items.length}
        </span>
      </div>

      {opened ? (
        <section aria-label={`${opened.title} 뷰어`} data-research-viewer="true" className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOpenId(null)}
              className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              ← 목록으로
            </button>
            <h2 className="text-base font-black text-slate-900">{opened.title}</h2>
          </div>
          <div className="mt-3">
            <RouteEmbedFrame src={opened.href ?? ""} title={opened.title} />
          </div>
        </section>
      ) : null}

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-slate-500" data-research-state="loading">불러오는 중입니다.</p>
        ) : failed || !catalog ? (
          <div data-research-state="error">
            <p className="text-sm text-slate-500">목록을 불러오지 못했습니다.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              다시 시도
            </button>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500" data-research-state="empty">이 분류에 표시할 리서치가 없습니다.</p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="리서치 목록">
            {visible.map((item) => {
              const live = item.status === "live" && item.href;
              return (
                <li
                  key={item.id}
                  data-research-card={item.id}
                  className={`flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${live ? "" : "opacity-70"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex min-h-6 items-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-600">
                      {kindLabel(item.kind)}
                    </span>
                    {live ? null : (
                      <span className="inline-flex min-h-6 items-center rounded-full border border-amber-200 bg-amber-50 px-2 text-[11px] font-bold text-amber-800">
                        커밍순
                      </span>
                    )}
                    {item.ticker ? (
                      <span className="inline-flex min-h-6 items-center rounded-full border border-blue-200 bg-blue-50 px-2 text-[11px] font-bold text-blue-900">
                        {item.ticker}
                      </span>
                    ) : null}
                    {item.date ? <span className="ml-auto text-[11px] font-bold text-slate-500">{item.date}</span> : null}
                  </div>
                  <h3 className="mt-2 text-base font-black text-slate-900">{item.title}</h3>
                  <div className="mt-auto pt-3">
                    {live ? (
                      <button
                        type="button"
                        onClick={() => setOpenId(item.id)}
                        data-research-open={item.id}
                        className="inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700"
                      >
                        열기
                      </button>
                    ) : (
                      <span className="inline-flex min-h-11 items-center text-sm font-bold text-slate-500">준비 중입니다</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4" aria-label="동기화 안내">
        <p className="text-sm font-bold text-slate-700">추가 리서치 아티팩트 동기화 준비 중</p>
        <p className="mt-1 text-sm text-slate-500">검증된 아티팩트부터 순차적으로 목록에 추가됩니다.</p>
      </aside>
    </div>
  );
}
