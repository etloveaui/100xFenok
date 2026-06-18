"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface StructureDoc {
  generated_at?: string;
  membershipChanges?: {
    updated?: string | null;
    recent?: Array<{ date?: string | null; index?: string | null; added?: string[]; removed?: string[] }>;
  };
  concentration?: Array<{ id: string; label: string; top3Weight?: number | null; top10Weight?: number | null }>;
  liquidity?: Array<{ id: string; label: string; date?: string | null; value?: number | null; delta7d?: number | null; points?: number }>;
  sentimentComponents?: {
    latestDate?: string | null;
    components?: Array<{ id: string; value?: number | null; delta7d?: number | null }>;
  };
}

let cache: StructureDoc | null = null;
let pending: Promise<StructureDoc | null> | null = null;

function loadStructure(): Promise<StructureDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/computed/market_structure_index.json")
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

function fmt(value: number | null | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—";
}

function labelComponent(id: string): string {
  return id.replace(/_/g, " ");
}

export default function MarketStructureIndexCard() {
  const [doc, setDoc] = useState<StructureDoc | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadStructure().then((next) => {
      if (!cancelled) {
        setDoc(next);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>시장 구조 인덱스</h2>
          <span className="desc">리밸런싱·유동성·심리</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "시장 구조 데이터를 불러오지 못했습니다." : "시장 구조 확인 중"}
        </div>
      </section>
    );
  }

  const change = doc.membershipChanges?.recent?.[0] ?? null;
  const topConcentration = doc.concentration?.[0] ?? null;
  const weakSentiment = [...(doc.sentimentComponents?.components ?? [])]
    .sort((a, b) => (a.value ?? 100) - (b.value ?? 100))
    .slice(0, 2);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>시장 구조 인덱스</h2>
        <span className="desc">{doc.membershipChanges?.updated ?? doc.generated_at?.slice(0, 10) ?? "—"}</span>
      </div>
      <div className="mv-col">
        {change ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">{String(change.index ?? "index").toUpperCase()} 리밸런싱</div>
              <div className="tk" style={{ whiteSpace: "normal" }}>
                +{change.added?.slice(0, 3).join(" · ") || "—"} / -{change.removed?.slice(0, 3).join(" · ") || "—"}
              </div>
            </span>
            <span className="pc num neutral">{change.date ?? "—"}</span>
          </div>
        ) : null}
        {topConcentration ? (
          <div className="mv-row">
            <span className="co">
              <div className="n">{topConcentration.label} 집중도</div>
              <div className="tk">Top10 {fmt(topConcentration.top10Weight, "%")}</div>
            </span>
            <span className="pc num up">{fmt(topConcentration.top3Weight, "%")}</span>
          </div>
        ) : null}
      </div>
      <div className="panel-foot">
        CNN 약한 축 {weakSentiment.map((item) => `${labelComponent(item.id)} ${fmt(item.value)}`).join(" · ") || "—"}
        <TransitionLink href="/market-valuation" style={{ marginLeft: 8, fontWeight: 900 }}>
          시장 상세
        </TransitionLink>
      </div>
    </section>
  );
}
