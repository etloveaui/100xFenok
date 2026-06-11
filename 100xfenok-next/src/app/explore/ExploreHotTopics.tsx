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
  badgeCls: string;
  text: string;
  amount: string;
  amountCls: string;
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
      badgeCls: "buy",
      text: `${topBought.ticker} — 구루 ${topBought.investors_count}명 매수 (최대: ${topBought.top_investor.name})`,
      amount: fmtAmount(topBought.amount),
      amountCls: "up",
    });
  }
  if (topSold) {
    topics.push({
      key: "sold",
      chip: "최다 매도",
      badgeCls: "sell",
      text: `${topSold.ticker} — 구루 ${topSold.investors_count}명 매도 (최대: ${topSold.top_investor.name})`,
      amount: fmtAmount(topSold.amount),
      amountCls: "down",
    });
  }
  if (topNew) {
    topics.push({
      key: "new",
      chip: "신규 편입",
      badgeCls: "new",
      text: `${topNew.ticker} — 구루 ${topNew.new_count}명 신규 편입`,
      amount: fmtAmount(topNew.amount),
      amountCls: "",
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

  if (loading || !data) return null;

  const topics = buildTopics(data);
  if (topics.length === 0) return null;

  return (
    <section className="panel f13-wrap">
      <div className="panel-h">
        <h2>13F 핫토픽</h2>
        <span className="desc">{data.metadata.quarter} 기준</span>
        <TransitionLink href="/superinvestors" className="act">구루 전체 →</TransitionLink>
      </div>
      <div className="f13-grid">
        {topics.map((t) => (
          <TransitionLink key={t.key} href="/superinvestors" className="f13">
            <span className={`badge ${t.badgeCls}`}>{t.chip}</span>
            <span className="body">
              <span className="tkr">{t.text.split("—")[0].trim()}</span>
              <span className="meta">{t.text.includes("—") ? t.text.split("—")[1].trim() : ""}</span>
            </span>
            <span className={`amt num ${t.amountCls}`}>{t.amount}</span>
          </TransitionLink>
        ))}
      </div>
      <div className="panel-foot">13F 공시는 분기 종료 후 최대 45일 지연됩니다 · 데이터: SEC 13F</div>
    </section>
  );
}
