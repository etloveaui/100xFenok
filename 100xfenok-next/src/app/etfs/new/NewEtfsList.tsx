"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import {
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  issuerNameFromEtfName,
  type EtfClassification,
  type EtfTypeFilter,
  type EtfUniverseRecord,
} from "../../explore/etfUniverseUtils";

interface NewEtfRow {
  s?: string;
  n?: string;
  inceptionDate?: string;
  price?: number;
  change?: number;
  classification?: EtfClassification;
}

interface EtfSnapshotPayload {
  newEtfs?: {
    fetched_at?: string | null;
    counts?: {
      records?: number | null;
      rows?: number | null;
    } | null;
    records?: NewEtfRow[];
  } | null;
}

interface EtfCoveragePayload {
  missing_tickers?: string[];
  yahoo_fallback_tickers?: string[];
}

interface NewEtfsState {
  snapshot: EtfSnapshotPayload | null;
  coverage: EtfCoveragePayload | null;
}

type DateFilter = "전체" | "7일" | "14일" | "30일";
type NewEtfSort = "date" | "ticker" | "change" | "price";

interface RadarRow extends Required<Pick<NewEtfRow, "s" | "n">> {
  inceptionDate?: string;
  price?: number;
  change?: number;
  classification?: EtfClassification;
  detailStatus: "full" | "partial" | "pending";
  issuer: string;
  typeTags: string[];
}

interface NewEtfsListProps {
  initialQuery?: string;
  initialType?: string;
  initialDays?: string;
  initialIssuer?: string;
  initialSort?: string;
}

let cache: EtfSnapshotPayload | null = null;
let pending: Promise<EtfSnapshotPayload | null> | null = null;
let coverageCache: EtfCoveragePayload | null = null;
let coveragePending: Promise<EtfCoveragePayload | null> | null = null;

function loadSnapshot(): Promise<EtfSnapshotPayload | null> {
  if (cache) return Promise.resolve(cache);
  if (pending) return pending;
  pending = fetch("/api/data/stockanalysis/etf-snapshot", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<EtfSnapshotPayload> : null))
    .then((payload) => {
      if (payload) {
        cache = payload;
      }
      pending = null;
      return payload;
    })
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

function loadCoverage(): Promise<EtfCoveragePayload | null> {
  if (coverageCache) return Promise.resolve(coverageCache);
  if (coveragePending) return coveragePending;
  coveragePending = fetch("/data/stockanalysis/coverage/etf_detail.json", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() as Promise<EtfCoveragePayload> : null))
    .then((payload) => {
      if (payload) {
        coverageCache = payload;
      }
      coveragePending = null;
      return payload;
    })
    .catch(() => {
      coveragePending = null;
      return null;
    });
  return coveragePending;
}

function fmtDate(value: string | null | undefined): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "-";
}

function fmtPrice(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(2)}` : "-";
}

function fmtChange(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function countRows(payload: EtfSnapshotPayload | null): number {
  const value = payload?.newEtfs?.counts?.records ?? payload?.newEtfs?.counts?.rows;
  if (typeof value === "number") return value;
  return payload?.newEtfs?.records?.length ?? 0;
}

function detailStatus(ticker: string, coverage: EtfCoveragePayload | null): "full" | "partial" | "pending" {
  const symbol = ticker.trim().toUpperCase();
  const missing = new Set((coverage?.missing_tickers ?? []).map((item) => item.trim().toUpperCase()));
  if (missing.has(symbol)) return "pending";
  const fallback = new Set((coverage?.yahoo_fallback_tickers ?? []).map((item) => item.trim().toUpperCase()));
  if (fallback.has(symbol)) return "partial";
  return "full";
}

function detailStatusLabel(status: "full" | "partial" | "pending"): string {
  if (status === "pending") return "요약 제공";
  if (status === "partial") return "가격 제공";
  return "상세 가능";
}

function detailStatusHint(status: "full" | "partial" | "pending"): string {
  if (status === "pending") return "요약 정보 제공";
  if (status === "partial") return "가격 정보 제공";
  return "상세 화면 준비됨";
}

function typeFromParam(value: string | null | undefined): EtfTypeFilter {
  if (value === "leveraged") return "레버리지";
  if (value === "single-stock") return "단일종목 레버리지";
  if (value === "inverse") return "인버스";
  return "전체";
}

function dateFromParam(value: string | null | undefined): DateFilter {
  if (value === "7" || value === "14" || value === "30") return `${value}일` as DateFilter;
  return "전체";
}

function sortFromParam(value: string | null | undefined): NewEtfSort {
  if (value === "ticker" || value === "change" || value === "price") return value;
  return "date";
}

function toUniverseRecord(row: Pick<RadarRow, "s" | "n" | "inceptionDate" | "price" | "change" | "classification">): EtfUniverseRecord {
  return {
    ticker: row.s,
    name: row.n,
    category: "신규 상장",
    inceptionDate: row.inceptionDate,
    price: row.price,
    change: row.change,
    classification: row.classification,
    is_new: true,
  };
}

function typeTags(row: Pick<RadarRow, "s" | "n" | "inceptionDate" | "price" | "change" | "classification">): string[] {
  const record = toUniverseRecord(row);
  const tags: string[] = [];
  if (isLeveragedEtf(record)) tags.push("레버리지");
  if (isSingleStockLeveragedEtf(record)) tags.push("단일종목");
  if (isInverseEtf(record)) tags.push("인버스");
  return tags.length > 0 ? tags : ["일반"];
}

function dateValue(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function changeClass(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows: RadarRow[]) {
  const cappedRows = rows.slice(0, 500);
  const headers = ["티커", "ETF명", "상장일", "가격", "변동률", "분류", "운용사", "상세 상태"];
  const lines = [
    headers.map(csvCell).join(","),
    ...cappedRows.map((row) => [
      row.s,
      row.n,
      fmtDate(row.inceptionDate),
      typeof row.price === "number" ? row.price.toFixed(2) : "",
      typeof row.change === "number" ? `${row.change.toFixed(2)}%` : "",
      row.typeTags.join(" / "),
      row.issuer,
      detailStatusLabel(row.detailStatus),
    ].map(csvCell).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `100x-new-etfs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function NewEtfsList({
  initialQuery,
  initialType,
  initialDays,
  initialIssuer,
  initialSort,
}: NewEtfsListProps) {
  const normalizedInitialQuery = (initialQuery ?? "").trim();
  const [state, setState] = useState<NewEtfsState>({ snapshot: null, coverage: null });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState(normalizedInitialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedInitialQuery);
  const [typeFilter, setTypeFilter] = useState<EtfTypeFilter>(typeFromParam(initialType));
  const [dateFilter, setDateFilter] = useState<DateFilter>(dateFromParam(initialDays));
  const [issuerFilter, setIssuerFilter] = useState(initialIssuer && initialIssuer.trim() ? initialIssuer.trim() : "전체");
  const [sort, setSort] = useState<NewEtfSort>(sortFromParam(initialSort));

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadSnapshot(), loadCoverage()]).then(([snapshot, coverage]) => {
      if (!cancelled) {
        setState({ snapshot, coverage });
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  const syncParams = useCallback((next: {
    query?: string;
    typeFilter?: EtfTypeFilter;
    dateFilter?: DateFilter;
    issuerFilter?: string;
    sort?: NewEtfSort;
  }) => {
    if (typeof window === "undefined") return;
    const nextQuery = next.query ?? query;
    const nextType = next.typeFilter ?? typeFilter;
    const nextDate = next.dateFilter ?? dateFilter;
    const nextIssuer = next.issuerFilter ?? issuerFilter;
    const nextSort = next.sort ?? sort;
    const params = new URLSearchParams(window.location.search);
    if (nextQuery.trim()) params.set("q", nextQuery.trim());
    else params.delete("q");
    if (nextType === "레버리지") params.set("type", "leveraged");
    else if (nextType === "단일종목 레버리지") params.set("type", "single-stock");
    else if (nextType === "인버스") params.set("type", "inverse");
    else params.delete("type");
    if (nextDate === "전체") params.delete("days");
    else params.set("days", nextDate.replace("일", ""));
    if (nextIssuer === "전체") params.delete("issuer");
    else params.set("issuer", nextIssuer);
    if (nextSort === "date") params.delete("sort");
    else params.set("sort", nextSort);
    const queryString = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, [dateFilter, issuerFilter, query, sort, typeFilter]);

  const rows = useMemo<RadarRow[]>(() => {
    return (state.snapshot?.newEtfs?.records ?? [])
      .filter((row) => typeof row.s === "string" && row.s.trim())
      .map((row) => ({
        ...row,
        s: row.s!.trim().toUpperCase(),
        n: typeof row.n === "string" && row.n.trim() ? row.n.trim() : row.s!.trim().toUpperCase(),
        detailStatus: detailStatus(row.s!, state.coverage),
        issuer: issuerNameFromEtfName(typeof row.n === "string" && row.n.trim() ? row.n.trim() : row.s!.trim().toUpperCase()),
      }))
      .map((row) => ({
        ...row,
        typeTags: typeTags(row),
      }));
  }, [state]);

  const maxDate = useMemo(() => Math.max(...rows.map((row) => dateValue(row.inceptionDate)), 0), [rows]);
  const fetchedAtDate = dateValue(state.snapshot?.newEtfs?.fetched_at);
  const dateFilterAnchor = Math.max(fetchedAtDate, maxDate);
  const issuers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.issuer, (counts.get(row.issuer) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [rows]);
  const typeCounts = useMemo(() => {
    let leveraged = 0;
    let singleStock = 0;
    let inverse = 0;
    for (const row of rows) {
      const record = toUniverseRecord(row);
      if (isLeveragedEtf(record)) leveraged += 1;
      if (isSingleStockLeveragedEtf(record)) singleStock += 1;
      if (isInverseEtf(record)) inverse += 1;
    }
    return { leveraged, singleStock, inverse };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = debouncedQuery.trim().toUpperCase();
    const days = dateFilter === "전체" ? null : Number(dateFilter.replace("일", ""));
    if (days && !dateFilterAnchor) return [];
    const threshold = days && dateFilterAnchor ? dateFilterAnchor - (days - 1) * 24 * 60 * 60 * 1000 : null;
    return rows
      .filter((row) => issuerFilter === "전체" || row.issuer === issuerFilter)
      .filter((row) => {
        const record = toUniverseRecord(row);
        if (typeFilter === "레버리지") return isLeveragedEtf(record);
        if (typeFilter === "단일종목 레버리지") return isSingleStockLeveragedEtf(record);
        if (typeFilter === "인버스") return isInverseEtf(record);
        return true;
      })
      .filter((row) => !threshold || dateValue(row.inceptionDate) >= threshold)
      .filter((row) => !q || row.s.includes(q) || row.n.toUpperCase().includes(q) || row.issuer.toUpperCase().includes(q))
      .sort((a, b) => {
        if (sort === "ticker") return a.s.localeCompare(b.s);
        if (sort === "change") return (b.change ?? -Infinity) - (a.change ?? -Infinity) || a.s.localeCompare(b.s);
        if (sort === "price") return (b.price ?? -Infinity) - (a.price ?? -Infinity) || a.s.localeCompare(b.s);
        return dateValue(b.inceptionDate) - dateValue(a.inceptionDate) || a.s.localeCompare(b.s);
      });
  }, [dateFilter, dateFilterAnchor, debouncedQuery, issuerFilter, rows, sort, typeFilter]);
  const dateFilterMissingAnchor = dateFilter !== "전체" && !dateFilterAnchor;

  const typeOptions: Array<{ value: EtfTypeFilter; label: string; count: number }> = [
    { value: "전체", label: "전체", count: rows.length },
    { value: "레버리지", label: "레버리지", count: typeCounts.leveraged },
    { value: "단일종목 레버리지", label: "단일종목", count: typeCounts.singleStock },
    { value: "인버스", label: "인버스", count: typeCounts.inverse },
  ];

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>신규 상장 ETF 탐색</h2>
        <span className="desc">{fmtDate(state.snapshot?.newEtfs?.fetched_at)} · {filteredRows.length.toLocaleString("ko-KR")} / {countRows(state.snapshot).toLocaleString("ko-KR")}개</span>
      </div>

      {!loaded ? (
        <div className="mv-row">
          <span className="co">
            <div className="n">신규 상장 목록 확인 중</div>
            <div className="tk">상장일과 가격 정보를 읽고 있습니다</div>
          </span>
          <span className="pc num neutral">...</span>
        </div>
      ) : rows.length > 0 ? (
        <>
          <div className="panel-b space-y-3">
            <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_160px_160px_160px]">
              <label className="sr-only" htmlFor="new-etf-search">신규 ETF 검색</label>
              <input
                id="new-etf-search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  syncParams({ query: event.target.value });
                }}
                placeholder="티커, ETF명, 운용사 검색"
                className="min-h-10 rounded-xl border border-[var(--c-line)] bg-white px-3 text-sm font-bold text-[var(--c-ink)] outline-none transition focus:border-[var(--c-brand)] focus:ring-2 focus:ring-[rgb(var(--rgb-brand)/0.1)]"
              />
              <label className="sr-only" htmlFor="new-etf-date-filter">상장일 필터</label>
              <select
                id="new-etf-date-filter"
                value={dateFilter}
                onChange={(event) => {
                  const value = event.target.value as DateFilter;
                  setDateFilter(value);
                  syncParams({ dateFilter: value });
                }}
                className="min-h-10 rounded-xl border border-[var(--c-line)] bg-white px-3 text-sm font-black text-[var(--c-ink)] outline-none transition focus:border-[var(--c-brand)]"
              >
                {(["전체", "7일", "14일", "30일"] as DateFilter[]).map((value) => (
                  <option key={value} value={value}>{value === "전체" ? "전체 기간" : `최근 ${value}`}</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="new-etf-issuer-filter">운용사 필터</label>
              <select
                id="new-etf-issuer-filter"
                value={issuerFilter}
                onChange={(event) => {
                  setIssuerFilter(event.target.value);
                  syncParams({ issuerFilter: event.target.value });
                }}
                className="min-h-10 rounded-xl border border-[var(--c-line)] bg-white px-3 text-sm font-black text-[var(--c-ink)] outline-none transition focus:border-[var(--c-brand)]"
              >
                <option value="전체">전체 운용사</option>
                {issuers.map(([issuer, count]) => (
                  <option key={issuer} value={issuer}>{issuer} ({count})</option>
                ))}
              </select>
              <label className="sr-only" htmlFor="new-etf-sort">정렬</label>
              <select
                id="new-etf-sort"
                value={sort}
                onChange={(event) => {
                  const value = event.target.value as NewEtfSort;
                  setSort(value);
                  syncParams({ sort: value });
                }}
                className="min-h-10 rounded-xl border border-[var(--c-line)] bg-white px-3 text-sm font-black text-[var(--c-ink)] outline-none transition focus:border-[var(--c-brand)]"
              >
                <option value="date">상장일순</option>
                <option value="ticker">티커순</option>
                <option value="change">변동률순</option>
                <option value="price">가격순</option>
              </select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {typeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={typeFilter === option.value}
                  onClick={() => {
                    setTypeFilter(option.value);
                    syncParams({ typeFilter: option.value });
                  }}
                  className={`min-h-8 rounded-full border px-3 text-[11px] font-black transition ${
                    typeFilter === option.value
                      ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white"
                      : "border-[var(--c-line)] bg-white text-[var(--c-ink-3)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
                  }`}
                >
                  {option.label} {option.count.toLocaleString("ko-KR")}
                </button>
              ))}
              <button
                type="button"
                onClick={() => downloadCsv(filteredRows)}
                className="ml-auto min-h-8 rounded-full border border-[var(--c-line)] bg-white px-3 text-[11px] font-black text-[var(--c-brand)] transition hover:border-[var(--c-brand)]"
              >
                CSV 저장
              </button>
            </div>
            {dateFilterMissingAnchor ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                상장일 기준일이 없어 최근 기간 필터를 적용할 수 없습니다. 전체 기간으로 바꾸면 현재 수집된 목록을 볼 수 있습니다.
              </p>
            ) : null}
          </div>

          <div className="mv-col">
            {filteredRows.length > 0 ? filteredRows.map((row) => (
              <TransitionLink key={row.s} href={`/etfs/${encodeURIComponent(row.s)}`} className="mv-row">
                <span className="co">
                  <div className="n">{row.n}</div>
                  <div className="tk">
                    {row.s} · 상장일 {fmtDate(row.inceptionDate)} · 가격 {fmtPrice(row.price)} · {row.issuer} · {row.typeTags.join(" / ")} · {detailStatusHint(row.detailStatus)}
                  </div>
                </span>
                <span className="flex min-w-[92px] flex-col items-end gap-1">
                  <span className={`pc num ${changeClass(row.change)}`}>{fmtChange(row.change)}</span>
                  <span className="rounded-full border border-[var(--c-line)] bg-white px-2 py-0.5 text-[10px] font-black text-[var(--c-ink-3)]">
                    {detailStatusLabel(row.detailStatus)}
                  </span>
                </span>
              </TransitionLink>
            )) : (
              <div className="mv-row">
                <span className="co">
                  <div className="n">조건에 맞는 신규 ETF 없음</div>
                  <div className="tk">검색어와 필터를 조정해보세요</div>
                </span>
                <span className="pc num neutral">-</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="mv-row">
          <span className="co">
            <div className="n">신규 상장 ETF 없음</div>
            <div className="tk">현재 표시할 신규 상장 목록이 없습니다</div>
          </span>
          <span className="pc num neutral">-</span>
        </div>
      )}
      {loaded && rows.length > 0 ? (
        <div className="panel-foot flex flex-wrap items-center justify-between gap-2">
          <span>표시 중 {filteredRows.length.toLocaleString("ko-KR")} / {countRows(state.snapshot).toLocaleString("ko-KR")}개 · 각 행은 ETF 상세로 이동</span>
          <TransitionLink href="/etfs" className="font-black text-[var(--c-brand)] hover:underline">
            ETF 센터로 이동
          </TransitionLink>
        </div>
      ) : null}
    </section>
  );
}
