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

export type { SummariesDoc, MomentumRow };

let cache: SummariesDoc | null = null;
let pending: Promise<SummariesDoc | null> | null = null;
export function loadSummaries(): Promise<SummariesDoc | null> {
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

export function pick(doc: SummariesDoc, section: string, period: Period): MomentumRow {
  const m = doc.source_summaries?.[section]?.momentum;
  const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    px: n(m?.px_last?.[period]),
    eps: n(m?.best_eps?.[period]),
    per: n(m?.best_pe_ratio?.[period]),
  };
}

export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  const p = (v * 100).toFixed(1);
  return v >= 0 ? `+${p}%` : `${p}%`;
}

export type Verdict = { head: string; why: string; tone: "good" | "mix" | "bad" };

/** Two-layer copy: bold plain-Korean call + one-line reason (no jargon up front). */
export function verdict(row: MomentumRow): Verdict {
  const { px, eps, per } = row;
  if (px === null || eps === null || per === null) return { head: "데이터 부족", why: "이익·멀티플 분해 불가", tone: "mix" };
  if (px >= 0 && eps > 0 && per <= 0.005) return { head: "실적이 끌어올린 상승", why: "이익 증가가 주도 — 비싸지지 않음", tone: "good" };
  if (px >= 0 && eps > 0 && per > 0.005) {
    return per > eps
      ? { head: "비싸져서 오른 상승", why: "이익보다 멀티플(기대)이 더 빨리 상승 — 주의", tone: "mix" }
      : { head: "실적이 끌어올린 상승", why: "이익이 주도, 멀티플은 소폭 확장", tone: "good" };
  }
  if (px >= 0 && eps <= 0) return { head: "이익 없이 오른 상승", why: "기대만으로 상승 중 — 부담 큼", tone: "bad" };
  if (px < 0 && eps > 0) return { head: "이익은 느는데 가격은 하락", why: "그만큼 싸지는 중", tone: "good" };
  return { head: "이익·가격 동반 약세", why: "펀더멘털과 가격이 함께 하락", tone: "bad" };
}

/** Diverging bar from center; cap = full-scale magnitude per metric (design: 이익 100%, 멀티플 22%). */
function DTrack({ value, cap, kind }: { value: number | null; cap: number; kind: "eps" | "per" }) {
  if (value === null) return <div className="db-track" />;
  const w = Math.max((Math.min(Math.abs(value), cap) / cap) * 50, 3);
  return (
    <div className="db-track">
      <span className="db-zero" />
      <i
        className={`db-bar ${kind}`}
        style={{
          width: `${w}%`,
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

  if (!rows || rows.length === 0) return null;

  return (
    <section className="panel thermo">
      <div className="panel-h">
        <h2>시장 체온계</h2>
        <span className="desc">이익 × 멀티플 분해</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          {PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={period === p.id ? "on" : ""}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {rows.map(({ key, label, row }) => {
        const v = verdict(row);
        return (
          <div key={key} className="ti">
            <div className="ti-top">
              <span className="nm">{label}</span>
              <span className={`tot num ${row.px !== null && row.px >= 0 ? "up" : "down"}`}>{fmtPct(row.px)}</span>
            </div>
            <div className="ti-bars">
              <div className="db-row">
                <span className="dl">이익</span>
                <DTrack value={row.eps} cap={1.0} kind="eps" />
                <span className="dv num">{fmtPct(row.eps)}</span>
              </div>
              <div className="db-row">
                <span className="dl">멀티플</span>
                <DTrack value={row.per} cap={0.22} kind="per" />
                <span className="dv num">{fmtPct(row.per)}</span>
              </div>
            </div>
            <div className="ti-why">
              <span className={`tag ${v.tone}`}>{v.head}</span> {v.why}
            </div>
          </div>
        );
      })}
      <div className="panel-foot">Bloomberg 주간 집계 기준 · 막대 중앙선 오른쪽 = 플러스 기여</div>
    </section>
  );
}
