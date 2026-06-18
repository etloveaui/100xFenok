"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import {
  asOfDate,
  cleanCategory,
  formatNumber,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  type EtfUniverseRecord,
} from "./etfUniverseUtils";

interface EtfUniverseDoc {
  generated_at?: string | null;
  counts?: {
    records?: number | null;
  } | null;
  records?: EtfUniverseRecord[];
}

interface NewEtfRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
}

interface ScreenerRow {
  s?: string;
  n?: string;
  assetClass?: string;
  aum?: number;
  holdings?: number;
}

interface SurfaceSummary<T> {
  fetched_at?: string | null;
  counts?: {
    records?: number | null;
    rows?: number | null;
  } | null;
  records?: T[];
}

interface EtfSnapshot {
  newEtfs?: SurfaceSummary<NewEtfRow> | null;
  screener?: SurfaceSummary<ScreenerRow> | null;
}

interface EtfGatewayData {
  universe: EtfUniverseDoc | null;
  snapshot: EtfSnapshot | null;
}

let gatewayCache: EtfGatewayData | null = null;
let gatewayPending: Promise<EtfGatewayData> | null = null;

function loadGatewayData(): Promise<EtfGatewayData> {
  if (gatewayCache) return Promise.resolve(gatewayCache);
  if (gatewayPending) return gatewayPending;
  gatewayPending = Promise.all([
    fetch("/data/stockanalysis/etf_universe.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() as Promise<EtfUniverseDoc> : null))
      .catch(() => null),
    fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() as Promise<EtfSnapshot> : null))
      .catch(() => null),
  ]).then(([universe, snapshot]) => {
    gatewayCache = { universe, snapshot };
    return gatewayCache;
  });
  return gatewayPending;
}

function compactMoney(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

function surfaceCount<T>(surface: SurfaceSummary<T> | null | undefined): number | null {
  const value = surface?.counts?.records ?? surface?.counts?.rows;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Array.isArray(surface?.records) ? surface.records.length : null;
}

function EtfMetric({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <TransitionLink href={href} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-brand-interactive hover:bg-white">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-base font-black text-slate-900">{value}</div>
    </TransitionLink>
  );
}

export default function EtfGatewayCard() {
  const [data, setData] = useState<EtfGatewayData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGatewayData().then((payload) => {
      if (!cancelled) {
        setData(payload);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    const sourceRows = Array.isArray(data?.universe?.records) ? data.universe.records : [];
    return sourceRows
      .filter((row) => typeof row.ticker === "string" && row.ticker.trim())
      .map((row) => ({
        ...row,
        ticker: row.ticker!.trim().toUpperCase(),
        category: cleanCategory(row.category),
      }));
  }, [data]);

  const counts = useMemo(() => {
    let leveraged = 0;
    let singleStock = 0;
    let inverse = 0;
    const categories = new Map<string, number>();
    for (const row of rows) {
      if (isLeveragedEtf(row)) leveraged += 1;
      if (isSingleStockLeveragedEtf(row)) singleStock += 1;
      if (isInverseEtf(row)) inverse += 1;
      categories.set(row.category, (categories.get(row.category) ?? 0) + 1);
    }
    const topCategory = [...categories.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    return { leveraged, singleStock, inverse, topCategory };
  }, [rows]);

  const newEtfs = Array.isArray(data?.snapshot?.newEtfs?.records) ? data.snapshot.newEtfs.records : [];
  const largest = Array.isArray(data?.snapshot?.screener?.records) ? data.snapshot.screener.records[0] : null;
  const latestNew = newEtfs[0] ?? null;
  const total = data?.universe?.counts?.records ?? rows.length;
  const newCount = surfaceCount(data?.snapshot?.newEtfs);
  const asOf = asOfDate(data?.universe?.generated_at ?? data?.snapshot?.newEtfs?.fetched_at ?? null);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 관문</h2>
        <span className="desc">{asOf} · {formatNumber(total)}개</span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">ETF 요약 확인 중</div>
            <div className="tk">유니버스·신규·필터 카운트를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : (
        <div className="panel-b space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EtfMetric label="레버리지" value={formatNumber(counts.leveraged)} href="/etfs?type=leveraged" />
            <EtfMetric label="단일종목" value={formatNumber(counts.singleStock)} href="/etfs?type=single-stock" />
            <EtfMetric label="인버스" value={formatNumber(counts.inverse)} href="/etfs?type=inverse" />
            <EtfMetric label="신규 ETF" value={formatNumber(newCount)} href="/etfs" />
          </div>

          <div className="mv-col">
            {counts.topCategory ? (
              <div className="mv-row">
                <span className="co">
                  <div className="n">최대 카테고리</div>
                  <div className="tk">{counts.topCategory[0]}</div>
                </span>
                <span className="pc num neutral">{formatNumber(counts.topCategory[1])}</span>
              </div>
            ) : null}
            {latestNew ? (
              <TransitionLink href={`/etfs/${encodeURIComponent(String(latestNew.s || "").toUpperCase())}`} className="mv-row">
                <span className="co">
                  <div className="n">{latestNew.n || latestNew.s || "신규 ETF"}</div>
                  <div className="tk">{String(latestNew.s || "-").toUpperCase()} · 설정일 {latestNew.inceptionDate || "-"}</div>
                </span>
                <span className={`pc num ${String(latestNew.change ?? "").startsWith("-") ? "down" : "up"}`}>
                  {typeof latestNew.change === "number" ? `${latestNew.change.toFixed(2)}%` : "—"}
                </span>
              </TransitionLink>
            ) : null}
            {largest ? (
              <TransitionLink href={`/etfs/${encodeURIComponent(String(largest.s || "").toUpperCase())}`} className="mv-row">
                <span className="co">
                  <div className="n">{largest.n || largest.s || "AUM 상위 ETF"}</div>
                  <div className="tk">{String(largest.s || "-").toUpperCase()} · {largest.assetClass || "-"} · 보유 {formatNumber(largest.holdings)}</div>
                </span>
                <span className="pc num neutral">{compactMoney(largest.aum)}</span>
              </TransitionLink>
            ) : null}
          </div>
        </div>
      )}

      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>전체 검색·필터·상세 원장은 ETF 탭에서 이어집니다</span>
        <TransitionLink href="/etfs" className="font-black text-brand-interactive hover:underline">
          ETF 전체 보기
        </TransitionLink>
      </div>
    </section>
  );
}
