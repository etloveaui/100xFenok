"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import TickerTypeahead from "@/components/TickerTypeahead";
import { sectorLabelKo } from "@/lib/design/sectorMap";
import type { CanonicalSector } from "@/lib/design/sectorMap";

type MomentumMap = Record<string, Record<string, number>>;

const INDEX_CHIPS: Array<{ key: string; label: string }> = [
  { key: "sp500", label: "S&P 500" },
  { key: "nasdaq100", label: "나스닥 100" },
  { key: "russell2000", label: "러셀 2000" },
  { key: "kospi", label: "코스피" },
  { key: "nikkei", label: "니케이" },
  { key: "emerging", label: "이머징" },
];

const SECTOR_KEYS: Array<{ key: string; canonical: CanonicalSector }> = [
  { key: "information_technology", canonical: "Technology" },
  { key: "communication_services", canonical: "Communication Services" },
  { key: "consumer_discretionary", canonical: "Consumer Discretionary" },
  { key: "consumer_staples", canonical: "Consumer Staples" },
  { key: "energy", canonical: "Energy" },
  { key: "financials", canonical: "Financials" },
  { key: "health_care", canonical: "Healthcare" },
  { key: "industrials", canonical: "Industrials" },
  { key: "materials", canonical: "Materials" },
  { key: "real_estate", canonical: "Real Estate" },
  { key: "utilities", canonical: "Utilities" },
];

function pct(v: number | undefined): string {
  if (v === undefined || Number.isNaN(v)) return "—";
  const p = (v * 100).toFixed(1);
  return v >= 0 ? `+${p}%` : `${p}%`;
}

function toneClass(v: number | undefined): string {
  if (v === undefined) return "neu";
  return v >= 0 ? "up" : "down";
}

export default function ExploreDashboard() {
  const [momentum, setMomentum] = useState<MomentumMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/benchmarks/summaries.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.momentum) setMomentum(j.momentum as MomentumMap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      {/* Search card */}
      <div className="c-card search-card">
        <TickerTypeahead
          placeholder="티커 검색 — 종목 상세로 바로 이동 (예: AAPL, NVDA, TSM)"
          className="min-w-0 flex-1 bg-transparent py-3.5 text-[15.5px] font-semibold outline-none"
          formClass="flex w-full items-center gap-3"
          showButton
          buttonLabel="종목 상세"
          buttonClass="search-btn"
        />
      </div>

      {/* Market pulse */}
      <div className="c-card">
        <div className="card-title">
          <h2>시장 펄스</h2>
          <span className="sub">연초 대비 · YTD</span>
          <TransitionLink href="/market-valuation" className="more">전체 →</TransitionLink>
        </div>
        <div className="pulse">
          {INDEX_CHIPS.map((c) => {
            const v = momentum?.[c.key]?.ytd;
            return (
              <TransitionLink key={c.key} href="/market-valuation" className="pcell">
                <div className="pn">{c.label}</div>
                <div className={`pv num ${toneClass(v)}`}>{momentum ? pct(v) : "…"}</div>
              </TransitionLink>
            );
          })}
        </div>

        <p className="heat-cap">11개 섹터 · 최근 1개월 수익률 · 탭하여 히트맵으로</p>
        <div className="heat">
          {SECTOR_KEYS.map(({ key, canonical }) => {
            const v = momentum?.[key]?.["1m"];
            const tone = v === undefined ? "ht-flat" : Math.abs(v) < 0.005 ? "ht-flat" : v >= 0 ? "ht-up" : "ht-down";
            return (
              <TransitionLink
                key={key}
                href="/sectors"
                className={`ht ${tone}`}
                title={`${sectorLabelKo(canonical)} 1개월 ${pct(v)}`}
              >
                <span className="hn">{sectorLabelKo(canonical)}</span>
                <span className="hv num">{momentum ? pct(v) : "…"}</span>
              </TransitionLink>
            );
          })}
        </div>
      </div>
    </section>
  );
}
