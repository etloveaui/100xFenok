"use client";

// Every index, every method, one axis.
//
// The first draft drew a card per index. Each card scaled itself, so a +265%
// band and a +45% band rendered at the same width, and a reader comparing
// lengths down the page was reading a lie. This draws ONE figure: one row per
// index, one shared domain, one zero rule through all of them. Length means the
// same thing everywhere, which is the only thing that makes stacked rows
// comparable at all.
//
// The axis is percent against each index's own current price, so zero reads as
// "the market is right" and distance from it is the size of the claim. A band
// draws as a band and a point as a point; neither collapses into the other,
// because a midpoint is the single target the producers refuse to publish.
//
// Colour carries method identity only. It deliberately does not encode sign:
// position already carries that, and colouring by sign would repaint the same
// method between rows. Both hues are validated against the light and the dark
// surface — lightness band, chroma floor, CVD separation, contrast — and the
// dark pair is stepped for the dark surface rather than flipped from the light.
// Identity never rests on colour alone: each method is named in the legend and
// every row is repeated as text.

import type { MethodologyAxisView, MethodologyReading } from "./methodologyAxis";

const PERCENT = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});
const PERCENT_1 = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const LEVEL = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

const VIEW_W = 720;
const LABEL_W = 132;
const PAD_R = 52;
const ROW_H = 30;
const HEAD_H = 22;
const AXIS_H = 26;
const BAND_H = 13;
const MARKER_R = 5.5;

function lensColor(lensIndex: number): string {
  return lensIndex === 0 ? "var(--c-chart-lens-1)" : "var(--c-chart-lens-2)";
}

/** A step from the 1/2/5 family, so tick labels are round numbers. */
function buildTicks(min: number, max: number): number[] {
  const span = max - min;
  const raw = span / 5;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
    ticks.push(Math.abs(t) < 1e-9 ? 0 : t);
  }
  return ticks;
}

function horizonOf(axes: MethodologyAxisView[], lens: string): string {
  for (const axis of axes) {
    const reading = axis.readings.find((r) => r.lens === lens);
    if (reading) return reading.horizon;
  }
  return "";
}

function readingMeaning(reading: MethodologyReading): string {
  if (reading.kind === "band") {
    if (reading.highPct < 0) return "현재가보다 낮은 범위";
    if (reading.lowPct > 0) return "현재가보다 높은 범위";
    return "현재가를 포함하는 범위";
  }
  if (reading.lowPct < 0) return "현재가보다 낮은 수준";
  if (reading.lowPct > 0) return "현재가보다 높은 수준";
  return "현재가와 같은 수준";
}

function readingValue(reading: MethodologyReading): string {
  return reading.kind === "band"
    ? `${PERCENT_1.format(reading.lowPct)} ~ ${PERCENT_1.format(reading.highPct)}`
    : PERCENT_1.format(reading.lowPct);
}

function readingLevel(reading: MethodologyReading): string {
  return reading.kind === "band"
    ? `${LEVEL.format(reading.impliedLow)} ~ ${LEVEL.format(reading.impliedHigh)}`
    : LEVEL.format(reading.impliedLow);
}

function Mark({
  reading,
  x,
  mid,
  color,
  clipAt = null,
}: {
  reading: MethodologyReading;
  x: (pct: number) => number;
  mid: number;
  color: string;
  /** Pixel at which a row that runs past the axis is cut, with a marker. */
  clipAt?: number | null;
}) {
  const title = `${reading.lens} · ${reading.kind === "band"
    ? `${PERCENT_1.format(reading.lowPct)}~${PERCENT_1.format(reading.highPct)}`
    : PERCENT_1.format(reading.lowPct)} · 기준일 ${reading.asOf}`;

  if (reading.kind === "band") {
    const rawX1 = x(reading.lowPct);
    const rawX2 = x(reading.highPct);
    // Clamp BOTH ends. A row can sit entirely past the axis — KOSPI's band
    // starts at +265% — and capping only the right end left it drawn as a
    // one-pixel sliver off-canvas, i.e. an empty row. It now runs to the edge
    // and the chevron beside it says the rest is off-axis.
    const x2 = clipAt === null ? rawX2 : Math.min(rawX2, clipAt);
    const x1 = clipAt === null ? rawX1 : Math.min(rawX1, clipAt - 28);
    return (
      <g>
        <title>{title}</title>
        {/* A surface ring keeps the band legible where it crosses the zero rule
            or the other method's marker. */}
        <rect
          x={x1 - 1.5} y={mid - BAND_H / 2 - 1.5} width={Math.max(x2 - x1, 2) + 3} height={BAND_H + 3}
          rx={(BAND_H + 3) / 2} fill="var(--c-panel)"
        />
        <rect
          x={x1} y={mid - BAND_H / 2} width={Math.max(x2 - x1, 1)} height={BAND_H}
          rx={BAND_H / 2} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={2}
        />
      </g>
    );
  }

  const cx = x(reading.lowPct);
  return (
    <g>
      <title>{title}</title>
      <circle cx={cx} cy={mid} r={MARKER_R + 2} fill="var(--c-panel)" />
      <circle cx={cx} cy={mid} r={MARKER_R} fill={color} />
    </g>
  );
}

export interface MethodologyChartProps {
  axes: MethodologyAxisView[];
  /** Rows the gate withheld, so a short list is not read as a short market. */
  withheldRows?: Array<{ label: string; reason: string }>;
}

export default function MethodologyBar({ axes, withheldRows = [] }: MethodologyChartProps) {
  const drawable = axes.filter((axis) => axis.readings.length > 0);
  if (drawable.length === 0) return null;

  // ONE domain for every row. This is the whole point of the redraw.
  //
  // One exception, and it is not "drop the inconvenient row". When a single
  // index's claim is an order of magnitude past the rest, fitting the axis to it
  // compresses every other row into a stub and the figure stops saying anything.
  // Dropping it would be worse: it is a real published range for a market the
  // reader cares about. So the axis is set by the others and that row is drawn
  // clipped, with a chevron at the edge and its true numbers on the row — the
  // reader is told the row continues, never shown a shortened version of it.
  const rowHighs = drawable
    .map((axis) => Math.max(...axis.readings.map((r) => r.highPct)))
    .sort((a, b) => b - a);
  const clipAbove = rowHighs.length >= 2 && rowHighs[0] > rowHighs[1] * 2.5
    ? rowHighs[1]
    : Number.POSITIVE_INFINITY;
  const isClipped = (axis: MethodologyAxisView) =>
    Math.max(...axis.readings.map((r) => r.highPct)) > clipAbove;

  const values = drawable
    .filter((axis) => !isClipped(axis))
    .flatMap((axis) => axis.readings.flatMap((r) => [r.lowPct, r.highPct]));
  values.push(0);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || 0.02) * 0.06;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const inner = VIEW_W - LABEL_W - PAD_R;
  const x = (pct: number) => LABEL_W + ((pct - min) / (max - min)) * inner;

  const plotH = drawable.length * ROW_H;
  const height = HEAD_H + plotH + AXIS_H;
  const zeroX = x(0);
  const ticks = buildTicks(min, max);

  // Lens order is fixed across rows so a colour never changes meaning.
  const lensOrder: string[] = [];
  for (const axis of drawable) {
    for (const reading of axis.readings) {
      if (!lensOrder.includes(reading.lens)) lensOrder.push(reading.lens);
    }
  }
  const colorOf = (lens: string) => lensColor(lensOrder.indexOf(lens));

  const spoken = drawable
    .map((axis) => `${axis.label} ${axis.readings.map((r) => `${r.lens} ${r.kind === "band"
      ? `${PERCENT.format(r.lowPct)}에서 ${PERCENT.format(r.highPct)}`
      : PERCENT.format(r.lowPct)}`).join(", ")}`)
    .join("; ");

  return (
    <div className="mv-methodology">
      <div className="mv-methodology-chart">
        <svg
          viewBox={`0 0 ${VIEW_W} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label={`지수별 현재가 대비 업사이드. ${spoken}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={x(tick)} x2={x(tick)} y1={HEAD_H - 4} y2={HEAD_H + plotH}
                stroke="var(--c-line-2)" strokeWidth={1}
              />
              <text
                x={x(tick)} y={height - 9} textAnchor="middle"
                fontSize={10} fontWeight={700} fill="var(--c-ink-3)"
              >
                {PERCENT.format(tick)}
              </text>
            </g>
          ))}

          {/* The anchor rule. One line for every row: today's price is the shared
              reference, not a per-row artefact. */}
          <line
            x1={zeroX} x2={zeroX} y1={HEAD_H - 10} y2={HEAD_H + plotH}
            stroke="var(--c-ink-3)" strokeWidth={2}
          />
          <text
            x={zeroX} y={HEAD_H - 14} textAnchor="middle"
            fontSize={10} fontWeight={800} fill="var(--c-ink-2)"
          >
            오늘 가격
          </text>

          {drawable.map((axis, rowIndex) => {
            const mid = HEAD_H + rowIndex * ROW_H + ROW_H / 2;
            return (
              <g key={axis.indexId}>
                <text
                  x={LABEL_W - 10} y={mid + 3} textAnchor="end"
                  fontSize={11} fontWeight={800} fill="var(--c-ink)"
                >
                  {axis.label}
                </text>
                <text
                  x={VIEW_W - 6} y={mid + 3} textAnchor="end"
                  fontSize={10} fontWeight={700} fill="var(--c-ink-3)"
                >
                  {LEVEL.format(axis.anchorPrice)}
                </text>
                {axis.readings.map((reading) => (
                  <Mark
                    key={reading.lens}
                    reading={reading}
                    x={x}
                    mid={mid}
                    color={colorOf(reading.lens)}
                    clipAt={isClipped(axis) ? VIEW_W - PAD_R - 26 : null}
                  />
                ))}
                {isClipped(axis) ? (
                  <text
                    x={VIEW_W - PAD_R - 20} y={mid + 3} textAnchor="start"
                    fontSize={10} fontWeight={800} fill="var(--c-ink-2)"
                  >
                    ▸ 축 밖
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mv-methodology-mobile">
        <p className="mv-methodology-mobile-kicker">휴대폰용 요약 · 현재가 기준</p>
        <ul className="mv-methodology-mobile-list">
          {drawable.map((axis) => (
            <li key={axis.indexId} className="mv-methodology-mobile-item">
              <div className="mv-methodology-mobile-head">
                <strong>{axis.label}</strong>
                <small>현재가 {LEVEL.format(axis.anchorPrice)} · 기준일 {axis.anchorAsOf}</small>
              </div>
              <ul className="mv-methodology-mobile-readings">
                {axis.readings.map((reading) => (
                  <li key={reading.lens}>
                    <span>{reading.lens}</span>
                    <strong>{readingValue(reading)}</strong>
                    <small>{readingMeaning(reading)} · 수준 {readingLevel(reading)} · {reading.horizon}</small>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>

      <ul className="mv-methodology-legend">
        {lensOrder.map((lens, index) => (
          <li key={lens}>
            <span className="mv-swatch" style={{ background: lensColor(index) }} aria-hidden="true" />
            <strong>{lens}</strong>
            <small>{horizonOf(drawable, lens)}</small>
          </li>
        ))}
      </ul>

      {/* The numbers in full, for anyone the figure does not serve. The column
          heads carry the lens names: the legend sits above the figure, and a
          table read on its own would otherwise be unlabelled numbers. */}
      <div
        className="mv-methodology-table-scroll"
        role="region"
        tabIndex={0}
        aria-label="방법론별 상세 표. 좌우로 스크롤해 전체 열을 확인하세요."
      >
        <table className="mv-methodology-table">
          <thead>
            <tr>
              <th scope="col">지수</th>
              {lensOrder.map((lens) => <th key={lens} scope="col">{lens}</th>)}
              <th scope="col">기준일</th>
            </tr>
          </thead>
          <tbody>
            {drawable.map((axis) => (
              <tr key={axis.indexId}>
                <th scope="row">{axis.label}</th>
                {lensOrder.map((lens) => {
                  const reading = axis.readings.find((r) => r.lens === lens);
                  return (
                    <td key={lens}>
                      {reading ? readingValue(reading) : "—"}
                    </td>
                  );
                })}
                <td className="mv-asof">{axis.anchorAsOf}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mv-methodology-scroll-cue" aria-hidden="true">↔ 좌우로 밀어 상세 표 전체 보기</p>

      {withheldRows.map((row) => (
        <p key={row.label} className="mv-withheld">
          {row.label}: {row.reason}
        </p>
      ))}
    </div>
  );
}
