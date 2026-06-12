"use client";

import { useEffect, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { formatSignedPercentDecimal } from "@/lib/dashboard/formatters";

type DiscoveryTab = "movers" | "returns" | "dividends";

interface DiscoveryRow {
  symbol: string;
  company: string;
  sector: string | null;
  price?: number | null;
  change?: number | null;
  changePercent?: number | null;
  value?: number | null;
}

interface MoverSide {
  date: string | null;
  count: number;
  historyCount: number;
  rows: DiscoveryRow[];
}

interface DiscoveryDoc {
  generated_at?: string;
  movers?: {
    gainers?: MoverSide;
    losers?: MoverSide;
  };
  returns?: {
    best1y?: DiscoveryRow[];
    worst1y?: DiscoveryRow[];
    best3y?: DiscoveryRow[];
  };
  dividends?: {
    highYield?: DiscoveryRow[];
    highTtm?: DiscoveryRow[];
  };
  universe?: {
    uniqueCount?: number;
  };
}

let cache: DiscoveryDoc | null = null;
let pending: Promise<DiscoveryDoc | null> | null = null;

function loadDiscovery(): Promise<DiscoveryDoc | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/data/slickcharts/discovery-summary.json")
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmtMove(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
}

function fmtFraction(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatSignedPercentDecimal(value, 1) : "—";
}

function fmtDividendYield(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function fmtDollars(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `$${value.toFixed(2)}` : "—";
}

function RowList({
  rows,
  tone,
  formatValue,
}: {
  rows: DiscoveryRow[];
  tone: "up" | "down";
  formatValue: (value: number | null | undefined) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="mv-col">
      {rows.slice(0, 5).map((row) => (
        <TransitionLink key={row.symbol} href={`/stock/${encodeURIComponent(row.symbol)}`} className="mv-row">
          <span className="co">
            <div className="n">{row.company || row.symbol}</div>
            <div className="tk">{row.symbol}{row.sector ? ` · ${row.sector}` : ""}</div>
          </span>
          <span className={`pc num ${tone}`}>{formatValue(row.value ?? row.changePercent)}</span>
        </TransitionLink>
      ))}
    </div>
  );
}

function SectionTitle({ tone, children }: { tone: "up" | "down"; children: React.ReactNode }) {
  return <div className={`mv-h ${tone}`}>{children}</div>;
}

export default function SlickchartsDiscoveryCard() {
  const [doc, setDoc] = useState<DiscoveryDoc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<DiscoveryTab>("movers");

  useEffect(() => {
    let cancelled = false;
    loadDiscovery().then((d) => {
      if (!cancelled) {
        setDoc(d);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const gainers = doc?.movers?.gainers?.rows ?? [];
  const losers = doc?.movers?.losers?.rows ?? [];
  const best1y = doc?.returns?.best1y ?? [];
  const worst1y = doc?.returns?.worst1y ?? [];
  const highYield = doc?.dividends?.highYield ?? [];
  const highTtm = doc?.dividends?.highTtm ?? [];
  const asOf = doc?.movers?.gainers?.date ?? doc?.generated_at?.slice(0, 10) ?? null;

  if (!doc) {
    return (
      <section className="panel">
        <div className="panel-h">
          <h2>수익률 리더보드</h2>
          <span className="desc">가격·수익률·배당</span>
        </div>
        <div className="panel-b text-sm font-semibold text-slate-500">
          {loaded ? "수익률 리더보드 데이터를 불러오지 못했습니다." : "수익률 리더보드 확인 중"}
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>수익률 리더보드</h2>
        <span className="desc">{asOf ?? "—"} · {doc.universe?.uniqueCount ?? "—"}개 유니버스</span>
        <div className="seg" style={{ marginLeft: "auto" }}>
          {[
            ["movers", "무버"],
            ["returns", "수익률"],
            ["dividends", "배당"],
          ].map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? "on" : ""} onClick={() => setTab(key as DiscoveryTab)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "movers" ? (
        <div className="mv-split">
          <div>
            <SectionTitle tone="up">▲ 상승률 TOP</SectionTitle>
            <RowList rows={gainers} tone="up" formatValue={fmtMove} />
          </div>
          <div>
            <SectionTitle tone="down">▼ 하락률 TOP</SectionTitle>
            <RowList rows={losers} tone="down" formatValue={fmtMove} />
          </div>
        </div>
      ) : null}

      {tab === "returns" ? (
        <div className="mv-split">
          <div>
            <SectionTitle tone="up">▲ 1Y 수익률 TOP</SectionTitle>
            <RowList rows={best1y} tone="up" formatValue={fmtFraction} />
          </div>
          <div>
            <SectionTitle tone="down">▼ 1Y 수익률 하위</SectionTitle>
            <RowList rows={worst1y} tone="down" formatValue={fmtFraction} />
          </div>
        </div>
      ) : null}

      {tab === "dividends" ? (
        <div className="mv-split">
          <div>
            <SectionTitle tone="up">배당률 TOP</SectionTitle>
            <RowList rows={highYield} tone="up" formatValue={fmtDividendYield} />
          </div>
          <div>
            <SectionTitle tone="up">DPS TTM TOP</SectionTitle>
            <RowList rows={highTtm} tone="up" formatValue={fmtDollars} />
          </div>
        </div>
      ) : null}

      <div className="panel-foot">원본 gainers/losers 히스토리는 약 5.7MB라 summary index만 로드합니다 · 데이터: SlickCharts</div>
    </section>
  );
}
