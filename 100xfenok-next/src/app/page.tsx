'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

const WIDGETS = ['liquidity-stress', 'liquidity-flow', 'banking-health', 'sentiment-signal'];
const INTERVAL = 5000;
const READY_TIMEOUT = 2000;

export default function Home() {
  const [activeSlot, setActiveSlot] = useState<'a' | 'b'>('a');

  const slotARef = useRef<HTMLIFrameElement>(null);
  const slotBRef = useRef<HTMLIFrameElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const carouselRef = useRef<HTMLDivElement>(null);

  const currentIndexRef = useRef(0);
  const activeSlotRef = useRef<'a' | 'b'>('a');
  const isPausedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const gaIds: Record<string, string> = {
      'etloveaui.github.io': 'G-X7MZFQZRBW',
      '100xfenok.pages.dev': 'G-BWHGXQPH2D',
    };

    const id = gaIds[window.location.hostname] || 'G-X7MZFQZRBW';
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    function gtag(...args: unknown[]) {
      window.dataLayer.push(args);
    }
    window.gtag = gtag;
    gtag('js', new Date());
    gtag('config', id);
  }, []);

  useEffect(() => {
    const slotA = slotARef.current;
    const slotB = slotBRef.current;
    const progress = progressRef.current;
    const carousel = carouselRef.current;

    if (!slotA || !slotB || !progress || !carousel) return;

    const slotASafe = slotA;
    const slotBSafe = slotB;
    const progressSafe = progress;
    const carouselSafe = carousel;

    function getWidgetUrl(index: number) {
      return `./tools/macro-monitor/widgets/${WIDGETS[index]}.html`;
    }

    function requestDataForWidget(widgetId: string) {
      if (window.parent === window) return;
      window.parent.postMessage({ type: 'REQUEST_WIDGET_DATA', widgetId }, '*');
    }

    function resetProgress() {
      progressSafe.classList.remove('running');
      progressSafe.style.width = '0%';
      void progressSafe.offsetWidth;
    }

    function startProgress() {
      if (isPausedRef.current) return;
      resetProgress();
      requestAnimationFrame(() => {
        progressSafe.classList.add('running');
      });
    }

    function scheduleNext() {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (isPausedRef.current) return;
      timerRef.current = setTimeout(() => {
        prepareNextWidget();
      }, INTERVAL);
    }

    function executeTransition(toIndex: number) {
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
      pendingWidgetIdRef.current = null;

      if (activeSlotRef.current === 'a') {
        activeSlotRef.current = 'b';
        setActiveSlot('b');
      } else {
        activeSlotRef.current = 'a';
        setActiveSlot('a');
      }

      currentIndexRef.current = toIndex;
      startProgress();
      scheduleNext();
    }

    function prepareNextWidget() {
      const nextIndex = (currentIndexRef.current + 1) % WIDGETS.length;
      const nextSlot = activeSlotRef.current === 'a' ? slotBSafe : slotASafe;
      const nextWidgetId = WIDGETS[nextIndex];

      pendingWidgetIdRef.current = null;

      nextSlot.onload = () => {
        pendingWidgetIdRef.current = nextWidgetId;
        requestDataForWidget(nextWidgetId);

        readyTimeoutRef.current = setTimeout(() => {
          executeTransition(nextIndex);
        }, READY_TIMEOUT);
      };

      nextSlot.src = getWidgetUrl(nextIndex);
    }

    function pause() {
      isPausedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
      progressSafe.style.transition = 'none';
    }

    function resume() {
      isPausedRef.current = false;
      startProgress();
      scheduleNext();
    }

    function handleMessage(event: MessageEvent) {
      const { type, widgetId, payload } = (event.data || {}) as {
        type?: string;
        widgetId?: string;
        payload?: unknown;
      };

      if (type === 'WIDGET_DATA_RESPONSE' && widgetId) {
        [slotASafe, slotBSafe].forEach((slot) => {
          if (slot.src && slot.src.includes(`${widgetId}.html`) && slot.contentWindow) {
            slot.contentWindow.postMessage({ type: 'WIDGET_DATA_UPDATE', payload }, '*');
          }
        });
      }

      if (type === 'WIDGET_READY' && widgetId) {
        if (!pendingWidgetIdRef.current) return;
        if (widgetId !== pendingWidgetIdRef.current) return;

        const nextIndex = WIDGETS.indexOf(pendingWidgetIdRef.current);
        if (nextIndex >= 0) executeTransition(nextIndex);
      }
    }

    function init() {
      slotASafe.src = getWidgetUrl(0);
      slotASafe.onload = () => {
        requestDataForWidget(WIDGETS[0]);
        startProgress();
        scheduleNext();
      };
    }

    carouselSafe.addEventListener('mouseenter', pause);
    carouselSafe.addEventListener('mouseleave', resume);
    window.addEventListener('message', handleMessage);

    if (document.readyState === 'complete') {
      init();
    } else {
      window.addEventListener('load', init, { once: true });
    }

    return () => {
      carouselSafe.removeEventListener('mouseenter', pause);
      carouselSafe.removeEventListener('mouseleave', resume);
      window.removeEventListener('message', handleMessage);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
    };
  }, []);

  return (
    <main className="container mx-auto p-4 sm:p-6 md:py-20 lg:p-10 animate-fadeIn text-base sm:text-lg lg:text-xl">
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .animate-fadeIn {
          animation: fadeIn 0.5s ease-in-out;
        }

        .orbitron {
          font-family: 'Orbitron', monospace;
        }

        .card-hover {
          transition: all .3s cubic-bezier(.4, 0, .2, 1);
        }

        .card-hover:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 25px -5px rgb(0 0 0 / .10), 0 8px 10px -6px rgb(0 0 0 / .10);
        }

        .carousel-container {
          position: relative;
          height: 280px;
          border-radius: 16px;
          overflow: hidden;
        }

        .carousel-slot {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: none;
          transition: opacity 0.7s ease-in-out;
        }

        .carousel-slot.active { opacity: 1; z-index: 10; }
        .carousel-slot.next { opacity: 0; z-index: 0; }

        .carousel-progress {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 2px;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          width: 0%;
          z-index: 20;
          transition: none;
        }

        .carousel-progress.running {
          width: 100%;
          transition: width 5s linear;
        }

        @media (max-width: 767px) {
          .carousel-container { height: 320px; }
        }

        @media (max-width: 400px) {
          .carousel-container { height: 360px; }
        }
      `}</style>

      <header className="text-center mb-12">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black orbitron bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-blue-600">
          Investment Knowledge
        </h1>
        <p className="text-sm sm:text-base md:text-lg text-slate-500 max-w-2xl mx-auto mt-2">
          데이터 기반의 정교한 분석과 실전 검증된 투자 도구를 제공합니다.
        </p>

        <div className="flex flex-col items-center gap-2 my-4">
          <Link
            href="/tools/macro-monitor"
            className="transition hover:scale-105 duration-150 bg-gradient-to-r from-indigo-100 to-purple-50 border border-indigo-300 text-indigo-900 rounded-xl px-4 py-2 text-sm shadow-sm flex items-center gap-2 font-medium hover:bg-indigo-200 active:scale-100 w-full sm:w-[350px]"
            title="100x Market Radar - 거시경제 지표 통합 대시보드"
          >
            <i className="fas fa-satellite-dish text-indigo-500"></i>
            <span><strong>What's New:</strong> 100x Market Radar</span>
            <i className="fas fa-arrow-right ml-2 text-indigo-400"></i>
          </Link>
        </div>
      </header>

      <section className="flex flex-col items-center mb-8">
        <div id="carousel" ref={carouselRef} className="carousel-container w-full max-w-[600px] lg:max-w-[500px] shadow-lg">
          <iframe id="slot-a" ref={slotARef} className={`carousel-slot ${activeSlot === 'a' ? 'active' : 'next'}`} scrolling="no"></iframe>
          <iframe id="slot-b" ref={slotBRef} className={`carousel-slot ${activeSlot === 'b' ? 'active' : 'next'}`} scrolling="no"></iframe>
          <div id="carousel-progress" ref={progressRef} className="carousel-progress"></div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
          <Link href="/tools/macro-monitor" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-full shadow-md hover:shadow-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200">
            <span>100x Market Radar</span>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Live</span>
            <i className="fas fa-arrow-right"></i>
          </Link>
          <Link href="/ib" className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-rose-500 to-amber-500 text-white font-semibold rounded-full shadow-md hover:shadow-lg hover:from-rose-600 hover:to-amber-600 transition-all duration-200">
            <i className="fas fa-calculator"></i>
            <span>100x IB Helper</span>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Beta</span>
          </Link>
        </div>
      </section>

      <section className="grid gap-8 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 mb-8">
        <Link href="/100x" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold orbitron text-slate-900">100x Market Wrap</h2>
            <i className="fas fa-newspaper text-3xl text-blue-500 group-hover:text-blue-600"></i>
          </div>
          <p className="text-slate-500 mb-6">AI 기반 멀티에셋 분석으로 시장 핵심 동인을 심층 제공.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 space-y-2 text-sm sm:text-base">
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>월스트리트 이슈 요약</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>기관 자금 흐름</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>실행 가능한 트레이드</p>
          </div>
        </Link>

        <Link href="/alpha-scout" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold orbitron text-slate-900">100x Alpha Scout</h2>
            <i className="fas fa-compass text-3xl text-black group-hover:text-rose-600"></i>
          </div>
          <p className="text-slate-500 mb-6">숨겨진 투자 기회를 발견하여 '알파'를 찾는 것을 목표.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 space-y-2 text-sm sm:text-base">
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>전략별 종목 선별(Value & Momentum)</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>기관 의견과 핵심 이벤트 일정</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>투자 힌트 포착</p>
          </div>
        </Link>

        <Link href="/tools/multichart" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold orbitron text-slate-900">100x Multichart Pro</h2>
            <i className="fas fa-chart-line text-3xl text-amber-500 group-hover:text-amber-600"></i>
          </div>
          <p className="text-slate-500 mb-6">레버리지 ETF까지 지원하는 초고속 브라우저 기반 멀티차트.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 space-y-2 text-sm sm:text-base">
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>Stooq + Polygon 자동 소스 선택</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>100+ 종목 동시 분석</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>성능 최적화 캐싱</p>
          </div>
        </Link>

        <Link href="/ib" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold orbitron text-slate-900">Infinite Buying</h2>
            <i className="fas fa-calculator text-3xl text-purple-500 group-hover:text-purple-600"></i>
          </div>
          <p className="text-slate-500 mb-6">TQQQ·SOXL 분할매수를 자동 계산해 주는 가이드.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 space-y-2 text-sm sm:text-base">
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>실시간 가격 연동</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>자동 주문표 생성</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>위기관리 단계별 지원</p>
          </div>
        </Link>

        <Link href="/vr" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold orbitron text-slate-900">Value Rebalancing</h2>
            <i className="fas fa-balance-scale-right text-3xl text-teal-500 group-hover:text-teal-600"></i>
          </div>
          <p className="text-slate-500 mb-6">밸류 리밸런싱 완전 자동화 시스템과 백테스트.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 space-y-2 text-sm">
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>VR 5.0 공식 계산기</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>3단계 라이프사이클</p>
            <p className="flex items-center"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>성과 시뮬레이션</p>
          </div>
        </Link>

        <Link href="/posts" className="bg-white rounded-2xl p-6 sm:p-8 card-hover shadow-lg flex flex-col group">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 orbitron">Quantum Analysis</h2>
            <i className="fas fa-search-dollar text-3xl text-red-500 group-hover:text-red-600 transition-colors"></i>
          </div>
          <p className="text-slate-500 mb-6">시장의 거시적 흐름을 꿰뚫는 통찰력 높은 심층 분석 콘텐츠.</p>
          <div className="mt-auto border-t border-slate-200 pt-4 text-sm sm:text-base space-y-2">
            <p className="flex items-center text-slate-600"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>거시 경제 및 정책 분석</p>
            <p className="flex items-center text-slate-600"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>미국 경제 플레이북</p>
            <p className="flex items-center text-slate-600"><i className="fas fa-check-circle w-5 mr-2 text-green-500"></i>디지털 자산 동향</p>
          </div>
        </Link>
      </section>
    </main>
  );
}

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}
