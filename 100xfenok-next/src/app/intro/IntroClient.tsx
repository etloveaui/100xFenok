"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { ROUTES } from "@/lib/routes";
import {
  fetchMe,
  getGoogleClientId,
  loadGoogleScript,
  postAuthGoogle,
  renderGoogleButton,
} from "@/lib/auth/clientAuth";
import type { TourScreen } from "./IntroTour";

// ---------------------------------------------------------------------------
// The intro is a product tour: the real screens of 100x form a ring around the
// viewer (three.js), the camera sweeps them once, then the ring is interactive —
// drag to turn, hover to lift, click to enter. No slogan: the product name, the
// screen names and one fact line are the only copy. Without WebGL or with
// reduced motion the same screens render as a flat tilted gallery.
// ---------------------------------------------------------------------------

const IntroTour = dynamic(() => import("./IntroTour"), { ssr: false });

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

interface ScreensIndex {
  generated_at?: string;
  screens?: TourScreen[];
}

function isScreen(v: unknown): v is TourScreen {
  if (!v || typeof v !== "object") return false;
  const s = v as TourScreen;
  return typeof s.route === "string" && typeof s.label === "string" && typeof s.href === "string" && typeof s.file === "string";
}

export default function IntroClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");
  const replay = !!searchParams?.get("replay");
  const targetHref = useMemo(
    // Same-origin paths only: one leading slash, never "//host" or backslash tricks.
    () => (nextParam && /^\/(?![\/\\])[^\\]*$/.test(nextParam) ? nextParam : ROUTES.home),
    [nextParam],
  );

  const [screens, setScreens] = useState<TourScreen[] | null>(null);
  const [screensFailed, setScreensFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [use3d, setUse3d] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState<TourScreen | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const [gisFailed, setGisFailed] = useState(false);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  // Browsing without login goes through the browse door, which sets the
  // session-long cookie so the intro does not come back on every page.
  const browseHref = (path: string) => `/api/intro/browse?next=${encodeURIComponent(path)}`;

  // Existing session → straight in (unless the owner asked to replay the intro).
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

  // Viewport, motion preference, WebGL, card timing.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const width = window.matchMedia("(max-width: 1023px)");
    setNarrow(width.matches);
    const onWidth = (e: MediaQueryListEvent) => setNarrow(e.matches);
    width.addEventListener("change", onWidth);
    let webgl = false;
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webgl = false;
    }
    if (media.matches) {
      setReducedMotion(true);
      setCardVisible(true);
      setFocused(true);
      return () => width.removeEventListener("change", onWidth);
    }
    setUse3d(webgl);
    const t1 = setTimeout(() => setCardVisible(true), width.matches ? 1300 : 4200);
    const t2 = setTimeout(() => setFocused(true), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      width.removeEventListener("change", onWidth);
    };
  }, []);

  // The product's screens (built from the QA baselines at deploy time).
  useEffect(() => {
    let active = true;
    fetch("/intro/screens/index.json", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ScreensIndex | TourScreen[] | null) => {
        if (!active) return;
        const list = Array.isArray(data) ? data : data?.screens;
        const ok = (list ?? []).filter(isScreen).filter((s) => s.file);
        if (ok.length) setScreens(ok);
        else setScreensFailed(true);
      })
      .catch(() => {
        if (active) setScreensFailed(true);
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

  const tourOn = use3d && !!screens;
  const screenCount = screens?.length ?? 0;

  return (
    <div className="intro-root relative min-h-[100svh] w-full overflow-hidden text-slate-100">
      {/* Stage */}
      {tourOn && screens ? (
        <>
          <IntroTour screens={screens} narrow={narrow} onReady={() => setSceneReady(true)} onHover={setHovered} onSelect={(s) => window.location.assign(browseHref(s.href))} />
          <div className="intro-vignette pointer-events-none absolute inset-0 z-[1]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true" style={{ background: "var(--intro-bg)", opacity: sceneReady ? 0 : 1, transition: `opacity 900ms ${EASE}` }} />
        </>
      ) : (
        <IntroFlat screens={screens} failed={screensFailed} onSelect={(s) => window.location.assign(browseHref(s.href))} onHover={setHovered} />
      )}

      {/* Top bar */}
      <header className="pointer-events-none relative z-[3] flex items-center justify-between px-5 pt-5 sm:px-8">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-bold tracking-tight text-white">100x</span>
          <span className="text-[12px] font-medium tracking-wide" style={{ color: "var(--intro-ink-3)" }}>
            Market Radar
          </span>
        </div>
        <a href={browseHref(targetHref)} className="pointer-events-auto inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors hover:text-white" style={{ color: "var(--intro-ink-2)" }}>
          둘러보기
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </header>

      {/* Product line + hover readout + login (bottom-left; bottom sheet on phones) */}
      <section
        className={`pointer-events-none absolute z-[3] flex flex-col gap-4 px-5 sm:px-8 ${narrow ? "inset-x-0 bottom-6" : "bottom-10 left-0 w-[44%] max-w-[600px]"}`}
        aria-label="100x 소개"
      >
        <div className="intro-scrim pointer-events-none absolute -inset-x-6 -inset-y-10 -z-[1]" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] font-extrabold leading-[1.1] tracking-[-0.03em] text-white sm:text-[44px]">
            100x Market Radar
          </h1>
          <p className="text-[14px] sm:text-[16px]" style={{ color: "var(--intro-ink-2)" }}>
            {screenCount ? `${screenCount}개 화면 · 매일 자동 갱신` : screensFailed ? "화면 목록을 불러오지 못했습니다." : ""}
          </p>
          <p className="min-h-[20px] text-[13px]" style={{ color: "var(--intro-ink-2)", opacity: hovered ? 1 : 0, transition: `opacity 160ms ${EASE}` }} aria-live="polite">
            {hovered ? `${hovered.label} — 클릭하면 바로 들어갑니다` : " "}
          </p>
        </div>

        <div
          className="pointer-events-auto flex flex-col gap-3"
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
              <button type="button" disabled aria-busy={!gisFailed} className="inline-flex h-[44px] items-center gap-2.5 rounded-full border px-5 text-[14px] font-medium text-white opacity-70" style={{ borderColor: "var(--intro-line-strong)", background: "var(--intro-fill-faint)" }}>
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={browseHref(targetHref)} className="inline-flex min-h-[44px] items-center text-[13px] underline underline-offset-4 transition-colors hover:text-white" style={{ color: "var(--intro-ink-3)" }}>
              로그인 없이 둘러보기
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

/** Fallback gallery: the same screens as tilted cards, no WebGL, no motion. */
function IntroFlat({ screens, failed, onSelect, onHover }: { screens: TourScreen[] | null; failed: boolean; onSelect: (s: TourScreen) => void; onHover: (s: TourScreen | null) => void }) {
  return (
    <div className="absolute inset-0 z-0 overflow-y-auto" aria-label="100x 화면 목록">
      <div className="intro-grid absolute inset-0" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-[1200px] grid-cols-2 gap-4 px-5 pb-[46svh] pt-24 sm:grid-cols-3 sm:px-8">
        {(screens ?? []).map((s) => (
          <button
            key={s.route}
            type="button"
            onClick={() => onSelect(s)}
            onMouseEnter={() => onHover(s)}
            onMouseLeave={() => onHover(null)}
            className="intro-flat-card group relative overflow-hidden rounded-[8px] border text-left"
            style={{ borderColor: "var(--intro-line-strong)", background: "var(--intro-fill-faint)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={s.file} alt={s.label} width={s.width || 1200} height={s.height || 750} loading="lazy" className="block h-auto w-full opacity-90 transition-opacity group-hover:opacity-100" />
            <span className="absolute bottom-2 left-2 text-[12px] font-medium text-white">{s.label}</span>
          </button>
        ))}
        {failed ? (
          <p className="col-span-full text-[14px]" style={{ color: "var(--intro-ink-3)" }}>
            화면 목록을 불러오지 못했습니다.
          </p>
        ) : null}
      </div>
    </div>
  );
}
