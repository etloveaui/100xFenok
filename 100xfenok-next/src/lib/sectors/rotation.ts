import type { MomentumWindow, SectorMomentum, SectorRow } from "./types";

export type RotationWindow = "1w" | "1m" | "3m";

export const ROTATION_WINDOWS: ReadonlyArray<{ key: RotationWindow; label: string }> = [
  { key: "1w", label: "1주" },
  { key: "1m", label: "1개월" },
  { key: "3m", label: "3개월" },
];

export type QuadrantId = "run-expensive" | "cheap-recover" | "cheap-weak" | "rich-fade";

export const QUADRANT_LABEL: Record<QuadrantId, string> = {
  "run-expensive": "달리는·비싼",
  "cheap-recover": "싸고 회복",
  "cheap-weak": "싸고 약한",
  "rich-fade": "비싸고 꺾인",
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Forward P/E band percentile as 0–100, or null when the sector has no band. */
export function bandPosition(row: SectorRow): number | null {
  const percentile = row.valuation?.peBand?.percentile;
  if (!finiteNumber(percentile)) return null;
  return Math.max(0, Math.min(100, percentile * 100));
}

/** Relative momentum (%p) vs the S&P benchmark for a window, or null. */
export function relativeMomentum(row: SectorRow, windowKey: MomentumWindow, benchmarkValue: number | null): number | null {
  const value = row.momentum[windowKey];
  if (!finiteNumber(value) || !finiteNumber(benchmarkValue)) return null;
  return (value - benchmarkValue) * 100;
}

export function quadrantOf(relative: number, bandPct: number): QuadrantId {
  if (relative >= 0 && bandPct >= 50) return "run-expensive";
  if (relative >= 0) return "cheap-recover";
  if (bandPct >= 50) return "rich-fade";
  return "cheap-weak";
}

export interface RotationPoint {
  row: SectorRow;
  /** %p vs S&P for the selected window. */
  relative: number;
  /** 0–100 band position, or null when the sector has no band value. */
  band: number | null;
  quadrant: QuadrantId | null;
}

/** Sectors with a measurable relative momentum for the window, ranked desc. */
export function rotationPoints(rows: SectorRow[], windowKey: MomentumWindow, benchmarkValue: number | null): RotationPoint[] {
  return rows
    .map((row) => {
      const relative = relativeMomentum(row, windowKey, benchmarkValue);
      if (relative === null) return null;
      const band = bandPosition(row);
      return { row, relative, band, quadrant: band === null ? null : quadrantOf(relative, band) };
    })
    .filter((point): point is RotationPoint => point !== null)
    .sort((a, b) => b.relative - a.relative);
}

function formatPp(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(value)).toFixed(digits)}%p`;
}

/**
 * One-sentence rotation read. Quadrant moves compare the selected timeframe
 * against the previous SNAPSHOT (the earlier as-of in load history) — never
 * the previous timeframe axis. Each timeframe's relative momentum uses that
 * timeframe's own S&P benchmark. With no previous snapshot the read stays
 * partial instead of inventing moves.
 */
export function rotationRead(
  rows: SectorRow[],
  windowKey: RotationWindow,
  windowLabel: string,
  benchmarkMomentum: SectorMomentum | null,
  totalSectors: number,
  prevSnapshot: { rows: SectorRow[]; benchmarkMomentum: SectorMomentum | null } | null,
): string {
  const benchmarkValue = benchmarkMomentum?.[windowKey] ?? null;
  const points = rotationPoints(rows, windowKey, benchmarkValue);
  if (points.length === 0) return "선택 구간의 상대 모멘텀 자료가 없어 로테이션 지도를 그릴 수 없습니다.";
  const top = points[0];
  const beatCount = points.filter((point) => point.relative > 0).length;
  const topClause = top.quadrant
    ? `${top.row.name} ${formatPp(top.relative)}가 가장 강한 모멘텀으로 '${QUADRANT_LABEL[top.quadrant]}'에 있고`
    : `${top.row.name} ${formatPp(top.relative)}가 가장 강한 모멘텀이지만 밴드 미확보로 사분면 밖에 있고`;
  const base = `${windowLabel} 기준 ${topClause}, S&P 500 대비 상회 ${beatCount}/${totalSectors}개 섹터입니다.`;

  const prevBenchmark = prevSnapshot?.benchmarkMomentum?.[windowKey] ?? null;
  if (prevSnapshot === null) return `${base} 이전 스냅샷 없음 · 현재 사분면만 표시.`;
  const prevPoints = new Map(rotationPoints(prevSnapshot.rows, windowKey, prevBenchmark).map((point) => [point.row.key, point]));
  if (prevPoints.size === 0) return `${base} 직전 스냅샷에 비교 자료가 없어 이동 비교는 다음 갱신에 반영됩니다.`;
  const movers = points
    .filter((point) => {
      const prev = prevPoints.get(point.row.key);
      if (!prev || prev.quadrant === null || point.quadrant === null) return false;
      return prev.quadrant !== point.quadrant;
    })
    .map((point) => `${point.row.name}→'${QUADRANT_LABEL[point.quadrant as QuadrantId]}'`);
  if (movers.length === 0) return `${base} 직전 스냅샷 대비 사분면 이동은 없습니다.`;
  return `${base} 직전 스냅샷 대비 사분면 이동: ${movers.join(" · ")}.`;
}
