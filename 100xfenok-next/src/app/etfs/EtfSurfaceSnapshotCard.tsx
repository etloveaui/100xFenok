"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import Tabs, { TabPanel, type TabItem, useTabsBaseId } from "@/components/ui/Tabs";
import EtfRetryCallout from "@/app/etfs/EtfRetryCallout";
import { normalizeForEntityKey } from "@/lib/ticker";

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

interface IssuerCollectionDoc extends SurfaceDoc<ProviderRow> {
  id?: string;
  label?: string;
  surface?: string;
}

interface EtfSurfaceData {
  newEtfs: SurfaceDoc<NewEtfRow> | null;
  screener: EtfScreenerDoc | null;
  issuerCollections?: IssuerCollectionDoc[] | null;
  blackrock: SurfaceDoc<ProviderRow> | null;
  proshares: SurfaceDoc<ProviderRow> | null;
  bitcoin: SurfaceDoc<BitcoinEtfRow> | null;
}

type CollectionKey = string;

interface ProviderCollectionLoadState {
  doc: SurfaceDoc<ProviderRow> | null;
  loading: boolean;
  failed: boolean;
}

interface CollectionEntry {
  id: CollectionKey;
  label: string;
  kind: "issuer" | "bitcoin";
  surface?: string;
  rows: Array<ProviderRow | BitcoinEtfRow>;
  total: number | null;
  fetchedAt?: string | null;
}

const ETF_COLLECTION_TABS_ID = "etf-surface-collections-tabs";
const DEFAULT_COLLECTION_KEY = "issuer:blackrock";
const BITCOIN_COLLECTION_KEY = "bitcoin";

let etfSurfaceCache: EtfSurfaceData | undefined;
let etfSurfacePending: Promise<EtfSurfaceData | null> | null = null;

function loadEtfSurfaceData(): Promise<EtfSurfaceData | null> {
  if (etfSurfaceCache) return Promise.resolve(etfSurfaceCache);
  if (etfSurfacePending) return etfSurfacePending;
  etfSurfacePending = fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
    .then((response) => {
      if (response.ok) return response.json() as Promise<EtfSurfaceData>;
      etfSurfaceCache = undefined;
      return null;
    })
    .then((payload) => {
      if (payload) {
        etfSurfaceCache = payload;
      } else {
        etfSurfaceCache = undefined;
      }
      etfSurfacePending = null;
      return payload;
    })
    .catch(() => {
      etfSurfaceCache = undefined;
      etfSurfacePending = null;
      return null;
    });
  return etfSurfacePending;
}

function clearEtfSurfaceData() {
  etfSurfaceCache = undefined;
  etfSurfacePending = null;
}

function initialProviderCollectionLoads(): Record<CollectionKey, ProviderCollectionLoadState> {
  return {};
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

function shownTotalLabel(shown: number, total: number | null | undefined): string {
  if (typeof total === "number" && Number.isFinite(total)) {
    return `${fmtNumber(total)}개 중 ${fmtNumber(shown)}개 표시`;
  }
  return `${fmtNumber(shown)}개 표시`;
}

function compactShownTotalLabel(shown: number, total: number | null | undefined): string {
  if (typeof total === "number" && Number.isFinite(total)) {
    return `${fmtNumber(shown)}/${fmtNumber(total)}`;
  }
  return fmtNumber(shown);
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
    labels.push(classification.underlying ? `단일종목 레버리지 ${classification.underlying}` : "단일종목 레버리지");
  }
  if (classification.is_inverse) labels.push("인버스");
  return labels.length ? labels.join(" · ") : null;
}

function titleCaseSlug(value: string): string {
  return value
    .replace(/^etf_provider_/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((part) => part ? `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}` : part)
    .join(" ");
}

function issuerLabelFromRows(collection: IssuerCollectionDoc, fallback: string): string {
  const explicit = typeof collection.label === "string" && collection.label.trim() ? collection.label.trim() : "";
  if (explicit) return explicit;
  const sample = rows(collection)
    .map((row) => row.fund_name)
    .find((value) => typeof value === "string" && value.trim());
  const text = String(sample ?? fallback).toLowerCase();
  if (text.includes("ishares") || text.includes("blackrock")) return "iShares";
  if (text.includes("proshares")) return "ProShares";
  if (text.includes("vanguard")) return "Vanguard";
  if (text.includes("state street") || text.includes("spdr")) return "State Street";
  if (text.includes("direxion")) return "Direxion";
  return titleCaseSlug(fallback);
}

function collectionKeyForIssuer(collection: IssuerCollectionDoc, index: number): string {
  const id = typeof collection.id === "string" && collection.id.trim()
    ? collection.id.trim()
    : typeof collection.surface === "string" && collection.surface.trim()
      ? collection.surface.trim().replace(/^etf_provider_/, "")
      : `issuer-${index}`;
  return `issuer:${id}`;
}

function legacyIssuerCollections(data: EtfSurfaceData | null | undefined): IssuerCollectionDoc[] {
  if (Array.isArray(data?.issuerCollections) && data.issuerCollections.length > 0) return data.issuerCollections;
  const collections: IssuerCollectionDoc[] = [];
  if (data?.blackrock) {
    collections.push({ ...data.blackrock, id: "blackrock", label: "iShares", surface: "etf_provider_blackrock" });
  }
  if (data?.proshares) {
    collections.push({ ...data.proshares, id: "proshares", label: "ProShares", surface: "etf_provider_proshares" });
  }
  return collections;
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
  const symbol = normalizeForEntityKey(ticker);
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
  const [reloadKey, setReloadKey] = useState(0);
  const [loadState, setLoadState] = useState<{
    reloadKey: number;
    data: EtfSurfaceData | null;
    loaded: boolean;
    failed: boolean;
  }>({ reloadKey: 0, data: null, loaded: false, failed: false });
  const [collectionKey, setCollectionKey] = useState<CollectionKey>(DEFAULT_COLLECTION_KEY);
  const [providerCollectionLoads, setProviderCollectionLoads] = useState(initialProviderCollectionLoads);
  const collectionTabsId = useTabsBaseId(ETF_COLLECTION_TABS_ID);

  useEffect(() => {
    let cancelled = false;
    loadEtfSurfaceData().then((payload) => {
      if (!cancelled) {
        setLoadState({ reloadKey, data: payload, loaded: true, failed: !payload });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retryLoad = () => {
    clearEtfSurfaceData();
    setProviderCollectionLoads(initialProviderCollectionLoads());
    setReloadKey((value) => value + 1);
  };

  const loadProviderCollection = (collection: CollectionEntry) => {
    if (collection.kind !== "issuer" || !collection.surface) return;
    const current = providerCollectionLoads[collection.id] ?? { doc: null, loading: false, failed: false };
    if (current.loading || current.doc) return;
    setProviderCollectionLoads((prev) => ({
      ...prev,
      [collection.id]: { ...current, loading: true, failed: false },
    }));
    fetch(`/api/data/stockanalysis/surfaces/${encodeURIComponent(collection.surface)}/`, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`surface ${collection.surface} failed`);
        return response.json() as Promise<SurfaceDoc<ProviderRow>>;
      })
      .then((doc) => {
        setProviderCollectionLoads((prev) => ({
          ...prev,
          [collection.id]: { doc, loading: false, failed: false },
        }));
      })
      .catch(() => {
        setProviderCollectionLoads((prev) => ({
          ...prev,
          [collection.id]: { ...current, loading: false, failed: true },
        }));
      });
  };

  const isCurrentLoad = loadState.reloadKey === reloadKey;
  const data = isCurrentLoad ? loadState.data : null;
  const loaded = isCurrentLoad ? loadState.loaded : false;
  const loadFailed = isCurrentLoad ? loadState.failed : false;
  const newEtfs = useMemo(() => rows(data?.newEtfs).slice(0, 5), [data]);
  const largestEtfs = useMemo(() => rows(data?.screener).slice(0, 5), [data]);
  const volumeLeaders = useMemo(() => (data?.screener?.volumeLeaders ?? []).slice(0, 5), [data]);
  const changeLeaders = useMemo(() => (data?.screener?.changeLeaders ?? []).slice(0, 5), [data]);
  const issuerCollections = useMemo(() => legacyIssuerCollections(data), [data]);
  const providerLeaders = useMemo(
    () => issuerCollections.flatMap((collection) => rows(collection).slice(0, 3)),
    [issuerCollections],
  );
  const providerShown = providerLeaders.length;
  const providerTotal = issuerCollections.reduce((sum, collection) => sum + (countRows(collection) ?? 0), 0);
  const providerHeader = issuerCollections
    .map((collection, index) => issuerLabelFromRows(collection, collection.id ?? collection.surface ?? `issuer-${index}`))
    .slice(0, 2)
    .join(" · ");
  const bitcoinEtfs = useMemo(() => rows(data?.bitcoin).slice(0, 4), [data]);
  const collections = useMemo<CollectionEntry[]>(() => {
    const issuerEntries: CollectionEntry[] = issuerCollections.map((collection, index) => {
      const id = collectionKeyForIssuer(collection, index);
      const loadedDoc = providerCollectionLoads[id]?.doc ?? null;
      const doc = loadedDoc ?? collection;
      return {
        id,
        label: issuerLabelFromRows(collection, collection.id ?? collection.surface ?? `issuer-${index}`),
        kind: "issuer",
        surface: collection.surface,
        rows: rows(doc),
        total: countRows(doc),
        fetchedAt: doc.fetched_at,
      };
    });
    return [
      ...issuerEntries,
      {
        id: BITCOIN_COLLECTION_KEY,
        label: "디지털자산",
        kind: "bitcoin",
        rows: rows(data?.bitcoin),
        total: countRows(data?.bitcoin),
        fetchedAt: data?.bitcoin?.fetched_at,
      },
    ];
  }, [data, issuerCollections, providerCollectionLoads]);
  const activeCollection = collections.find((collection) => collection.id === collectionKey) ?? collections[0];
  const effectiveCollectionKey = activeCollection?.id ?? collectionKey;
  const collectionTabs: Array<TabItem<CollectionKey> & { total: number | null; shown: number }> = collections.map((collection) => ({
    id: collection.id,
    label: collection.label,
    shown: collection.rows.length,
    total: collection.total,
  }));
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
      ) : loadFailed ? (
        <div className="panel-b">
          <EtfRetryCallout
            title="ETF 요약을 불러오지 못했습니다"
            desc="신규 상장·운용자산·테마 목록 연결에 실패했습니다. 다시 시도하면 최신 요약 데이터를 새로 요청합니다."
            onRetry={retryLoad}
          />
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
            <div className="flex items-center justify-between gap-2 text-[11px] font-black uppercase tracking-wide text-[var(--c-ink-3)]">
              <span>{providerHeader || "운용사"} ETF</span>
              <span className="text-[10px] font-bold normal-case tracking-normal">{shownTotalLabel(providerShown, providerTotal || null)}</span>
            </div>
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
                  {activeCollection?.label ?? "ETF"} · {shownTotalLabel(activeCollection?.rows.length ?? 0, activeCollection?.total)}
                </div>
              </div>
              <Tabs
                idBase={collectionTabsId}
                items={collectionTabs}
                value={effectiveCollectionKey}
                onValueChange={setCollectionKey}
                ariaLabel="ETF 모음 분류"
                className="flex flex-wrap gap-1.5"
                getTabClassName={(_, selected) => `min-h-8 rounded-full border px-3 text-[11px] font-black transition ${
                  selected
                    ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
                    : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
                }`}
                renderLabel={(item) => <>{item.label} {compactShownTotalLabel(item.shown, item.total)}</>}
              />
            </div>
            {collectionTabs.map((item) => {
              const collection = collections.find((candidate) => candidate.id === item.id);
              if (!collection) return null;
              const providerLoad = collection.kind === "issuer"
                ? providerCollectionLoads[item.id] ?? { doc: null, loading: false, failed: false }
                : null;
              const hasMoreRows = Boolean(
                providerLoad
                  && typeof collection.total === "number"
                  && collection.total > collection.rows.length,
              );
              return (
                <TabPanel key={item.id} idBase={collectionTabsId} item={item} active={effectiveCollectionKey === item.id}>
                  {collection.rows.map((row) => {
                    if (item.id === "bitcoin") {
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
                  {providerLoad ? (
                    <div className="flex flex-wrap items-center gap-2 px-[var(--panel-pad)] py-2">
                      {hasMoreRows && !providerLoad.failed ? (
                        <button
                          type="button"
                          onClick={() => loadProviderCollection(collection)}
                          disabled={providerLoad.loading}
                          className="inline-flex min-h-8 items-center rounded-full border border-[var(--c-line)] bg-white px-3 text-[11px] font-black text-[var(--c-brand)] transition hover:border-[var(--c-brand)] disabled:cursor-wait disabled:opacity-60"
                        >
                          {providerLoad.loading
                            ? "전체 목록 불러오는 중"
                            : `전체 목록 불러오기 · ${fmtNumber(collection.rows.length)} / ${fmtNumber(collection.total)}`}
                        </button>
                      ) : providerLoad.doc ? (
                        <span className="text-[10px] font-bold text-[var(--c-ink-3)]">전체 목록 표시 중</span>
                      ) : null}
                      {providerLoad.failed ? (
                        <button
                          type="button"
                          onClick={() => loadProviderCollection(collection)}
                          className="inline-flex min-h-8 items-center rounded-full border border-red-200 bg-red-50 px-3 text-[11px] font-black text-red-700 transition hover:border-red-300"
                        >
                          전체 목록 다시 불러오기
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="px-[var(--panel-pad)] py-2 text-[10px] font-bold text-[var(--c-ink-3)]">
                    기준일 {asOf(collection.fetchedAt)}
                  </div>
                </TabPanel>
              );
            })}
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
