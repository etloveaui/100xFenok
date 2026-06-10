"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import type { TradesRankingData, TradesRankingRow } from "@/lib/superinvestors/types";

function fmtAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
  return `$${Math.round(value).toLocaleString()}`;
}

type Topic = {
  key: string;
  chip: string;
  chipClass: string;
  text: string;
  amount: string;
};

function buildTopics(data: TradesRankingData): Topic[] {
  const topics: Topic[] = [];
  const topBought: TradesRankingRow | undefined = data.bought[0];
  const topSold: TradesRankingRow | undefined = data.sold[0];
  const topNew = data.bought
    .filter((r) => (r.new_count ?? 0) > 0)
    .sort((a, b) => (b.new_count ?? 0) - (a.new_count ?? 0) || b.amount - a.amount)[0];

  if (topBought) {
    topics.push({
      key: "bought",
      chip: "최다 매수",
      chipClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      text: `${topBought.ticker} — 구루 ${topBought.investors_count}명 매수 (최대: ${topBought.top_investor.name})`,
      amount: fmtAmount(topBought.amount),
    });
  }
  if (topSold) {
    topics.push({
      key: "sold",
      chip: "최다 매도",
      chipClass: "bg-rose-50 text-rose-700 border-rose-200",
      text: `${topSold.ticker} — 구루 ${topSold.investors_count}명 매도 (최대: ${topSold.top_investor.name})`,
      amount: fmtAmount(topSold.amount),
    });
  }
  if (topNew) {
    topics.push({
      key: "new",
      chip: "신규 편입",
      chipClass: "bg-sky-50 text-sky-700 border-sky-200",
      text: `${topNew.ticker} — 구루 ${topNew.new_count}명 신규 편입`,
      amount: fmtAmount(topNew.amount),
    });
  }
  return topics;
}

export default function ExploreHotTopics() {
  const [data, setData] = useState<TradesRankingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/data/sec-13f/analytics/trades_ranking.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TradesRankingData = await res.json();
        if (!cancelled) setData(json);
      } catch {
        // graceful: section simply stays hidden on failure
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <section className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 w-full rounded bg-slate-100" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const topics = buildTopics(data);
  if (topics.length === 0) return null;

  return (
    <section className="mt-8 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.10)]">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-black tracking-tight text-slate-950">13F 핫토픽</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">
          {data.metadata.quarter} 기준
        </span>
        <span className="text-[10px] font-bold text-slate-400">13F 공시는 분기 종료 후 최대 45일 지연됩니다</span>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {topics.map((t) => (
          <li key={t.key}>
            <TransitionLink
              href="/superinvestors"
              className="group flex items-center gap-3 py-2.5 transition hover:bg-slate-50"
            >
              <span
                className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-black ${t.chipClass}`}
              >
                {t.chip}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 group-hover:text-slate-950">
                {t.text}
              </span>
              <span className="orbitron shrink-0 text-sm font-bold tabular-nums text-slate-900">{t.amount}</span>
              <span className="shrink-0 text-[11px] font-black text-brand-interactive">→</span>
            </TransitionLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
