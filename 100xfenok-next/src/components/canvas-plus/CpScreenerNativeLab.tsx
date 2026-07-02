"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import CpBadge from "@/components/canvas-plus/CpBadge";
import CpButton from "@/components/canvas-plus/CpButton";
import {
  CP_SCREENER_DENSITY_LABEL,
  CP_SCREENER_DENSITY_ROWS,
  CP_SCREENER_NUMERIC_FIELDS,
  cpClassNames,
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

type SortKey = "ticker" | "sector" | CpScreenerNumericField;
type SortDir = "asc" | "desc";

const DENSITY_OPTIONS: CpScreenerDensity[] = ["compact", "default", "comfy"];
const SCREENER_PAGE_SIZE = 150;
const NATIVE_COLUMNS: Array<{ key: SortKey; label: string; numeric?: true }> = [
  { key: "ticker", label: "Ticker" },
  { key: "sector", label: "Sector" },
  { key: "price", label: "Price", numeric: true },
  { key: "marketCap", label: "Mkt cap", numeric: true },
  { key: "per", label: "PER", numeric: true },
  { key: "pbr", label: "PBR", numeric: true },
  { key: "return12m", label: "12M", numeric: true },
  { key: "roe", label: "ROE", numeric: true },
  { key: "opm", label: "OPM", numeric: true },
  { key: "momentum3m", label: "3M", numeric: true },
  { key: "fenokEdge", label: "Edge", numeric: true },
  { key: "rank", label: "Rank", numeric: true },
];

function compareRows(left: CpScreenerRow, right: CpScreenerRow, sortKey: SortKey, sortDir: SortDir): number {
  const modifier = sortDir === "asc" ? 1 : -1;
  if (sortKey === "ticker" || sortKey === "sector") {
    return left[sortKey].localeCompare(right[sortKey]) * modifier;
  }
  const leftValue = left[sortKey] ?? Number.NEGATIVE_INFINITY;
  const rightValue = right[sortKey] ?? Number.NEGATIVE_INFINITY;
  return (leftValue - rightValue) * modifier;
}

function formatCell(row: CpScreenerRow, key: SortKey): string {
  if (key === "ticker") return row.ticker;
  if (key === "sector") return row.sector;
  if (key === "marketCap") return formatCompactMarketCap(row.marketCap);
  if (key === "return12m" || key === "roe" || key === "opm" || key === "momentum3m") return formatPercent(row[key]);
  if (key === "fenokEdge" || key === "rank") return formatScore(row[key]);
  return formatNumber(row[key]);
}

function NumericCell({ row, field }: { row: CpScreenerRow; field: CpScreenerNumericField }) {
  return (
    <span className="cp-screener-num" data-numeric-cell data-tone={numericTone(row[field])}>
      {formatCell(row, field)}
    </span>
  );
}

function ScreenerMobileCard({ row }: { row: CpScreenerRow }) {
  return (
    <article className="cp-screener-card" data-mobile-card-target-height="360">
      <header className="cp-screener-card__header">
        <div>
          <h2>{row.ticker}</h2>
          <p>{row.name}</p>
        </div>
        <CpBadge tone={row.fixtureKind === "source" ? "positive" : "neutral"}>
          {row.fixtureKind === "source" ? "source" : "shadow"}
        </CpBadge>
      </header>
      <div className="cp-screener-card__meta">
        <span>{row.sector}</span>
        <span>{row.country}</span>
      </div>
      <dl className="cp-screener-card__metrics">
        {CP_SCREENER_NUMERIC_FIELDS.slice(0, 8).map((field) => (
          <div key={field}>
            <dt>{field}</dt>
            <dd className="cp-screener-num" data-numeric-cell data-tone={numericTone(row[field])}>
              {formatCell(row, field)}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default function CpScreenerNativeLab() {
  const [fixture, setFixture] = useState<CpScreenerFixture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [density, setDensity] = useState<CpScreenerDensity>("default");
  const [sortKey, setSortKey] = useState<SortKey>("fenokEdge");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(SCREENER_PAGE_SIZE);

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

  const rows = useMemo(() => {
    const sourceRows = fixture?.rows ?? [];
    const normalizedQuery = query.trim().toUpperCase();
    const filteredRows = normalizedQuery
      ? sourceRows.filter((row) =>
          `${row.ticker} ${row.name} ${row.sector}`.toUpperCase().includes(normalizedQuery),
        )
      : sourceRows;
    return [...filteredRows].sort((left, right) => compareRows(left, right, sortKey, sortDir));
  }, [fixture?.rows, query, sortDir, sortKey]);

  const filterSignature = `${query}|${sortKey}|${sortDir}`;
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (filterSignature !== prevFilterSignature) {
    setPrevFilterSignature(filterSignature);
    setVisibleCount(SCREENER_PAGE_SIZE);
  }

  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);
  const canShowMore = visibleCount < rows.length;

  const numericTabularRatio = CP_SCREENER_NUMERIC_FIELDS.length / CP_SCREENER_NUMERIC_FIELDS.length;

  return (
    <div
      className="cp-screener-lab"
      data-canvas-plus-screener-native
      data-row-density={density}
      style={{ "--cp-active-row-height": `${CP_SCREENER_DENSITY_ROWS[density]}px` } as CSSProperties}
    >
      <section className="cp-screener-lab__toolbar" aria-label="Native screener controls">
        <div>
          <p className="cp-lab__eyebrow">CANVAS+ V3 SCREENER NATIVE</p>
          <h1 className="cp-lab__title">Native enhanced density grid</h1>
          <p className="cp-lab__summary">
            No table dependency: fixed row rhythm, full fixture scroll, and tabular numeric cells for a direct baseline.
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
            <tr>
              {NATIVE_COLUMNS.map((column) => (
                <th key={column.key} data-align={column.numeric ? "right" : "left"}>
                  <button
                    type="button"
                    onClick={() => {
                      if (sortKey === column.key) {
                        setSortDir((current) => current === "asc" ? "desc" : "asc");
                      } else {
                        setSortKey(column.key);
                        setSortDir(column.numeric ? "desc" : "asc");
                      }
                    }}
                  >
                    {column.label}
                    {sortKey === column.key ? <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.id} data-fixture-kind={row.fixtureKind}>
                <th scope="row">
                  <span className="cp-screener-ticker">{row.ticker}</span>
                  <span>{row.name}</span>
                </th>
                <td>{row.sector}</td>
                {CP_SCREENER_NUMERIC_FIELDS.map((field) => (
                  <td key={field} data-align="right">
                    <NumericCell row={row} field={field} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="cp-screener-lab__loadmore"
        data-screener-loadmore
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "12px 0" }}
      >
        <p style={{ margin: 0 }}>
          {rows.length}개 중 {visibleRows.length}개 표시
        </p>
        {canShowMore ? (
          <CpButton
            density="compact"
            variant="ghost"
            onClick={() => setVisibleCount((current) => Math.min(rows.length, current + SCREENER_PAGE_SIZE))}
          >
            더 보기 (150개씩)
          </CpButton>
        ) : null}
      </div>

      <section className="cp-screener-card-grid" aria-label="Mobile screener cards">
        {rows.slice(0, 24).map((row) => (
          <ScreenerMobileCard key={row.id} row={row} />
        ))}
      </section>
    </div>
  );
}
