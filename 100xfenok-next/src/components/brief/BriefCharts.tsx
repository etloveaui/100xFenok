"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  edgeLabelColor,
  fmt,
  kst,
  monthDay,
  type BriefAnnotation,
  type BriefEdge,
  type BriefEdgeWeekPoint,
  type Dir,
} from "@/lib/brief/brief";

/* Chart colours of the approved mockup (template_i.html / charts.js). */
const UP = "#0F8A5F";
const DOWN = "#D1344C";
const MUTE_T = "#94A3B8";
export const SPX_COLOR = "#1B73D3";
export const TNX_COLOR = "#D97706";
const TNX_INK = "#B45309";

/** charts.js spark(): a 2px-inset polyline with an end dot. */
export function Spark({
  values,
  width,
  height,
  direction,
}: {
  values: readonly number[] | null | undefined;
  width: number;
  height: number;
  direction: Dir;
}) {
  if (!values || values.length < 2) return null;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const range = mx - mn || 1;
  const points = values.map(
    (v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - mn) / range) * (height - 4)).toFixed(1)}`,
  );
  const color = direction === "up" ? UP : direction === "down" ? DOWN : MUTE_T;
  const [lx, ly] = points[points.length - 1].split(",");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className="va-spark">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={2} fill={color} />
    </svg>
  );
}

/** Width of an element, tracked across resizes (the mockup's drawAll on resize). */
function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.round(node.clientWidth));
    if (typeof ResizeObserver === "undefined") {
      const frame = requestAnimationFrame(measure);
      window.addEventListener("resize", measure);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", measure);
      };
    }
    // The first observation reports the current size, so no synchronous read.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

type Point = readonly [string, number];

const minutesFromOpen = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) - 570;
const inSession = (p: Point) => p[0] >= "09:30" && p[0] <= "16:00";

function nearest(points: readonly Point[], minute: number): Point {
  let best = points[0];
  for (const p of points) {
    if (Math.abs(minutesFromOpen(p[0]) - minute) < Math.abs(minutesFromOpen(best[0]) - minute)) best = p;
  }
  return best;
}

function paddedRange(points: readonly Point[]) {
  const values = points.map((p) => p[1]);
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const pad = (mx - mn) * 0.16 || 1;
  return { mn: mn - pad, mx: mx + pad };
}

/**
 * Session map: S&P 500 (area + line, left axis) and the US 10-year yield
 * (line, right axis) through the cash session, x axis in KST with the local
 * ET time under it, annotation pills and a hover/touch read-out.
 */
export function SessionMap({
  spx,
  tnx,
  annotations,
  leadHours,
}: {
  spx: readonly Point[];
  tnx: readonly Point[];
  annotations: readonly BriefAnnotation[];
  leadHours: number;
}) {
  const [boxRef, W] = useElementWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gradientId = `brief-ga-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hover, setHover] = useState<{ a: Point; b: Point; left: number } | null>(null);
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (outTimer.current) clearTimeout(outTimer.current);
  }, []);

  const a = spx.filter(inSession);
  const b = tnx.filter(inSession);
  const ready = W > 0 && a.length > 1 && b.length > 1;

  const H = Math.round(Math.min(330, Math.max(230, W * 0.5)));
  const L = 48;
  const R = 48;
  const T = 18;
  const B = 34;
  const X = (t: string) => L + (minutesFromOpen(t) / 390) * (W - L - R);
  const ra = ready ? paddedRange(a) : { mn: 0, mx: 1 };
  const rb = ready ? paddedRange(b) : { mn: 0, mx: 1 };
  const Ya = (v: number) => T + ((ra.mx - v) / (ra.mx - ra.mn)) * (H - T - B);
  const Yb = (v: number) => T + ((rb.mx - v) / (rb.mx - rb.mn)) * (H - T - B);
  const linePath = (points: readonly Point[], Y: (v: number) => number) =>
    points.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)} ${Y(q[1]).toFixed(1)}`).join(" ");

  const move = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || !ready) return;
    if (outTimer.current) clearTimeout(outTimer.current);
    const rect = svg.getBoundingClientRect();
    const cx = ((clientX - rect.left) / rect.width) * W;
    const minute = ((cx - L) / (W - L - R)) * 390;
    const pa = nearest(a, minute);
    const pb = nearest(b, minute);
    const x = X(pa[0]);
    setHover({ a: pa, b: pb, left: Math.max(90, Math.min(rect.width - 90, (x / W) * rect.width)) });
  };
  const out = () => setHover(null);

  return (
    <div className="plot" ref={boxRef}>
      <div className="tip" style={{ left: hover ? `${hover.left}px` : undefined, opacity: hover ? 1 : 0 }}>
        {hover ? (
          <>
            <b>{kst(hover.a[0], leadHours)} </b>
            <span className="m">(현지 {hover.a[0]})</span>
            <br />
            {`S&P 500 ${fmt(hover.a[1], 2)} · 10년물 ${fmt(hover.b[1], 3)}%`}
          </>
        ) : null}
      </div>
      {ready ? (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          role="img"
          aria-label="S&P 500과 미 10년물 금리의 장중 흐름(한국 시간)"
          onMouseMove={(event) => move(event.clientX)}
          onMouseLeave={out}
          onTouchStart={(event) => move(event.touches[0].clientX)}
          onTouchMove={(event) => move(event.touches[0].clientX)}
          onTouchEnd={() => {
            outTimer.current = setTimeout(out, 1600);
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1={0} x2={0} y1={0} y2={1}>
              <stop offset="0%" stopColor={SPX_COLOR} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SPX_COLOR} stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const y = T + (i * (H - T - B)) / 4;
            return (
              <g key={`grid-${i}`}>
                <line x1={L} x2={W - R} y1={y} y2={y} stroke="#EEF2F6" strokeDasharray={i === 4 ? "0" : "2 4"} />
                <text x={L - 8} y={y + 4} textAnchor="end" fontSize={10.5} fill={SPX_COLOR} opacity={0.85}>
                  {fmt(ra.mx - (i * (ra.mx - ra.mn)) / 4, 0)}
                </text>
                <text x={W - R + 8} y={y + 4} fontSize={10.5} fill={TNX_INK} opacity={0.9}>
                  {`${fmt(rb.mx - (i * (rb.mx - rb.mn)) / 4, 2)}%`}
                </text>
              </g>
            );
          })}
          {["09:30", "11:00", "12:30", "14:00", "16:00"].map((t) => {
            const x = X(t);
            return (
              <g key={`tick-${t}`}>
                <line x1={x} x2={x} y1={H - B} y2={H - B + 4} stroke="#CBD5E1" />
                <text x={x} y={H - B + 17} textAnchor="middle" fontSize={11} fontWeight={600} fill="#475569">
                  {kst(t, leadHours)}
                </text>
                <text x={x} y={H - B + 30} textAnchor="middle" fontSize={9.5} fill="#94A3B8">
                  현지 {t}
                </text>
              </g>
            );
          })}
          <path
            d={`${linePath(a, Ya)} L${X(a[a.length - 1][0]).toFixed(1)} ${H - B} L${X(a[0][0]).toFixed(1)} ${H - B} Z`}
            fill={`url(#${gradientId})`}
          />
          <path d={linePath(b, Yb)} fill="none" stroke={TNX_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath(a, Ya)} fill="none" stroke={SPX_COLOR} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
          {annotations.map((note, k) => {
            const isB = note.series.includes("10");
            const pts = isB ? b : a;
            const Y = isB ? Yb : Ya;
            const color = isB ? TNX_INK : SPX_COLOR;
            const best = nearest(pts, minutesFromOpen(note.time_et));
            const x = X(best[0]);
            const y = Y(best[1]);
            const label = `${note.label} · ${kst(best[0], leadHours)}`;
            const w = label.length * 6.6 + 16;
            const up = y > T + 46;
            const bx = Math.max(L, Math.min(W - R - w, x - w / 2));
            const by = up ? y - 34 : y + 12;
            return (
              <g key={`ann-${k}`}>
                <line x1={x} x2={x} y1={y} y2={H - B} stroke={color} strokeDasharray="2 3" opacity={0.45} />
                <circle cx={x} cy={y} r={7} fill={color} opacity={0.15} />
                <circle cx={x} cy={y} r={4} fill="#fff" stroke={color} strokeWidth={2.2} />
                <rect x={bx} y={by} width={w} height={22} rx={11} fill="#fff" stroke={color} strokeWidth={1.2} />
                <text x={bx + w / 2} y={by + 15} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={color}>
                  {label}
                </text>
              </g>
            );
          })}
          <line
            x1={hover ? X(hover.a[0]) : 0}
            x2={hover ? X(hover.a[0]) : 0}
            y1={T}
            y2={H - B}
            stroke="#0F172A"
            opacity={hover ? 0.2 : 0}
          />
          <circle cx={hover ? X(hover.a[0]) : 0} cy={hover ? Ya(hover.a[1]) : 0} r={4} fill={SPX_COLOR} opacity={hover ? 1 : 0} />
          <circle cx={hover ? X(hover.b[0]) : 0} cy={hover ? Yb(hover.b[1]) : 0} r={4} fill={TNX_COLOR} opacity={hover ? 1 : 0} />
        </svg>
      ) : null}
    </div>
  );
}

/* 100x market-health gauge zones: 방어 / 중립 / 위험 선호. */
const ZONES: [number, number, string][] = [
  [0, 45, "#F6C7CD"],
  [45, 62, "#E2E8F0"],
  [62, 100, "#BFE8D2"],
];

const COMPONENTS: [string, (edge: BriefEdge) => string][] = [
  ["투자 심리", () => "공포·탐욕 지수 · 45%"],
  ["섹터 확산", (edge) => `오른 섹터 ${edge.sectors_up ?? "–"}/11 · 35%`],
  ["스트레스 완화", (edge) => `하이일드 ${edge.hy_spread ?? "–"}% · 10년물 · 20%`],
];

/** The mockup's edgeBox(): gauge, component bars and the week strip. */
export function EdgeBox({ edge, week }: { edge: BriefEdge; week?: readonly BriefEdgeWeekPoint[] | null }) {
  const w = 240;
  const h = 146;
  const cx = w / 2;
  const cy = 134;
  const r = 92;
  const pt = (v: number, rr: number): [number, number] => {
    const angle = Math.PI * (1 - v / 100);
    return [cx + rr * Math.cos(angle), cy - rr * Math.sin(angle)];
  };
  const needle = pt(edge.score, r - 26);
  const delta = edge.prev_score != null ? edge.score - edge.prev_score : null;
  const gaugeStyle: CSSProperties = { maxWidth: "260px" };
  return (
    <div className="edge">
      <div>
        <div className="gk">100X 시장 체력 · 어젯밤 체감</div>
        <svg
          className="gauge"
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height={h}
          role="img"
          aria-label={`시장 체력 ${edge.score} ${edge.label}`}
          style={gaugeStyle}
        >
          {ZONES.map(([from, to, color]) => {
            const p0 = pt(from, r);
            const p1 = pt(to, r);
            return <path key={`zone-${from}`} d={`M${p0[0]} ${p0[1]} A${r} ${r} 0 0 1 ${p1[0]} ${p1[1]}`} fill="none" stroke={color} strokeWidth={16} />;
          })}
          {[45, 62].map((t) => {
            const inner = pt(t, r - 12);
            const outer = pt(t, r + 12);
            const q = pt(t, r + 17);
            return (
              <g key={`zone-tick-${t}`}>
                <line x1={inner[0]} y1={inner[1]} x2={outer[0]} y2={outer[1]} stroke="#fff" strokeWidth={2} />
                <text x={q[0] + (t < 50 ? -6 : 6)} y={q[1] + 3} textAnchor="middle" fontSize={10} fill="#94A3B8">
                  {t}
                </text>
              </g>
            );
          })}
          <line x1={cx} y1={cy} x2={needle[0]} y2={needle[1]} stroke="#0F172A" strokeWidth={3} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} fill="#0F172A" />
        </svg>
        <div className="gv num">
          <b>{edge.score}</b>
          <span className="lab" style={{ color: edgeLabelColor(edge.label) }}>
            {edge.label}
          </span>
          {delta != null ? (
            <span className="dl">
              전날 {edge.prev_score} → {delta > 0 ? "+" : ""}
              {delta}
            </span>
          ) : null}
        </div>
      </div>
      <div className="comp">
        {COMPONENTS.map(([name, describe]) => {
          const value = edge.components?.[name];
          if (value == null) return null;
          return (
            <div className="cr" key={name}>
              <div className="t">
                <span>
                  {name} · {describe(edge)}
                </span>
                <b>{value}</b>
              </div>
              <div className="tr">
                <i style={{ width: `${value}%`, background: value < 45 ? "#E46A7A" : value < 62 ? "#94A3B8" : "#2FA176" }} />
              </div>
            </div>
          );
        })}
      </div>
      {week && week.length > 1 ? (
        <div className="wk">
          {week.map((point) => {
            const current = point.session === edge.session;
            return (
              <div className={`b${current ? " cur" : ""}`} key={point.session}>
                <span>{point.score}</span>
                <i
                  style={{
                    height: `${Math.max(6, point.score * 0.4)}px`,
                    background: point.score < 45 ? "#F2A1AC" : point.score < 62 ? "#CBD5E1" : "#8FD3B0",
                    outline: current ? "2px solid #0F172A" : undefined,
                  }}
                />
                <span>{monthDay(point.session)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="note">100x 홈과 같은 공식(투자 심리 45% + 섹터 확산 35% + 스트레스 완화 20%) · 하루 체감 지표 · 추세는 &apos;시황&apos;에서 확인</div>
    </div>
  );
}
