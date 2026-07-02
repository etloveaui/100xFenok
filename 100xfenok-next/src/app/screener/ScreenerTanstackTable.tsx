"use client";

import { Component, Fragment, useMemo, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import MetricHelp from "@/components/MetricHelp";
import type { ScreenerSortKey, ScreenerStock } from "@/lib/screener/types";
import StockDetailPanel from "./StockDetailPanel";
import type { ScreenerColumn, ScreenerDesktopTableProps } from "./ScreenerDesktopTable";

type ScreenerTanstackTableProps = ScreenerDesktopTableProps & {
  canvasPlusPreview?: boolean;
  enabled: boolean;
  fallback: ReactNode;
};

type ScreenerTanstackTableInnerProps = ScreenerDesktopTableProps & {
  canvasPlusPreview: boolean;
};

type ScreenerTanstackBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
};

type ScreenerTanstackBoundaryState = {
  hasError: boolean;
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function canvasPlusDensityMode(density: string): "compact" | "default" | "comfy" {
  if (density === "compact") return "compact";
  if (density === "comfortable") return "comfy";
  return "default";
}

function canvasPlusRowHeight(density: string): number {
  if (density === "compact") return 32;
  if (density === "comfortable") return 48;
  return 40;
}

class ScreenerTanstackBoundary extends Component<ScreenerTanstackBoundaryProps, ScreenerTanstackBoundaryState> {
  constructor(props: ScreenerTanstackBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ScreenerTanstackBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ScreenerTanstackTable] desktop table crashed, falling back to legacy table:", error, info.componentStack);
  }

  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function TickerCell({
  canvasPlusPreview,
  densityClass,
  expanded,
  onToggleExpandedTicker,
  renderGuruHolderBadge,
  stock,
}: {
  canvasPlusPreview: boolean;
  densityClass: ScreenerDesktopTableProps["densityClass"];
  expanded: boolean;
  onToggleExpandedTicker: (ticker: string) => void;
  renderGuruHolderBadge: (stock: ScreenerStock) => ReactNode;
  stock: ScreenerStock;
}) {
  const detailId = `screener-detail-${stock.ticker}`;
  if (canvasPlusPreview) {
    return (
      <span className="cp-screener-name-cell">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpandedTicker(stock.ticker);
          }}
          className="cp-screener-ticker inline-flex items-center gap-1 border-0 bg-transparent p-0 font-black transition focus:outline-none focus:ring-2 focus:ring-[var(--cp-focus-ring)]"
        >
          <span className="w-5 text-center text-[12px]" aria-hidden="true">{expanded ? "-" : "+"}</span>
          <span className="truncate">{stock.ticker}</span>
        </button>
        {renderGuruHolderBadge(stock)}
      </span>
    );
  }

  return (
    <div className={cx("flex max-w-full items-center gap-1.5", densityClass.tickerCell)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailId}
        aria-label={`${stock.ticker} 상세 ${expanded ? "접기" : "펼치기"}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggleExpandedTicker(stock.ticker);
        }}
        className="inline-flex items-center gap-1 rounded-md text-left text-sm font-black text-[var(--c-ink)] transition hover:bg-[var(--c-surface-2)] focus:outline-none focus:ring-2 focus:ring-brand-interactive/40"
      >
        <span className="w-5 text-center text-[12px] text-[var(--c-ink-4)]" aria-hidden="true">{expanded ? "-" : "+"}</span>
        <span className="truncate">{stock.ticker}</span>
      </button>
      {renderGuruHolderBadge(stock)}
    </div>
  );
}

function ScreenerTanstackTableInner({
  activeColumns,
  allPageSelected,
  canvasPlusPreview,
  dataReady,
  density,
  densityClass,
  expandedTicker,
  pageRows,
  preset,
  selectedTickers,
  sortDir,
  sortKey,
  deselectPageRows,
  onToggleExpandedTicker,
  renderCell,
  renderGuruHolderBadge,
  selectPageRows,
  toggleSelectedTicker,
  toggleSort,
}: ScreenerTanstackTableInnerProps) {
  const rowHeight = canvasPlusRowHeight(density);
  const densityMode = canvasPlusDensityMode(density);
  const columnById = useMemo(() => new Map<ScreenerSortKey, ScreenerColumn>(activeColumns.map((column) => [column.key, column])), [activeColumns]);
  const columns = useMemo<Array<ColumnDef<ScreenerStock>>>(() => [
    {
      id: "__select",
      header: () => (
        <input
          type="checkbox"
          checked={allPageSelected}
          onChange={(event) => (event.target.checked ? selectPageRows() : deselectPageRows())}
          aria-label="현재 페이지 종목 선택"
          className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedTickers.has(row.original.ticker)}
          onChange={() => toggleSelectedTicker(row.original.ticker)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`${row.original.ticker} 선택`}
          className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
        />
      ),
    },
    ...activeColumns.map((column) => ({
      id: column.key,
      accessorFn: (stock) => stock[column.key],
      header: () => {
        const active = column.key === sortKey;
        return (
          <div className={cx("inline-flex items-center gap-1", column.align === "right" && "justify-end")}>
            <button
              type="button"
              onClick={() => toggleSort(column.key)}
              aria-label={`${column.label} 정렬 ${active ? (sortDir === "asc" ? "오름차순" : "내림차순") : "정렬 안 됨"}`}
              className={canvasPlusPreview
                ? cx("inline-flex items-center gap-1", column.align === "right" && "flex-row-reverse")
                : cx(
                  "inline-flex items-center gap-1 text-[var(--c-ink)] transition hover:text-[var(--c-ink)]",
                  column.align === "right" && "flex-row-reverse",
                )}
            >
              {column.label}
              <span className="text-[9px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
            </button>
            <MetricHelp label={column.label} metricKey={column.key} showLabel={false} align={column.align === "right" ? "right" : "left"} />
          </div>
        );
      },
      cell: ({ row }) => {
        const stock = row.original;
        if (column.key === "ticker") {
          return (
            <TickerCell
              canvasPlusPreview={canvasPlusPreview}
              densityClass={densityClass}
              expanded={expandedTicker === stock.ticker}
              onToggleExpandedTicker={onToggleExpandedTicker}
              renderGuruHolderBadge={renderGuruHolderBadge}
              stock={stock}
            />
          );
        }
        return renderCell(stock, column.key, preset);
      },
    }) satisfies ColumnDef<ScreenerStock>),
  ], [
    activeColumns,
    allPageSelected,
    canvasPlusPreview,
    densityClass,
    deselectPageRows,
    expandedTicker,
    onToggleExpandedTicker,
    preset,
    renderCell,
    renderGuruHolderBadge,
    selectPageRows,
    selectedTickers,
    sortDir,
    sortKey,
    toggleSelectedTicker,
    toggleSort,
  ]);

  // TanStack owns this table instance; keep the React Compiler warning scoped to the gated adapter.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: pageRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (stock) => stock.ticker,
  });
  const canvasPlusCellFrameStyle = {
    maxHeight: `${Math.max(20, rowHeight - 1)}px`,
  } as CSSProperties;

  const tableMarkup = (
    <div
      className={canvasPlusPreview ? "cp-screener-table-wrap" : cx("-mx-1 overflow-auto px-1", densityClass.scroller)}
      data-canvas-plus-table-preview={canvasPlusPreview ? "true" : undefined}
      data-canvas-plus-row-height={canvasPlusPreview ? rowHeight : undefined}
      data-screener-density={density}
    >
      <table className={canvasPlusPreview ? "cp-screener-table" : cx("w-full min-w-[760px]", densityClass.table)}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className={canvasPlusPreview ? undefined : "sticky top-0 z-10 border-b border-[var(--c-line)] bg-[var(--c-panel)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]"}>
              {headerGroup.headers.map((header) => {
                const column = columnById.get(header.column.id as ScreenerSortKey);
                const active = column?.key === sortKey;
                return (
                  <th
                    key={header.id}
                    aria-sort={column ? (active ? (sortDir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    data-align={canvasPlusPreview ? column?.align ?? "left" : undefined}
                    className={canvasPlusPreview ? undefined : column ? cx(densityClass.headerCell, column.align === "right" ? "text-right" : "text-left") : cx("w-12 text-left", densityClass.headerCell)}
                  >
                    {canvasPlusPreview ? (
                      <span className="block overflow-hidden" style={canvasPlusCellFrameStyle}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </span>
                    ) : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => {
            const stock = row.original;
            const expanded = expandedTicker === stock.ticker;
            const detailId = `screener-detail-${stock.ticker}`;
            return (
              <Fragment key={stock.ticker}>
                <tr
                  data-testid="screener-desktop-row"
                  data-ticker={stock.ticker}
                  onClick={() => onToggleExpandedTicker(stock.ticker)}
                  className={canvasPlusPreview ? "cursor-pointer" : "cursor-pointer border-b border-[var(--c-line-2)] transition last:border-0 hover:bg-[var(--c-surface-2)]"}
                >
                  {row.getVisibleCells().map((cell) => {
                    const column = columnById.get(cell.column.id as ScreenerSortKey);
                    return (
                      <td
                        key={cell.id}
                        data-align={canvasPlusPreview ? column?.align ?? "left" : undefined}
                        className={canvasPlusPreview ? undefined : column ? cx(densityClass.bodyCell, column.align === "right" ? "text-right" : "text-left") : densityClass.bodyCell}
                      >
                        {canvasPlusPreview ? (
                          <span className="block overflow-hidden" style={canvasPlusCellFrameStyle}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        ) : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
                {expanded ? (
                  <tr id={detailId} data-testid="screener-desktop-detail-row" data-ticker={stock.ticker}>
                    <td colSpan={activeColumns.length + 1} className="p-0">
                      <StockDetailPanel ticker={stock.ticker} stock={stock} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {dataReady && pageRows.length === 0 ? (
            <tr>
              <td colSpan={activeColumns.length + 1} className="px-2 py-10 text-center text-sm font-semibold text-[var(--c-ink-3)]">
                조건에 맞는 종목이 없습니다.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );

  if (!canvasPlusPreview) return tableMarkup;

  return (
    <div
      className="canvas-plus"
      data-canvas-plus
      data-canvas-plus-screener-preview
      data-row-density={densityMode}
      style={{
        "--cp-active-row-height": `${rowHeight}px`,
        background: "transparent",
        minHeight: "auto",
      } as CSSProperties}
    >
      {tableMarkup}
    </div>
  );
}

export default function ScreenerTanstackTable({ canvasPlusPreview = false, enabled, fallback, ...props }: ScreenerTanstackTableProps) {
  if (!enabled) return fallback;
  return (
    <ScreenerTanstackBoundary fallback={fallback}>
      <ScreenerTanstackTableInner {...props} canvasPlusPreview={canvasPlusPreview} />
    </ScreenerTanstackBoundary>
  );
}
