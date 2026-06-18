"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";

interface SurfaceDoc<T> {
  fetched_at?: string | null;
  counts?: {
    records?: number | null;
    rows?: number | null;
    fields?: number | null;
  } | null;
  records?: T[];
  tables?: Array<{
    records?: T[];
  }>;
}

interface NewEtfRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
}

interface EtfScreenerRow {
  s?: string;
  n?: string;
  assetClass?: string;
  aum?: number;
  price?: number;
  change?: number;
  holdings?: number;
}

interface ProviderRow {
  symbol?: string;
  fund_name?: string;
  assets?: string;
  div_yield?: string;
  exp_ratio?: string;
  change_1y?: string;
}

interface BitcoinEtfRow {
  symbol?: string;
  fund_name?: string;
  assets?: string;
  stock_price?: string;
  pct_change?: string;
}

interface EtfSurfaceData {
  newEtfs: SurfaceDoc<NewEtfRow> | null;
  screener: SurfaceDoc<EtfScreenerRow> | null;
  blackrock: SurfaceDoc<ProviderRow> | null;
  proshares: SurfaceDoc<ProviderRow> | null;
  bitcoin: SurfaceDoc<BitcoinEtfRow> | null;
}

let etfSurfaceCache: EtfSurfaceData | null = null;
let etfSurfacePending: Promise<EtfSurfaceData | null> | null = null;

function loadEtfSurfaceData(): Promise<EtfSurfaceData | null> {
  if (etfSurfaceCache) return Promise.resolve(etfSurfaceCache);
  if (etfSurfacePending) return etfSurfacePending;
  etfSurfacePending = fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<EtfSurfaceData> : null))
    .then((payload) => {
      etfSurfaceCache = payload;
      return payload;
    })
    .catch(() => null);
  return etfSurfacePending;
}

function rows<T>(doc: SurfaceDoc<T> | null | undefined): T[] {
  if (Array.isArray(doc?.records)) return doc.records;
  if (Array.isArray(doc?.tables)) {
    return doc.tables.flatMap((table) => (Array.isArray(table.records) ? table.records : []));
  }
  return [];
}

function fmtNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "-";
}

function fmtAum(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

function countRows<T>(doc: SurfaceDoc<T> | null | undefined): number | null {
  const value = doc?.counts?.records ?? doc?.counts?.rows;
  return typeof value === "number" ? value : rows(doc).length || null;
}

function short(value: string | null | undefined, max = 34): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "-") return "-";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function asOf(...values: Array<string | null | undefined>): string {
  const hit = values.find((value) => typeof value === "string" && value.length >= 10);
  return hit ? hit.slice(0, 10) : "-";
}

function EtfLink({
  ticker,
  name,
  detail,
  value,
}: {
  ticker?: string;
  name?: string;
  detail?: string;
  value?: string;
}) {
  const symbol = String(ticker || "").trim().toUpperCase();
  const body = (
    <>
      <span className="co">
        <div className="n">{short(name || symbol)}</div>
        <div className="tk">{symbol || "-"} · {detail || "-"}</div>
      </span>
      <span className={`pc num ${String(value || "").startsWith("-") ? "down" : "up"}`}>{value || "-"}</span>
    </>
  );
  return symbol ? (
    <TransitionLink href={`/etfs/${encodeURIComponent(symbol)}`} className="mv-row">
      {body}
    </TransitionLink>
  ) : (
    <div className="mv-row">{body}</div>
  );
}

export default function EtfSurfaceSnapshotCard() {
  const [data, setData] = useState<EtfSurfaceData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadEtfSurfaceData().then((payload) => {
      if (!cancelled) {
        setData(payload);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const newEtfs = useMemo(() => rows(data?.newEtfs).slice(0, 5), [data]);
  const largestEtfs = useMemo(() => rows(data?.screener).slice(0, 5), [data]);
  const providerLeaders = useMemo(
    () => [...rows(data?.blackrock).slice(0, 3), ...rows(data?.proshares).slice(0, 3)],
    [data],
  );
  const bitcoinEtfs = useMemo(() => rows(data?.bitcoin).slice(0, 4), [data]);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 표면 데이터</h2>
        <span className="desc">
          {asOf(data?.newEtfs?.fetched_at, data?.screener?.fetched_at)} · {fmtNumber(countRows(data?.screener))}개 스크리너
        </span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">ETF 표면 확인 중</div>
            <div className="tk">신규·운용사·테마 데이터를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : (
        <div className="panel-b grid gap-3 lg:grid-cols-2">
          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">
              신규 ETF · {fmtNumber(countRows(data?.newEtfs))}개
            </div>
            {newEtfs.map((row) => (
              <EtfLink
                key={`new-${row.s}`}
                ticker={row.s}
                name={row.n}
                detail={`설정일 ${row.inceptionDate || "-"} · 가격 ${row.price ?? "-"}`}
                value={typeof row.change === "number" ? `${row.change.toFixed(2)}%` : "-"}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">AUM 상위 ETF</div>
            {largestEtfs.map((row) => (
              <EtfLink
                key={`large-${row.s}`}
                ticker={row.s}
                name={row.n}
                detail={`${row.assetClass || "-"} · 보유 ${fmtNumber(row.holdings)}`}
                value={fmtAum(row.aum)}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">운용사 표면</div>
            {providerLeaders.map((row) => (
              <EtfLink
                key={`provider-${row.symbol}`}
                ticker={row.symbol}
                name={row.fund_name}
                detail={`보수 ${row.exp_ratio || "-"} · 배당 ${row.div_yield || "-"}`}
                value={row.change_1y || row.assets || "-"}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">테마 ETF</div>
            {bitcoinEtfs.map((row) => (
              <EtfLink
                key={`btc-${row.symbol}`}
                ticker={row.symbol}
                name={row.fund_name}
                detail={`가격 ${row.stock_price || "-"} · AUM ${row.assets || "-"}`}
                value={row.pct_change || "-"}
              />
            ))}
          </div>
        </div>
      )}

      <div className="panel-foot">
        <span>ETF 표면 원본은 서버에서 요약되어 전송됩니다</span>
      </div>
    </section>
  );
}
