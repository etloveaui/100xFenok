"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
// Feed contract (intro-feed v1/v2 tolerant). Nothing here is ever defaulted to
// a number: a missing series simply does not render.
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
  indices?: {
    sp500?: IndexSeries;
    nasdaq?: IndexSeries;
    kospi?: IndexSeries;
  };
  breadth?: {
    total?: number;
    upCount?: number;
    downCount?: number;
    sectors?: BreadthSector[];
  };
  rotation?: RotationDot[] | { window?: string; windowLabel?: string; missing?: number; sectors?: RotationDot[] } | null;
}

type Phase = "hold" | "draw" | "card" | "focus";

const QUADRANT_KO: Record<string, string> = {
  "run-expensive": "강세·고평가",
  "cheap-recover": "회복·저평가",
  "cheap-weak": "약세·저평가",
  "rich-fade": "둔화·고평가",
};

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

function isFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isSeries(v: unknown): v is IndexSeries {
  if (!v || typeof v !== "object") return false;
  const s = v as IndexSeries;
  return (
    Array.isArray(s.sparkline) &&
    s.sparkline.length >= 2 &&
    s.sparkline.every(isFinite) &&
    isFinite(s.price) &&
    isFinite(s.changePercent)
  );
}

/** Line + area paths in a 0..w × 0..h box (top padding keeps the peak inside). */
function linePaths(values: number[], w: number, h: number): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = h * 0.08;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * step;
    const y = pad + (1 - (v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  return { line, area };
}

function fmtPrice(v: number): string {
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
}

function fmtPp(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%p`;
}

// ---------------------------------------------------------------------------

export default function IntroClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");
  const targetHref = useMemo(
    () => (nextParam && nextParam.startsWith("/") ? nextParam : ROUTES.home),
    [nextParam],
  );

  const [feed, setFeed] = useState<IntroFeed | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [phase, setPhase] = useState<Phase>("hold");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

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

  // Motion preference, viewport, timeline.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const width = window.matchMedia("(max-width: 1023px)");
    setNarrow(width.matches);
    const onWidth = (e: MediaQueryListEvent) => setNarrow(e.matches);
    width.addEventListener("change", onWidth);
    if (media.matches) {
      setReducedMotion(true);
      setPhase("focus");
      return () => width.removeEventListener("change", onWidth);
    }
    // Phone: the card must not wait 3.5 s behind the art.
    const cardAt = width.matches ? 1400 : 3500;
    const t1 = setTimeout(() => setPhase("draw"), 800);
    const t2 = setTimeout(() => setPhase("card"), cardAt);
    const t3 = setTimeout(() => setPhase("focus"), 6000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      width.removeEventListener("change", onWidth);
    };
  }, []);

  // Live feed. Failure = static composition without numbers; never sample data.
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
      if (!active || !loaded || !googleBtnRef.current) return;
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
    });
    return () => {
      active = false;
    };
  }, [router, targetHref]);

  const drawing = reducedMotion || phase !== "hold";
  const cardVisible = reducedMotion || phase === "card" || phase === "focus";
  const focused = reducedMotion || phase === "focus";

  const sp = feed?.indices?.sp500 && isSeries(feed.indices.sp500) ? feed.indices.sp500 : null;
  const nq = feed?.indices?.nasdaq && isSeries(feed.indices.nasdaq) ? feed.indices.nasdaq : null;
  const ks = feed?.indices?.kospi && isSeries(feed.indices.kospi) ? feed.indices.kospi : null;
  const sectors = (feed?.breadth?.sectors ?? []).filter(
    (s) => s && isFinite(s.changePercent) && typeof s.symbol === "string",
  );
  const rotationRaw = feed?.rotation;
  const rotationList: RotationDot[] = Array.isArray(rotationRaw)
    ? rotationRaw
    : rotationRaw && Array.isArray(rotationRaw.sectors)
      ? rotationRaw.sectors
      : [];
  const rotationWindowLabel =
    rotationRaw && !Array.isArray(rotationRaw) && typeof rotationRaw.windowLabel === "string" ? rotationRaw.windowLabel : null;
  const dots = rotationList
    .map((d) => {
      const band = isFinite(d.band) ? d.band : isFinite(d.bandPct) ? d.bandPct : null;
      return isFinite(d.relative) && band !== null ? { ...d, band } : null;
    })
    .filter((d): d is RotationDot & { band: number } => d !== null);
  const asOf = sp?.asOf ?? feed?.asOf ?? null;

  const W = 720;
  const H = 220;
  const spPaths = useMemo(() => (sp ? linePaths(sp.sparkline, W, H) : null), [sp]);
  const nqPaths = useMemo(() => (nq ? linePaths(nq.sparkline, W, H) : null), [nq]);
  const maxAbsRel = dots.length ? Math.max(5, ...dots.map((d) => Math.abs(d.relative))) : 5;
  const maxAbsBar = sectors.length ? Math.max(1, ...sectors.map((s) => Math.abs(s.changePercent))) : 1;

  return (
    <div
      className="intro-root relative min-h-[100svh] w-full overflow-hidden bg-[#08090a] text-slate-100"
      style={
        {
          "--intro-brand": "#3B8DE8",
          "--intro-up": "#34C48B",
          "--intro-down": "#F0566E",
          "--intro-ink-2": "#B6BDC9",
          "--intro-ink-3": "#7C8594",
          "--intro-line": "rgba(255,255,255,0.08)",
          fontFamily: "var(--font-sans)",
        } as React.CSSProperties
      }
    >
      <style>{`
        @keyframes intro-drift { from { transform: translate3d(-6%, 0, 0) rotate(-28deg); } to { transform: translate3d(6%, 0, 0) rotate(-28deg); } }
        .intro-streak { position:absolute; left:-20%; width:140%; height:18vh; min-height:120px; filter: blur(56px); opacity:.55; transform: rotate(-28deg); animation: intro-drift 26s ${EASE} infinite alternate; }
        .intro-streak.s1 { top:-8%; background: linear-gradient(90deg, transparent 8%, rgba(59,141,232,.55) 42%, rgba(59,141,232,.15) 70%, transparent 92%); }
        .intro-streak.s2 { top:34%; opacity:.35; animation-duration: 34s; animation-delay:-9s; background: linear-gradient(90deg, transparent 12%, rgba(99,102,241,.35) 48%, transparent 88%); }
        .intro-streak.s3 { top:74%; opacity:.28; animation-duration: 30s; animation-delay:-17s; background: linear-gradient(90deg, transparent 5%, rgba(59,141,232,.4) 55%, transparent 90%); }
        @media (prefers-reduced-motion: reduce) { .intro-streak { animation: none; } }
        .intro-num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
      `}</style>

      {/* Layer 1 — light streaks */}
      <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div className="intro-streak s1" />
        <div className="intro-streak s2" />
        <div className="intro-streak s3" />
      </div>

      {/* Top bar */}
      <header className="relative z-20 mx-auto flex w-full max-w-[1280px] items-center justify-between px-5 pt-5 sm:px-8">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-bold tracking-tight text-white">100x</span>
          <span className="text-[12px] font-medium tracking-wide" style={{ color: "var(--intro-ink-3)" }}>
            Market Radar
          </span>
        </div>
        <Link
          href={targetHref}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors hover:text-white"
          style={{ color: "var(--intro-ink-2)" }}
        >
          둘러보기
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </header>

      <main className="relative z-10 mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-10 px-5 pb-12 pt-8 sm:px-8 lg:min-h-[calc(100svh-84px)] lg:grid-cols-12 lg:items-center lg:gap-12 lg:pt-0">
        {/* Layer 3 + 4 — headline and login */}
        <section className="flex flex-col gap-8 lg:col-span-5">
          <div className="flex flex-col gap-4">
            <h1 className="text-[34px] font-bold leading-[1.15] tracking-[-0.02em] text-white sm:text-[44px]">
              미국 시장을
              <br />
              숫자로 먼저 봅니다
            </h1>
            <p className="max-w-[34ch] text-[16px] leading-[1.6]" style={{ color: "var(--intro-ink-2)" }}>
              S&amp;P 500과 나스닥, 11개 섹터의 등락과 회전을 매일 갱신합니다.
            </p>
            {asOf ? (
              <p className="intro-num text-[12px]" style={{ color: "var(--intro-ink-3)" }}>
                기준 {asOf}
              </p>
            ) : null}
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
            <span className="text-[14px] font-medium text-white">Google 계정으로 시작</span>
            <div
              ref={googleBtnRef}
              className="flex min-h-[44px] items-center rounded-full"
              style={{
                boxShadow: focused ? "0 0 0 1px rgba(59,141,232,.45), 0 0 32px rgba(59,141,232,.25)" : "none",
                transition: reducedMotion ? "none" : `box-shadow 700ms ${EASE}`,
                width: "fit-content",
              }}
            >
              {!gisReady ? (
                <button
                  type="button"
                  disabled={loggingIn}
                  onClick={() => window.google?.accounts?.id?.prompt?.()}
                  className="inline-flex h-[44px] items-center gap-2.5 rounded-full border px-5 text-[14px] font-medium text-white disabled:opacity-50"
                  style={{ borderColor: "rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.04)" }}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.34 24 12 24z" />
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.42l4.04-3.15z" />
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
                  </svg>
                  {loggingIn ? "로그인 중" : "Google 계정으로 계속"}
                </button>
              ) : null}
            </div>
            {loginError ? (
              <p className="text-[13px]" style={{ color: "var(--intro-down)" }} role="alert">
                {loginError}
              </p>
            ) : null}
            <Link
              href={targetHref}
              className="inline-flex min-h-[44px] w-fit items-center text-[13px] underline underline-offset-4 transition-colors hover:text-white"
              style={{ color: "var(--intro-ink-3)" }}
            >
              로그인 없이 둘러보기
            </Link>
          </div>
        </section>

        {/* Layer 2 — market field (the art). No card box: the data is the background. */}
        <section className="flex flex-col gap-8 lg:col-span-7" aria-label="오늘의 미국 시장">
          {/* Index lines */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
              {sp ? (
                <IndexLabel name="S&P 500" series={sp} accent="var(--intro-brand)" />
              ) : null}
              {nq ? (
                <IndexLabel name="나스닥" series={nq} accent="var(--intro-ink-2)" />
              ) : null}
              {ks ? (
                <IndexLabel name="KOSPI" series={ks} accent="var(--intro-ink-3)" small />
              ) : null}
              {feedFailed && !sp ? (
                <span className="text-[13px]" style={{ color: "var(--intro-ink-3)" }}>
                  시장 데이터를 불러오지 못했습니다.
                </span>
              ) : null}
            </div>
            <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}`, maxHeight: narrow ? 180 : 260 }}>
              {spPaths || nqPaths ? (
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
                  <defs>
                    <linearGradient id="intro-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B8DE8" stopOpacity="0.28" />
                      <stop offset="100%" stopColor="#3B8DE8" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[0.25, 0.5, 0.75].map((f) => (
                    <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--intro-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  ))}
                  {spPaths ? (
                    <path
                      d={spPaths.area}
                      fill="url(#intro-area)"
                      style={{
                        opacity: drawing ? 1 : 0,
                        transition: reducedMotion ? "none" : `opacity 1400ms ${EASE} 1900ms`,
                      }}
                    />
                  ) : null}
                  {nqPaths ? (
                    <path
                      d={nqPaths.line}
                      fill="none"
                      stroke="var(--intro-ink-3)"
                      strokeWidth="1.25"
                      vectorEffect="non-scaling-stroke"
                      pathLength={1}
                      strokeDasharray="1"
                      style={{
                        strokeDashoffset: drawing ? 0 : 1,
                        transition: reducedMotion ? "none" : `stroke-dashoffset 2400ms ${EASE} 1100ms`,
                      }}
                    />
                  ) : null}
                  {spPaths ? (
                    <path
                      d={spPaths.line}
                      fill="none"
                      stroke="var(--intro-brand)"
                      strokeWidth="2"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      pathLength={1}
                      strokeDasharray="1"
                      style={{
                        strokeDashoffset: drawing ? 0 : 1,
                        transition: reducedMotion ? "none" : `stroke-dashoffset 2200ms ${EASE} 800ms`,
                      }}
                    />
                  ) : null}
                </svg>
              ) : (
                <div className="absolute inset-0 rounded-md" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)" }} />
              )}
            </div>
          </div>

          {/* Breadth: 11 US sectors, bars from a zero line */}
          {sectors.length ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-white">11개 섹터 등락</span>
                <span className="intro-num text-[12px]" style={{ color: "var(--intro-ink-3)" }}>
                  <span style={{ color: "var(--intro-up)" }}>상승 {sectors.filter((s) => s.changePercent > 0).length}</span>
                  {"  ·  "}
                  <span style={{ color: "var(--intro-down)" }}>하락 {sectors.filter((s) => s.changePercent < 0).length}</span>
                </span>
              </div>
              <div className="grid gap-x-1.5 sm:gap-x-2" style={{ gridTemplateColumns: `repeat(${sectors.length}, minmax(0, 1fr))` }}>
                {sectors.map((s, i) => {
                  const up = s.changePercent >= 0;
                  const h = Math.max(4, Math.round((Math.abs(s.changePercent) / maxAbsBar) * 44));
                  return (
                    <div key={s.symbol} className="flex flex-col items-center gap-1.5" title={`${s.name} ${fmtPct(s.changePercent)}`}>
                      <div className="relative h-[92px] w-full">
                        <div className="absolute left-0 right-0 top-1/2 h-px" style={{ background: "var(--intro-line)" }} />
                        <div
                          className="absolute left-[15%] right-[15%] rounded-[2px]"
                          style={{
                            [up ? "bottom" : "top"]: "50%",
                            height: h,
                            background: up ? "var(--intro-up)" : "var(--intro-down)",
                            transformOrigin: up ? "bottom" : "top",
                            transform: drawing ? "scaleY(1)" : "scaleY(0)",
                            transition: reducedMotion ? "none" : `transform 600ms ${EASE} ${1200 + i * 70}ms`,
                          }}
                        />
                      </div>
                      <span className="max-w-full truncate text-[12px] leading-none" style={{ color: "var(--intro-ink-2)" }}>
                        {narrow ? s.symbol.replace(/^XL/, "") : s.name}
                      </span>
                      <span className="intro-num text-[12px] leading-none" style={{ color: up ? "var(--intro-up)" : "var(--intro-down)" }}>
                        {fmtPct(s.changePercent)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Rotation: real coordinates — x = relative momentum vs S&P, y = valuation band */}
          {dots.length ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium text-white">섹터 회전</span>
                <span className="text-[12px]" style={{ color: "var(--intro-ink-3)" }}>
                  {rotationWindowLabel ? `${rotationWindowLabel} · ` : ""}가로 S&amp;P 대비 모멘텀 · 세로 밸류에이션 밴드
                </span>
              </div>
              <div className="relative w-full overflow-hidden rounded-md" style={{ height: narrow ? 170 : 210, border: "1px solid var(--intro-line)" }}>
                <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: "var(--intro-line)" }} />
                <div className="absolute inset-x-0 top-1/2 h-px" style={{ background: "var(--intro-line)" }} />
                {(
                  [
                    ["run-expensive", "right-2 top-2 text-right"],
                    ["cheap-recover", "right-2 bottom-2 text-right"],
                    ["rich-fade", "left-2 top-2"],
                    ["cheap-weak", "left-2 bottom-2"],
                  ] as const
                ).map(([id, cls]) => (
                  <span key={id} className={`absolute text-[12px] ${cls}`} style={{ color: "var(--intro-ink-3)" }}>
                    {QUADRANT_KO[id]}
                  </span>
                ))}
                {dots.map((d, i) => {
                  const x = 50 + (d.relative / maxAbsRel) * 44;
                  const y = 100 - d.band;
                  const up = d.relative >= 0;
                  return (
                    <div
                      key={d.symbol}
                      className="absolute flex items-center gap-1.5"
                      title={`${d.name} ${fmtPp(d.relative)} · 밴드 ${Math.round(d.band)}%`}
                      style={{
                        left: drawing ? `${x}%` : "50%",
                        top: drawing ? `${Math.min(92, Math.max(8, y))}%` : "50%",
                        opacity: drawing ? 1 : 0,
                        transform: "translate(-4px, -50%)",
                        transition: reducedMotion ? "none" : `left 900ms ${EASE} ${2200 + i * 60}ms, top 900ms ${EASE} ${2200 + i * 60}ms, opacity 400ms ${EASE} ${2200 + i * 60}ms`,
                      }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: up ? "var(--intro-up)" : "var(--intro-down)", boxShadow: `0 0 10px ${up ? "rgba(52,196,139,.6)" : "rgba(240,86,110,.6)"}` }} />
                      <span className="whitespace-nowrap text-[12px]" style={{ color: "var(--intro-ink-2)" }}>
                        {narrow ? d.symbol.replace(/^XL/, "") : d.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

function IndexLabel({ name, series, accent, small }: { name: string; series: IndexSeries; accent: string; small?: boolean }) {
  const up = series.changePercent >= 0;
  return (
    <div className={`flex items-baseline gap-2 ${small ? "opacity-80" : ""}`}>
      <span className="inline-block h-2 w-2 translate-y-[-1px] rounded-full" style={{ background: accent }} aria-hidden="true" />
      <span className={`${small ? "text-[12px]" : "text-[13px]"} font-medium text-white`}>{name}</span>
      <span className={`intro-num ${small ? "text-[14px]" : "text-[18px]"} font-medium text-white`}>{fmtPrice(series.price)}</span>
      <span className="intro-num text-[12px]" style={{ color: up ? "var(--intro-up)" : "var(--intro-down)" }}>
        {fmtPct(series.changePercent)}
      </span>
    </div>
  );
}
