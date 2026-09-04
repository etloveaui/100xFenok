"use client";

import { EvidenceRail, Panel, PanelHeader } from "@/components/ui";
import { formatAsOf, isStaleAsOf } from "@/lib/data-state";
import { ROUTES } from "@/lib/routes";
import {
  MOMENTUM_WINDOWS,
  type MomentumWindow,
  type SectorRow,
  type SectorMomentum,
} from "@/lib/sectors/types";

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function formatPp(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(1)}%p`;
}

/** Rank (1 = strongest) by relative momentum for one window; empty when the benchmark is missing. */
function rankForWindow(
  rows: SectorRow[],
  windowKey: MomentumWindow,
  benchmark: number | null,
): Map<string, { rank: number; relative: number }> {
  if (!finiteNumber(benchmark)) return new Map();
  const base = benchmark;
  const valued = rows
    .map((row) => {
      const value = row.momentum[windowKey];
      if (!finiteNumber(value)) return null;
      return { key: row.key, relative: (value - base) * 100 };
    })
    .filter((entry): entry is { key: string; relative: number } => entry !== null)
    .sort((a, b) => b.relative - a.relative);
  return new Map(valued.map((entry, index) => [entry.key, { rank: index + 1, relative: entry.relative }]));
}

export default function RotationStripPanel({
  rows,
  benchmarkMomentum,
  loading,
  ready,
  failed,
  stale,
  clock,
  lkgClock,
  onRetry,
}: {
  rows: SectorRow[];
  benchmarkMomentum: SectorMomentum | null;
  loading: boolean;
  ready: boolean;
  failed: boolean;
  stale: boolean;
  clock: string | null;
  lkgClock: string | null;
  onRetry: () => void;
}) {
  const ranks = new Map(
    MOMENTUM_WINDOWS.map((window) => [
      window.key,
      rankForWindow(rows, window.key, benchmarkMomentum?.[window.key] ?? null),
    ]),
  );
  // A window is complete only when all 11 sectors carry a value; coverage
  // counts sector×window cells present (e.g. 52/55), never valued windows.
  const valueCount = (windowKey: MomentumWindow) =>
    rows.filter((row) => finiteNumber(row.momentum[windowKey])).length;
  const completeWindows = MOMENTUM_WINDOWS.filter(
    (window) => rows.length > 0 && valueCount(window.key) >= rows.length,
  );
  const presentCells = MOMENTUM_WINDOWS.reduce((sum, window) => sum + valueCount(window.key), 0);
  const totalCells = rows.length * MOMENTUM_WINDOWS.length;
  const coverageLabel = totalCells > 0
    ? `${presentCells}/${totalCells} · ${MOMENTUM_WINDOWS.map((window) => `${window.key.toUpperCase()} ${valueCount(window.key)}/${rows.length}`).join(" · ")}`
    : "—";
  // Row order follows the 1M rank so the strip reads top-to-bottom strongest-first.
  const orderRank = ranks.get("1m") ?? new Map<string, { rank: number; relative: number }>();
  const ordered = [...rows].sort(
    (a, b) => (orderRank.get(a.key)?.rank ?? 999) - (orderRank.get(b.key)?.rank ?? 999),
  );
  const empty = !loading && (!ready || presentCells === 0);
  const asOfLabel = formatAsOf(clock) ?? "—";
  const partial = ready && completeWindows.length < MOMENTUM_WINDOWS.length;
  const clockStale = isStaleAsOf(clock);

  return (
    <Panel
      className="sec-rank-panel"
      loading={loading}
      empty={empty}
      emptyReason={failed || !ready ? "구간별 섹터 순위를 불러오지 못했습니다" : "표시할 순위 자료가 없습니다"}
      emptyNextRefresh="다음 마감 후 갱신"
      emptyActionLabel={failed || !ready ? "다시 시도" : undefined}
      onEmptyAction={failed || !ready ? onRetry : undefined}
      stale={stale || clockStale}
      asOf={clock ?? undefined}
      onRetry={stale || clockStale ? onRetry : undefined}
    >
      {ready && presentCells > 0 && (
        <div className="sec-rank-strip" data-sectors-rank-strip="true">
          <PanelHeader
            eyebrow="Rank Bump"
            title="순위 변화 띠"
            right={<span className="sec-head-note">S&P 대비 초과성과 순위</span>}
          />
          <div className="sec-rank-scroll">
            <table className="sec-rank-table">
              <thead>
                <tr>
                  <th scope="col" className="sec-rank-th-name">섹터</th>
                  {MOMENTUM_WINDOWS.map((window) => (
                    <th scope="col" key={window.key}>{window.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ordered.map((row) => (
                  <tr key={row.key} className="sec-rank-row" data-sectors-rank-row={row.etf}>
                    <th scope="row" className="sec-rank-name">
                      {row.name} <span className="sec-ticker">{row.etf}</span>
                    </th>
                    {MOMENTUM_WINDOWS.map((window, windowIndex) => {
                      const cell = ranks.get(window.key)?.get(row.key);
                      // Rank movement vs the adjacent (previous) window: climbed
                      // (smaller rank number) reads ▲, slipped reads ▼. The
                      // marker is neutral — only the number carries gain/loss.
                      const prev = windowIndex > 0
                        ? ranks.get(MOMENTUM_WINDOWS[windowIndex - 1].key)?.get(row.key)
                        : undefined;
                      const delta = cell && prev ? prev.rank - cell.rank : null;
                      return (
                        <td
                          key={window.key}
                          className={cell ? (cell.relative >= 0 ? "sec-up tabular-nums" : "sec-down tabular-nums") : "tabular-nums sec-mute"}
                        >
                          {cell ? `#${cell.rank} · ${formatPp(cell.relative)}` : "—"}
                          {delta !== null && delta !== 0 && (
                            <span className="sec-rank-move">{delta > 0 ? `▲${delta}` : `▼${-delta}`}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <EvidenceRail
        freshness={loading ? "pending" : failed || !ready ? "error" : stale || clockStale ? "stale" : partial ? "partial" : clock ? "fresh" : "fixed"}
        source="SlickCharts · Yahoo"
        asOf={asOfLabel}
        coverage={ready ? coverageLabel : "—"}
        lkgAsOf={(stale || clockStale) && lkgClock ? (formatAsOf(lkgClock) ?? lkgClock) : undefined}
        onRetry={failed || !ready || stale || clockStale || partial ? onRetry : undefined}
        onEvidence={ready && !failed ? () => window.open(ROUTES.sectorMomentumJson, "_blank", "noopener") : undefined}
      />
    </Panel>
  );
}
