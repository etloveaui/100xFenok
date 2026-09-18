"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import {
  fetchMe,
  getGoogleClientId,
  loadGoogleScript,
  postAuthGoogle,
  renderGoogleButton,
} from "@/lib/auth/clientAuth";
import IntroTour, { type TourScreen } from "./IntroTour";

interface ScreensIndex {
  generated_at?: string;
  screens?: TourScreen[];
}

function isScreen(v: unknown): v is TourScreen {
  if (!v || typeof v !== "object") return false;
  const s = v as TourScreen;
  return (
    typeof s.route === "string" &&
    typeof s.label === "string" &&
    typeof s.href === "string" &&
    typeof s.file === "string"
  );
}

export default function IntroClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");
  const replay = !!searchParams?.get("replay");
  const targetHref = useMemo(
    // Same-origin paths only: one leading slash, never "//host" or backslash tricks.
    () => (nextParam && /^\/(?![\/\\])[^\\]*$/.test(nextParam) ? nextParam : ROUTES.home),
    [nextParam]
  );

  const [screens, setScreens] = useState<TourScreen[] | null>(null);
  const [screensFailed, setScreensFailed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [hovered, setHovered] = useState<TourScreen | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const [gisFailed, setGisFailed] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const autoGlanceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userInteractedRef = useRef(false);

  // Browsing without login routes through the browse door, which sets the
  // session cookie so the intro does not intercept subsequent page navigations.
  const browseHref = useCallback(
    (path: string) => `/api/intro/browse?next=${encodeURIComponent(path)}`,
    []
  );

  // Cancel first 3-seconds auto-glance on any user interaction
  const handleUserInteraction = useCallback(() => {
    userInteractedRef.current = true;
    if (autoGlanceTimerRef.current) {
      clearTimeout(autoGlanceTimerRef.current);
      autoGlanceTimerRef.current = null;
    }
  }, []);

  // Existing session → straight in (unless replay=1 was requested)
  useEffect(() => {
    if (replay) return;
    let active = true;
    fetchMe()
      .then((res) => {
        if (active && res.ok && res.user) router.replace(targetHref);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [router, targetHref, replay]);

  // Reduced motion preference
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Fetch product screens index
  useEffect(() => {
    let active = true;
    fetch("/intro/screens/index.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ScreensIndex | TourScreen[] | null) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : data?.screens;
        const ok = (list ?? [])
          .filter(isScreen)
          .filter((s) => s.file)
          .map((s) => ({
            ...s,
            file: s.file.includes("/") ? s.file : `${ROUTES.intro}/screens/${s.file}`,
          }));
        if (ok.length) {
          setScreens(ok);
        } else {
          setScreensFailed(true);
        }
      })
      .catch(() => {
        if (active) setScreensFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  // Choreography: First 3 seconds auto-glance
  // 0.0s Home -> 1.4s auto-glance to Valuation (Buffett Indicator) -> settle
  useEffect(() => {
    if (reducedMotion || !screens || screens.length < 2) return;
    autoGlanceTimerRef.current = setTimeout(() => {
      if (!userInteractedRef.current) {
        const valIdx = screens.findIndex((s) => s.route === "market-valuation");
        if (valIdx >= 0) {
          setActiveIndex(valIdx);
        }
      }
    }, 1400);

    return () => {
      if (autoGlanceTimerRef.current) clearTimeout(autoGlanceTimerRef.current);
    };
  }, [screens, reducedMotion]);

  // Keyboard navigation: 1-9 for tabs, arrows for prev/next, Enter to browse
  useEffect(() => {
    if (!screens || screens.length === 0) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < screens.length) {
          handleUserInteraction();
          setActiveIndex(idx);
          setExtraOpen(false);
        }
      } else if (e.key === "ArrowRight") {
        handleUserInteraction();
        setActiveIndex((curr) => (curr + 1) % screens.length);
      } else if (e.key === "ArrowLeft") {
        handleUserInteraction();
        setActiveIndex((curr) => (curr - 1 + screens.length) % screens.length);
      } else if (e.key === "Enter") {
        const current = screens[activeIndex];
        if (current) {
          window.location.assign(browseHref(current.href));
        }
      } else if (e.key === "Escape") {
        setExtraOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screens, activeIndex, browseHref, handleUserInteraction]);

  // Google Identity Services button
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

  const activeScreen = screens ? screens[activeIndex] ?? screens[0] : null;
  const isExtraActive = activeIndex >= 9;

  return (
    <div className="intro-root relative min-h-[100svh] w-full overflow-x-hidden bg-slate-50 text-slate-900 selection:bg-blue-100 selection:text-blue-900 pb-28">
      {/* Background Micro Grid */}
      <div className="intro-grid pointer-events-none absolute inset-0 z-0 opacity-60" aria-hidden="true" />

      {/* Top Header Bar */}
      <header className="relative z-20 mx-auto flex w-full max-w-[1400px] items-center justify-between px-5 pt-5 sm:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <a
            href={browseHref(ROUTES.home)}
            className="group flex items-baseline gap-2 text-decoration-none"
          >
            <span className="text-[22px] font-black tracking-tight text-slate-950 font-mono flex items-center gap-1.5">
              100x
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600 inline-block group-hover:scale-125 transition-transform" />
            </span>
            <span className="rounded-md border border-blue-200/80 bg-blue-50/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-700 font-mono">
              Market Radar
            </span>
          </a>
          <span className="hidden md:inline text-[12px] text-slate-400 font-medium border-l border-slate-200 pl-3">
            미국 시장 실시간 정량 인텔리전스
          </span>
        </div>

        {/* Right CTA & Auth */}
        <div className="flex items-center gap-3">
          {/* GIS Container */}
          <div className="relative flex min-h-[38px] items-center">
            <div ref={googleBtnRef} className="min-h-[38px]" />
            {!gisReady ? (
              <button
                type="button"
                disabled
                aria-busy={!gisFailed}
                className="inline-flex h-[38px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 shadow-xs opacity-80"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="var(--intro-google-blue)"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="var(--intro-google-green)"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.15C3.26 21.36 7.34 24 12 24z"
                  />
                  <path
                    fill="var(--intro-google-yellow)"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.24C.45 8.16 0 9.94 0 12s.45 3.84 1.24 5.42l4.04-3.15z"
                  />
                  <path
                    fill="var(--intro-google-red)"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.24 6.58l4.04 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                {loggingIn ? "로그인 중..." : "Google 로그인"}
              </button>
            ) : null}
          </div>

          {/* Direct Browse CTA */}
          <a
            href={browseHref(targetHref)}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-full bg-slate-900 px-4 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-95"
          >
            <span>둘러보기</span>
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 text-slate-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        </div>
      </header>

      {/* Hero Headline & Quantitative Summary */}
      <section className="relative z-10 mx-auto mt-6 mb-5 max-w-[1240px] px-5 text-center sm:px-8 sm:mt-10 sm:mb-8">
        <h1 className="text-[28px] font-extrabold tracking-tight text-slate-950 sm:text-[40px] lg:text-[46px] leading-[1.15]">
          숫자로 먼저 보는 <span className="text-blue-600">미국 시장의 실시간 국면</span>
        </h1>
        <p className="mx-auto mt-3 max-w-[760px] text-[14px] text-slate-600 sm:text-[16px] leading-relaxed">
          감정이나 뉴스가 아닌 13개 정량 지표 엔진으로 시장 밸류에이션, 자금 회전, 거인들의 13F 지분을 실시간 추적합니다.
        </p>

        {/* Feature Tags Row */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[12px] font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-emerald-800 border border-emerald-200/70">
            <span className="intro-pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
            매일 실시간 자동 갱신
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-700 border border-slate-200/70">
            13개 정량 분석 엔진
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-slate-700 border border-slate-200/70">
            S&P 500 · NASDAQ · ETF
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-blue-700 border border-blue-200/70 font-mono">
            단축키 [1]~[9] 지원
          </span>
        </div>

        {/* Hover Readout */}
        <p
          className="mt-2.5 min-h-[18px] text-[12px] font-medium text-blue-600 transition-opacity duration-200"
          style={{ opacity: hovered ? 1 : 0 }}
          aria-live="polite"
        >
          {hovered ? `${hovered.label} — 클릭하면 해당 화면으로 바로 이동합니다` : " "}
        </p>

        {loginError ? (
          <p className="mt-3 text-[13px] text-red-600" role="alert">
            {loginError}
          </p>
        ) : null}
      </section>

      {/* 1:1 Live Stage */}
      <main className="relative z-10 mx-auto w-full">
        {activeScreen ? (
          <IntroTour
            screens={screens ?? []}
            activeScreen={activeScreen}
            onSelect={(s) => window.location.assign(browseHref(s.href))}
            onHover={setHovered}
          />
        ) : screensFailed ? (
          <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs">
            <p className="text-[14px] text-slate-600">화면 목록을 불러오지 못했습니다.</p>
            <a
              href={browseHref(targetHref)}
              className="mt-4 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800"
            >
              홈 화면으로 바로 둘러보기 →
            </a>
          </div>
        ) : (
          <div className="mx-auto h-[480px] max-w-[1240px] rounded-2xl border border-slate-200 bg-white/60 animate-pulse" />
        )}
      </main>

      {/* Floating Command Dock (Bottom Nav) */}
      {screens && screens.length > 0 ? (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 max-w-[96vw]">
          <nav
            aria-label="화면 전환 독"
            className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-[0_12px_40px_-10px_rgba(15,23,42,0.18)] backdrop-blur-xl no-scrollbar max-w-[96vw]"
          >
            {screens.slice(0, 9).map((screen, idx) => {
              const isActive = activeIndex === idx;
              const shortcutNum = idx + 1;
              return (
                <button
                  key={screen.route}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUserInteraction();
                    setActiveIndex(idx);
                    setExtraOpen(false);
                  }}
                  className={`group relative flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-[12px] font-medium transition-all whitespace-nowrap ${
                    isActive
                      ? "bg-slate-950 text-white shadow-sm font-semibold"
                      : "text-slate-600 hover:text-slate-950 hover:bg-slate-100/90"
                  }`}
                  aria-selected={isActive}
                  role="tab"
                >
                  <span
                    className={`inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-mono font-bold transition-colors ${
                      isActive
                        ? "bg-slate-800 text-blue-300"
                        : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-800"
                    }`}
                  >
                    {shortcutNum}
                  </span>
                  <span>{screen.label}</span>
                </button>
              );
            })}

            {/* Extra Screens Menu */}
            {screens.length > 9 ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUserInteraction();
                    setExtraOpen((v) => !v);
                  }}
                  className={`flex items-center gap-1 rounded-xl px-2.5 py-1.5 sm:px-3 sm:py-2 text-[12px] font-medium transition-all whitespace-nowrap ${
                    isExtraActive
                      ? "bg-slate-950 text-white font-semibold"
                      : "text-slate-600 hover:text-slate-950 hover:bg-slate-100/90"
                  }`}
                  aria-expanded={extraOpen}
                  aria-label="더 많은 화면 보기"
                >
                  <span>{isExtraActive ? activeScreen?.label : "더보기"}</span>
                  <svg
                    viewBox="0 0 16 16"
                    className={`h-3 w-3 transition-transform ${extraOpen ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {extraOpen ? (
                  <div
                    className="absolute bottom-full right-0 mb-2 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl backdrop-blur-md z-40"
                    role="menu"
                  >
                    {screens.slice(9).map((screen, sliceIdx) => {
                      const screenIdx = 9 + sliceIdx;
                      const isItemActive = activeIndex === screenIdx;
                      return (
                        <button
                          key={screen.route}
                          type="button"
                          onClick={() => {
                            setActiveIndex(screenIdx);
                            setExtraOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-[12px] transition-colors ${
                            isItemActive
                              ? "bg-blue-50 font-semibold text-blue-700"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                          role="menuitem"
                        >
                          <span>{screen.label}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            /{screen.route}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </nav>

          {/* Navigation Hint */}
          <span className="hidden sm:inline-block text-[11px] font-medium text-slate-500 bg-white/80 backdrop-blur-xs px-3 py-0.5 rounded-full border border-slate-200/60 shadow-2xs">
            키보드 <span className="font-mono font-bold text-slate-700">[1]~[9]</span> 또는{" "}
            <span className="font-mono font-bold text-slate-700">[←][→]</span> 방향키로 전환 · 클릭 시 즉시 탐색
          </span>
        </div>
      ) : null}
    </div>
  );
}
