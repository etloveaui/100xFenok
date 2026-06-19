"use client";

import { useEffect, useMemo, useState } from "react";

interface YardneyRow {
  date: string;
  moodys_aaa?: number | null;
  moodys_baa?: number | null;
  spread_avg?: number | null;
  spx: number;
  eps?: number | null;
  bond_per?: number | null;
  fair_value: number;
  premium_pct: number | null;
}

interface YardneyDoc {
  data?: YardneyRow[];
}

let cache: YardneyDoc | null = null;
let pending: Promise<YardneyDoc | null> | null = null;
function loadYardney(): Promise<YardneyDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/yardney/yardney_model.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      cache = d;
      return d;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function verdict(p: number | null): { text: string; tone: string } {
  if (p === null) return { text: "데이터 부족", tone: "text-[var(--c-ink-4)]" };
  if (p > 15) return { text: `적정가 대비 ${p.toFixed(1)}% 프리미엄 — 고평가 구간`, tone: "text-[var(--c-down)]" };
  if (p > 5) return { text: `다소 프리미엄 (${p.toFixed(1)}%)`, tone: "text-[var(--c-warn)]" };
  if (p >= -5) return { text: `적정 범위 (${p.toFixed(1)}%)`, tone: "text-[var(--c-ink-2)]" };
  return { text: `할인 구간 (${p.toFixed(1)}%)`, tone: "text-[var(--c-up)]" };
}

function percentile(value: number, sorted: number[]): number {
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count++;
    else break;
  }
  return Math.round((count / sorted.length) * 100);
}

const W = 480;
const H = 138;
const PAD = 12;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtIndex(value: number | null | undefined): string {
  return finite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
}

function fmtNum(value: number | null | undefined, digits = 1): string {
  return finite(value) ? value.toFixed(digits) : "—";
}

export default function YardeniCard() {
  const [doc, setDoc] = useState<YardneyDoc | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadYardney().then((d) => {
      if (!cancelled) setDoc(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = useMemo(() => {
    if (!doc?.data?.length) return null;
    const rows = doc.data;
    return rows[rows.length - 1];
  }, [doc]);

  const chart = useMemo(() => {
    if (!doc?.data?.length) return null;
    const rows = doc.data
      .filter((r) => finite(r.spx) && finite(r.fair_value))
      .filter((_, i, arr) => i % 4 === 0 || i === arr.length - 1);
    const recent = rows.length > 0 && rows[rows.length - 1]?.date !== doc.data[doc.data.length - 1]?.date
      ? [...rows, doc.data[doc.data.length - 1]]
      : rows;
    if (recent.length < 2) return null;

    const vals = recent.flatMap((r) => [r.spx, r.fair_value]).filter(finite);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const scaleX = (i: number) => PAD + (i / (recent.length - 1)) * (W - 2 * PAD);
    const scaleY = (v: number) => H - PAD - ((v - minV) / range) * (H - 2 * PAD);

    const spxPts = recent.map((r, i) => `${scaleX(i).toFixed(1)},${scaleY(r.spx).toFixed(1)}`).join(" ");
    const fairPts = recent.map((r, i) => `${scaleX(i).toFixed(1)},${scaleY(r.fair_value).toFixed(1)}`).join(" ");
    const markers = recent
      .map((row, index) => ({ row, index, x: scaleX(index), y: scaleY(row.spx) }))
      .filter((_, index, array) => index % 26 === 0 || index === array.length - 1);

    return { rows: recent, spxPts, fairPts, markers, minV, maxV, scaleX, scaleY };
  }, [doc]);

  const pctRank = useMemo(() => {
    if (!doc?.data?.length || !latest || latest.premium_pct === null) return null;
    const allNonNull = doc.data
      .map((r) => r.premium_pct)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    return percentile(latest.premium_pct, allNonNull);
  }, [doc, latest]);

  if (!latest) return null;

  const active = chart?.rows[activeIndex ?? chart.rows.length - 1] ?? latest;
  const v = verdict(active.premium_pct);

  return (
    <div className="rounded-[1.5rem] border border-[var(--c-line)] bg-[var(--c-panel)] p-5">
      <div>
        <h2 className="text-sm font-black tracking-tight text-[var(--c-ink)]">
          야데니 모델 (채권 PER)
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-[var(--c-ink-3)]">
          회사채 금리로 계산한 채권 PER × EPS = 주식 적정가. 국채·회사채 대비
          주식이 비싼지 보는 잣대.
        </p>
      </div>

      <p className={`mt-3 text-xs font-black ${v.tone}`}>{v.text}</p>

      <div className="mt-2 flex flex-wrap items-baseline gap-3 text-[11px] font-bold text-[var(--c-ink-3)]">
        <span>
          S&P 500{" "}
          <span className="orbitron font-black text-[var(--c-ink)]">
            {fmtIndex(active.spx)}
          </span>
        </span>
        <span className="text-[var(--c-line-2)]">vs</span>
        <span>
          적정가{" "}
          <span className="orbitron font-black text-[var(--c-ink)]">
            {fmtIndex(active.fair_value)}
          </span>
        </span>
        <span className="text-[var(--c-line-2)]">{active.date}</span>
      </div>

      {chart ? (
        <div className="mt-4">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`S&P 500과 Yardeni 적정가 overlay · 현재 ${fmtIndex(latest.spx)} 대 ${fmtIndex(latest.fair_value)} · 범위 ${fmtIndex(chart.minV)}~${fmtIndex(chart.maxV)} · 기준일 ${latest.date}`}
            onMouseLeave={() => setActiveIndex(null)}
          >
            <line
              x1={PAD}
              y1={chart.scaleY(chart.minV)}
              x2={W - PAD}
              y2={chart.scaleY(chart.minV)}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
            <line x1={PAD} y1={chart.scaleY(chart.maxV)} x2={W - PAD} y2={chart.scaleY(chart.maxV)} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3,3" />
            <polyline
              points={chart.fairPts}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="1.8"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={chart.spxPts}
              fill="none"
              stroke="#1B73D3"
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {chart.markers.map((marker) => (
              <circle
                key={marker.row.date}
                cx={marker.x}
                cy={marker.y}
                r={active.date === marker.row.date ? "4" : "2.5"}
                fill={active.date === marker.row.date ? "#1B73D3" : "rgba(27,115,211,0.25)"}
                stroke="white"
                strokeWidth="1.5"
                onMouseEnter={() => setActiveIndex(marker.index)}
                onFocus={() => setActiveIndex(marker.index)}
              >
                <title>{`${marker.row.date} · S&P 500 ${fmtIndex(marker.row.spx)} · 적정가 ${fmtIndex(marker.row.fair_value)} · 프리미엄 ${fmtNum(marker.row.premium_pct)}%`}</title>
              </circle>
            ))}
          </svg>
          <div className="mt-1 flex justify-between text-[9px] font-bold tabular-nums text-[var(--c-ink-4)]">
            <span>최저 {fmtIndex(chart.minV)}</span>
            <span className="text-[var(--c-brand)]">S&P 500</span>
            <span className="text-[var(--c-ink-3)]">적정가</span>
            <span>최고 {fmtIndex(chart.maxV)}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-5">
            {[
              ["EPS", `$${fmtNum(active.eps, 2)}`],
              ["채권 PER", `${fmtNum(active.bond_per, 1)}x`],
              ["AAA", `${fmtNum(active.moodys_aaa, 2)}%`],
              ["BAA", `${fmtNum(active.moodys_baa, 2)}%`],
              ["평균 스프레드", `${fmtNum(active.spread_avg, 2)}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-[var(--c-line)] bg-[var(--c-surface-2)] px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-4)]">{label}</p>
                <p className="orbitron mt-1 text-xs font-black tabular-nums text-[var(--c-ink-2)]">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {pctRank !== null ? (
        <p className="mt-3 text-[11px] font-bold text-[var(--c-ink-3)]">
          1990년 이후 프리미엄 상위 {pctRank}% 수준
        </p>
      ) : null}

      <p className="mt-3 text-[9px] font-semibold text-[var(--c-ink-4)]">
        Moody&apos;s AAA·BAA 스프레드 기반 · 주간 · 참고용 · {latest.date}
      </p>
    </div>
  );
}
