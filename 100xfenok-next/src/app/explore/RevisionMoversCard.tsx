"use client";

import { useEffect, useState } from "react";
import TickerChip from "@/components/TickerChip";
import { formatSignedPercent } from "@/lib/format";

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
    <div className="mv-col">
      <div className={`mv-h ${tone}`}>{tone === "up" ? "▲ 상향" : "▼ 하향"}</div>
      {rows.map((r) => (
        <div key={r.ticker} className="mv-row">
          <span className="co">
            <div className="n">{r.name ?? r.ticker}</div>
            <div className="tk"><TickerChip ticker={r.ticker} variant="inline" /></div>
          </span>
          <span className={`pc num ${tone}`}>
            {formatSignedPercent(r.change_1w, { fraction: true, digits: 1 })}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function RevisionMoversCard() {
  const [doc, setDoc] = useState<MoversDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMovers().then((d) => {
      if (!cancelled) {
        setDoc(d);
        setLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const up = (doc?.up ?? []).slice(0, 5);
  const down = (doc?.down ?? []).slice(0, 5);
  if (up.length === 0 && down.length === 0) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>실적 추정치 변화</h2>
          <span className="desc">추정치 변화</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "표시할 추정치 변화가 없습니다." : "추정치 변화 확인 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>실적 추정치 변화</h2>
        <span className="desc">추정치 변화</span>
      </div>
      <div className="mv-split">
        <MoverList rows={up} tone="up" />
        <MoverList rows={down} tone="down" />
      </div>
      <div className="panel-foot">FY+1 EPS 시장 예상 1주 변화율 · 기저가 0에 가까우면 %가 과장될 수 있음</div>
    </section>
  );
}
