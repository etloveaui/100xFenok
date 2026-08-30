"use client";

import { useId } from "react";

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

import { benchmarkHorizonReading, type BenchmarkOrdinalGroup, type BenchmarkOrdinalHorizon, type BenchmarkOrdinalRow } from "@/lib/market-valuation/benchmarkOrdinals";
import { formatElapsedKo } from "@/lib/format";

const VIEW_W = 720;
const NAME_W = 150;
const VALUE_W = 170;
const ROW_H = 36;
const GROUP_GAP = 12;
const HEAD_H = 24;
const AXIS_H = 22;
const DOT_R = 4.5;

const PE = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });

function ordinalMeaning(pct: number): string {
  if (pct >= 80) return "역사상 고평가 구간";
  if (pct >= 60) return "자기 역사보다 높은 편";
  if (pct > 40) return "자기 역사 중앙값 근처";
  if (pct > 20) return "자기 역사보다 낮은 편";
  return "역사상 저평가 구간";
}

const HORIZONS: ReadonlyArray<{ id: BenchmarkOrdinalHorizon; label: string }> = [
  { id: "all", label: "전체" },
  { id: "w5", label: "5년" },
  { id: "w10", label: "10년" },
];

function horizonLabel(horizon: BenchmarkOrdinalHorizon): string {
  return HORIZONS.find((item) => item.id === horizon)?.label ?? "10년";
}

function deltaFromAverage(current: number | null, average: number | null): number | null {
  if (current === null || average === null || average === 0) return null;
  return (current / average - 1) * 100;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return "평균 대비 —";
  return `평균 대비 ${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatAverage(value: number | null): string {
  return value === null ? "평균 —" : `평균 ${PE.format(value)}배`;
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
  rows: Array<{ row: BenchmarkOrdinalRow; reading: ReturnType<typeof benchmarkHorizonReading> }>;
  top: number;
}

export interface OrdinalStripProps {
  groups: BenchmarkOrdinalGroup[];
  /** Indices to call out by name because another method also speaks about them. */
  highlightIds?: string[];
  horizon: BenchmarkOrdinalHorizon;
  onHorizonChange: (horizon: BenchmarkOrdinalHorizon) => void;
}

export default function OrdinalStrip({ groups, highlightIds = [], horizon, onHorizonChange }: OrdinalStripProps) {
  const descriptionId = useId();
  const entries = groups.map((group) => ({
    group,
    rows: group.rows.map((row) => ({ row, reading: benchmarkHorizonReading(row, horizon) })),
  }));
  const usable = entries
    .map((entry) => ({ ...entry, rows: entry.rows.filter(({ reading }) => reading.percentile !== null) }))
    .filter((entry) => entry.rows.length > 0);
  const allRows = entries.flatMap((entry) => entry.rows);
  const totalCount = allRows.length;
  const rankableCount = allRows.filter(({ reading }) => reading.percentile !== null).length;
  const lowCount = allRows.filter(({ reading }) => reading.percentile !== null && reading.percentile <= 40).length;
  const middleCount = allRows.filter(({ reading }) => reading.percentile !== null && reading.percentile >= 41 && reading.percentile <= 59).length;
  const highCount = allRows.filter(({ reading }) => reading.percentile !== null && reading.percentile >= 60).length;

  const withheld = allRows
    .filter(({ reading }) => reading.percentile === null)
    .map(({ row, reading }) => ({
      id: row.id,
      name: displayName(row),
      reason: row.pe.current === null
        ? row.pe.currentStaleDays !== null && row.pe.currentStaleDays > 45
          ? `선행 이익 추정치로 배수를 계산할 수 없습니다 (마지막 계산 가능일 ${formatElapsedKo(row.pe.currentStaleDays)} 전)`
          : "현재 선행 PER을 계산할 수 없습니다"
        : reading.truncated && reading.spanYears !== null
          ? `${horizonLabel(horizon)} 데이터는 실제 ${reading.spanYears}년, ${reading.points}개 주간 관측만 있어 순위를 계산하지 않습니다 (전체 역사로 대신 계산하지 않습니다)`
          : `${horizonLabel(horizon)} 데이터가 ${reading.points}개 관측으로 부족해 순위를 계산하지 않습니다`,
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
      <div className="mv-ordinal-controls">
        <div className="mv-ordinal-horizon-selector" role="group" aria-label="역사 기간 선택">
          {HORIZONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="mv-ordinal-horizon-button"
              aria-pressed={horizon === item.id}
              onClick={() => onHorizonChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mv-ordinal-summary" aria-live="polite" aria-atomic="true">
          {rankableCount < totalCount ? <strong>표시 {rankableCount}/{totalCount}</strong> : null}
          <span>낮은 편 <strong>{lowCount}</strong></span>
          <span>중앙권 <strong>{middleCount}</strong></span>
          <span>높은 편 <strong>{highCount}</strong></span>
        </div>
      </div>
      <details className="mv-ordinal-explanation">
        <summary>지표 읽는 법</summary>
        <div>
          <p>백분위는 선택한 기간의 선행 PER 중 현재값보다 낮았던 관측치의 비율입니다.</p>
          <p>50은 자기 역사 중앙값입니다. 평균은 같은 관측 모집단의 산술 평균입니다.</p>
          <p>관측 수는 순위를 계산할 수 없는 경우에만 사유와 함께 표시하며, 전체 역사로 대신 계산하지 않습니다.</p>
        </div>
      </details>

      {usable.length > 0 ? <div className="mv-ordinal-chart">
        <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" height={height} role="img"
          aria-label={`지수별 선행 PER 백분위 — ${horizonLabel(horizon)} 기준`}
          aria-describedby={descriptionId}>
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
          <text x={VIEW_W - 6} y={HEAD_H - 14} textAnchor="end" fontSize={9} fontWeight={800} fill="var(--c-ink-3)">
            백분위 · 현재 PER
          </text>
          {placed.map(({ group, rows, top }) => (
            <g key={group.id}>
              <text x={0} y={top + 9} fontSize={10} fontWeight={800} fill="var(--c-ink-3)">
                {group.label}
              </text>
              {rows.map(({ row, reading }, index) => {
                const y = top + 14 + index * ROW_H + ROW_H / 2;
                const pct = reading.percentile as number;
                const marked = highlight.has(row.id);
                const delta = deltaFromAverage(row.pe.current, reading.average);
                const titleText = `${displayName(row)} · ${horizonLabel(horizon)} 선행 PER ${row.pe.current === null ? "없음" : PE.format(row.pe.current)} · ${pct}번째 백분위 · ${formatAverage(reading.average)} · ${formatSignedPercent(delta)}`;
                return (
                  <g key={row.id}>
                    <title>{titleText}</title>
                    <text
                      x={NAME_W - 10} y={y - 6} textAnchor="end" fontSize={10.5}
                      fontWeight={marked ? 800 : 600}
                      fill={marked ? "var(--c-ink)" : "var(--c-ink-2)"}
                    >
                      {displayName(row)}
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
                      {pct}백분위 · {row.pe.current === null ? "배수 없음" : `${PE.format(row.pe.current)}배`}
                    </text>
                    <text x={VIEW_W - 6} y={y + 10} textAnchor="end" fontSize={9} fill="var(--c-ink-3)">
                      {formatAverage(reading.average)} · {formatSignedPercent(delta)}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div> : null}

      <ul id={descriptionId} className="mv-ordinal-desktop-a11y">
        {usable.flatMap(({ rows }) => rows).map(({ row, reading }) => {
          const pct = reading.percentile as number;
          const delta = deltaFromAverage(row.pe.current, reading.average);
          return (
            <li key={row.id}>
              {displayName(row)} · {horizonLabel(horizon)} · 현재 선행 PER {row.pe.current === null ? "없음" : `${PE.format(row.pe.current)}배`} · {pct}번째 백분위 · {formatAverage(reading.average)} · {formatSignedPercent(delta)}
            </li>
          );
        })}
      </ul>

      <div className="mv-ordinal-mobile">
        {usable.map(({ group, rows }) => (
          <section key={group.id} className="mv-ordinal-mobile-group">
            <h3>{group.label}</h3>
            <ul>
              {rows.map(({ row, reading }) => {
                const pct = reading.percentile as number;
                const delta = deltaFromAverage(row.pe.current, reading.average);
                const marked = highlight.has(row.id);
                return (
                  <li key={row.id} className={`mv-ordinal-mobile-item${marked ? " is-highlighted" : ""}`}>
                    <div className="mv-ordinal-mobile-head">
                      <div className="mv-ordinal-mobile-identity">
                        <strong>{displayName(row)}</strong>
                        <small>{ordinalMeaning(pct)}</small>
                      </div>
                      <span className="mv-ordinal-mobile-percentile"><strong>{pct}</strong><small>백분위</small></span>
                    </div>
                    <div className="mv-ordinal-meter" aria-hidden="true">
                      <span className="mv-ordinal-meter-median" />
                      <span
                        className="mv-ordinal-meter-distance"
                        style={{ left: `${Math.min(pct, 50)}%`, width: `${Math.abs(pct - 50)}%` }}
                      />
                      <span className="mv-ordinal-meter-dot" style={{ left: `${pct}%`, background: dotColor(pct) }} />
                    </div>
                    <div className="mv-ordinal-mobile-metrics">
                      <span>현재 <strong>{row.pe.current === null ? "배수 없음" : `${PE.format(row.pe.current)}배`}</strong></span>
                      <span>{formatAverage(reading.average)}</span>
                      <span className="mv-ordinal-mobile-delta">{formatSignedPercent(delta)}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {withheld.length > 0 ? (
        <div className="ordinal-withheld">
          <strong>{horizonLabel(horizon)} 기준 확인이 필요한 지수</strong>
          <ul>{withheld.map((w) => <li key={w.id}>{w.name}: {w.reason}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
