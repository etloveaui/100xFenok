"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

type ActionTab = "smart_money" | "value_momentum" | "index_core";

interface ActionRow {
  symbol: string;
  company?: string | null;
  sector?: string | null;
  actionScore?: number | null;
  actionLabel?: string | null;
  actionBucket?: string | null;
  actionReasons?: string[];
  return12m?: number | null;
  guruHolders?: number | null;
}

interface ActionDoc {
  generated_at?: string;
  coverage?: {
    indexed_stock_count?: number | null;
    conviction_matched_count?: number | null;
    quarter_close_ticker_count?: number | null;
  };
  rows?: ActionRow[];
}

let cache: ActionDoc | null = null;
let pending: Promise<ActionDoc | null> | null = null;

function loadActions(): Promise<ActionDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/computed/stock_action_index.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => {
      cache = doc;
      return doc;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function fmtScore(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toString() : "—";
}

function fmtPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function tone(bucket: string | null | undefined): string {
  if (bucket === "smart_money") return "up";
  if (bucket === "value_momentum") return "up";
  if (bucket === "index_core") return "neutral";
  return "neutral";
}

export default function ActionCandidatesCard() {
  const [doc, setDoc] = useState<ActionDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<ActionTab>("smart_money");

  useEffect(() => {
    let cancelled = false;
    loadActions().then((next) => {
      if (!cancelled) {
        setDoc(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const all = Array.isArray(doc?.rows) ? doc.rows : [];
    return all.filter((row) => row.actionBucket === tab).slice(0, 6);
  }, [doc, tab]);

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>액션 후보</h2>
          <span className="desc">SlickCharts · 13F · YF</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "액션 후보 데이터를 불러오지 못했습니다." : "액션 후보 계산 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>액션 후보</h2>
        <span className="desc">{doc.coverage?.indexed_stock_count ?? "—"}개 · 13F {doc.coverage?.conviction_matched_count ?? "—"}건</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          {[
            ["smart_money", "구루"],
            ["value_momentum", "밸류"],
            ["index_core", "지수"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? "on" : ""} onClick={() => setTab(key as ActionTab)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mv-col">
        {rows.map((row) => (
          <TransitionLink key={row.symbol} href={`/stock/${encodeURIComponent(row.symbol)}`} className="mv-row">
            <span className="co">
              <div className="n">{row.company || row.symbol}</div>
              <div className="tk">
                {row.symbol}{row.sector ? ` · ${row.sector}` : ""}
              </div>
              {row.actionReasons?.[0] ? <div className="tk" style={{ whiteSpace: "normal" }}>{row.actionReasons[0]}</div> : null}
            </span>
            <span className={`pc num ${tone(row.actionBucket)}`}>
              {fmtScore(row.actionScore)}
              <small style={{ display: "block", fontSize: 10, color: "var(--c-ink-3)" }}>{fmtPct(row.return12m)}</small>
            </span>
          </TransitionLink>
        ))}
      </div>
      <div className="panel-foot">YF 분기 종가 {doc.coverage?.quarter_close_ticker_count ?? "—"}개 · 데이터: computed stock_action_index</div>
    </section>
  );
}
