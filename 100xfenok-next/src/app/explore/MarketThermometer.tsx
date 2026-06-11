"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 시장 체온계 — price change decomposed into earnings vs multiple.
 * Source: benchmarks/summaries.json source_summaries[section].momentum
 * (Bloomberg-derived weekly aggregates; px_last ≈ (1+best_eps)(1+best_pe_ratio)-1).
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

function verdict(row: MomentumRow): { text: string; tone: "good" | "warn" | "bad" } {
  const { px, eps, per } = row;
  if (px === null || eps === null || per === null) return { text: "데이터 부족", tone: "warn" };
  if (px >= 0 && eps > 0 && per <= 0.005) return { text: "이익이 끄는 상승 — 건강", tone: "good" };
  if (px >= 0 && eps > 0 && per > 0.005) {
    return per > eps
      ? { text: "멀티플 확장이 주도 — 비싸지는 중", tone: "warn" }
      : { text: "이익 주도 + 약간의 멀티플 확장", tone: "good" };
  }
  if (px >= 0 && eps <= 0) return { text: "이익 없이 오르는 중 — 주의", tone: "bad" };
  if (px < 0 && eps > 0) return { text: "이익은 느는데 가격 하락 — 싸지는 중", tone: "good" };
  return { text: "이익·가격 동반 약세", tone: "bad" };
}

const TONE_TEXT = { good: "text-emerald-700", warn: "text-amber-600", bad: "text-rose-600" } as const;

/** Diverging bar: emerald = earnings contribution, indigo = multiple contribution. */
function DecompBar({ eps, per }: { eps: number | null; per: number | null }) {
  if (eps === null || per === null) return <div className="h-2 rounded-full bg-slate-100" />;
  // Scale both against a shared max so rows are comparable within the card.
  const cap = 0.6; // 60%+ clamps — keeps semis/kospi from flattening everything else
  const w = (v: number) => `${Math.min(Math.abs(v), cap) / cap * 50}%`;
  const seg = (v: number, color: string) => (
    <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
      <div
        className="absolute top-0 h-2"
        style={{
          width: w(v),
          backgroundColor: color,
          left: v >= 0 ? "50%" : undefined,
          right: v < 0 ? "50%" : undefined,
          opacity: 0.9,
        }}
      />
      <div className="absolute left-1/2 top-0 h-2 w-px bg-slate-300" />
    </div>
  );
  return (
    <div className="flex items-center gap-1.5">
      {seg(eps, "#059669")}
      {seg(per, "#6366f1")}
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
    if (sp.px === null || sp.eps === null || sp.per === null) return null;
    const v = verdict(sp);
    return { text: `미국 증시 ${fmtPct(sp.px)} — ${v.text}`, tone: v.tone };
  }, [doc, period]);

  if (!rows || rows.length === 0) return null;

  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-black tracking-tight text-slate-900">시장 체온계</h2>
          <p className="text-[10px] font-semibold text-slate-400">
            가격 변화 = <span className="font-black text-emerald-600">이익(EPS)</span> ×{" "}
            <span className="font-black text-indigo-500">멀티플(PER)</span> 분해
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-black uppercase tracking-[0.08em] transition ${
                period === p.id
                  ? "border-brand-interactive bg-brand-interactive/5 text-brand-interactive"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {headline ? (
        <p className={`mt-2 text-xs font-black ${TONE_TEXT[headline.tone]}`}>{headline.text}</p>
      ) : null}

      <div className="mt-3 space-y-2.5">
        {rows.map(({ key, label, row }) => {
          const v = verdict(row);
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-700">{label}</span>
                <span className="orbitron tabular-nums text-[11px] font-black text-slate-900">{fmtPct(row.px)}</span>
              </div>
              <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-2">
                <DecompBar eps={row.eps} per={row.per} />
                <span className={`w-44 truncate text-right text-[10px] font-bold ${TONE_TEXT[v.tone]}`}>{v.text}</span>
              </div>
              <p className="mt-0.5 text-[9px] font-semibold text-slate-400">
                이익 {fmtPct(row.eps)} · 멀티플 {fmtPct(row.per)}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[9px] font-semibold text-slate-400">
        Bloomberg 주간 집계 기준 · 막대 중앙선 기준 오른쪽 = 플러스 기여
      </p>
    </div>
  );
}
