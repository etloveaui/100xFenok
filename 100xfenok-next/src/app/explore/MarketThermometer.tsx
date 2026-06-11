"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 시장 체온계 — price change decomposed into earnings vs multiple.
 * Source: benchmarks/summaries.json source_summaries[section].momentum
 * (Bloomberg-derived weekly aggregates; px_last ≈ (1+best_eps)(1+best_pe_ratio)-1).
 * Visual language: theme-c (claude.ai handoff mood C).
 */

type Period = "1m" | "3m" | "ytd";

interface MomentumRow {
  px: number | null;
  eps: number | null;
  per: number | null;
}

type SummariesDoc = {
  source_summaries?: Record<string, { momentum?: Record<string, Record<string, number | null>> }>;
};

let cache: SummariesDoc | null = null;
let pending: Promise<SummariesDoc | null> | null = null;
function loadSummaries(): Promise<SummariesDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/benchmarks/summaries.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { cache = d; return d; })
    .catch(() => { pending = null; return null; });
  return pending;
}

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: "sp500", label: "S&P 500" },
  { key: "nasdaq100", label: "나스닥 100" },
  { key: "philadelphia_semi", label: "필라델피아 반도체" },
  { key: "kospi", label: "코스피" },
  { key: "nikkei", label: "니케이" },
  { key: "world", label: "전세계" },
];

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "ytd", label: "YTD" },
  { id: "3m", label: "3개월" },
  { id: "1m", label: "1개월" },
];

function pick(doc: SummariesDoc, section: string, period: Period): MomentumRow {
  const m = doc.source_summaries?.[section]?.momentum;
  const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    px: n(m?.px_last?.[period]),
    eps: n(m?.best_eps?.[period]),
    per: n(m?.best_pe_ratio?.[period]),
  };
}

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const p = (v * 100).toFixed(1);
  return v >= 0 ? `+${p}%` : `${p}%`;
}

function verdict(row: MomentumRow): { text: string; tone: "good" | "mix" | "bad" } {
  const { px, eps, per } = row;
  if (px === null || eps === null || per === null) return { text: "데이터 부족", tone: "mix" };
  if (px >= 0 && eps > 0 && per <= 0.005) return { text: "이익이 끄는 상승 — 건강", tone: "good" };
  if (px >= 0 && eps > 0 && per > 0.005) {
    return per > eps
      ? { text: "멀티플 확장이 주도 — 비싸지는 중", tone: "mix" }
      : { text: "이익 주도 + 약간의 멀티플 확장", tone: "good" };
  }
  if (px >= 0 && eps <= 0) return { text: "이익 없이 오르는 중 — 주의", tone: "bad" };
  if (px < 0 && eps > 0) return { text: "이익은 느는데 가격 하락 — 싸지는 중", tone: "good" };
  return { text: "이익·가격 동반 약세", tone: "bad" };
}

/** Diverging bar segment: fill from center, right=positive. */
function DTrack({ value, color }: { value: number | null; color: string }) {
  if (value === null) return <div className="dtrack" />;
  const cap = 0.6; // 60%+ clamps so semis/kospi don't flatten the rest
  const w = (Math.min(Math.abs(value), cap) / cap) * 50;
  return (
    <div className="dtrack">
      <span className="dz" />
      <i
        style={{
          width: `${w}%`,
          backgroundColor: color,
          left: value >= 0 ? "50%" : undefined,
          right: value < 0 ? "50%" : undefined,
        }}
      />
    </div>
  );
}

export default function MarketThermometer() {
  const [doc, setDoc] = useState<SummariesDoc | null>(null);
  const [period, setPeriod] = useState<Period>("ytd");

  useEffect(() => {
    let cancelled = false;
    loadSummaries().then((d) => { if (!cancelled) setDoc(d); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    if (!doc) return null;
    return SECTIONS.map((s) => ({ ...s, row: pick(doc, s.key, period) }))
      .filter((r) => r.row.px !== null);
  }, [doc, period]);

  const headline = useMemo(() => {
    if (!doc) return null;
    const sp = pick(doc, "sp500", period);
    if (sp.px === null) return null;
    const v = verdict(sp);
    return { px: sp.px, text: v.text };
  }, [doc, period]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="c-card">
      <div className="card-title">
        <h2>시장 체온계</h2>
        <span className="sub">이익 × 멀티플 분해</span>
        <div className="seg">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={period === p.id ? "on" : ""}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {headline ? (
        <div className="verdict">
          미국 증시 <span className={`pc num ${headline.px >= 0 ? "up" : "down"}`}>{fmtPct(headline.px)}</span>{" "}
          — <em>{headline.text}</em>
        </div>
      ) : null}

      {rows.map(({ key, label, row }) => {
        const v = verdict(row);
        return (
          <div key={key} className="temp-row">
            <div className="temp-top">
              <span className="nm">{label}</span>
              <span className={`tot num ${row.px !== null && row.px >= 0 ? "up" : "down"}`}>{fmtPct(row.px)}</span>
            </div>
            <div className="dbar">
              <span className="dl">이익</span>
              <DTrack value={row.eps} color="var(--c-up)" />
              <span className="dv num">{fmtPct(row.eps)}</span>
            </div>
            <div className="dbar">
              <span className="dl">멀티플</span>
              <DTrack value={row.per} color="var(--c-brand)" />
              <span className="dv num">{fmtPct(row.per)}</span>
            </div>
            <span className={`vd ${v.tone === "good" ? "" : v.tone}`}>{v.text}</span>
          </div>
        );
      })}
      <p className="heat-cap">Bloomberg 주간 집계 기준 · 막대 중앙선 오른쪽 = 플러스 기여</p>
    </div>
  );
}
