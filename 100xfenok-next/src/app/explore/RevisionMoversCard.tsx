"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

/**
 * 리비전 무버 — 이번 주 FY+1 EPS 컨센서스가 크게 움직인 종목.
 * Source: revision_movers.json (build-revision-movers.mjs aggregate).
 */

interface MoverRow {
  ticker: string;
  name: string | null;
  change_1w: number;
  eps_fy1: number | null;
  as_of: string | null;
}

interface MoversDoc {
  generated_at?: string;
  up?: MoverRow[];
  down?: MoverRow[];
}

let cache: MoversDoc | null = null;
let pending: Promise<MoversDoc | null> | null = null;
function loadMovers(): Promise<MoversDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/global-scouter/core/revision_movers.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { cache = d; return d; })
    .catch(() => { pending = null; return null; });
  return pending;
}

function MoverList({ title, rows, tone }: { title: string; rows: MoverRow[]; tone: "up" | "down" }) {
  const color = tone === "up" ? "text-emerald-600" : "text-rose-500";
  if (rows.length === 0) return null;
  return (
    <div>
      <p className={`text-[10px] font-black uppercase tracking-[0.08em] ${color}`}>{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.ticker} className="flex items-baseline justify-between gap-2">
            <TransitionLink
              href={`/stock/${encodeURIComponent(r.ticker)}`}
              className="min-w-0 truncate text-[11px] font-bold text-slate-700 hover:text-brand-interactive"
            >
              <span className="font-black">{r.ticker}</span>
              {r.name ? <span className="ml-1.5 font-semibold text-slate-400">{r.name}</span> : null}
            </TransitionLink>
            <span className={`orbitron shrink-0 tabular-nums text-[11px] font-black ${color}`}>
              {r.change_1w >= 0 ? "+" : ""}{(r.change_1w * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function RevisionMoversCard() {
  const [doc, setDoc] = useState<MoversDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMovers().then((d) => { if (!cancelled) setDoc(d); });
    return () => { cancelled = true; };
  }, []);

  const up = (doc?.up ?? []).slice(0, 5);
  const down = (doc?.down ?? []).slice(0, 5);
  if (up.length === 0 && down.length === 0) return null;

  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-black tracking-tight text-slate-900">리비전 무버</h2>
      <p className="text-[10px] font-semibold text-slate-400">
        이번 주 애널리스트들이 내년 EPS 추정치를 가장 크게 고쳐 쓴 종목
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <MoverList title="상향 ▲" rows={up} tone="up" />
        <MoverList title="하향 ▼" rows={down} tone="down" />
      </div>
      <p className="mt-3 text-[9px] font-semibold text-slate-400">
        FY+1 EPS 컨센서스 1주 변화율 · 적자 전환/기저가 0에 가까운 종목은 %가 과장될 수 있음 · 클릭 시 종목 상세
      </p>
    </div>
  );
}
