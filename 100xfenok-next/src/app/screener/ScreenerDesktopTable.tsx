"use client";

import { Fragment, type ReactNode } from "react";
import MetricHelp from "@/components/MetricHelp";
import type { ScreenerSortKey, SortDir, ScreenerStock } from "@/lib/screener/types";
import type { ColumnPreset } from "@/lib/screener/filter-url";
import StockDetailPanel from "./StockDetailPanel";

export type ScreenerColumn = {
  key: ScreenerSortKey;
  label: string;
  align: "left" | "right";
};

export type ScreenerDensityClass = {
  scroller: string;
  table: string;
  headerCell: string;
  bodyCell: string;
  tickerCell: string;
};

export type ScreenerDesktopTableProps = {
  activeColumns: ScreenerColumn[];
  allPageSelected: boolean;
  dataReady: boolean;
  density: string;
  densityClass: ScreenerDensityClass;
  expandedTicker: string | null;
  pageRows: ScreenerStock[];
  preset: ColumnPreset;
  selectedTickers: ReadonlySet<string>;
  sortDir: SortDir;
  sortKey: ScreenerSortKey;
  deselectPageRows: () => void;
  onToggleExpandedTicker: (ticker: string) => void;
  renderCell: (stock: ScreenerStock, key: ScreenerSortKey, preset?: ColumnPreset) => ReactNode;
  renderGuruHolderBadge: (stock: ScreenerStock) => ReactNode;
  selectPageRows: () => void;
  toggleSelectedTicker: (ticker: string) => void;
  toggleSort: (key: ScreenerSortKey) => void;
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function ScreenerDesktopTable({
  activeColumns,
  allPageSelected,
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
}: ScreenerDesktopTableProps) {
  return (
    <div
      className={cx("-mx-1 overflow-auto px-1", densityClass.scroller)}
      data-screener-density={density}
    >
      <table className={cx("w-full min-w-[760px]", densityClass.table)}>
        <thead>
          <tr className="sticky top-0 z-10 border-b border-[var(--c-line)] bg-[var(--c-panel)] text-[11px] font-black uppercase tracking-[0.08em] text-[var(--c-ink-2)]">
            <th className={cx("w-12 text-left", densityClass.headerCell)}>
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={(event) => (event.target.checked ? selectPageRows() : deselectPageRows())}
                aria-label="현재 페이지 종목 선택"
                className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
              />
            </th>
            {activeColumns.map((column) => {
              const active = column.key === sortKey;
              return (
                <th
                  key={column.key}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                  className={cx(densityClass.headerCell, column.align === "right" ? "text-right" : "text-left")}
                >
                  <div className={cx("inline-flex items-center gap-1", column.align === "right" && "justify-end")}>
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      aria-label={`${column.label} 정렬 ${active ? (sortDir === "asc" ? "오름차순" : "내림차순") : "정렬 안 됨"}`}
                      className={cx(
                        "inline-flex items-center gap-1 text-[var(--c-ink)] transition hover:text-[var(--c-ink)]",
                        column.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {column.label}
                      <span className="text-[9px]">{active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                    </button>
                    <MetricHelp label={column.label} metricKey={column.key} showLabel={false} align={column.align === "right" ? "right" : "left"} />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((stock) => {
            const expanded = expandedTicker === stock.ticker;
            const detailId = `screener-detail-${stock.ticker}`;
            return (
              <Fragment key={stock.ticker}>
                <tr
                  data-testid="screener-desktop-row"
                  data-ticker={stock.ticker}
                  onClick={() => onToggleExpandedTicker(stock.ticker)}
                  className="cursor-pointer border-b border-[var(--c-line-2)] transition last:border-0 hover:bg-[var(--c-surface-2)]"
                >
                  <td className={densityClass.bodyCell}>
                    <input
                      type="checkbox"
                      checked={selectedTickers.has(stock.ticker)}
                      onChange={() => toggleSelectedTicker(stock.ticker)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`${stock.ticker} 선택`}
                      className="h-5 min-h-5 w-5 min-w-5 accent-slate-900"
                    />
                  </td>
                  {activeColumns.map((column) => (
                    <td
                      key={column.key}
                      className={cx(densityClass.bodyCell, column.align === "right" ? "text-right" : "text-left")}
                    >
                      {column.key === "ticker" ? (
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
                      ) : renderCell(stock, column.key, preset)}
                    </td>
                  ))}
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
}
