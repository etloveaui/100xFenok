"use client";

import { useEffect, useState } from "react";

type SignalStatus = "stable" | "normal" | "neutral" | "caution" | string;

interface SignalDoc {
  as_of?: string;
  signals?: Record<string, { overallStatus?: SignalStatus }>;
}

let cache: SignalDoc | null = null;
let pending: Promise<SignalDoc | null> | null = null;
function loadSignals(): Promise<SignalDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/computed/signals.json")
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

const CHIPS: Array<{ key: string; label: string }> = [
  { key: "liquidity_flow", label: "유동성 흐름" },
  { key: "liquidity_stress", label: "유동성 스트레스" },
  { key: "banking_health", label: "뱅킹 건전성" },
  { key: "sentiment_signal", label: "센티먼트" },
];

const STATUS_COLOR: Record<string, string> = {
  stable: "bg-emerald-500",
  normal: "bg-emerald-500",
  neutral: "bg-slate-400",
  caution: "bg-amber-500",
};

const STATUS_KO: Record<string, string> = {
  stable: "안정",
  normal: "정상",
  neutral: "중립",
  caution: "주의",
};

function dotColor(status: SignalStatus | undefined): string {
  if (!status) return "bg-slate-300";
  return STATUS_COLOR[status] ?? "bg-slate-300";
}

function statusLabel(status: SignalStatus | undefined): string {
  if (!status) return "—";
  return STATUS_KO[status] ?? status;
}

export default function SignalStrip() {
  const [doc, setDoc] = useState<SignalDoc | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSignals().then((d) => {
      if (!cancelled) setDoc(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!doc?.signals) return null;

  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CHIPS.map((c) => {
          const s = doc.signals?.[c.key]?.overallStatus;
          return (
            <div
              key={c.key}
              className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
            >
              <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(s)}`} />
              <span className="text-[11px] font-bold leading-tight text-slate-700">{c.label}</span>
              <span className="ml-auto shrink-0 text-[10px] font-black text-slate-500">
                {statusLabel(s)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] font-semibold text-slate-400">
        기준 {doc.as_of ?? "—"} · 유동성·뱅킹·센티먼트 종합 신호
      </p>
    </div>
  );
}
