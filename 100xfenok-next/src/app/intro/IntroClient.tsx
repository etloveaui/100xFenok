"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import {
  fetchMe,
  getGoogleClientId,
  loadGoogleScript,
  postAuthGoogle,
  renderGoogleButton,
} from "@/lib/auth/clientAuth";

// ---------------------------------------------------------------------------
// One full-screen scene. The day's US market is the set; the reading of the
// day is the title. No slogan, no cards, no panel grid. Nothing is defaulted
// to a number: a missing series simply does not render.
// ---------------------------------------------------------------------------

interface IndexSeries {
  symbol: string;
  ticker: string;
  price: number;
  changePercent: number;
  sparkline: number[];
  asOf?: string;
}

interface BreadthSector {
  symbol: string;
  name: string;
  changePercent: number;
  isUp: boolean;
}

interface RotationDot {
  symbol: string;
  name: string;
  relative: number;
  band?: number | null;
  bandPct?: number | null;
  quadrant?: string | null;
}

interface IntroFeed {
  schema_version?: string;
  asOf?: string;
  indices?: { sp500?: IndexSeries; nasdaq?: IndexSeries; kospi?: IndexSeries };
  breadth?: { total?: number; upCount?: number; downCount?: number; sectors?: BreadthSector[] };
  rotation?: RotationDot[] | { window?: string; windowLabel?: string; missing?: number; sectors?: RotationDot[] } | null;
}

const IntroScene = dynamic(() => import("./IntroScene"), { ssr: false });

type Phase = "hold" | "draw" | "bars" | "dots" | "card" | "focus";
const PHASE_ORDER: Phase[] = ["hold", "draw", "bars", "dots", "card", "focus"];
const EASE = "cubic-bezier(0.2, 0, 0, 1)";

const QUADRANT_KO: Record<string, string> = {
  "run-expensive": "강세·고평가",
  "cheap-recover": "회복·저평가",
  "cheap-weak": "약세·저평가",
  "rich-fade": "둔화·고평가",
};

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isSeries(v: unknown): v is IndexSeries {
  if (!v || typeof v !== "object") return false;
  const s = v as IndexSeries;
  return Array.isArray(s.sparkline) && s.sparkline.length >= 2 && s.sparkline.every(isNum) && isNum(s.price) && isNum(s.changePercent);
}

/** Pixel-space line + area for a series inside the box x0..x1 × y0..y1. */
function pixelPaths(values: number[], x0: number, x1: number, y0: number, y1: number): { line: string; area: string; last: [number, number] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (x1 - x0) / (values.length - 1);
  const pts = values.map((v, i) => [x0 + i * step, y0 + (1 - (v - min) / span) * (y1 - y0)] as [number, number]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${x1.toFixed(1)} ${(y1 + 60).toFixed(1)} L${x0.toFixed(1)} ${(y1 + 60).toFixed(1)} Z`;
  return { line, area, last: pts[pts.length - 1] };
}

const fmtPrice = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const fmtPp = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p`;
const fmtDateKo = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : iso;
};

/** Counts a number up from 0 to target while `run` is true; snaps when not. */
function useCountUp(target: number | null, run: boolean, durationMs = 1400): number | null {
  const [value, setValue] = useState<number | null>(target === null ? null : run ? 0 : target);
  useEffect(() => {
    if (target === null) return;
    if (!run) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, durationMs]);
  return value;
}

// ---------------------------------------------------------------------------

export default function IntroClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");
  const targetHref = useMemo(
    // Same-origin paths only: one leading slash, never "//host" or backslash tricks.
    () => (nextParam && /^\/(?![\/\\])[^\\]*$/.test(nextParam) ? nextParam : ROUTES.home),
    [nextParam],
  );

  const [feed, setFeed] = useState<IntroFeed | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>("hold");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const [gisFailed, setGisFailed] = useState(false);
  const [use3d, setUse3d] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Existing session → straight in.
  useEffect(() => {
    let active = true;
    fetchMe()
      .then((res) => {
        if (active && res.ok && res.user) router.replace(targetHref);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router, targetHref]);

  // Viewport, motion preference, timeline.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const width = window.matchMedia("(max-width: 1023px)");
    setNarrow(width.matches);
    const onWidth = (e: MediaQueryListEvent) => setNarrow(e.matches);
    width.addEventListener("change", onWidth);
    const measure = () => {
      const el = rootRef.current;
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (rootRef.current) ro.observe(rootRef.current);
    let webgl = false;
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
    if (media.matches) {
      setReducedMotion(true);
      setPhase("focus");
      return () => {
        width.removeEventListener("change", onWidth);
        ro.disconnect();
      };
    }
    setUse3d(webgl);
    const phone = width.matches;
    const timers = [
      setTimeout(() => setPhase("draw"), 500),
      setTimeout(() => setPhase("bars"), 2400),
      setTimeout(() => setPhase("dots"), 3300),
      setTimeout(() => setPhase("card"), phone ? 1300 : 3900),
      setTimeout(() => setPhase("focus"), 5600),
    ];
    return () => {
      timers.forEach(clearTimeout);
      width.removeEventListener("change", onWidth);
      ro.disconnect();
    };
  }, []);

  // Live feed. Failure = the still composition without numbers; never sample data.
  useEffect(() => {
    let active = true;
    fetch("/data/computed/intro-feed.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: IntroFeed | null) => {
        if (!active) return;
        if (data && typeof data === "object") setFeed(data);
        else setFeedFailed(true);
      })
      .catch(() => {
        if (active) setFeedFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Google Identity Services button.
  useEffect(() => {
    let active = true;
    const clientId = getGoogleClientId();
    loadGoogleScript().then((loaded) => {
      if (!active) return;
      if (!loaded || !googleBtnRef.current) {
        setGisFailed(true);
        return;
      }
      const ok = renderGoogleButton(googleBtnRef.current, clientId, async (idToken) => {
        setLoggingIn(true);
        setLoginError(null);
        try {
          const res = await postAuthGoogle(idToken);
          if (res.ok) router.replace(targetHref);
          else setLoginError(res.error || "로그인 처리에 실패했습니다.");
        } catch {
          setLoginError("네트워크 오류가 발생했습니다.");
        } finally {
          setLoggingIn(false);
        }
      });
      if (ok) setGisReady(true);
      else setGisFailed(true);
    });
    return () => {
      active = false;
    };
  }, [router, targetHref]);

  const at = (p: Phase) => reducedMotion || PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(p);
  // The card phase is scheduled independently on phones, so test it directly.
  const cardVisible = reducedMotion || phase === "card" || phase === "focus" || (narrow && at("bars"));
  const focused = reducedMotion || phase === "focus";

  const sp = feed?.indices?.sp500 && isSeries(feed.indices.sp500) ? feed.indices.sp500 : null;
  const nq = feed?.indices?.nasdaq && isSeries(feed.indices.nasdaq) ? feed.indices.nasdaq : null;
  const sectors = (feed?.breadth?.sectors ?? []).filter((s) => s && isNum(s.changePercent) && typeof s.symbol === "string");
  const rotationRaw = feed?.rotation;
  const rotationList: RotationDot[] = Array.isArray(rotationRaw) ? rotationRaw : rotationRaw && Array.isArray(rotationRaw.sectors) ? rotationRaw.sectors : [];
  const rotationWindowLabel = rotationRaw && !Array.isArray(rotationRaw) && typeof rotationRaw.windowLabel === "string" ? rotationRaw.windowLabel : null;
  const dots = rotationList
    .map((d) => {
      const band = isNum(d.band) ? d.band : isNum(d.bandPct) ? d.bandPct : null;
      return isNum(d.relative) && band !== null ? { ...d, band } : null;
    })
    .filter((d): d is RotationDot & { band: number } => d !== null);
  const asOf = sp?.asOf ?? feed?.asOf ?? null;

  // The reading of the day — this is the title.
  const reading = useMemo(() => {
    if (!sectors.length) return null;
    const sorted = [...sectors].sort((a, b) => b.changePercent - a.changePercent);
    const ups = sectors.filter((s) => s.changePercent > 0).length;
    return { ups, total: sectors.length, strongest: sorted[0], weakest: sorted[sorted.length - 1] };
  }, [sectors]);

  // Geometry in pixels (client only).
  const { w, h } = size;
  const art = useMemo(() => {
    if (!w || !h) return null;
    const x0 = -0.02 * w;
    const x1 = 1.02 * w;
    const y0 = narrow ? 0.07 * h : 0.12 * h;
    const y1 = narrow ? 0.36 * h : 0.46 * h;
    return {
      sp: sp ? pixelPaths(sp.sparkline, x0, x1, y0, y1) : null,
      nq: nq ? pixelPaths(nq.sparkline, x0, x1, y0 + 0.02 * h, y1 + 0.04 * h) : null,
    };
  }, [w, h, narrow, sp, nq]);

  const spCount = useCountUp(sp ? sp.price : null, !reducedMotion && at("draw") && !at("bars"));
  const nqCount = useCountUp(nq ? nq.price : null, !reducedMotion && at("draw") && !at("bars"));
  const maxAbsBar = sectors.length ? Math.max(1, ...sectors.map((s) => Math.abs(s.changePercent))) : 1;
  const maxAbsRel = dots.length ? Math.max(5, ...dots.map((d) => Math.abs(d.relative))) : 5;
  const placedDots = useMemo(() => {
    const placed = dots.map((d) => ({
      d,
      x: 50 + (d.relative / maxAbsRel) * 44,
      y: Math.min(92, Math.max(8, 100 - d.band)),
      labelLeft: d.relative > 0,
    }));
    placed.sort((a, b) => a.y - b.y);
    for (let i = 1; i < placed.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = placed[j];
        const b = placed[i];
        const sameSide = a.labelLeft === b.labelLeft;
        if (Math.abs(a.x - b.x) < (sameSide ? 24 : 14) && Math.abs(a.y - b.y) < 8) b.y = Math.min(94, a.y + 8);
      }
    }
    return placed;
  }, [dots, maxAbsRel]);

  const sceneSectors = useMemo(() => sectors.map((s) => ({ symbol: s.symbol, name: s.name, changePercent: s.changePercent })), [sectors]);
  const sceneDots = useMemo(() => dots.map((d) => ({ symbol: d.symbol, name: d.name, relative: d.relative, band: d.band })), [dots]);
  const sceneSp = useMemo(() => (sp ? { values: sp.sparkline, price: sp.price, changePercent: sp.changePercent } : null), [sp]);
  const sceneNq = useMemo(() => (nq ? { values: nq.sparkline, price: nq.price, changePercent: nq.changePercent } : null), [nq]);
  const sceneOn = use3d && !!feed && !feedFailed;

  const drawing = at("draw");
  const barsUp = at("bars");
  const dotsIn = at("dots");

  return (
    <div ref={rootRef} className="intro-root relative min-h-[100svh] w-full overflow-hidden text-slate-100">
      {sceneOn ? (
        <>
          <IntroScene sp={sceneSp} nq={sceneNq} sectors={sceneSectors} dots={sceneDots} narrow={narrow} onReady={() => setSceneReady(true)} onHover={setHoverLabel} />
          <div className="intro-vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
          <div
            className="pointer-events-none absolute inset-0 z-[2]"
            aria-hidden="true"
            style={{ background: "var(--intro-bg)", opacity: sceneReady ? 0 : 1, transition: `opacity 900ms ${EASE}` }}
          />
        </>
      ) : (
        <>
      {/* Layer A — set: dot grid, drifting streaks, vignette */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div className="intro-grid absolute inset-0" />
        <div className="intro-streak s1" />
        <div className="intro-streak s2" />
        <div className="intro-streak s3" />
        <div className="intro-vignette absolute inset-0" />
      </div>

      {/* Layer B — the market as the set: S&P line edge to edge, Nasdaq behind it */}
      {art && (art.sp || art.nq) ? (
        <svg className="pointer-events-none absolute inset-0 z-[1]" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <defs>
            <linearGradient id="intro-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--intro-brand)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--intro-brand)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {art.nq ? (
            <path
              d={art.nq.line}
              fill="none"
              stroke="var(--intro-ink-3)"
              strokeWidth="1"
              pathLength={1}
              strokeDasharray="1"
              style={{ strokeDashoffset: drawing ? 0 : 1, opacity: 0.7, transition: reducedMotion ? "none" : `stroke-dashoffset 2400ms ${EASE} 300ms` }}
            />
          ) : null}
          {art.sp ? (
            <>
              <path d={art.sp.area} fill="url(#intro-area)" style={{ opacity: drawing ? 1 : 0, transition: reducedMotion ? "none" : `opacity 1600ms ${EASE} 1400ms` }} />
              <path
                d={art.sp.line}
                fill="none"
                stroke="var(--intro-brand)"
                strokeWidth="14"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1"
                style={{ strokeDashoffset: drawing ? 0 : 1, opacity: 0.14, transition: reducedMotion ? "none" : `stroke-dashoffset 2200ms ${EASE}` }}
              />
              <path
                d={art.sp.line}
                fill="none"
                stroke="var(--intro-brand)"
                strokeWidth="2.25"
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="1"
                style={{ strokeDashoffset: drawing ? 0 : 1, transition: reducedMotion ? "none" : `stroke-dashoffset 2200ms ${EASE}` }}
              />
              <g style={{ opacity: barsUp ? 1 : 0, transition: reducedMotion ? "none" : `opacity 300ms ${EASE}` }}>
                <circle cx={art.sp.last[0]} cy={art.sp.last[1]} r="4" fill="var(--intro-brand)" />
                <circle className="intro-pulse" cx={art.sp.last[0]} cy={art.sp.last[1]} r="4" fill="none" stroke="var(--intro-brand)" strokeWidth="1.5" />
              </g>
            </>
          ) : null}
        </svg>
      ) : null}

        </>
      )}
      {/* Index readouts riding the line's head (count up while it draws) */}
      {!narrow && (sp || nq) ? (
        <div
          className="pointer-events-none absolute right-8 top-[9%] z-[2] flex flex-row items-baseline gap-x-6 gap-y-1"
          style={{ opacity: drawing ? 1 : 0, transition: reducedMotion ? "none" : `opacity 500ms ${EASE} 200ms` }}
        >
          {sp ? <Readout name="S&P 500" value={spCount} pct={sp.changePercent} accent="var(--intro-brand)" /> : null}
          {nq ? <Readout name="나스닥" value={nqCount} pct={nq.changePercent} accent="var(--intro-ink-2)" /> : null}
        </div>
      ) : null}

      {!sceneOn ? (
        <>
      {/* Layer C — 11 sectors rise along the bottom edge */}
      {sectors.length ? (
        <div className={`pointer-events-none absolute inset-x-0 bottom-0 z-[1] ${narrow ? "h-[15svh]" : "h-[22svh]"}`} aria-hidden="true">
          <div className="absolute inset-x-[4%] bottom-[7svh] top-0 flex items-end gap-[1.2%]">
            {sectors.map((s, i) => {
              const up = s.changePercent >= 0;
              const hPct = Math.max(8, (Math.abs(s.changePercent) / maxAbsBar) * 78);
              return (
                <div key={s.symbol} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                  <div
                    className={`w-full rounded-t-[3px] ${up ? "intro-bar-up" : "intro-bar-down"}`}
                    style={{
                      height: `${hPct}%`,
                      transformOrigin: "bottom",
                      transform: barsUp ? "scaleY(1)" : "scaleY(0)",
                      transition: reducedMotion ? "none" : `transform 700ms ${EASE} ${i * 60}ms`,
                    }}
                  />
                  <div
                    className="absolute top-full mt-2 flex w-full flex-col items-center gap-0.5"
                    style={{ opacity: barsUp ? 1 : 0, transition: reducedMotion ? "none" : `opacity 400ms ${EASE} ${300 + i * 60}ms` }}
                  >
                    <span className="max-w-full truncate text-[12px] leading-none" style={{ color: "var(--intro-ink-2)" }}>
                      {narrow ? s.symbol.replace(/^XL/, "") : s.name}
                    </span>
                    {!narrow ? (
                      <span className="intro-num text-[12px] leading-none" style={{ color: up ? "var(--intro-up)" : "var(--intro-down)" }}>
                        {fmtPct(s.changePercent)}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Layer C' — rotation field on the right third (desktop only) */}
      {!narrow && dots.length ? (
        <div className="pointer-events-none absolute z-[2]" style={{ left: "58%", right: "5%", top: "50%", height: "26%" }} aria-hidden="true">
          <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--intro-line)" }} />
          <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "var(--intro-line)" }} />
          {(
            [
              ["run-expensive", "right-0 top-0 text-right"],
              ["cheap-recover", "right-0 bottom-0 text-right"],
              ["rich-fade", "left-0 top-0"],
              ["cheap-weak", "left-0 bottom-0"],
            ] as const
          ).map(([id, cls]) => (
            <span key={id} className={`absolute text-[12px] ${cls}`} style={{ color: "var(--intro-ink-3)", opacity: dotsIn ? 1 : 0, transition: `opacity 400ms ${EASE}` }}>
              {QUADRANT_KO[id]}
            </span>
          ))}
          <span className="absolute -top-6 right-0 text-[12px]" style={{ color: "var(--intro-ink-3)", opacity: dotsIn ? 1 : 0, transition: `opacity 400ms ${EASE}` }}>
            섹터 회전{rotationWindowLabel ? ` · ${rotationWindowLabel}` : ""} · 가로 S&amp;P 대비 모멘텀 · 세로 밸류 밴드
          </span>
          {placedDots.map(({ d, x, y, labelLeft }, i) => {
            const up = d.relative >= 0;
            return (
              <div
                key={d.symbol}
                className={`absolute flex items-center gap-1.5 ${labelLeft ? "flex-row-reverse" : ""}`}
                title={`${d.name} ${fmtPp(d.relative)} · 밴드 ${Math.round(d.band)}%`}
                style={{
                  left: dotsIn ? `${x}%` : x > 50 ? "110%" : "-10%",
                  top: dotsIn ? `${y}%` : "50%",
                  opacity: dotsIn ? 1 : 0,
                  transform: labelLeft ? "translate(calc(-100% + 4px), -50%)" : "translate(-4px, -50%)",
                  transition: reducedMotion ? "none" : `left 900ms ${EASE} ${i * 55}ms, top 900ms ${EASE} ${i * 55}ms, opacity 400ms ${EASE} ${i * 55}ms`,
                }}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${up ? "intro-dot-up" : "intro-dot-down"}`} style={{ background: up ? "var(--intro-up)" : "var(--intro-down)" }} />
                <span className="whitespace-nowrap text-[12px]" style={{ color: "var(--intro-ink-2)" }}>
                  {d.name}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

        </>
      ) : null}

      {/* Top bar */}
      <header className="relative z-[3] flex items-center justify-between px-5 pt-5 sm:px-8">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-bold tracking-tight text-white">100x</span>
          <span className="text-[12px] font-medium tracking-wide" style={{ color: "var(--intro-ink-3)" }}>
            Market Radar
          </span>
        </div>
        <Link href={targetHref} className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors hover:text-white" style={{ color: "var(--intro-ink-2)" }}>
          둘러보기
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </header>

      {/* Layer D — the reading of the day is the title; login sits under it */}
      <section
        className={`absolute z-[3] flex flex-col gap-5 px-5 sm:px-8 ${narrow ? "inset-x-0 top-[40%]" : "left-0 top-[34%] w-[46%] max-w-[640px]"}`}
        aria-label="오늘의 읽기"
      >
        <div className="intro-scrim pointer-events-none absolute -inset-x-6 -inset-y-10 -z-[1]" aria-hidden="true" />
        <div
          className="flex flex-col gap-3"
          style={{
            opacity: at("draw") ? 1 : 0,
            transform: at("draw") ? "translateY(0)" : "translateY(10px)",
            filter: at("draw") ? "blur(0)" : "blur(6px)",
            transition: reducedMotion ? "none" : `opacity 700ms ${EASE} 900ms, transform 700ms ${EASE} 900ms, filter 700ms ${EASE} 900ms`,
          }}
        >
          {narrow && (sp || nq) ? (
            <div className="flex flex-col gap-1">
              {sp ? <Readout name="S&P 500" value={spCount} pct={sp.changePercent} accent="var(--intro-brand)" /> : null}
              {nq ? <Readout name="나스닥" value={nqCount} pct={nq.changePercent} accent="var(--intro-ink-2)" /> : null}
            </div>
          ) : null}
          <p className="intro-num text-[12px] tracking-wide" style={{ color: "var(--intro-ink-3)" }}>
            {asOf ? `${asOf} · 미국 장 마감` : "100x Market Radar"}
          </p>
          {sceneOn ? (
            <p className="min-h-[18px] text-[13px]" style={{ color: "var(--intro-ink-2)", opacity: hoverLabel ? 1 : 0, transition: `opacity 160ms ${EASE}` }} aria-live="polite">
              {hoverLabel ?? " "}
            </p>
          ) : null}
          {reading ? (
            <>
              <h1 className="text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white sm:text-[56px] lg:text-[64px]">
                {reading.total}개 섹터 중
                <br />
                {reading.ups}개 상승
              </h1>
              <p className="text-[16px] leading-[1.5] sm:text-[18px]" style={{ color: "var(--intro-ink-2)" }}>
                <span style={{ color: "var(--intro-up)" }}>{reading.strongest.name} {fmtPct(reading.strongest.changePercent)}</span> 최강
                {" · "}
                <span style={{ color: "var(--intro-down)" }}>{reading.weakest.name} {fmtPct(reading.weakest.changePercent)}</span> 최약
              </p>
            </>
          ) : (
            <>
              <h1 className="text-[40px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white sm:text-[56px]">
                100x
                <br />
                Market Radar
              </h1>
              {feedFailed ? (
                <p className="text-[14px]" style={{ color: "var(--intro-ink-3)" }}>
                  시장 데이터를 불러오지 못했습니다.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div
          className="flex flex-col gap-3"
          style={{
            opacity: cardVisible ? 1 : 0,
            transform: cardVisible ? "translateY(0)" : "translateY(12px)",
            transition: reducedMotion ? "none" : `opacity 600ms ${EASE}, transform 600ms ${EASE}`,
            pointerEvents: cardVisible ? "auto" : "none",
          }}
        >
          {/* GIS owns the first div's children; the placeholder is a sibling so React never fights the iframe. */}
          <div className={`relative flex min-h-[44px] w-fit items-center rounded-full ${focused ? "intro-focus-ring" : ""}`} style={{ transition: reducedMotion ? "none" : `box-shadow 700ms ${EASE}` }}>
            <div ref={googleBtnRef} className="min-h-[44px]" />
            {!gisReady ? (
              <button
                type="button"
                disabled
                aria-busy={!gisFailed}
                className="inline-flex h-[44px] items-center gap-2.5 rounded-full border px-5 text-[14px] font-medium text-white opacity-70"
                style={{ borderColor: "var(--intro-line-strong)", background: "var(--intro-fill-faint)" }}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="var(--intro-google-blue)" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                  <path fill="var(--intro-google-green)" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.34 24 12 24z" />
                  <path fill="var(--intro-google-yellow)" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.42l4.04-3.15z" />
                  <path fill="var(--intro-google-red)" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                </svg>
                {loggingIn ? "로그인 중" : gisFailed ? "Google 로그인을 불러오지 못했습니다" : "Google 계정으로 계속"}
              </button>
            ) : null}
          </div>
          {loginError ? (
            <p className="text-[13px]" style={{ color: "var(--intro-down)" }} role="alert">
              {loginError}
            </p>
          ) : null}
          <Link href={targetHref} className="inline-flex min-h-[44px] w-fit items-center text-[13px] underline underline-offset-4 transition-colors hover:text-white" style={{ color: "var(--intro-ink-3)" }}>
            로그인 없이 둘러보기
          </Link>
        </div>
      </section>
    </div>
  );
}

function Readout({ name, value, pct, accent }: { name: string; value: number | null; pct: number; accent: string }) {
  const up = pct >= 0;
  return (
    <div className="flex items-baseline gap-2">
      <span className="inline-block h-2 w-2 translate-y-[-1px] rounded-full" style={{ background: accent }} aria-hidden="true" />
      <span className="text-[13px] font-medium text-white">{name}</span>
      <span className="intro-num text-[20px] font-medium text-white">{value === null ? "" : fmtPrice(value)}</span>
      <span className="intro-num text-[12px]" style={{ color: up ? "var(--intro-up)" : "var(--intro-down)" }}>
        {fmtPct(pct)}
      </span>
    </div>
  );
}
