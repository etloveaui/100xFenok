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
}

interface SectorBreadth {
  symbol: string;
  name: string;
  changePercent: number;
  isUp: boolean;
}

interface SectorRotation {
  symbol: string;
  name: string;
  relative: number;
  band: number;
  quadrant: string;
}

interface IntroFeedData {
  asOf: string;
  indices: {
    sp500: SparklineStats;
    nasdaq: SparklineStats;
    kospi?: SparklineStats;
  };
  breadth: {
    total: number;
    upCount: number;
    downCount: number;
    ratio: number;
    sectors: SectorBreadth[];
  };
  rotation: SectorRotation[];
}

const DEFAULT_FEED: IntroFeedData = {
  asOf: "2026-09-17",
  indices: {
    sp500: {
      symbol: "S&P 500",
      ticker: "SPY",
      price: 754.05,
      changePercent: -0.44,
      sparkline: [767, 769, 762, 765, 763, 765, 766, 771, 769, 767, 761, 765, 773, 770, 765, 762, 757, 764, 760, 757, 754.05],
    },
    nasdaq: {
      symbol: "NASDAQ",
      ticker: "QQQ",
      price: 708.69,
      changePercent: -1.06,
      sparkline: [723, 732, 731, 729, 717, 716, 710, 713, 706, 710, 711, 721, 716, 716, 707, 709, 717, 718, 718, 716, 708.69],
    },
    kospi: {
      symbol: "KOSPI",
      ticker: "KOSPI",
      price: 2750.5,
      changePercent: 0.25,
      sparkline: [2700, 2715, 2725, 2740, 2750.5],
    },
  },
  breadth: {
    total: 11,
    upCount: 4,
    downCount: 7,
    ratio: 0.36,
    sectors: [
      { symbol: "XLK", name: "정보기술", changePercent: -0.22, isUp: false },
      { symbol: "XLF", name: "금융", changePercent: -0.17, isUp: false },
      { symbol: "XLV", name: "헬스케어", changePercent: -0.33, isUp: false },
      { symbol: "XLE", name: "에너지", changePercent: 1.32, isUp: true },
      { symbol: "XLI", name: "산업재", changePercent: -0.42, isUp: false },
      { symbol: "XLC", name: "커뮤니케이션", changePercent: -0.85, isUp: false },
      { symbol: "XLY", name: "자유소비재", changePercent: -1.59, isUp: false },
      { symbol: "XLP", name: "필수소비재", changePercent: -0.99, isUp: false },
      { symbol: "XLRE", name: "부동산", changePercent: 0.53, isUp: true },
      { symbol: "XLB", name: "소재", changePercent: 0.65, isUp: true },
      { symbol: "XLU", name: "유틸리티", changePercent: 0.26, isUp: true },
    ],
  },
  rotation: [
    { symbol: "XLK", name: "정보기술", relative: 4.4, band: 77, quadrant: "run-expensive" },
    { symbol: "XLF", name: "금융", relative: 4.5, band: 37, quadrant: "cheap-recover" },
    { symbol: "XLV", name: "헬스케어", relative: 10.2, band: 69, quadrant: "run-expensive" },
    { symbol: "XLE", name: "에너지", relative: 10.2, band: 48, quadrant: "cheap-recover" },
    { symbol: "XLI", name: "산업재", relative: 1.3, band: 66, quadrant: "run-expensive" },
    { symbol: "XLC", name: "커뮤니케이션", relative: 6.5, band: 35, quadrant: "cheap-recover" },
    { symbol: "XLY", name: "자유소비재", relative: 9.1, band: 58, quadrant: "run-expensive" },
    { symbol: "XLP", name: "필수소비재", relative: 4.7, band: 58, quadrant: "run-expensive" },
    { symbol: "XLRE", name: "부동산", relative: 2.2, band: 72, quadrant: "run-expensive" },
    { symbol: "XLB", name: "소재", relative: 6.9, band: 57, quadrant: "run-expensive" },
    { symbol: "XLU", name: "유틸리티", relative: -2.7, band: 44, quadrant: "cheap-weak" },
  ],
};

function buildSvgPath(values: number[], width = 240, height = 48): string {
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

  const [feed, setFeed] = useState<IntroFeedData>(DEFAULT_FEED);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [timelineStep, setTimelineStep] = useState<"init" | "drawing" | "cardReady" | "focused">("init");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  // 1. Session check on mount: If user is already authenticated, forward immediately
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

  // 3. Load live market feed
  useEffect(() => {
    let active = true;
    fetch("/data/computed/intro-feed.json")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (active && data && data.indices) {
          setFeed(data);
        }
      })
      .catch(() => {});
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

  const sp500Path = useMemo(
    () => buildSvgPath(feed.indices.sp500.sparkline, 220, 44),
    [feed.indices.sp500.sparkline],
  );
  const nasdaqPath = useMemo(
    () => buildSvgPath(feed.indices.nasdaq.sparkline, 220, 44),
    [feed.indices.nasdaq.sparkline],
  );
  const kospiPath = useMemo(
    () => (feed.indices.kospi ? buildSvgPath(feed.indices.kospi.sparkline, 100, 24) : ""),
    [feed.indices.kospi],
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
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 border border-slate-700/60 rounded px-1.5 py-0.5 bg-slate-800/40">
            Radar
          </span>
        </div>

        {/* Ghost 둘러보기 button (visible from 0s) */}
        <Link
          href={targetHref}
          className="group flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-cyan-300 transition-colors px-3 py-1.5 rounded-lg border border-slate-800 hover:border-cyan-500/40 bg-slate-900/40 backdrop-blur-sm"
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
            {/* LAYER 3: Headline & Clean Korean copy (Criteria v0.2: no hype) */}
            <div className="flex flex-col gap-3">
              <div className="inline-flex items-center gap-2 self-start rounded-full border border-cyan-500/30 bg-cyan-950/30 px-3 py-1 text-[11px] font-medium text-cyan-300">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Live Market Radar
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold tracking-tight text-white leading-[1.25]">
                매일 아침, 데이터가 말하는{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-sky-200 to-indigo-300">
                  시장의 체온
                </span>
              </h1>
              <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-lg">
                미국 11개 섹터 브레드와 주도 섹터 로테이션, 글로벌 지수를
                하나의 화면에서 실시간으로 확인하세요.
              </p>
            </div>

            {/* LAYER 4: Login Card (Rises at 3.5s, focus at 6s, static if reduced motion) */}
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
                    <span className="text-xs text-slate-400">
                      개인화된 포트폴리오와 맞춤형 시장 레이더를 바로 이용할 수 있습니다.
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
                      {/* Fallback while GIS loads */}
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
                        {loggingIn ? "로그인 중..." : "Google 계정으로 계속하기"}
                      </button>
                    </div>

                    <div className="flex items-center justify-between w-full pt-1">
                      <Link
                        href={targetHref}
                        className="text-xs text-slate-400 hover:text-slate-200 transition-colors underline underline-offset-4"
                      >
                        로그인 없이 둘러보기
                      </Link>
                      <span className="text-[11px] text-slate-400">
                        {feed.asOf} 기준 데이터
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop: 6 cols): Live Market Field (US-First) */}
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
                <span className="text-[11px] text-slate-400 font-mono">
                  as of {feed.asOf}
                </span>
              </div>

              {/* 1. Sparklines: S&P 500 (SPY) + NASDAQ (QQQ) drawing procedurally */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* S&P 500 Tile */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3.5 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-baseline justify-between z-10">
                    <span className="text-xs font-semibold text-slate-300">
                      {feed.indices.sp500.symbol}
                    </span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        feed.indices.sp500.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {feed.indices.sp500.changePercent >= 0 ? "+" : ""}
                      {feed.indices.sp500.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="text-lg font-bold font-mono text-white tracking-tight z-10">
                    ${feed.indices.sp500.price.toFixed(2)}
                  </div>

                  {/* Procedural drawing SVG */}
                  <div className="h-11 w-full pt-1">
                    <svg viewBox="0 0 220 44" className="w-full h-full overflow-visible">
                      <path
                        d={sp500Path}
                        fill="none"
                        stroke={feed.indices.sp500.changePercent >= 0 ? "#10b981" : "#f43f5e"}
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
                  </div>
                </div>

                {/* NASDAQ Tile */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/60 p-3.5 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-baseline justify-between z-10">
                    <span className="text-xs font-semibold text-slate-300">
                      {feed.indices.nasdaq.symbol}
                    </span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        feed.indices.nasdaq.changePercent >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {feed.indices.nasdaq.changePercent >= 0 ? "+" : ""}
                      {feed.indices.nasdaq.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="text-lg font-bold font-mono text-white tracking-tight z-10">
                    ${feed.indices.nasdaq.price.toFixed(2)}
                  </div>

                  {/* Procedural drawing SVG */}
                  <div className="h-11 w-full pt-1">
                    <svg viewBox="0 0 220 44" className="w-full h-full overflow-visible">
                      <path
                        d={nasdaqPath}
                        fill="none"
                        stroke={feed.indices.nasdaq.changePercent >= 0 ? "#10b981" : "#f43f5e"}
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
                  </div>
                </div>
              </div>

              {/* 2. 11 US Sector Breadth Bars Rising in Sequence */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">
                    11 US Sector Breadth
                  </span>
                  <span className="font-mono text-[11px]">
                    <span className="text-emerald-400 font-bold">{feed.breadth.upCount} 상승</span> /{" "}
                    <span className="text-rose-400 font-bold">{feed.breadth.downCount} 하락</span>
                  </span>
                </div>

                <div className="grid grid-cols-11 gap-1.5 h-16 items-end bg-slate-950/40 p-2 rounded-xl border border-slate-800/60">
                  {feed.breadth.sectors.map((sec, idx) => {
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
                        <span className="text-[9px] font-mono text-slate-400 group-hover:text-white">
                          {sec.symbol.slice(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 3. Sector Rotation Dots & KOSPI Secondary Tile */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
                {/* Sector Rotation Quadrant (2 cols) */}
                <div className="sm:col-span-2 rounded-xl border border-slate-800/70 bg-slate-950/50 p-3 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
                    <span className="font-semibold text-slate-300">Sector Rotation</span>
                    <span className="text-[10px] text-slate-400">모멘텀 / 밸류 밴드</span>
                  </div>
                  {/* 2x2 Quadrant preview */}
                  <div className="grid grid-cols-2 gap-1 h-14 relative bg-slate-900/60 rounded-lg p-1 border border-slate-800/50">
                    <div className="border-r border-b border-slate-800 flex items-start justify-start p-1 text-[9px] text-slate-400">
                      회복
                    </div>
                    <div className="border-b border-slate-800 flex items-start justify-end p-1 text-[9px] text-cyan-400/80">
                      주도
                    </div>
                    <div className="border-r border-slate-800 flex items-end justify-start p-1 text-[9px] text-slate-400">
                      소외
                    </div>
                    <div className="flex items-end justify-end p-1 text-[9px] text-slate-400">
                      고평가
                    </div>

                    {/* Settling rotation dots */}
                    <div className="absolute inset-0 pointer-events-none p-2 flex items-center justify-around">
                      {feed.rotation.slice(0, 7).map((dot, idx) => (
                        <span
                          key={dot.symbol}
                          className="w-2 h-2 rounded-full transition-all duration-700 shadow-sm"
                          style={{
                            backgroundColor: dot.relative > 5 ? "#38bdf8" : dot.relative > 0 ? "#10b981" : "#f43f5e",
                            opacity: isDataDrawing ? 0.9 : 0,
                            transform: isDataDrawing
                              ? `translate(${(idx % 3 - 1) * 6}px, ${(idx % 2 - 0.5) * 6}px)`
                              : "scale(0)",
                            transitionDelay: reducedMotion ? "0ms" : `${2000 + idx * 100}ms`,
                          }}
                          title={`${dot.name} (${dot.symbol}): 상대모멘텀 ${dot.relative}%`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* KOSPI Small Secondary Tile (Spec §2: secondary tile only) */}
                <div className="rounded-xl border border-slate-800/70 bg-slate-950/40 p-3 flex flex-col justify-between">
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="font-semibold text-slate-400">KOSPI</span>
                    <span
                      className={`font-mono text-[10px] font-bold ${
                        (feed.indices.kospi?.changePercent ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {(feed.indices.kospi?.changePercent ?? 0) >= 0 ? "+" : ""}
                      {feed.indices.kospi?.changePercent?.toFixed(2) ?? "0.00"}%
                    </span>
                  </div>
                  <div className="text-sm font-bold font-mono text-slate-200">
                    {feed.indices.kospi?.price.toLocaleString() ?? "2,750"}
                  </div>
                  {/* Mini sparkline */}
                  <div className="h-6 w-full">
                    {kospiPath && (
                      <svg viewBox="0 0 100 24" className="w-full h-full overflow-visible">
                        <path
                          d={kospiPath}
                          fill="none"
                          stroke={(feed.indices.kospi?.changePercent ?? 0) >= 0 ? "#10b981" : "#f43f5e"}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Subtle Footer */}
      <footer className="relative z-10 py-4 text-center text-xs text-slate-400 border-t border-slate-900/60 max-w-7xl mx-auto w-full px-6 flex items-center justify-between">
        <span>© 2026 100x Fenok Platform. All rights reserved.</span>
        <span className="font-mono text-[11px] text-slate-400">v0.1 S1</span>
      </footer>
    </div>
  );
}
