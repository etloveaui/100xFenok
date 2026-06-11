"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

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

function MoverList({ rows, tone }: { rows: MoverRow[]; tone: "up" | "down" }) {
  if (rows.length === 0) return null;
  return (
    <div className="mv-grp">
      <div className={`mv-h ${tone}`}>
        <span className="pin">{tone === "up" ? "▲" : "▼"}</span>
        {tone === "up" ? "상향" : "하향"}
      </div>
      {rows.map((r) => (
        <TransitionLink key={r.ticker} href={`/stock/${encodeURIComponent(r.ticker)}`} className="mv-row">
          <span className="co">
            {r.name ?? r.ticker}
            <small>{r.ticker}</small>
          </span>
          <span className={`pc num ${tone}`}>
            {r.change_1w >= 0 ? "+" : ""}{(r.change_1w * 100).toFixed(1)}%
          </span>
        </TransitionLink>
      ))}
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
    <div className="c-card">
      <div className="card-title">
        <h2>리비전 무버</h2>
        <span className="sub">추정치 변화</span>
      </div>
      <MoverList rows={up} tone="up" />
      <MoverList rows={down} tone="down" />
      <p className="heat-cap">
        FY+1 EPS 컨센서스 1주 변화율 · 적자 전환/기저가 0에 가까운 종목은 %가 과장될 수 있음 · 클릭 시 종목 상세
      </p>
    </div>
  );
}
