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

interface SparklineStats {
  symbol: string;
  ticker: string;
  price: number;
  changePercent: number;
  sparkline: number[];
  asOf: string;
}

interface SectorBreadth {
  symbol: string;
  name: string;
  changePercent: number;
  isUp: boolean;
}

interface SectorRotation {
  key: string;
  symbol: string;
  name: string;
  relative: number;
  band: number | null;
  quadrant: string | null;
  quadrantLabel: string | null;
  marketCap: number | null;
}

interface IntroFeedData {
  schema_version: string;
  asOf: string | null;
  indices: {
    sp500: SparklineStats | null;
    nasdaq: SparklineStats | null;
    kospi: SparklineStats | null;
  };
  breadth: {
    total: number;
    missing: number;
    upCount: number;
    downCount: number;
    ratio: number;
    sectors: SectorBreadth[];
  };
  rotation: {
    window: string;
    windowLabel: string;
    missing: number;
    sectors: SectorRotation[];
  };
}

function buildSvgPath(values: number[] | undefined, width = 220, height = 44): string {
  if (!values || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);

  return values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 8) - 4;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function IntroClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");
  const targetHref = useMemo(() => {
    if (nextParam && nextParam.startsWith("/")) {
      return nextParam;
    }
    return ROUTES.home;
  }, [nextParam]);

  // Initial state is strictly null (no fabricated numbers).
  // Skeletons render during loading and remain static if the fetch fails.
  const [feed, setFeed] = useState<IntroFeedData | null>(null);
  const [feedFailed, setFeedFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [timelineStep, setTimelineStep] = useState<"init" | "drawing" | "cardReady" | "focused">("init");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  // 1. Session check: forward authenticated users immediately to destination
  useEffect(() => {
    let active = true;
    fetchMe()
      .then((res) => {
        if (active && res.ok && res.user) {
          router.replace(targetHref);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router, targetHref]);

  // 2. Motion preference & timeline scheduling
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) {
      setReducedMotion(true);
      setTimelineStep("focused");
      return;
    }

    // Timeline: 0~0.8s logo+streaks -> 0.8s data draws -> 3.5s card rises -> 6s card takes focus
    const tDraw = setTimeout(() => setTimelineStep("drawing"), 800);
    const tCard = setTimeout(() => setTimelineStep("cardReady"), 3500);
    const tFocus = setTimeout(() => setTimelineStep("focused"), 6000);

    return () => {
      clearTimeout(tDraw);
      clearTimeout(tCard);
      clearTimeout(tFocus);
    };
  }, []);

  // 3. Load live market feed (real data only, fallback to clean skeleton on failure)
  useEffect(() => {
    let active = true;
    fetch("/data/computed/intro-feed.json")
      .then((res) => {
        if (!res.ok) throw new Error("Feed fetch error");
        return res.json();
      })
      .then((data) => {
        if (active && data && data.indices) {
          setFeed(data);
        } else if (active) {
          setFeedFailed(true);
        }
      })
      .catch(() => {
        if (active) setFeedFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // 4. Initialize Google Identity Services button
  useEffect(() => {
    let active = true;
    const clientId = getGoogleClientId();

    loadGoogleScript().then((loaded) => {
      if (!active || !loaded || !googleBtnContainerRef.current) return;
      renderGoogleButton(googleBtnContainerRef.current, clientId, async (idToken) => {
        setLoggingIn(true);
        setLoginError(null);
        try {
          const res = await postAuthGoogle(idToken);
          if (res.ok) {
            router.replace(targetHref);
          } else {
            setLoginError(res.error || "로그인 처리에 실패했습니다.");
          }
        } catch {
          setLoginError("네트워크 오류가 발생했습니다.");
        } finally {
          setLoggingIn(false);
        }
      });
    });

    return () => {
      active = false;
    };
  }, [router, targetHref]);

  const sp500 = feed?.indices?.sp500 ?? null;
  const nasdaq = feed?.indices?.nasdaq ?? null;
  const kospi = feed?.indices?.kospi ?? null;

  const sp500Path = useMemo(
    () => (sp500 ? buildSvgPath(sp500.sparkline, 220, 44) : ""),
    [sp500],
  );
  const nasdaqPath = useMemo(
    () => (nasdaq ? buildSvgPath(nasdaq.sparkline, 220, 44) : ""),
    [nasdaq],
  );
  const kospiPath = useMemo(
    () => (kospi ? buildSvgPath(kospi.sparkline, 100, 24) : ""),
    [kospi],
  );

  const isCardVisible = reducedMotion || timelineStep === "cardReady" || timelineStep === "focused";
  const isCardFocused = reducedMotion || timelineStep === "focused";
  const isDataDrawing = reducedMotion || timelineStep !== "init";

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden bg-[#08090a] text-slate-100 flex flex-col justify-between selection:bg-cyan-500/30 selection:text-cyan-200"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}
    >
      {/* LAYER 1: Light streaks (Raycast/Linear inspired procedural gradients) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-0" aria-hidden="true">
        {/* Top-right diagonal streak */}
        <div
          className="absolute -top-[20%] -right-[15%] w-[65vw] h-[65vw] max-w-[900px] max-h-[900px] rounded-full opacity-30 blur-[120px] transition-all duration-1000"
          style={{
            background: "radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(6, 182, 212, 0.2) 40%, transparent 70%)",
            transform: isDataDrawing ? "translate(0, 0) scale(1.05)" : "translate(20px, -20px) scale(0.95)",
          }}
        />
        {/* Bottom-left soft purple-cyan accent streak */}
        <div
          className="absolute -bottom-[25%] -left-[15%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] rounded-full opacity-20 blur-[130px] transition-all duration-1000"
          style={{
            background: "radial-gradient(circle, rgba(99, 102, 241, 0.35) 0%, rgba(14, 165, 233, 0.15) 50%, transparent 70%)",
            transform: isDataDrawing ? "translate(0, 0) scale(1)" : "translate(-20px, 20px) scale(0.9)",
          }}
        />
        {/* Center subtle glow streak */}
        <div
          className="absolute top-[35%] left-[30%] w-[45vw] h-[30vw] max-w-[600px] rounded-full opacity-15 blur-[100px] transition-opacity duration-1000"
          style={{
            background: "radial-gradient(ellipse, rgba(56, 189, 248, 0.4) 0%, transparent 70%)",
          }}
        />
      </div>

      {/* Top Bar: Brand + Quick Skip (Skip is visible from 0s per spec) */}
      <header className="relative z-20 flex items-center justify-between px-6 py-5 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
            100x <span className="text-cyan-400 font-semibold">Fenok</span>
          </span>
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-300 border border-slate-700/60 rounded px-1.5 py-0.5 bg-slate-800/40">
            Radar
          </span>
        </div>

        {/* Ghost 둘러보기 button (visible from 0s) */}
        <Link
          href={targetHref}
          className="group flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-cyan-300 transition-colors px-3 py-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/40 bg-slate-900/40 backdrop-blur-sm"
          aria-label="로그인 건너뛰고 둘러보기"
        >
          <span>둘러보기</span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 flex-1 flex flex-col justify-center max-w-7xl mx-auto px-6 py-4 w-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* LEFT COLUMN (Desktop: 6 cols): Headline + Login Card */}
          <div className="lg:col-span-6 flex flex-col gap-6 max-w-xl">
            {/* Headline & Clean Korean copy (Criteria v0.2: factual, no hype, 합니다체) */}
            <div className="flex flex-col gap-3">
              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold tracking-tight text-white leading-[1.25]">
                미국 시장을 숫자로 먼저 봅니다
              </h1>
              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-lg">
                S&P 500과 나스닥, 11개 섹터의 등락과 회전을 매일 갱신합니다.
              </p>
            </div>

            {/* Login Card (Rises at 3.5s, focus at 6s, static if reduced motion) */}
            <div
              className={`transition-all duration-700 ${
                isCardVisible
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-6 pointer-events-none"
              }`}
            >
              <div
                className={`rounded-2xl border p-5 sm:p-6 backdrop-blur-xl transition-all duration-700 ${
                  isCardFocused
                    ? "border-cyan-500/50 bg-slate-900/80 shadow-[0_0_30px_rgba(6,182,212,0.15)]"
                    : "border-slate-800/80 bg-slate-900/60 shadow-xl"
                }`}
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-white">
                      Google 계정으로 시작하기
                    </span>
                    <span className="text-xs text-slate-300">
                      개인화된 포트폴리오와 맞춤형 시장 지표를 이용할 수 있습니다.
                    </span>
                  </div>

                  {loginError && (
                    <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-950/40 text-rose-200 text-xs">
                      {loginError}
                    </div>
                  )}

                  {/* Google Button Container */}
                  <div className="flex flex-col items-center sm:items-start gap-2 pt-1">
                    <div
                      ref={googleBtnContainerRef}
                      className="min-h-[44px] flex items-center justify-center"
                    >
                      {/* Fallback button while GIS loads */}
                      <button
                        type="button"
                        disabled={loggingIn}
                        className="inline-flex items-center justify-center gap-2.5 w-[260px] h-[44px] rounded-full border border-slate-700 bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-850 hover:border-cyan-500/40 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
                        onClick={() => {
                          const id = window.google?.accounts?.id;
                          if (id && typeof id.prompt === "function") {
                            id.prompt();
                          }
                        }}
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                          <path
                            fill="#4285F4"
                            d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                          />
                          <path
                            fill="#34A853"
                            d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.34 24 12 24z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
                          />
                          <path
                            fill="#EA4335"
                            d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                          />
                        </svg>
                        {loggingIn ? "로그인 처리 중입니다..." : "Google 계정으로 계속하기"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between w-full pt-1">
                      <Link
                        href={targetHref}
                        className="text-xs text-slate-300 hover:text-slate-200 transition-colors underline underline-offset-4"
                      >
                        로그인 없이 둘러보기
                      </Link>
                      {feed?.asOf && (
                        <span className="text-[11px] text-slate-300 font-mono">
                          {feed.asOf} 기준 데이터
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop: 6 cols): Market Field (US-First) */}
          <div className="lg:col-span-6 flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 sm:p-6 backdrop-blur-md flex flex-col gap-5 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    US Market Pulse
                  </span>
                  <span className="text-[10px] text-cyan-400 font-mono bg-cyan-950/60 border border-cyan-800/50 rounded px-1.5 py-0.5">
                    US-FIRST
                  </span>
                </div>
                {feed?.asOf && (
                  <span className="text-[11px] text-slate-300 font-mono">
                    as of {feed.asOf}
                  </span>
                )}
              </div>

              {/* 1. Sparklines: S&P 500 (SPY) + NASDAQ (QQQ) drawing procedurally */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* S&P 500 Tile */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3.5 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-baseline justify-between z-10">
                    <span className="text-xs font-semibold text-slate-300">
                      S&P 500
                    </span>
                    {sp500 ? (
                      <span
                        className={`text-xs font-mono font-bold ${
                          sp500.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {sp500.changePercent >= 0 ? "+" : ""}
                        {sp500.changePercent.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="w-12 h-3.5 bg-slate-800/60 rounded animate-pulse" />
                    )}
                  </div>

                  {sp500 ? (
                    <div className="text-lg font-bold font-mono text-white tracking-tight z-10">
                      ${sp500.price.toFixed(2)}
                    </div>
                  ) : (
                    <div className="w-24 h-6 bg-slate-800/60 rounded animate-pulse" />
                  )}

                  {/* Procedural drawing SVG or Skeleton Hairline */}
                  <div className="h-11 w-full pt-1">
                    {sp500 && sp500Path ? (
                      <svg viewBox="0 0 220 44" className="w-full h-full overflow-visible">
                        <path
                          d={sp500Path}
                          fill="none"
                          stroke={sp500.changePercent >= 0 ? "#10b981" : "#f43f5e"}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            strokeDasharray: 300,
                            strokeDashoffset: isDataDrawing ? 0 : 300,
                            transition: reducedMotion ? "none" : "stroke-dashoffset 2s cubic-bezier(0.16, 1, 0.3, 1) 0.8s",
                          }}
                        />
                      </svg>
                    ) : (
                      <div className="w-full h-[1px] bg-slate-800/40 my-auto" />
                    )}
                  </div>
                </div>

                {/* NASDAQ Tile */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3.5 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-baseline justify-between z-10">
                    <span className="text-xs font-semibold text-slate-300">
                      NASDAQ
                    </span>
                    {nasdaq ? (
                      <span
                        className={`text-xs font-mono font-bold ${
                          nasdaq.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {nasdaq.changePercent >= 0 ? "+" : ""}
                        {nasdaq.changePercent.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="w-12 h-3.5 bg-slate-800/60 rounded animate-pulse" />
                    )}
                  </div>

                  {nasdaq ? (
                    <div className="text-lg font-bold font-mono text-white tracking-tight z-10">
                      ${nasdaq.price.toFixed(2)}
                    </div>
                  ) : (
                    <div className="w-24 h-6 bg-slate-800/60 rounded animate-pulse" />
                  )}

                  {/* Procedural drawing SVG or Skeleton Hairline */}
                  <div className="h-11 w-full pt-1">
                    {nasdaq && nasdaqPath ? (
                      <svg viewBox="0 0 220 44" className="w-full h-full overflow-visible">
                        <path
                          d={nasdaqPath}
                          fill="none"
                          stroke={nasdaq.changePercent >= 0 ? "#10b981" : "#f43f5e"}
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            strokeDasharray: 300,
                            strokeDashoffset: isDataDrawing ? 0 : 300,
                            transition: reducedMotion ? "none" : "stroke-dashoffset 2s cubic-bezier(0.16, 1, 0.3, 1) 1.0s",
                          }}
                        />
                      </svg>
                    ) : (
                      <div className="w-full h-[1px] bg-slate-800/40 my-auto" />
                    )}
                  </div>
                </div>
              </div>

              {/* 2. 11 US Sector Breadth Bars Rising in Sequence */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span className="font-semibold text-slate-300">
                    11 US Sector Breadth
                  </span>
                  {feed?.breadth ? (
                    <span className="font-mono text-[11px]">
                      <span className="text-emerald-400 font-bold">{feed.breadth.upCount} 상승</span> /{" "}
                      <span className="text-rose-400 font-bold">{feed.breadth.downCount} 하락</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 font-mono">
                      {feedFailed ? "자료 미확보" : "—"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-11 gap-1.5 h-16 items-end bg-slate-950/40 p-2 rounded-xl border border-slate-800/60">
                  {feed?.breadth?.sectors
                    ? feed.breadth.sectors.map((sec, idx) => {
                        const abs = Math.min(Math.max(Math.abs(sec.changePercent), 0.2), 3);
                        const heightPercent = Math.round((abs / 3) * 100);
                        return (
                          <div
                            key={sec.symbol}
                            className="flex flex-col items-center justify-end h-full gap-1 group relative"
                            title={`${sec.name} (${sec.symbol}): ${sec.changePercent > 0 ? "+" : ""}${sec.changePercent}%`}
                          >
                            <div
                              className={`w-full rounded-t transition-all duration-700 ${
                                sec.isUp ? "bg-emerald-500/80 group-hover:bg-emerald-400" : "bg-rose-500/80 group-hover:bg-rose-400"
                              }`}
                              style={{
                                height: isDataDrawing ? `${heightPercent}%` : "0%",
                                transitionDelay: reducedMotion ? "0ms" : `${1200 + idx * 80}ms`,
                              }}
                            />
                            <span className="text-[9px] font-mono text-slate-300 group-hover:text-white">
                              {sec.symbol.slice(1)}
                            </span>
                          </div>
                        );
                      })
                    : Array.from({ length: 11 }).map((_, idx) => (
                        <div key={idx} className="flex flex-col items-center justify-end h-full gap-1">
                          <div className="w-full rounded-t bg-slate-800/40 h-5" />
                          <span className="w-3 h-2 bg-slate-800/50 rounded" />
                        </div>
                      ))}
                </div>
              </div>

              {/* 3. Sector Rotation Quadrant & KOSPI Secondary Tile */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
                {/* Sector Rotation Quadrant (2 cols) */}
                <div className="sm:col-span-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1.5">
                    <span className="font-semibold text-slate-300">Sector Rotation</span>
                    <span className="text-[10px] text-slate-300">1개월 모멘텀 × 밸류 밴드</span>
                  </div>

                  {/* 2x2 Quadrant with approved labels from Sectors page */}
                  <div className="grid grid-cols-2 gap-1 h-20 relative bg-slate-900/60 rounded-lg p-1 border border-slate-800/50 overflow-hidden">
                    {/* Top-Left: 둔화·고평가 */}
                    <div className="border-r border-b border-slate-800/70 flex items-start justify-start p-1 text-[9px] text-slate-300 font-medium">
                      둔화·고평가
                    </div>
                    {/* Top-Right: 강세·고평가 */}
                    <div className="border-b border-slate-800/70 flex items-start justify-end p-1 text-[9px] text-emerald-400/90 font-medium">
                      강세·고평가
                    </div>
                    {/* Bottom-Left: 약세·저평가 */}
                    <div className="border-r border-slate-800/70 flex items-end justify-start p-1 text-[9px] text-slate-500 font-medium">
                      약세·저평가
                    </div>
                    {/* Bottom-Right: 회복·저평가 */}
                    <div className="flex items-end justify-end p-1 text-[9px] text-cyan-400/90 font-medium">
                      회복·저평가
                    </div>

                    {/* Settling rotation dots placed at real quadrant positions */}
                    {feed?.rotation?.sectors && (
                      <div className="absolute inset-0 pointer-events-none">
                        {feed.rotation.sectors.map((dot, idx) => {
                          // Compute coordinate within 2x2 container
                          // relative momentum range approx -7 to +7 (%p) -> x 8% to 92%
                          const xPct = Math.max(10, Math.min(90, 50 + (dot.relative / 7) * 40));
                          // band percentile 0 to 100% -> y: 90% (bottom, 저평가) to 10% (top, 고평가)
                          const yPct = dot.band !== null
                            ? Math.max(10, Math.min(90, 100 - dot.band * 0.8 - 10))
                            : dot.quadrant === "run-expensive" || dot.quadrant === "rich-fade"
                              ? 25
                              : 75;

                          const dotColor =
                            dot.quadrant === "run-expensive"
                              ? "#10b981"
                              : dot.quadrant === "cheap-recover"
                                ? "#38bdf8"
                                : dot.quadrant === "rich-fade"
                                  ? "#f43f5e"
                                  : "#94a3b8";

                          return (
                            <span
                              key={dot.symbol}
                              className="absolute w-2 h-2 rounded-full transition-all duration-700 shadow-sm pointer-events-auto cursor-pointer -translate-x-1/2 -translate-y-1/2"
                              style={{
                                left: `${xPct}%`,
                                top: `${yPct}%`,
                                backgroundColor: dotColor,
                                opacity: isDataDrawing ? 0.95 : 0,
                                transform: isDataDrawing
                                  ? "translate(-50%, -50%) scale(1)"
                                  : "translate(-50%, -50%) scale(0)",
                                transitionDelay: reducedMotion ? "0ms" : `${2000 + idx * 90}ms`,
                              }}
                              title={`${dot.name} (${dot.symbol}): 상대 모멘텀 ${dot.relative > 0 ? "+" : ""}${dot.relative}%p · ${dot.quadrantLabel ?? ""}`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* KOSPI Small Secondary Tile (Spec §2: secondary tile only) */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-3 flex flex-col justify-between">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="font-semibold text-slate-300">KOSPI</span>
                    {kospi ? (
                      <span
                        className={`font-mono text-[10px] font-bold ${
                          kospi.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {kospi.changePercent >= 0 ? "+" : ""}
                        {kospi.changePercent.toFixed(2)}%
                      </span>
                    ) : (
                      <span className="w-8 h-3 bg-slate-800/50 rounded animate-pulse" />
                    )}
                  </div>

                  {kospi ? (
                    <div className="text-sm font-bold font-mono text-slate-200">
                      {kospi.price.toLocaleString()}
                    </div>
                  ) : (
                    <div className="w-16 h-4 bg-slate-800/50 rounded animate-pulse" />
                  )}

                  {/* Mini sparkline */}
                  <div className="h-6 w-full">
                    {kospi && kospiPath ? (
                      <svg viewBox="0 0 100 24" className="w-full h-full overflow-visible">
                        <path
                          d={kospiPath}
                          fill="none"
                          stroke={kospi.changePercent >= 0 ? "#10b981" : "#f43f5e"}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <div className="w-full h-[1px] bg-slate-800/40 my-auto" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer */}
      <footer className="relative z-10 py-4 text-center text-xs text-slate-300 border-t border-slate-900/60 max-w-7xl mx-auto w-full px-6 flex items-center justify-between">
        <span>© 2026 100x Fenok Platform. All rights reserved.</span>
        <span className="font-mono text-[11px] text-slate-300">v0.1 S1</span>
      </footer>
    </div>
  );
}
