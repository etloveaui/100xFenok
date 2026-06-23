"use client";

import { useEffect, useMemo, useState } from "react";
import DataStateNotice, { DataStateBadge } from "@/components/DataStateNotice";
import { makeDataState } from "@/lib/data-state";
import {
  loadSummaries,
  pick,
  verdict,
  fmtPct,
  type SummariesDoc,
} from "./MarketThermometer";

/**
 * Shell signal bar — the 3-second read: 4 macro LEDs (computed/signals.json)
 * beside the S&P 500 YTD thermometer headline. Top of /explore.
 */

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

const STATUS_TONE: Record<string, string> = {
  stable: "green",
  normal: "green",
  neutral: "gray",
  caution: "amber",
};

const STATUS_KO: Record<string, string> = {
  stable: "안정",
  normal: "정상",
  neutral: "중립",
  caution: "주의",
};

function tone(status: SignalStatus | undefined): string {
  if (!status) return "gray";
  return STATUS_TONE[status] ?? "gray";
}

function label(status: SignalStatus | undefined): string {
  if (!status) return "—";
  return STATUS_KO[status] ?? status;
}

export default function SignalStrip() {
  const [doc, setDoc] = useState<SignalDoc | null>(null);
  const [bench, setBench] = useState<SummariesDoc | null>(null);
  const [signalsLoaded, setSignalsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSignals().then((d) => {
      if (!cancelled) {
        setDoc(d);
        setSignalsLoaded(true);
      }
    });
    loadSummaries().then((d) => {
      if (!cancelled) setBench(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const headline = useMemo(() => {
    if (!bench) return null;
    const sp = pick(bench, "sp500", "ytd");
    if (sp.px === null) return null;
    const v = verdict(sp);
    return { px: sp.px, head: v.head, why: v.why };
  }, [bench]);

  if (!doc?.signals) {
    return (
      <section className="panel signalbar">
        <DataStateNotice
          state={makeDataState({
            status: signalsLoaded ? "error" : "pending",
            label: signalsLoaded ? "시장 신호 오류" : "시장 신호 확인 중",
            detail: signalsLoaded ? "유동성·뱅킹·센티먼트 신호를 불러오지 못했습니다." : "시장 신호와 벤치마크 요약을 읽고 있습니다.",
          })}
        />
      </section>
    );
  }

  return (
    <section className="panel signalbar">
      <div className="sb-grid">
        <div className="sb-cell">
          <div className="sb-signals">
            {CHIPS.map((c) => {
              const s = doc.signals?.[c.key]?.overallStatus;
              const t = tone(s);
              return (
                <div key={c.key} className="sig">
                  <span className={`led ${t}`} />
                  <span className="nm">{c.label}</span>
                  <span className={`st ${t}`}>{label(s)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {headline ? (
          <div className="sb-cell sb-verdict">
            <div className="vh">시장 체온 · 미국 증시 YTD</div>
            <div className="vm">
              <span className={`big num ${headline.px >= 0 ? "up" : "down"}`}>{fmtPct(headline.px)}</span> —{" "}
              <em>{headline.head}</em>
            </div>
            <div className="vr">{headline.why}</div>
          </div>
        ) : null}
      </div>
      <div className="sb-cap">
        <DataStateBadge
          state={makeDataState({
            status: doc.as_of ? "ready" : "unavailable",
            label: doc.as_of ? "시장 신호 준비됨" : "기준일 없음",
            detail: "유동성·뱅킹·센티먼트 종합 신호",
            asOf: doc.as_of ?? null,
          })}
        />
        <span>유동성·뱅킹·센티먼트 종합 신호</span>
      </div>
    </section>
  );
}
