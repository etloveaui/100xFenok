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

const STATUS_LED: Record<string, string> = {
  stable: "led-green",
  normal: "led-green",
  neutral: "led-gray",
  caution: "led-amber",
};

const STATUS_ST: Record<string, string> = {
  stable: "st-green",
  normal: "st-green",
  neutral: "st-gray",
  caution: "st-amber",
};

const STATUS_KO: Record<string, string> = {
  stable: "안정",
  normal: "정상",
  neutral: "중립",
  caution: "주의",
};

function ledClass(status: SignalStatus | undefined): string {
  if (!status) return "led-gray";
  return STATUS_LED[status] ?? "led-gray";
}

function stClass(status: SignalStatus | undefined): string {
  if (!status) return "st-gray";
  return STATUS_ST[status] ?? "st-gray";
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
    <div className="c-card">
      <div className="sig-grid">
        {CHIPS.map((c) => {
          const s = doc.signals?.[c.key]?.overallStatus;
          return (
            <div key={c.key} className="sig">
              <span className={`led ${ledClass(s)}`} />
              <span className="tx">
                <span className="nm">{c.label}</span>
                <span className={`st ${stClass(s)}`}>{statusLabel(s)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="sig-cap">
        기준 <span className="num">{doc.as_of ?? "—"}</span> · 유동성·뱅킹·센티먼트 종합 신호
      </p>
    </div>
  );
}
