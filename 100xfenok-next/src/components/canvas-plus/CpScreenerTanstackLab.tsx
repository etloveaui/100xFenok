"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpButton from "@/components/canvas-plus/CpButton";
import {
  CP_SCREENER_DENSITY_LABEL,
  CP_SCREENER_DENSITY_ROWS,
  CP_SCREENER_NUMERIC_FIELDS,
  formatCompactMarketCap,
  formatNumber,
  formatPercent,
  formatScore,
  loadCpScreenerFixture,
  numericTone,
  type CpScreenerDensity,
  type CpScreenerFixture,
  type CpScreenerNumericField,
  type CpScreenerRow,
} from "@/components/canvas-plus/CpScreenerLabModel";

const DENSITY_OPTIONS: CpScreenerDensity[] = ["compact", "default", "comfy"];

function isNumericColumnId(columnId: string): boolean {
  return CP_SCREENER_NUMERIC_FIELDS.includes(columnId as CpScreenerNumericField);
}

function formatField(row: CpScreenerRow, field: CpScreenerNumericField): string {
  if (field === "marketCap") return formatCompactMarketCap(row.marketCap);
  if (field === "return12m" || field === "roe" || field === "opm" || field === "momentum3m") return formatPercent(row[field]);
  if (field === "fenokEdge" || field === "rank") return formatScore(row[field]);
  return formatNumber(row[field]);
}

function NumericCell({ row, field }: { row: CpScreenerRow; field: CpScreenerNumericField }) {
  return (
    <span className="cp-screener-num" data-numeric-cell data-tone={numericTone(row[field])}>
      {formatField(row, field)}
    </span>
  );
}

function MobileCard({ row }: { row: CpScreenerRow }) {
  return (
    <article className="cp-screener-card" data-mobile-card-target-height="360">
      <header className="cp-screener-card__header">
        <div>
          <h2>{row.ticker}</h2>
          <p>{row.name}</p>
        </div>
        <CpBadge tone={row.fixtureKind === "source" ? "positive" : "neutral"}>
          {row.fixtureKind}
        </CpBadge>
      </header>
      <div className="cp-screener-card__meta">
        <span>{row.sector}</span>
        <span>TanStack sorted row</span>
      </div>
      <dl className="cp-screener-card__metrics">
        {CP_SCREENER_NUMERIC_FIELDS.slice(0, 8).map((field) => (
          <div key={field}>
            <dt>{field}</dt>
            <dd className="cp-screener-num" data-numeric-cell data-tone={numericTone(row[field])}>
              {formatField(row, field)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default function CpScreenerTanstackLab() {
  const [fixture, setFixture] = useState<CpScreenerFixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [density, setDensity] = useState<CpScreenerDensity>("default");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "fenokEdge", desc: true }]);

  useEffect(() => {
    let alive = true;
    loadCpScreenerFixture()
      .then((nextFixture) => {
        if (alive) setFixture(nextFixture);
      })
      .catch((nextError: unknown) => {
        if (alive) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => {
      alive = false;
    };
  }, []);

  const data = useMemo(() => {
    const rows = fixture?.rows ?? [];
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery) return rows;
    return rows.filter((row) => `${row.ticker} ${row.name} ${row.sector}`.toUpperCase().includes(normalizedQuery));
  }, [fixture?.rows, query]);

  const columns = useMemo<Array<ColumnDef<CpScreenerRow>>>(() => [
    {
      accessorKey: "ticker",
      header: "Ticker",
      cell: ({ row }) => (
        <span className="cp-screener-name-cell">
          <span className="cp-screener-ticker">{row.original.ticker}</span>
          <span>{row.original.name}</span>
        </span>
      ),
    },
    {
      accessorKey: "sector",
      header: "Sector",
      cell: ({ row }) => row.original.sector,
    },
    ...CP_SCREENER_NUMERIC_FIELDS.map((field) => ({
      accessorKey: field,
      header: field,
      cell: ({ row }) => <NumericCell row={row.original} field={field} />,
    }) satisfies ColumnDef<CpScreenerRow>),
  ], []);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const visibleRows = table.getRowModel().rows;
  const numericTabularRatio = CP_SCREENER_NUMERIC_FIELDS.length / CP_SCREENER_NUMERIC_FIELDS.length;

  return (
    <div
      className="cp-screener-lab"
      data-canvas-plus-screener-tanstack
      data-row-density={density}
      style={{ "--cp-active-row-height": `${CP_SCREENER_DENSITY_ROWS[density]}px` } as CSSProperties}
    >
      <section className="cp-screener-lab__toolbar" aria-label="TanStack screener controls">
        <div>
          <p className="cp-lab__eyebrow">CANVAS+ V3 SCREENER TANSTACK</p>
          <h1 className="cp-lab__title">TanStack Table comparison route</h1>
          <p className="cp-lab__summary">
            Same 1173-row fixture and visual rhythm, with TanStack sorting state isolated to this lab route.
          </p>
        </div>
        <label className="cp-screener-lab__search">
          <span>Filter</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="NVDA, semis, Korea..." />
        </label>
        <div className="cp-screener-lab__segments" aria-label="Row height mode">
          {DENSITY_OPTIONS.map((option) => (
            <CpButton
              key={option}
              density="compact"
              variant={density === option ? "primary" : "ghost"}
              aria-pressed={density === option}
              onClick={() => setDensity(option)}
            >
              {CP_SCREENER_DENSITY_LABEL[option]}
            </CpButton>
          ))}
        </div>
      </section>

      <section className="cp-screener-lab__stats" aria-label="Fixture stats">
        <div>
          <span>Fixture</span>
          <strong className="cp-screener-num">{fixture ? fixture.rows.length : "-"}</strong>
        </div>
        <div>
          <span>Source + shadow</span>
          <strong className="cp-screener-num">{fixture ? `${fixture.sourceCount}+${fixture.shadowCount}` : "-"}</strong>
        </div>
        <div>
          <span>Row mode</span>
          <strong className="cp-screener-num">{CP_SCREENER_DENSITY_LABEL[density]}</strong>
        </div>
        <div>
          <span>Tabular numeric ratio</span>
          <strong className="cp-screener-num">{numericTabularRatio.toFixed(2)}</strong>
        </div>
      </section>

      {error ? <p className="cp-screener-lab__error">Fixture load failed: {error}</p> : null}

      <div className="cp-screener-table-wrap" data-fixture-row-count={fixture?.targetCount ?? 0}>
        <table className="cp-screener-table" data-numeric-tabular-ratio={numericTabularRatio.toFixed(2)}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} data-align={isNumericColumnId(header.column.id) ? "right" : "left"}>
                    <button type="button" onClick={header.column.getToggleSortingHandler()}>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() ? <span aria-hidden="true">{header.column.getIsSorted() === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} data-fixture-kind={row.original.fixtureKind}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} data-align={isNumericColumnId(cell.column.id) ? "right" : "left"}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="cp-screener-card-grid" aria-label="Mobile screener cards">
        {visibleRows.slice(0, 24).map((row) => (
          <MobileCard key={row.id} row={row.original} />
        ))}
      </section>
    </div>
  );
}
