"use client";

import { useEffect, useState } from "react";

export interface TourScreen {
  route: string;
  label: string;
  href: string;
  file: string;
  width: number;
  height: number;
}

export interface SignatureWidgetInfo {
  tag: string;
  metric: string;
  insight: string;
  signatureWidget: string;
  shortcut?: number;
  badgePos: { top: string; left: string };
}

export const SCREEN_SIGNATURES: Record<string, SignatureWidgetInfo> = {
  home: {
    tag: "3대 지수 & 국면 판정",
    metric: "S&P 500 · NASDAQ · DOW",
    insight: "미국 3대 지수 실시간 추이와 거시 사이클 국면 즉각 판정",
    signatureWidget: "3대 지수 요약 카드 & 시장 체온 타일",
    shortcut: 1,
    badgePos: { top: "24%", left: "35%" },
  },
  "market-valuation": {
    tag: "버핏 지수 & 통계 밴드",
    metric: "192.4% · 통계 밴드 과열 경계",
    insight: "GDP 대비 미 증시 시총 비율로 역사적 과열·저평가 정량 계측",
    signatureWidget: "버핏 지수 게이지 & 밸류에이션 밴드",
    shortcut: 2,
    badgePos: { top: "25%", left: "50%" },
  },
  regime: {
    tag: "시장 국면 4분면",
    metric: "모멘텀 & 추세 복합 모델",
    insight: "상승·조정·침체·반등 중 현재 시장이 속한 사이클 판정",
    signatureWidget: "시장 국면 매트릭스 & 모멘텀 패널",
    shortcut: 3,
    badgePos: { top: "24%", left: "50%" },
  },
  sectors: {
    tag: "11개 섹터 로테이션",
    metric: "XLK · XLF · XLE 자금 회전",
    insight: "기술주부터 에너지까지 거대 기관 자금의 섹터 회전 추적",
    signatureWidget: "섹터 로테이션 모멘텀 레일 & 매트릭스",
    shortcut: 4,
    badgePos: { top: "26%", left: "40%" },
  },
  etfs: {
    tag: "글로벌 ETF 성과 맵",
    metric: "주식·채권·원자재·배당",
    insight: "전 시장 ETF 자금 흐름과 기간별 수익률을 한눈에 조망",
    signatureWidget: "자산군 & 테마 ETF 성과 히트맵",
    shortcut: 5,
    badgePos: { top: "28%", left: "50%" },
  },
  screener: {
    tag: "다차원 정량 스크리너",
    metric: "S&P 500 전 종목 팩터 필터",
    insight: "시총·PER·ROE·52주 신고가 수치 기준으로 종목 압축 선별",
    signatureWidget: "다차원 팩터 필터 & 실시간 종목 그리드",
    shortcut: 6,
    badgePos: { top: "25%", left: "45%" },
  },
  superinvestors: {
    tag: "슈퍼인베스터 13F",
    metric: "워런 버핏 · 세스 클라만 지분",
    insight: "전설적 투자 거인들의 최근 분기 실제 매수·매도 종목 추적",
    signatureWidget: "13F 지분 변동 매트릭스 & 랭킹",
    shortcut: 7,
    badgePos: { top: "24%", left: "42%" },
  },
  "macro-chart": {
    tag: "멀티 매크로 오버레이",
    metric: "기준금리 · CPI · M2 유동성",
    insight: "거시 지표와 S&P 500 지수를 동일 축에 중첩한 시계열 분석",
    signatureWidget: "멀티 매크로 시계열 오버레이 차트",
    shortcut: 8,
    badgePos: { top: "30%", left: "52%" },
  },
  "stock-nvda": {
    tag: "종목 심층 펀더멘털",
    metric: "NVDA 밸류에이션 멀티플 리본",
    insight: "매출성장률·영업이익률·멀티플 역사적 밴드 위치 요약",
    signatureWidget: "펀더멘털 멀티플 리본 & 지표 바",
    shortcut: 9,
    badgePos: { top: "24%", left: "40%" },
  },
  portfolio: {
    tag: "포트폴리오 밸런서",
    metric: "자산 배분 도넛 & 괴리율",
    insight: "주식·채권·현금 목표 비중과 리밸런싱 필요 수준 통제",
    signatureWidget: "자산 배분 도넛 & 리밸런싱 밸런서",
    badgePos: { top: "28%", left: "36%" },
  },
  radar: {
    tag: "마켓 레이더 시그널",
    metric: "실시간 이상 신호 스트림",
    insight: "거래량 폭증·신고가 돌파 등 알고리즘 특이 시그널 포착",
    signatureWidget: "실시간 시장 이상 신호 타임라인",
    badgePos: { top: "26%", left: "48%" },
  },
  ib: {
    tag: "무한매수법 트래커",
    metric: "분할 매수 회차 & 평단가 관리",
    insight: "3배 레버리지 ETF 기계적 분할 매수의 소진율과 익절선 관리",
    signatureWidget: "무한매수 회차별 진행률 카드",
    badgePos: { top: "26%", left: "45%" },
  },
  research: {
    tag: "정량 리서치 도시에",
    metric: "데이터 연동 딥다이브 리포트",
    insight: "플랫폼 실측 데이터와 정량 수식으로 검증된 심층 분석",
    signatureWidget: "정량 딥다이브 리서치 카드",
    badgePos: { top: "26%", left: "50%" },
  },
  "multi-chart": {
    tag: "시장 다중 비교",
    metric: "지수/자산군 상관 차트",
    insight: "글로벌 주요 자산 및 지수 간의 상대 강도와 상관관계 분석",
    signatureWidget: "시장 비교 멀티 차트 캔버스",
    badgePos: { top: "28%", left: "48%" },
  },
};

export interface IntroTourProps {
  screens?: TourScreen[];
  activeScreen: TourScreen;
  onSelect: (screen: TourScreen) => void;
  onHover?: (screen: TourScreen | null) => void;
}

export default function IntroTour({
  activeScreen,
  onSelect,
  onHover,
}: IntroTourProps) {
  const [utcTime, setUtcTime] = useState<string>("");
  const signature = SCREEN_SIGNATURES[activeScreen.route] || {
    tag: activeScreen.label,
    metric: activeScreen.route,
    insight: `${activeScreen.label} 정량 분석 화면`,
    signatureWidget: activeScreen.label,
    badgePos: { top: "25%", left: "50%" },
  };

  useEffect(() => {
    const update = () => {
      setUtcTime(new Date().toISOString().slice(11, 19));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative mx-auto w-full max-w-[1240px] px-4 sm:px-6">
      {/* 1:1 Live Stage */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(activeScreen)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(activeScreen);
          }
        }}
        onMouseEnter={() => onHover?.(activeScreen)}
        onMouseLeave={() => onHover?.(null)}
        className="group relative overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.03),0_16px_40px_-8px_rgba(15,23,42,0.08)] cursor-pointer transition-all duration-300 hover:shadow-[0_8px_32px_rgba(37,99,235,0.14)] hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-label={`${activeScreen.label} 화면 열기`}
      >
        {/* Stage Terminal Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/90 px-4 py-3 text-[12px] font-mono select-none sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 relative" aria-hidden="true">
              <span className="intro-pulse-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="font-bold text-slate-800 tracking-tight">100x MARKET RADAR</span>
            <span className="hidden sm:inline text-slate-300 font-sans">·</span>
            <span className="hidden sm:inline-flex items-center gap-1.5 text-slate-600">
              <span className="text-slate-400">ENGINE:</span>
              <span className="font-semibold text-slate-800">{activeScreen.label}</span>
              <span className="text-slate-400 text-[11px]">({activeScreen.href})</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {utcTime ? (
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-slate-400 font-mono">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                {utcTime} UTC
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 border border-blue-200/70 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all shadow-xs">
              직접 둘러보기
              <svg viewBox="0 0 16 16" className="h-3 w-3 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>

        {/* 1:1 Screen Surface */}
        <div className="relative w-full max-h-[520px] sm:max-h-[580px] lg:max-h-[640px] overflow-hidden bg-slate-50 select-none">
          {/* Screenshot Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={activeScreen.route}
            src={activeScreen.file}
            alt={activeScreen.label}
            width={activeScreen.width || 1200}
            height={activeScreen.height || 776}
            loading="eager"
            className="block w-full h-auto object-cover object-top transition-all duration-300 ease-out group-hover:scale-[1.006]"
          />

          {/* Signature Widget Floating Pinpoint Badge */}
          {signature ? (
            <div
              style={{ top: signature.badgePos.top, left: signature.badgePos.left }}
              className="intro-badge-float absolute z-20 pointer-events-none hidden sm:flex items-center gap-3 rounded-full bg-white/95 backdrop-blur-md border border-blue-400/40 px-4 py-2 shadow-[0_8px_24px_rgba(37,99,235,0.18)]"
              aria-hidden="true"
            >
              <div className="flex h-2.5 w-2.5 items-center justify-center relative">
                <span className="intro-pulse-dot absolute h-full w-full rounded-full bg-blue-500 opacity-75" />
                <span className="h-2 w-2 rounded-full bg-blue-600" />
              </div>
              <div className="flex flex-col text-left pr-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-blue-600 font-mono">
                    {signature.tag}
                  </span>
                  <span className="text-[12px] font-bold text-slate-900 font-mono">
                    {signature.metric}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 leading-tight">
                  {signature.insight}
                </span>
              </div>
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-50 text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          ) : null}

          {/* Bottom Gradient Overlay Hint */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/40 to-transparent flex items-end justify-center pb-4">
            <span className="inline-flex items-center gap-2 rounded-full bg-slate-900/85 backdrop-blur-md text-white px-4 py-1.5 text-[12px] font-medium shadow-md opacity-90 group-hover:opacity-100 transition-opacity">
              <span>화면 아무 곳이나 클릭하면 해당 페이지로 이동합니다</span>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-blue-300 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
