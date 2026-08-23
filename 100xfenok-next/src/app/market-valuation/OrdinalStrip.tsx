"use client";

// Thirty-eight indices, one question: where does each sit in its OWN history?
//
// Percentile is the only measure on this page that is comparable across all of
// them — a P/E of 5.5 and a P/E of 36 mean nothing side by side, but "0th of its
// own 866 weeks" and "33rd of its own 866 weeks" do. So the axis is 0–100 and
// every index gets one dot on it.
//
// POSITION carries the value, not colour. That is deliberate: this project's
// own gain/loss pair separates by ΔE 3.8 under deuteranopia, which means a
// red-green reader cannot tell expensive from cheap by hue at all. Here the dot
// sits at its percentile, the number is printed on the row, and colour is a
// third, redundant cue with a neutral midpoint at the historical median.
//
// The 50 line is not decoration. It is the index's own median, and "which side
// of its own median" is the one claim every row can make honestly.

import type { BenchmarkOrdinalGroup, BenchmarkOrdinalRow, BenchmarkWindowId } from "@/lib/market-valuation/benchmarkOrdinals";
import { formatElapsedKo } from "@/lib/format";

const VIEW_W = 720;
const NAME_W = 150;
const VALUE_W = 74;
const ROW_H = 28;
const GROUP_GAP = 12;
const HEAD_H = 24;
const AXIS_H = 22;
const DOT_R = 4.5;

const PE = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

/**
 * Trailing-window readout for one row: "10y 56 · 5y 37 · 3y 17". A window the
 * data cannot span is REFUSED and shows its ACTUAL held span instead of a
 * number ("10y 6y" = the 10y window holds only ~6y) — missing is missing,
 * never substituted. A dash means the window exists but is too short to rank.
 */
function windowReadout(row: BenchmarkOrdinalRow): { text: string; hasSpan: boolean } {
  const w = row.pe.windows;
  const parts: string[] = [];
  let hasSpan = false;
  const order: Array<[BenchmarkWindowId, string]> = [
    ["w10", "10y"], ["w5", "5y"], ["w3", "3y"],
  ];
  for (const [id, label] of order) {
    const m = w[id];
    if (m.percentile !== null) {
      parts.push(`${label} ${m.percentile}`);
    } else if (m.truncated && m.spanYears !== null) {
      parts.push(`${label} ${m.spanYears}y`);
      hasSpan = true;
    } else {
      parts.push(`${label} —`);
    }
  }
  return { text: parts.join(" · "), hasSpan };
}

/** Windows straddle the index's own median: some percentiles ≥ 50, some < 50. */
function windowsStraddleMedian(row: BenchmarkOrdinalRow): boolean {
  const pcts = [row.pe.windows.w3.percentile, row.pe.windows.w5.percentile, row.pe.windows.w10.percentile]
    .filter((p): p is number => p !== null);
  return pcts.some((p) => p >= 50) && pcts.some((p) => p < 50);
}

// §H rule 2: no raw index ids reach users. The benchmark payload names carry
// their Bloomberg ticker in parentheses — and one of them carries a typo in the
// source ("Ressell 2000") — so a display name is either mapped here or has its
// ticker suffix stripped. Nothing renders the raw name unchanged.
const ORDINAL_LABELS_KO: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq100: "나스닥 100",
  nasdaq_composite: "나스닥 종합",
  russell2000: "러셀 2000",
  euro_stoxx_50: "유로스톡스 50",
  hong_kong: "홍콩 항셍",
  nikkei: "닛케이 225",
  topix: "토픽스",
  brazil: "브라질 보베스파",
  hang_seng_h: "항셍 중국기업",
  india_sensex: "인도 센섹스",
  kospi: "코스피",
  shanghai: "상하이 종합",
  vietnam: "베트남 VN",
  china: "MSCI 중국",
  developed: "MSCI 선진",
  emerging: "MSCI 신흥",
  india: "MSCI 인도",
  korea: "MSCI 한국",
  world: "MSCI 전세계",
  hang_seng_tech: "항셍 테크",
  kosdaq_150: "코스닥 150",
  philadelphia_semi: "필라델피아 반도체",
  us_biotech: "미국 바이오텍",
  us_regional_banks: "미국 지역은행",
  "과창판_(star50_index)": "커촹반 STAR 50",
};

function displayName(row: BenchmarkOrdinalRow): string {
  const mapped = ORDINAL_LABELS_KO[row.id.toLowerCase()];
  if (mapped) return mapped;
  // Strip a trailing "(TICKER Index)" so a ticker never reaches the surface.
  return row.name.replace(/\s*\([^)]*\b(index|지수)\b[^)]*\)\s*$/i, "").trim() || row.name;
}

/** Diverging by percentile, neutral at the median. Redundant to position. */
function dotColor(pct: number): string {
  if (pct >= 80) return "var(--c-chart-ord-rich)";
  if (pct >= 60) return "var(--c-chart-ord-rich-soft)";
  if (pct > 40) return "var(--c-chart-ord-mid)";
  if (pct > 20) return "var(--c-chart-ord-cheap-soft)";
  return "var(--c-chart-ord-cheap)";
}

interface Placed {
  group: BenchmarkOrdinalGroup;
  rows: BenchmarkOrdinalRow[];
  top: number;
}

export interface OrdinalStripProps {
  groups: BenchmarkOrdinalGroup[];
  /** Indices to call out by name because another method also speaks about them. */
  highlightIds?: string[];
}

export default function OrdinalStrip({ groups, highlightIds = [] }: OrdinalStripProps) {
  const usable = groups
    .map((group) => ({ group, rows: group.rows.filter((r) => r.pe.percentile !== null) }))
    .filter((entry) => entry.rows.length > 0);
  if (usable.length === 0) return null;

  // An index that cannot be placed on this axis is NAMED rather than dropped in
  // silence. us_biotech is the live case: its forward EPS is negative, so no
  // multiple exists and the strip has no position to plot - but a reader
  // counting rows would otherwise just find one missing.
  const withheld = groups
    .flatMap((group) => group.rows)
    .filter((r) => r.pe.percentile === null)
    .map((r) => ({
      name: displayName(r),
      reason: r.pe.currentStaleDays !== null && r.pe.currentStaleDays > 45
        ? `선행 이익 추정치로 배수를 계산할 수 없습니다 (마지막 계산 가능일 ${formatElapsedKo(r.pe.currentStaleDays)} 전)`
        : "배수를 계산할 수 없습니다",
    }));

  const placed: Placed[] = [];
  let cursor = HEAD_H;
  for (const entry of usable) {
    placed.push({ ...entry, top: cursor });
    cursor += 14 + entry.rows.length * ROW_H + GROUP_GAP;
  }
  const plotBottom = cursor - GROUP_GAP;
  const height = plotBottom + AXIS_H;

  const inner = VIEW_W - NAME_W - VALUE_W;
  const x = (pct: number) => NAME_W + (pct / 100) * inner;
  const ticks = [0, 25, 50, 75, 100];

  const highlight = new Set(highlightIds);

  return (
    <div className="mv-ordinal">
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" height={height} role="img"
        aria-label="지수별 선행 PER 백분위 — 자기 역사 전체와 10년·5년·3년 창, 창이 중앙값을 가로지르는 지수 표시">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={x(tick)} x2={x(tick)} y1={HEAD_H - 8} y2={plotBottom}
              stroke={tick === 50 ? "var(--c-ink-3)" : "var(--c-line-2)"}
              strokeWidth={tick === 50 ? 1.5 : 1}
              strokeDasharray={tick === 50 ? "4 3" : undefined}
            />
            <text x={x(tick)} y={height - 7} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--c-ink-3)">
              {tick}
            </text>
          </g>
        ))}
        <text x={x(0)} y={HEAD_H - 14} textAnchor="start" fontSize={10} fontWeight={800} fill="var(--c-chart-ord-cheap)">
          역사상 저평가
        </text>
        <text x={x(50)} y={HEAD_H - 14} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--c-ink-3)">
          자기 역사 중앙값
        </text>
        <text x={x(100)} y={HEAD_H - 14} textAnchor="end" fontSize={10} fontWeight={800} fill="var(--c-chart-ord-rich)">
          역사상 고평가
        </text>
        <text x={VIEW_W - 6} y={HEAD_H - 14} textAnchor="end" fontSize={8.5} fill="var(--c-ink-3)">
          행 아래 10y·5y·3y = 창 백분위 · ⇅ = 창이 중앙값을 가로지름 · 이탤릭 "10y 6y" = 10년 창에 보유 약 6년
        </text>

        {placed.map(({ group, rows, top }) => (
          <g key={group.id}>
            <text x={0} y={top + 9} fontSize={10} fontWeight={800} fill="var(--c-ink-3)">
              {group.label}
            </text>
            {rows.map((row, index) => {
              const y = top + 14 + index * ROW_H + ROW_H / 2;
              const pct = row.pe.percentile as number;
              const marked = highlight.has(row.id);
              const straddle = windowsStraddleMedian(row);
              const windows = windowReadout(row);
              const titleText = `${displayName(row)} · 선행 PER ${row.pe.current === null ? "없음" : PE.format(row.pe.current)} · 자기 역사 ${pct}번째 백분위 · ${row.points}주 기준 · 창 10y/5y/3y: ${windows.text}${straddle ? " · 창이 중앙값을 가로지름" : ""}`;
              return (
                <g key={row.id}>
                  <title>{titleText}</title>
                  <text
                    x={NAME_W - 10} y={y - 6} textAnchor="end" fontSize={10.5}
                    fontWeight={marked ? 800 : 600}
                    fill={marked ? "var(--c-ink)" : "var(--c-ink-2)"}
                  >
                    {straddle ? "⇅ " : ""}{displayName(row)}
                  </text>
                  {/* Trailing-window readout (10y/5y/3y) under the name; a span
                      figure like "10y 6y" is the ACTUAL data held for a refused
                      window, never a percentile. */}
                  <text
                    x={NAME_W - 10} y={y + 10} textAnchor="end" fontSize={8.5}
                    fill={windows.hasSpan ? "var(--c-ink-3)" : "var(--c-ink-3)"}
                    fontStyle={windows.hasSpan ? "italic" : undefined}
                  >
                    {windows.text}
                  </text>
                  {/* A hairline from the median to the dot: the eye reads the
                      direction and the distance without needing the colour. */}
                  <line
                    x1={x(50)} x2={x(pct)} y1={y - 9} y2={y - 9}
                    stroke="var(--c-line)" strokeWidth={1.5}
                  />
                  <circle cx={x(pct)} cy={y - 9} r={DOT_R + 1.5} fill="var(--c-panel)" />
                  <circle cx={x(pct)} cy={y - 9} r={DOT_R} fill={dotColor(pct)} />
                  <text
                    x={VIEW_W - 6} y={y - 6} textAnchor="end" fontSize={10}
                    fontWeight={marked ? 800 : 600} fill="var(--c-ink-2)"
                  >
                    {row.pe.current === null ? "배수 없음" : `${PE.format(row.pe.current)}배`} · {pct}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {withheld.length > 0 ? (
        <p className="ordinal-withheld">
          {withheld.map((w) => `${w.name}: ${w.reason}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
