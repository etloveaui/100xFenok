"use client";

import { useEffect, useMemo, useState } from "react";

interface YardneyRow {
  date: string;
  spx: number;
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
  if (p === null) return { text: "데이터 부족", tone: "text-slate-400" };
  if (p > 15) return { text: `적정가 대비 ${p.toFixed(1)}% 프리미엄 — 고평가 구간`, tone: "text-rose-600" };
  if (p > 5) return { text: `다소 프리미엄 (${p.toFixed(1)}%)`, tone: "text-amber-600" };
  if (p >= -5) return { text: `적정 범위 (${p.toFixed(1)}%)`, tone: "text-slate-600" };
  return { text: `할인 구간 (${p.toFixed(1)}%)`, tone: "text-emerald-600" };
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
const H = 80;
const PAD = 4;

export default function YardeniCard() {
  const [doc, setDoc] = useState<YardneyDoc | null>(null);

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

  const sparkline = useMemo(() => {
    if (!doc?.data?.length) return null;
    const cutoff = "2016-06-01";
    const recent = doc.data
      .filter((r) => r.date >= cutoff && r.premium_pct !== null)
      .filter((_, i) => i % 4 === 0);
    if (recent.length < 2) return null;

    const vals = recent.map((r) => r.premium_pct as number);
    const minV = Math.min(...vals, -10);
    const maxV = Math.max(...vals, 10);
    const range = maxV - minV || 1;
    const scaleX = (i: number) => PAD + (i / (recent.length - 1)) * (W - 2 * PAD);
    const scaleY = (v: number) => H - PAD - ((v - minV) / range) * (H - 2 * PAD);

    const pts = vals.map((v, i) => `${scaleX(i).toFixed(1)},${scaleY(v).toFixed(1)}`);
    const zeroY = scaleY(0);
    const currentIdx = recent.length - 1;
    const currentX = scaleX(currentIdx);
    const currentY = scaleY(vals[currentIdx]);

    return { pts: pts.join(" "), zeroY, currentX, currentY, minV, maxV, currentValue: vals[currentIdx] };
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

  const v = verdict(latest.premium_pct);

  return (
    <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-black tracking-tight text-slate-900">
          야데니 모델 (Bond PER)
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          회사채 금리로 계산한 채권 PER × EPS = 주식 적정가. 국채·회사채 대비
          주식이 비싼지 보는 잣대.
        </p>
      </div>

      <p className={`mt-3 text-xs font-black ${v.tone}`}>{v.text}</p>

      <div className="mt-2 flex items-baseline gap-3 text-[11px] font-bold text-slate-500">
        <span>
          S&P 500{" "}
          <span className="orbitron font-black text-slate-900">
            {latest.spx.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </span>
        <span className="text-slate-300">vs</span>
        <span>
          적정가{" "}
          <span className="orbitron font-black text-slate-900">
            {latest.fair_value.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </span>
        </span>
      </div>

      {sparkline ? (
        <div className="mt-4">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            preserveAspectRatio="none"
            role="img"
            aria-label={`프리미엄 퍼센트 역사적 추이 · 현재 ${sparkline.currentValue.toFixed(1)}% · 범위 ${sparkline.minV.toFixed(1)}%~${sparkline.maxV.toFixed(1)}% · 기준일 ${latest.date}`}
          >
            <line
              x1={PAD}
              y1={sparkline.zeroY}
              x2={W - PAD}
              y2={sparkline.zeroY}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="3,3"
            />
            <polyline
              points={sparkline.pts}
              fill="none"
              stroke="#6366f1"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle
              cx={sparkline.currentX}
              cy={sparkline.currentY}
              r="3.5"
              fill="#6366f1"
              stroke="white"
              strokeWidth="1.5"
            />
          </svg>
          <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-300">
            <span>{sparkline.minV.toFixed(0)}%</span>
            <span>0%</span>
            <span>{sparkline.maxV.toFixed(0)}%</span>
          </div>
          <div className="mt-1 flex justify-between gap-2 text-[10px] font-black tabular-nums text-slate-500">
            <span>현재 {sparkline.currentValue.toFixed(1)}%</span>
            <span className="truncate text-slate-400">기준 {latest.date}</span>
          </div>
        </div>
      ) : null}

      {pctRank !== null ? (
        <p className="mt-3 text-[11px] font-bold text-slate-500">
          1990년 이후 상위 {pctRank}% 수준
        </p>
      ) : null}

      <p className="mt-3 text-[9px] font-semibold text-slate-400">
        Moody&apos;s AAA·BAA 스프레드 기반 · 주간 · 참고용 · {latest.date}
      </p>
    </div>
  );
}
