"use client";

import { Button } from "@/components/ui";
import { QUADRANT_LABEL, ROTATION_WINDOWS, type RotationPoint, type RotationWindow } from "@/lib/sectors/rotation";

function pp(value: number, digits = 1): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(digits)}%p`;
}

const PLOT = { x0: 90, x1: 1150, y0: 20, y1: 340 };

// Corner caption boxes. Dots are excluded from the caption columns by the x
// domain padding below (inset + caption width + largest bubble radius), so the
// y domain only needs bubble-radius containment plus centre clamping.
const CAPTION = { w: 132, h: 24, inset: 10 };

export default function RotationMapPanel({
  points,
  bandless,
  windowKey,
  windowLabel,
  onWindowChange,
}: {
  points: RotationPoint[];
  bandless: RotationPoint[];
  windowKey: RotationWindow;
  windowLabel: string;
  onWindowChange: (window: RotationWindow) => void;
}) {
  const relatives = points.map((point) => point.relative);
  const lo = Math.min(0, ...relatives);
  const hi = Math.max(0, ...relatives);
  const span = Math.max(0.5, hi - lo);
  const pad = span * 0.08;

  const caps = points.map((point) => point.row.etfInfo?.marketCap).filter((cap): cap is number => typeof cap === "number" && cap > 0);
  const maxCap = Math.max(...caps, 1);
  const radius = (point: RotationPoint) => {
    const cap = point.row.etfInfo?.marketCap;
    if (typeof cap !== "number" || cap <= 0) return 12;
    return 8 + 20 * Math.sqrt(cap / maxCap);
  };
  const plotted = points.filter((point) => point.band !== null);
  const maxR = plotted.reduce((m, point) => Math.max(m, radius(point)), 12);

  // X domain: each side reserves the corner caption column (inset + caption
  // width) plus the largest bubble radius, so no bubble edge can reach a
  // caption box and no bubble is clipped at the plot edge. Closed form: with
  // xScale data-units-per-px over the base span, the margin converts exactly.
  const plotW = PLOT.x1 - PLOT.x0;
  const plotH = PLOT.y1 - PLOT.y0;
  const xMarginPx = CAPTION.inset + CAPTION.w + maxR;
  const xScale = (span + 2 * pad) / (plotW - 2 * xMarginPx);
  const dLo = lo - pad - xMarginPx * xScale;
  const dHi = hi + pad + xMarginPx * xScale;
  const x = (value: number) => PLOT.x0 + ((value - dLo) / (dHi - dLo)) * plotW;

  // Y domain: band 0–100 padded by bubble-radius containment only — the x
  // exclusion already keeps dots out of the corner caption boxes.
  const yMarginPx = maxR;
  const yPadBand = (yMarginPx * 100) / (plotH - 2 * yMarginPx);
  const yLo = 0 - yPadBand;
  const yHi = 100 + yPadBand;
  const y = (band: number) => PLOT.y1 - ((band - yLo) / (yHi - yLo)) * plotH;

  // Clamp centres so a full bubble always stays inside the plot, then lift a
  // ticker label above its bubble when two bubbles overlap (smaller first).
  const placed = plotted.map((point) => {
    const r = radius(point);
    const cx = Math.min(PLOT.x1 - r, Math.max(PLOT.x0 + r, x(point.relative)));
    const cy = Math.min(PLOT.y1 - r, Math.max(PLOT.y0 + r, y(point.band as number)));
    return { point, cx, cy, r, raise: false };
  });
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i];
      const b = placed[j];
      if (Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r) {
        if (a.r <= b.r) a.raise = true;
        else b.raise = true;
      }
    }
  }

  return (
    <div>
      <div className="sec-rotation-toggle" data-sectors-rotation-window role="group" aria-label="로테이션 구간 선택">
        {ROTATION_WINDOWS.map((window) => (
          <Button
            key={window.key}
            type="button"
            variant="tab"
            active={window.key === windowKey}
            aria-pressed={window.key === windowKey}
            data-sectors-rotation-option={window.key}
            className="sec-period-btn"
            onClick={() => onWindowChange(window.key)}
          >
            {window.label}
          </Button>
        ))}
      </div>

      <svg viewBox="0 0 1200 400" width="100%" height="400" role="img" aria-label={`로테이션 지도 (${windowLabel} 기준)`} className="sec-rotation-map" data-sectors-rotation-map="true">
        <line x1={PLOT.x0} y1={y(50)} x2={PLOT.x1} y2={y(50)} stroke="var(--fnk-neutral-200)" strokeWidth="1" />
        <line x1={x(0)} y1={PLOT.y0} x2={x(0)} y2={PLOT.y1} stroke="var(--fnk-neutral-200)" strokeWidth="1" strokeDasharray="4 4" />
        <rect x={PLOT.x0} y={PLOT.y0} width={PLOT.x1 - PLOT.x0} height={PLOT.y1 - PLOT.y0} fill="none" stroke="var(--fnk-neutral-200)" strokeWidth="1" />

        {[dLo, 0, dHi].map((tick) => (
          <g key={tick}>
            <line x1={x(tick)} y1={PLOT.y1} x2={x(tick)} y2={PLOT.y1 + 6} stroke="var(--fnk-neutral-300)" />
            <text x={x(tick)} y={PLOT.y1 + 20} fontSize="11" fill="var(--fnk-neutral-500)" textAnchor="middle" className="tabular-nums">
              {tick > 0 ? `+${tick.toFixed(0)}` : tick.toFixed(0)}
            </text>
          </g>
        ))}
        <text x={(PLOT.x0 + PLOT.x1) / 2} y={PLOT.y1 + 45} fontSize="11" fill="var(--fnk-neutral-500)" textAnchor="middle">
          ← 약세&nbsp;&nbsp;&nbsp;&nbsp;{windowLabel} 상대 모멘텀 (%p, vs S&amp;P 500)&nbsp;&nbsp;&nbsp;&nbsp;강세 →
        </text>

        <text x={PLOT.x0 - 12} y={PLOT.y0 + 4} fontSize="11" fill="var(--fnk-neutral-500)" textAnchor="end">고평가</text>
        <text x={PLOT.x0 - 12} y={y(50) + 4} fontSize="11" fill="var(--fnk-neutral-500)" textAnchor="end">평균</text>
        <text x={PLOT.x0 - 12} y={PLOT.y1 + 4} fontSize="11" fill="var(--fnk-neutral-500)" textAnchor="end">저평가</text>

        <text x={PLOT.x1 - CAPTION.inset} y={PLOT.y0 + CAPTION.inset + 12} fontSize="12" fontWeight="600" fill="var(--fnk-neutral-500)" textAnchor="end">{QUADRANT_LABEL["run-expensive"]}</text>
        <text x={PLOT.x1 - CAPTION.inset} y={PLOT.y1 - CAPTION.inset - 6} fontSize="12" fontWeight="600" fill="var(--fnk-neutral-500)" textAnchor="end">{QUADRANT_LABEL["cheap-recover"]}</text>
        <text x={PLOT.x0 + CAPTION.inset} y={PLOT.y0 + CAPTION.inset + 12} fontSize="12" fontWeight="600" fill="var(--fnk-neutral-500)">{QUADRANT_LABEL["rich-fade"]}</text>
        <text x={PLOT.x0 + CAPTION.inset} y={PLOT.y1 - CAPTION.inset - 6} fontSize="12" fontWeight="600" fill="var(--fnk-neutral-500)">{QUADRANT_LABEL["cheap-weak"]}</text>

        {placed.map(({ point, cx, cy, r, raise }) => {
          const positive = point.relative >= 0;
          const color = positive ? "var(--fnk-color-gain)" : "var(--fnk-color-loss)";
          return (
            <g key={point.row.key}>
              <circle cx={cx} cy={cy} r={r} fill={color} opacity="0.14" stroke={color} strokeWidth="1.5" />
              <text x={cx} y={raise ? cy - r - 7 : cy + 3.5} fontSize="11" fontWeight="600" fill="var(--fnk-neutral-900)" textAnchor="middle" className="sec-ticker">
                {point.row.etf}
              </text>
              <title>{`${point.row.name} ${pp(point.relative)} · 밴드 ${Math.round(point.band as number)}`}</title>
            </g>
          );
        })}
      </svg>

      <ol className="sec-rotation-list" data-sectors-rotation-list="true">
        {points.map((point, index) => (
          <li key={point.row.key} className="sec-rotation-row">
            <span className="sec-rotation-rank tabular-nums">{index + 1}</span>
            <span className="sec-rotation-name">
              {point.row.name} <span className="sec-ticker">{point.row.etf}</span>
            </span>
            <span className={point.relative >= 0 ? "sec-up tabular-nums" : "sec-down tabular-nums"}>{pp(point.relative)}</span>
            <span className="sec-rotation-quad">{point.quadrant ? QUADRANT_LABEL[point.quadrant] : "밴드 -"}</span>
          </li>
        ))}
      </ol>

      {bandless.length > 0 && (
        <div className="sec-rotation-bandless" data-sectors-rotation-bandless="true">
          <span className="sec-rotation-bandless-label">밴드 -</span>
          {bandless.map((point) => (
            <span key={point.row.key} className="sec-rotation-bandless-chip">
              <span className="sec-ticker sec-ticker-strong">{point.row.etf}</span>
              <span className={point.relative >= 0 ? "sec-up tabular-nums" : "sec-down tabular-nums"}>{pp(point.relative)}</span>
            </span>
          ))}
          <span className="sec-rotation-bandless-note">밴드 미확보로 지도 밖에 표시</span>
        </div>
      )}

      <div className="sec-rotation-legend">
        <span><b>원 크기</b> 시가총액 비중</span>
        <span><b>테두리색</b> {windowLabel} 상대 모멘텀 방향</span>
        <span><b>y축</b> Fwd P/E 5년 밴드 위치</span>
      </div>
    </div>
  );
}
