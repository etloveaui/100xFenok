"use client";

import { useEffect, useMemo, useState } from "react";
import DataStateNotice from "@/components/DataStateNotice";
import { formatSignedPercent } from "@/lib/format";
import { makeDataState } from "@/lib/data-state";

type Period = "1w" | "1m" | "3m" | "6m" | "ytd" | "1y";

interface MomentumRow {
  px: number | null;
  eps: number | null;
  per: number | null;
  asOf?: string | null;
}

type SummariesDoc = {
  source_summaries?: Record<
    string,
    {
      momentum?: Record<string, Record<string, number | null>>;
      yearly_returns?: Record<string, Record<string, number | null>>;
    }
  >;
};

export type { SummariesDoc, MomentumRow };

let cache: SummariesDoc | null = null;
let pending: Promise<SummariesDoc | null> | null = null;

export function loadSummaries(): Promise<SummariesDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/benchmarks/summaries.json")
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
  { id: "6m", label: "6개월" },
  { id: "3m", label: "3개월" },
  { id: "1m", label: "1개월" },
  { id: "1w", label: "1주" },
  { id: "1y", label: "연간" },
];

export function pick(doc: SummariesDoc, section: string, period: Period): MomentumRow {
  const summary = doc.source_summaries?.[section];
  const m = summary?.momentum;
  const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
  if (period === "1y") {
    const yearly = summary?.yearly_returns;
    const years = Object.keys(yearly?.px_last ?? {})
      .filter((year) => Number.isFinite(Number(year)))
      .sort((a, b) => Number(b) - Number(a));
    const latestYear = years[0] ?? null;
    return {
      px: latestYear ? n(yearly?.px_last?.[latestYear]) : null,
      eps: latestYear ? n(yearly?.best_eps?.[latestYear]) : null,
      per: latestYear ? n(yearly?.best_pe_ratio?.[latestYear]) : null,
      asOf: latestYear,
    };
  }
  return {
    px: n(m?.px_last?.[period]),
    eps: n(m?.best_eps?.[period]),
    per: n(m?.best_pe_ratio?.[period]),
    asOf: null,
  };
}

export function fmtPct(v: number | null): string {
  return formatSignedPercent(v, { digits: 1 });
}

export type Verdict = { head: string; why: string; tone: "good" | "mix" | "bad" };

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

function DTrack({ value, cap, kind }: { value: number | null; cap: number; kind: "eps" | "per" }) {
  const name = kind === "eps" ? "이익" : "멀티플";
  const capText = `${(cap * 100).toFixed(0)}%`;
  if (value === null) return <div className="db-track" role="img" aria-label={`${name} 기여 데이터 부족 · 표시 범위 ±${capText}`} />;
  const w = Math.max((Math.min(Math.abs(value), cap) / cap) * 50, 3);
  const capped = Math.abs(value) > cap;
  const label = `${name} 기여 ${fmtPct(value)}${capped ? " · 표시 한도 초과" : ""} · 표시 범위 -${capText}~+${capText}`;
  return (
    <div className="db-track" role="img" aria-label={label} title={label}>
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
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSummaries().then((d) => {
      if (!cancelled) {
        setDoc(d);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (!doc) return null;
    return SECTIONS.map((s) => ({ ...s, row: pick(doc, s.key, period) }))
      .filter((r) => r.row.px !== null);
  }, [doc, period]);
  const activeYear = period === "1y" ? rows?.find((r) => r.row.asOf)?.row.asOf ?? null : null;
  const periodLabel = (p: { id: Period; label: string }) => (p.id === "1y" && activeYear ? `${activeYear}년` : p.label);
  const activePeriodLabel = period === "1y" && activeYear
    ? `${activeYear}년 수익률`
    : PERIODS.find((p) => p.id === period)?.label ?? "YTD";

  if (!rows || rows.length === 0) {
    return (
      <section className="panel thermo">
        <div className="panel-h">
          <h2>시장 체온계</h2>
          <span className="desc">이익 × 멀티플 분해</span>
        </div>
        <div className="panel-b">
          <DataStateNotice
            state={makeDataState({
              status: loaded ? "error" : "pending",
              label: loaded ? "시장 체온계 오류" : "시장 체온계 확인 중",
              detail: loaded ? "이익과 멀티플 분해 데이터를 불러오지 못했습니다." : "벤치마크 수익률과 이익 데이터를 읽고 있습니다.",
            })}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="panel thermo">
      <div className="panel-h">
        <h2>시장 체온계</h2>
        <span className="desc">이익 × 멀티플 분해</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          {PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={period === p.id ? "on" : ""} aria-pressed={period === p.id}>
              {periodLabel(p)}
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
      <div className="panel-foot">
        Bloomberg 주간 집계 기준 · {activePeriodLabel} · 막대 중앙선 오른쪽 = 플러스 기여 · 이익 ±100%, 멀티플 ±22% 표시
      </div>
    </section>
  );
}
