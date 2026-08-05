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

import type { BenchmarkOrdinalGroup, BenchmarkOrdinalRow } from "@/lib/market-valuation/benchmarkOrdinals";

const VIEW_W = 720;
const NAME_W = 150;
const VALUE_W = 74;
const ROW_H = 19;
const GROUP_GAP = 12;
const HEAD_H = 24;
const AXIS_H = 22;
const DOT_R = 4.5;

const PE = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

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
        aria-label="지수별 선행 PER의 자기 역사 내 백분위">
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

        {placed.map(({ group, rows, top }) => (
          <g key={group.id}>
            <text x={0} y={top + 9} fontSize={10} fontWeight={800} fill="var(--c-ink-3)">
              {group.label}
            </text>
            {rows.map((row, index) => {
              const y = top + 14 + index * ROW_H + ROW_H / 2;
              const pct = row.pe.percentile as number;
              const marked = highlight.has(row.id);
              return (
                <g key={row.id}>
                  <title>{`${displayName(row)} · 선행 PER ${PE.format(row.pe.current ?? 0)} · 자기 역사 ${pct}번째 백분위 · ${row.points}주 기준`}</title>
                  <text
                    x={NAME_W - 10} y={y + 3} textAnchor="end" fontSize={10.5}
                    fontWeight={marked ? 800 : 600}
                    fill={marked ? "var(--c-ink)" : "var(--c-ink-2)"}
                  >
                    {displayName(row)}
                  </text>
                  {/* A hairline from the median to the dot: the eye reads the
                      direction and the distance without needing the colour. */}
                  <line
                    x1={x(50)} x2={x(pct)} y1={y} y2={y}
                    stroke="var(--c-line)" strokeWidth={1.5}
                  />
                  <circle cx={x(pct)} cy={y} r={DOT_R + 1.5} fill="var(--c-panel)" />
                  <circle cx={x(pct)} cy={y} r={DOT_R} fill={dotColor(pct)} />
                  <text
                    x={VIEW_W - 6} y={y + 3} textAnchor="end" fontSize={10}
                    fontWeight={marked ? 800 : 600} fill="var(--c-ink-2)"
                  >
                    {PE.format(row.pe.current ?? 0)}배 · {pct}
                  </text>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
