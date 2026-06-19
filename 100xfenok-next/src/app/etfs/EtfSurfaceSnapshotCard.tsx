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

interface EtfScreenerDoc extends SurfaceDoc<EtfScreenerRow> {
  volumeLeaders?: EtfScreenerRow[];
  changeLeaders?: EtfScreenerRow[];
}

interface NewEtfRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
  classification?: EtfClassification;
}

interface EtfClassification {
  is_leveraged?: boolean;
  leverage_factor?: number | null;
  is_inverse?: boolean;
  is_single_stock?: boolean;
  underlying?: string | null;
}

interface EtfScreenerRow {
  s?: string;
  n?: string;
  assetClass?: string;
  aum?: number;
  price?: number;
  change?: number;
  volume?: number;
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
  screener: EtfScreenerDoc | null;
  blackrock: SurfaceDoc<ProviderRow> | null;
  proshares: SurfaceDoc<ProviderRow> | null;
  bitcoin: SurfaceDoc<BitcoinEtfRow> | null;
}

type CollectionKey = "largeProvider" | "strategy" | "bitcoin";

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
    .catch(() => {
      etfSurfacePending = null;
      return null;
    });
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

function countLabel(value: number | null | undefined, fallback = "전체"): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString("ko-KR")}개` : fallback;
}

function fmtAum(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value.toLocaleString("en-US");
}

function fmtPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(value >= 100 ? 0 : 2)}` : "-";
}

function fmtSignedPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function fmtVolume(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("ko-KR");
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

function providerDetail(row: ProviderRow): string {
  return `보수 ${row.exp_ratio || "-"} · 배당 ${row.div_yield || "-"} · 1년 ${row.change_1y || "-"}`;
}

function bitcoinDetail(row: BitcoinEtfRow): string {
  return `가격 ${row.stock_price || "-"} · 운용자산 ${row.assets || "-"}`;
}

function classificationDetail(row: NewEtfRow): string | null {
  const classification = row.classification;
  if (!classification) return null;
  const labels: string[] = [];
  if (classification.is_leveraged) {
    const factor = classification.leverage_factor;
    labels.push(typeof factor === "number" && Number.isFinite(factor) ? `${factor}x` : "레버리지");
  }
  if (classification.is_single_stock) {
    labels.push(classification.underlying ? `단일종목 ${classification.underlying}` : "단일종목");
  }
  if (classification.is_inverse) labels.push("인버스");
  return labels.length ? labels.join(" · ") : null;
}

function collectionLabel(key: CollectionKey): string {
  if (key === "largeProvider") return "대형 운용사";
  if (key === "strategy") return "레버리지·전략";
  return "디지털자산";
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
  const [collectionKey, setCollectionKey] = useState<CollectionKey>("largeProvider");

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
  const volumeLeaders = useMemo(() => (data?.screener?.volumeLeaders ?? []).slice(0, 5), [data]);
  const changeLeaders = useMemo(() => (data?.screener?.changeLeaders ?? []).slice(0, 5), [data]);
  const providerLeaders = useMemo(
    () => [...rows(data?.blackrock).slice(0, 3), ...rows(data?.proshares).slice(0, 3)],
    [data],
  );
  const bitcoinEtfs = useMemo(() => rows(data?.bitcoin).slice(0, 4), [data]);
  const collections = useMemo(
    () => ({
      largeProvider: {
        rows: rows(data?.blackrock),
        total: countRows(data?.blackrock),
        fetchedAt: data?.blackrock?.fetched_at,
      },
      strategy: {
        rows: rows(data?.proshares),
        total: countRows(data?.proshares),
        fetchedAt: data?.proshares?.fetched_at,
      },
      bitcoin: {
        rows: rows(data?.bitcoin),
        total: countRows(data?.bitcoin),
        fetchedAt: data?.bitcoin?.fetched_at,
      },
    }),
    [data],
  );
  const activeCollection = collections[collectionKey];
  const newEtfCount = countRows(data?.newEtfs);

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>ETF 한눈에 보기</h2>
        <span className="desc">
          {asOf(data?.newEtfs?.fetched_at, data?.screener?.fetched_at)} · {fmtNumber(countRows(data?.screener))}개 ETF
        </span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">ETF 현황 확인 중</div>
            <div className="tk">신규 상장·운용자산·테마 목록을 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : (
        <div className="panel-b grid gap-3 lg:grid-cols-2">
          <div className="mv-col">
            <div className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">
              <span>신규 상장 ETF · {fmtNumber(countRows(data?.newEtfs))}개</span>
              <TransitionLink href="/etfs/new" className="text-[var(--c-brand)] hover:text-[var(--c-ink)]">
                {countLabel(newEtfCount)} 전체 보기
              </TransitionLink>
            </div>
            {newEtfs.map((row) => {
              const classHint = classificationDetail(row);
              return (
                <EtfLink
                  key={`new-${row.s}`}
                  ticker={row.s}
                  name={row.n}
                  detail={`${classHint ? `${classHint} · ` : ""}상장일 ${row.inceptionDate || "-"} · 가격 ${row.price ?? "-"}`}
                  value={typeof row.change === "number" ? `${row.change.toFixed(2)}%` : "-"}
                />
              );
            })}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">운용자산 상위 ETF</div>
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
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">거래량 상위 ETF</div>
            {volumeLeaders.map((row) => (
              <EtfLink
                key={`volume-${row.s}`}
                ticker={row.s}
                name={row.n}
                detail={`${row.assetClass || "-"} · 가격 ${fmtPrice(row.price)} · 보유 ${fmtNumber(row.holdings)}`}
                value={fmtVolume(row.volume)}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">변동률 큰 ETF</div>
            {changeLeaders.map((row) => (
              <EtfLink
                key={`change-${row.s}`}
                ticker={row.s}
                name={row.n}
                detail={`${row.assetClass || "-"} · 가격 ${fmtPrice(row.price)} · 거래량 ${fmtVolume(row.volume)}`}
                value={fmtSignedPct(row.change)}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">대형 운용사 ETF</div>
            {providerLeaders.map((row) => (
              <EtfLink
                key={`provider-${row.symbol}`}
                ticker={row.symbol}
                name={row.fund_name}
                detail={providerDetail(row)}
                value={row.assets || "-"}
              />
            ))}
          </div>

          <div className="mv-col">
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">비트코인 ETF</div>
            {bitcoinEtfs.map((row) => (
              <EtfLink
                key={`btc-${row.symbol}`}
                ticker={row.symbol}
                name={row.fund_name}
                detail={bitcoinDetail(row)}
                value={row.pct_change || "-"}
              />
            ))}
          </div>

          <div className="mv-col lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-line)] px-[var(--panel-pad)] pb-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">ETF 모음</div>
                <div className="mt-1 text-xs font-semibold text-[var(--c-ink-3)]">
                  {collectionLabel(collectionKey)} · {fmtNumber(activeCollection.total)}개 중 {fmtNumber(activeCollection.rows.length)}개 표시
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["largeProvider", "strategy", "bitcoin"] as CollectionKey[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={collectionKey === key}
                    onClick={() => setCollectionKey(key)}
                    className={`min-h-8 rounded-full border px-3 text-[11px] font-black transition ${
                      collectionKey === key
                        ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
                        : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
                    }`}
                  >
                    {collectionLabel(key)} {fmtNumber(collections[key].total)}
                  </button>
                ))}
              </div>
            </div>
            {activeCollection.rows.map((row) => {
              if (collectionKey === "bitcoin") {
                const bitcoinRow = row as BitcoinEtfRow;
                return (
                  <EtfLink
                    key={`collection-btc-${bitcoinRow.symbol}`}
                    ticker={bitcoinRow.symbol}
                    name={bitcoinRow.fund_name}
                    detail={bitcoinDetail(bitcoinRow)}
                    value={bitcoinRow.pct_change || "-"}
                  />
                );
              }
              const providerRow = row as ProviderRow;
              return (
                <EtfLink
                  key={`collection-provider-${providerRow.symbol}`}
                  ticker={providerRow.symbol}
                  name={providerRow.fund_name}
                  detail={providerDetail(providerRow)}
                  value={providerRow.assets || "-"}
                />
              );
            })}
            <div className="px-[var(--panel-pad)] py-2 text-[10px] font-bold text-[var(--c-ink-3)]">
              기준일 {asOf(activeCollection.fetchedAt)}
            </div>
          </div>
        </div>
      )}

      <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
        <span>기준일 {asOf(data?.screener?.fetched_at, data?.newEtfs?.fetched_at)}</span>
        <TransitionLink href="/etfs/new" className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[11px] font-black text-[var(--c-brand)] transition hover:border-[var(--c-brand)]">
          신규 상장 {countLabel(newEtfCount)} 보기
        </TransitionLink>
      </div>
    </section>
  );
}
