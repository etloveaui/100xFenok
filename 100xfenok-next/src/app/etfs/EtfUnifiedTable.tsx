"use client";

import { useEffect, useMemo, useState } from "react";
import TransitionLink from "@/components/TransitionLink";
import { CpAccordion, CpDataTable, type CpDataTableColumn } from "@/components/canvas-plus/kit";
import { EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import {
  etfClassificationLabels,
  formatAum,
  percentPointsValue,
} from "@/app/explore/etfUniverseUtils";
import { ROUTES } from "@/lib/routes";
import { formatInteger, formatPlainPercent } from "@/lib/format";
import {
  digitalTickersFromSnapshot,
  etfClockKind,
  etfRailClockDate,
  etfUniverseAsOf,
  etfUniversePublishedAt,
  fmtSignedPct,
  isEtfClockStale,
  isInverseEtf,
  isLeveragedEtf,
  isSingleStockLeveragedEtf,
  issuerNameFromEtfName,
  openEtfEvidence,
  type EtfSurfaceData,
  type EtfUniverseRecord,
} from "./etfSurfaceData";

type EtfSegment = "전체" | "신규" | "디지털자산" | "레버리지" | "단일종목 레버리지" | "인버스";
type AumFilter = "전체" | "$100B 이상" | "$10B 이상" | "$1B 이상" | "$1B 미만" | "운용자산 미표시";
type ExpenseFilter = "전체" | "0.05% 이하" | "0.10% 이하" | "0.50% 이하" | "1.00% 이상" | "보수 미표시";
type EtfSortKey = "ticker" | "aum" | "expense" | "tr1y";
type EtfSortDirection = "asc" | "desc";

const AUM_FILTERS: readonly AumFilter[] = ["전체", "$100B 이상", "$10B 이상", "$1B 이상", "$1B 미만", "운용자산 미표시"];
const EXPENSE_FILTERS: readonly ExpenseFilter[] = ["전체", "0.05% 이하", "0.10% 이하", "0.50% 이하", "1.00% 이상", "보수 미표시"];
const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_OPTIONS = [30, 50, 100, 200] as const;
const PAGER_WINDOW = 1;
const DEFAULT_SORT: { key: EtfSortKey; direction: EtfSortDirection } = { key: "aum", direction: "desc" };
const SORT_DEFAULT_DIRECTION: Record<EtfSortKey, EtfSortDirection> = {
  ticker: "asc",
  aum: "desc",
  expense: "asc",
  tr1y: "desc",
};
const SORT_COLUMN_LABELS: Record<EtfSortKey, string> = {
  ticker: "티커 · 이름",
  aum: "운용자산",
  expense: "보수",
  tr1y: "1년 수익률",
};
const SORT_CHOICES: readonly { key: EtfSortKey; direction: EtfSortDirection; label: string }[] = [
  { key: "aum", direction: "desc", label: "운용자산 많은 순" },
  { key: "aum", direction: "asc", label: "운용자산 적은 순" },
  { key: "expense", direction: "asc", label: "보수 낮은 순" },
  { key: "expense", direction: "desc", label: "보수 높은 순" },
  { key: "tr1y", direction: "desc", label: "1년 수익률 높은 순" },
  { key: "tr1y", direction: "asc", label: "1년 수익률 낮은 순" },
  { key: "ticker", direction: "asc", label: "티커 · 이름 오름차순" },
  { key: "ticker", direction: "desc", label: "티커 · 이름 내림차순" },
];

function matchesAum(value: number | null | undefined, filter: AumFilter): boolean {
  const aum = typeof value === "number" && Number.isFinite(value) ? value : null;
  if (filter === "전체") return true;
  if (filter === "운용자산 미표시") return aum === null;
  if (aum === null) return false;
  if (filter === "$100B 이상") return aum >= 100_000_000_000;
  if (filter === "$10B 이상") return aum >= 10_000_000_000;
  if (filter === "$1B 이상") return aum >= 1_000_000_000;
  return aum < 1_000_000_000;
}

function matchesExpense(row: EtfUniverseRecord, filter: ExpenseFilter): boolean {
  const expense = normalizedExpenseRatioValue(row);
  if (filter === "전체") return true;
  if (filter === "보수 미표시") return expense === null;
  if (expense === null) return false;
  if (filter === "0.05% 이하") return expense <= 0.05;
  if (filter === "0.10% 이하") return expense <= 0.1;
  if (filter === "0.50% 이하") return expense <= 0.5;
  return expense >= 1;
}

function isMainstreamExpenseScaleCandidate(row: EtfUniverseRecord, value: number): boolean {
  if (value <= 5) return false;
  if (isLeveragedEtf(row) || isInverseEtf(row) || isSingleStockLeveragedEtf(row)) return false;
  const category = `${row.category ?? row.assetClass ?? ""}`.toLowerCase();
  const mainstreamCategory =
    category === "equity" ||
    category === "fixed income" ||
    category === "commodity" ||
    category === "주식형" ||
    category === "채권형" ||
    category === "원자재";
  const aum = typeof row.aum === "number" && Number.isFinite(row.aum) ? row.aum : 0;
  return mainstreamCategory || aum >= 1_000_000_000;
}

function normalizedExpenseRatioValue(row: EtfUniverseRecord): number | null {
  const primary = percentPointsValue(row.expense_ratio);
  const alternate = percentPointsValue(row.expenseRatio);
  const value = primary ?? alternate;
  if (value === null) return null;
  if (value > 5 && alternate !== null && alternate <= 5) return alternate;
  if (isMainstreamExpenseScaleCandidate(row, value)) return value / 100;
  return value;
}

function sortValueFor(row: EtfUniverseRecord, key: EtfSortKey): number | string | null {
  if (key === "ticker") {
    const ticker = (row.ticker ?? "").trim();
    if (ticker) return ticker.toUpperCase();
    const name = (row.name ?? "").trim();
    return name ? name.toUpperCase() : null;
  }
  if (key === "aum") return typeof row.aum === "number" && Number.isFinite(row.aum) ? row.aum : null;
  if (key === "expense") return normalizedExpenseRatioValue(row);
  const value = row.performance?.tr1y;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Missing values sink below present ones in both directions.
function compareSortValues(
  left: number | string | null,
  right: number | string | null,
  direction: EtfSortDirection,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const delta =
    typeof left === "string" || typeof right === "string"
      ? `${left}`.localeCompare(`${right}`, "en", { numeric: true })
      : left - right;
  return direction === "asc" ? delta : -delta;
}

function paginationItems(current: number, total: number): Array<{ key: string; page: number | null }> {
  const pages = new Set<number>([1, total]);
  for (let value = current - PAGER_WINDOW; value <= current + PAGER_WINDOW; value += 1) {
    if (value >= 1 && value <= total) pages.add(value);
  }
  const items: Array<{ key: string; page: number | null }> = [];
  let previous = 0;
  for (const page of [...pages].sort((left, right) => left - right)) {
    if (previous > 0 && page - previous > 1) items.push({ key: `gap-${previous}`, page: null });
    items.push({ key: `page-${page}`, page });
    previous = page;
  }
  return items;
}

function etfTypeLabels(row: EtfUniverseRecord, digitalTickers: ReadonlySet<string>): string[] {
  const labels = [...etfClassificationLabels(row)];
  if (digitalTickers.has((row.ticker ?? "").toUpperCase())) labels.unshift("디지털자산");
  if (row.is_new) labels.push("신규");
  return labels.length > 0 ? [...new Set(labels)] : ["일반"];
}

function EtfMobileList({
  rows,
  digitalTickers,
}: {
  rows: readonly EtfUniverseRecord[];
  digitalTickers: ReadonlySet<string>;
}) {
  return (
    <div className="etf-mobile-list" aria-label="ETF 모바일 목록">
      {rows.map((row) => {
        const oneYearValue = row.performance?.tr1y ?? null;
        const oneYearLabel = fmtSignedPct(oneYearValue);
        const oneYearClassName =
          typeof oneYearValue === "number" ? (oneYearValue < 0 ? "etf-down" : "etf-up") : undefined;
        return (
          <article key={row.ticker ?? row.name ?? "unknown"} className="etf-mobile-card">
            <div className="etf-mobile-card__head">
              <TransitionLink href={ROUTES.etf(row.ticker ?? "")} className="etf-mobile-title">
                <strong>{row.ticker}</strong>
                <span>{row.name && row.name !== row.ticker ? row.name : "—"}</span>
              </TransitionLink>
              <span className="etf-mobile-category">{row.category ?? "미분류"}</span>
            </div>
            <span className="etf-badges etf-mobile-badges">
              {etfTypeLabels(row, digitalTickers).map((label) => (
                <span key={label} className="etf-badge">{label}</span>
              ))}
            </span>
            <dl className="etf-mobile-stats">
              <div>
                <dt>운용자산</dt>
                <dd>{formatAum(row)}</dd>
              </div>
              <div>
                <dt>보수</dt>
                <dd>{formatPlainPercent(normalizedExpenseRatioValue(row), { digits: 2, fraction: false })}</dd>
              </div>
              <div>
                <dt>1년</dt>
                <dd className={oneYearClassName}>{oneYearLabel}</dd>
              </div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}

export default function EtfUnifiedTable({ surface }: { surface: EtfSurfaceData }) {
  // Page-level store (fh-681 P1): no own loader — rows/snapshot/reload come
  // from EtfPageClient, so one retry recovers every dependent panel atomically.
  const { loaded, universeOk, snapshotOk, universe, rows, snapshot, reload } = surface;
  const digitalTickers = useMemo(() => digitalTickersFromSnapshot(snapshot), [snapshot]);
  const clock = etfUniverseAsOf(universe);
  const published = etfUniversePublishedAt(universe);
  const loading = !loaded;
  // The list is universe-feed truth; a failed snapshot feed only degrades the
  // digital-asset segment, so the rail drops to partial instead of fresh.
  const feedFailed = loaded && !universeOk;
  const stale = loaded && !feedFailed && isEtfClockStale(clock ?? published);
  const partial = loaded && !feedFailed && !snapshotOk;

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [segment, setSegment] = useState<EtfSegment>("전체");
  const [category, setCategory] = useState("전체");
  const [issuer, setIssuer] = useState("전체");
  const [aum, setAum] = useState<AumFilter>("전체");
  const [expense, setExpense] = useState<ExpenseFilter>("전체");
  const [sortKey, setSortKey] = useState<EtfSortKey>(DEFAULT_SORT.key);
  const [sortDirection, setSortDirection] = useState<EtfSortDirection>(DEFAULT_SORT.direction);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const retryLoad = reload;

  const resetPaging = () => setPage(1);

  const changeSort = (key: EtfSortKey, direction?: EtfSortDirection) => {
    const nextDirection =
      direction ?? (key === sortKey ? (sortDirection === "asc" ? "desc" : "asc") : SORT_DEFAULT_DIRECTION[key]);
    setSortKey(key);
    setSortDirection(nextDirection);
    setPage(1);
  };

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.category ?? "미분류", (counts.get(row.category ?? "미분류") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }, [rows]);

  const issuers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const name = issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [rows]);

  const advancedFilteredRows = useMemo(
    () =>
      rows
        .filter((row) => category === "전체" || (row.category ?? "미분류") === category)
        .filter((row) => issuer === "전체" || issuerNameFromEtfName(row.issuer ?? row.name ?? row.ticker) === issuer)
        .filter((row) => matchesAum(row.aum, aum))
        .filter((row) => matchesExpense(row, expense)),
    [rows, category, issuer, aum, expense],
  );

  const segmentCounts = useMemo(() => {
    let leveraged = 0;
    let singleStock = 0;
    let inverse = 0;
    let digital = 0;
    let fresh = 0;
    for (const row of advancedFilteredRows) {
      if (isLeveragedEtf(row)) leveraged += 1;
      if (isSingleStockLeveragedEtf(row)) singleStock += 1;
      if (isInverseEtf(row)) inverse += 1;
      if (digitalTickers.has((row.ticker ?? "").toUpperCase())) digital += 1;
      if (row.is_new) fresh += 1;
    }
    return { leveraged, singleStock, inverse, digital, fresh };
  }, [advancedFilteredRows, digitalTickers]);

  const segments: Array<{ value: EtfSegment; label: string; count: number }> = [
    { value: "전체", label: "전체", count: advancedFilteredRows.length },
    { value: "신규", label: "신규", count: segmentCounts.fresh },
    { value: "디지털자산", label: "디지털자산", count: segmentCounts.digital },
    { value: "레버리지", label: "레버리지", count: segmentCounts.leveraged },
    { value: "단일종목 레버리지", label: "단일종목 레버리지", count: segmentCounts.singleStock },
    { value: "인버스", label: "인버스", count: segmentCounts.inverse },
  ];

  const filteredRows = useMemo(() => {
    const q = debouncedQuery.trim().toUpperCase();
    return advancedFilteredRows
      .filter((row) => {
        if (segment === "전체") return true;
        if (segment === "신규") return row.is_new === true;
        if (segment === "디지털자산") return digitalTickers.has((row.ticker ?? "").toUpperCase());
        if (segment === "레버리지") return isLeveragedEtf(row);
        if (segment === "단일종목 레버리지") return isSingleStockLeveragedEtf(row);
        return isInverseEtf(row);
      })
      .filter((row) => !q || (row.ticker ?? "").includes(q) || (row.name ?? "").toUpperCase().includes(q) || (row.issuer ?? "").toUpperCase().includes(q));
  }, [advancedFilteredRows, segment, debouncedQuery, digitalTickers]);

  // Ties keep the filter order, so sorting stays stable on every engine.
  const sortedRows = useMemo(() => {
    const baseOrder = new Map<EtfUniverseRecord, number>();
    filteredRows.forEach((row, index) => baseOrder.set(row, index));
    return [...filteredRows].sort((left, right) => {
      const delta = compareSortValues(sortValueFor(left, sortKey), sortValueFor(right, sortKey), sortDirection);
      return delta !== 0 ? delta : (baseOrder.get(left) ?? 0) - (baseOrder.get(right) ?? 0);
    });
  }, [filteredRows, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const renderSortHeader = (key: EtfSortKey) => {
    const label = SORT_COLUMN_LABELS[key];
    const active = sortKey === key;
    const directionLabel = sortDirection === "asc" ? "오름차순" : "내림차순";
    return (
      <button
        type="button"
        className="etf-sort-btn"
        data-active={active ? "true" : undefined}
        onClick={() => changeSort(key)}
        aria-label={active ? `${label} 정렬 · 현재 ${directionLabel}` : `${label} 기준으로 정렬`}
      >
        <span>{label}</span>
        <span className="etf-sort-arrow" aria-hidden="true">
          {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    );
  };

  const columns: readonly CpDataTableColumn<EtfUniverseRecord>[] = [
    {
      key: "ticker",
      header: renderSortHeader("ticker"),
      align: "left",
      render: (row) => (
        <TransitionLink href={ROUTES.etf(row.ticker ?? "")} className="etf-table-ticker">
          <strong>{row.ticker}</strong>
          <span>{row.name && row.name !== row.ticker ? row.name : "—"}</span>
        </TransitionLink>
      ),
    },
    {
      key: "category",
      header: "자산군",
      render: (row) => row.category ?? "미분류",
    },
    {
      key: "classification",
      header: "구분",
      render: (row) => {
        const labels = etfTypeLabels(row, digitalTickers);
        return (
          <span className="etf-badges">
            {labels.map((label) => (
              <span key={label} className="etf-badge">{label}</span>
            ))}
          </span>
        );
      },
    },
    {
      key: "aum",
      header: renderSortHeader("aum"),
      render: (row) => formatAum(row),
    },
    {
      key: "expense",
      header: renderSortHeader("expense"),
      render: (row) => formatPlainPercent(normalizedExpenseRatioValue(row), { digits: 2, fraction: false }),
    },
    {
      key: "tr1y",
      header: renderSortHeader("tr1y"),
      render: (row) => {
        const value = row.performance?.tr1y ?? null;
        const label = fmtSignedPct(value);
        if (typeof value !== "number") return label;
        return <span className={value >= 0 ? "etf-up" : "etf-down"}>{label}</span>;
      },
    },
  ];

  const empty = loaded && (feedFailed || filteredRows.length === 0);
  const asOfLabel = etfRailClockDate(clock, published, universe?.source_as_of_reason ? "제공자 미공개" : "—");
  const asOfKind = etfClockKind(clock, published);

  return (
    <Panel
      loading={loading}
      empty={empty}
      emptyReason={feedFailed ? "ETF 목록을 불러오지 못했습니다" : "조건에 맞는 ETF가 없습니다. 필터를 조정해 주세요."}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={feedFailed ? "다시 시도" : undefined}
      onEmptyAction={feedFailed ? retryLoad : undefined}
      stale={stale}
      asOf={clock ?? undefined}
      onRetry={stale ? retryLoad : undefined}
    >
      <PanelHeader
        eyebrow="Universe"
        title="ETF 목록"
        right={
          <div className="etf-seg-pills" role="group" aria-label="ETF 세그먼트">
            {segments.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setSegment(option.value);
                  resetPaging();
                }}
                aria-pressed={segment === option.value}
                className="etf-seg-pill"
                data-active={segment === option.value ? "true" : undefined}
              >
                {option.label} <span className="tabular-nums">{option.count.toLocaleString("ko-KR")}</span>
              </button>
            ))}
          </div>
        }
      />
      {!feedFailed ? (
        <>
          <div className="etf-list-toolbar">
            <label className="sr-only" htmlFor="etf-search">ETF 검색</label>
            <input
              id="etf-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                resetPaging();
              }}
              placeholder="티커 또는 이름 검색"
              className="etf-search"
            />
            <label className="etf-sort-field">
              <span>정렬</span>
              <select
                value={`${sortKey}:${sortDirection}`}
                onChange={(event) => {
                  const next = SORT_CHOICES.find((choice) => `${choice.key}:${choice.direction}` === event.target.value);
                  if (next) changeSort(next.key, next.direction);
                }}
              >
                {SORT_CHOICES.map((choice) => (
                  <option key={`${choice.key}:${choice.direction}`} value={`${choice.key}:${choice.direction}`}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <CpAccordion title="필터 더보기" meta="자산군 · 운용사 · 운용자산 · 보수">
            <div className="etf-filter-grid">
              <label className="etf-filter-field">
                <span>자산군</span>
                <select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    resetPaging();
                  }}
                >
                  <option value="전체">전체</option>
                  {categories.map((item) => (
                    <option key={item.name} value={item.name}>{item.name} ({item.count.toLocaleString("ko-KR")})</option>
                  ))}
                </select>
              </label>
              <label className="etf-filter-field">
                <span>운용사</span>
                <select
                  value={issuer}
                  onChange={(event) => {
                    setIssuer(event.target.value);
                    resetPaging();
                  }}
                >
                  <option value="전체">전체</option>
                  {issuers.map((item) => (
                    <option key={item.name} value={item.name}>{item.name} ({item.count.toLocaleString("ko-KR")})</option>
                  ))}
                </select>
              </label>
              <label className="etf-filter-field">
                <span>운용자산</span>
                <select
                  value={aum}
                  onChange={(event) => {
                    setAum(event.target.value as AumFilter);
                    resetPaging();
                  }}
                >
                  {AUM_FILTERS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="etf-filter-field">
                <span>보수</span>
                <select
                  value={expense}
                  onChange={(event) => {
                    setExpense(event.target.value as ExpenseFilter);
                    resetPaging();
                  }}
                >
                  {EXPENSE_FILTERS.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </CpAccordion>

          {filteredRows.length > 0 ? (
            <>
              <div className="etf-table-desktop">
                <CpDataTable columns={columns} rows={pageRows} getRowKey={(row) => row.ticker ?? ""} />
              </div>
              <EtfMobileList rows={pageRows} digitalTickers={digitalTickers} />
              <div className="etf-load-more">
                <p className="etf-pager-status">
                  전체 {formatInteger(sortedRows.length)}개 · {formatInteger(currentPage)} / {formatInteger(pageCount)} 페이지
                </p>
                {pageCount > 1 ? (
                  <nav className="etf-pager" aria-label="ETF 목록 페이지">
                    <button
                      type="button"
                      className="etf-pager-btn"
                      onClick={() => setPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      이전
                    </button>
                    {paginationItems(currentPage, pageCount).map((item) => {
                      if (item.page === null) {
                        return (
                          <span key={item.key} className="etf-pager-gap" aria-hidden="true">
                            …
                          </span>
                        );
                      }
                      const targetPage = item.page;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className="etf-pager-btn"
                          data-active={targetPage === currentPage ? "true" : undefined}
                          aria-current={targetPage === currentPage ? "page" : undefined}
                          onClick={() => setPage(targetPage)}
                        >
                          {formatInteger(targetPage)}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="etf-pager-btn"
                      onClick={() => setPage(currentPage + 1)}
                      disabled={currentPage >= pageCount}
                    >
                      다음
                    </button>
                  </nav>
                ) : null}
                <label className="etf-page-size">
                  <span>페이지당</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      setPage(1);
                    }}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>{size}개</option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <EvidenceRail
        freshness={loading ? "pending" : feedFailed ? "error" : partial ? "partial" : stale ? "stale" : (clock ?? published) ? "fresh" : "fixed"}
        source="발행사 공시 · 거래소"
        asOf={asOfLabel}
        asOfKind={asOfKind === "published" ? "published" : undefined}
        coverage={rows.length > 0 ? `${formatInteger(filteredRows.length)}/${formatInteger(rows.length)}` : "—"}
        lkgAsOf={stale && clock ? clock : undefined}
        onRetry={feedFailed || stale ? retryLoad : undefined}
        onEvidence={feedFailed ? undefined : () => openEtfEvidence("/api/data/stockanalysis/etf-universe")}
      />
    </Panel>
  );
}
