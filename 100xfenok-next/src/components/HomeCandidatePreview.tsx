"use client";

import Link from "next/link";
import { useState } from "react";

export type HomeCandidatePreviewMode =
  | "overview"
  | "candidate-a"
  | "candidate-b"
  | "candidate-c"
  | "candidate-d";

type HomeCandidatePreviewProps = {
  initialMode?: HomeCandidatePreviewMode;
};

type CandidateSpec = {
  id: Exclude<HomeCandidatePreviewMode, "overview">;
  code: "A" | "B" | "C" | "D";
  name: string;
  concept: string;
  difference: string;
  philosophy: string;
  strengths: string[];
  risks: string[];
  scores: {
    readability: number;
    completeness: number;
    mobile: number;
    cost: number;
  };
  href: string;
  accent: {
    surface: string;
    badge: string;
    hero: string;
    panel: string;
  };
};

type PreviewContext = {
  viewport: number;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
};

const viewportOptions = [
  { label: "360", value: 360 },
  { label: "390", value: 390 },
  { label: "768", value: 768 },
  { label: "1024", value: 1024 },
] as const;

const candidates: CandidateSpec[] = [
  {
    id: "candidate-a",
    code: "A",
    name: "Macro Bento Board",
    concept: "격자 타일, 한 화면에 전부",
    difference: "스캔 방향 자유, Bloomberg 스타일",
    philosophy: "핵심과 세부를 같은 화면 위에서 자유롭게 훑는 보드형 구조입니다.",
    strengths: ["데스크톱에서 한 화면 스캔", "현재 카드 재사용이 가장 쉬움"],
    risks: ["정보 밀도가 높아 보일 수 있음", "모바일에선 타일 재배치가 중요"],
    scores: { readability: 3, completeness: 5, mobile: 3, cost: 5 },
    href: "/admin/design-lab?mode=home-candidate-a",
    accent: {
      surface: "from-slate-950 via-slate-900 to-slate-800",
      badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
      hero: "bg-[linear-gradient(145deg,#041a3b_0%,#0f3d6b_55%,#1b73d3_100%)] text-white",
      panel: "bg-white text-slate-900 border-slate-200",
    },
  },
  {
    id: "candidate-b",
    code: "B",
    name: "Signal Command Center",
    concept: "거대한 Hero 판정 + 아래 진단 패널",
    difference: "결론 먼저, Hero가 뷰포트 40%",
    philosophy: "상단에서 시장의 판정을 확실하게 찍고, 아래에서 원인을 진단하는 구조입니다.",
    strengths: ["3초 판정이 가장 선명", "상하 위계가 분명함"],
    risks: ["Hero 비중이 커서 세로 공간을 많이 씀", "판정이 틀리면 과감해 보일 수 있음"],
    scores: { readability: 5, completeness: 4, mobile: 3, cost: 4 },
    href: "/admin/design-lab?mode=home-candidate-b",
    accent: {
      surface: "from-slate-950 via-brand-navy to-slate-900",
      badge: "bg-blue-50 text-blue-700 border-blue-200",
      hero: "bg-[linear-gradient(160deg,#020617_0%,#02122e_48%,#0f1f4d_100%)] text-white",
      panel: "bg-slate-950/90 text-white border-white/10",
    },
  },
  {
    id: "candidate-c",
    code: "C",
    name: "Brief + Diagnostics",
    concept: "헤드라인 + 증거 카드 세로 스택",
    difference: "뉴스 기사처럼 읽힘, 모바일 최적",
    philosophy: "최상단 한 줄 결론 뒤에 증거 카드를 세로로 읽는 내러티브 구조입니다.",
    strengths: ["모바일에서 가장 읽기 쉬움", "카드마다 결론과 근거가 함께 있음"],
    risks: ["데스크톱에서 스크롤이 많음", "대시보드보다 브리프에 가까움"],
    scores: { readability: 4, completeness: 4, mobile: 5, cost: 4 },
    href: "/admin/design-lab?mode=home-candidate-c",
    accent: {
      surface: "from-white via-amber-50 to-orange-50",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
      hero: "bg-[linear-gradient(180deg,#fff8ed_0%,#ffffff_100%)] text-slate-950",
      panel: "bg-white text-slate-900 border-amber-200",
    },
  },
  {
    id: "candidate-d",
    code: "D",
    name: "What Changed Feed",
    concept: "어제 대비 변화량 중심 타임라인",
    difference: "절대값보다 델타를 먼저 보여줌",
    philosophy: "시장 상태보다 오늘 바뀐 신호를 먼저 읽게 하는 변화 중심 피드 구조입니다.",
    strengths: ["지금 바뀐 것에 집중", "변화가 없을 때도 조용한 상태를 설명 가능"],
    risks: ["전일 데이터 비교 계층이 필요", "대시보드에 익숙한 사용자에겐 낯설 수 있음"],
    scores: { readability: 3, completeness: 3, mobile: 4, cost: 2 },
    href: "/admin/design-lab?mode=home-candidate-d",
    accent: {
      surface: "from-slate-950 via-slate-900 to-slate-800",
      badge: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
      hero: "bg-[linear-gradient(180deg,#09111f_0%,#131f35_100%)] text-white",
      panel: "bg-slate-900 text-white border-white/10",
    },
  },
];

const heroAxes = [
  { label: "심리", value: 45, detail: "F&G 72 · 탐욕 심리" },
  { label: "확산", value: 35, detail: "11개 중 7개 상승" },
  { label: "안정", value: 20, detail: "스트레스 0.16 · 낮음" },
];

const quickStrip = ["SPY +1.2%", "QQQ +0.8%", "10Y 4.08%", "HY 2.88%"];
const breadthLeaders = ["XLK +1.6%", "XLF +1.1%", "XLV +0.4%"];
const breadthLaggards = ["XLU -1.4%", "XLB -0.9%", "XLRE -0.6%"];
const liquidityBars = [28, 46, 64, 42, 58, 74];
const weeklyContextBars = [22, 34, 48, 63, 55, 68, 82];
const feedItems = [
  {
    impact: "강함",
    title: "F&G 72 → 68",
    summary: "탐욕이 식으면서 심리 기여도가 낮아졌습니다.",
    tone: "down" as const,
  },
  {
    impact: "강함",
    title: "섹터 확산 6/11 → 7/11",
    summary: "XLK와 XLF가 복귀하면서 breadth가 개선됐습니다.",
    tone: "up" as const,
  },
  {
    impact: "보통",
    title: "HY 2.91% → 2.88%",
    summary: "신용 스트레스가 소폭 완화됐습니다.",
    tone: "up" as const,
  },
  {
    impact: "낮음",
    title: "은행권 업데이트 없음",
    summary: "분기 데이터 갱신 전까지 안정 상태를 유지합니다.",
    tone: "neutral" as const,
  },
];

function scoreDots(score: number) {
  return Array.from({ length: 5 }, (_, index) => (
    <span
      key={`score-${score}-${index}`}
      className={`h-2.5 w-2.5 rounded-full ${index < score ? "bg-brand-interactive" : "bg-slate-200"}`}
    />
  ));
}

function AxisRow({ label, value, detail, light = false }: { label: string; value: number; detail: string; light?: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs font-bold uppercase tracking-[0.12em]">
        <span className={light ? "text-white/70" : "text-slate-500"}>{label}</span>
        <span className={light ? "text-white" : "text-slate-900"}>{value}%</span>
      </div>
      <div className={`h-2.5 rounded-full ${light ? "bg-white/10" : "bg-slate-200"}`}>
        <div
          className={`h-2.5 rounded-full ${light ? "bg-gradient-to-r from-emerald-300 to-sky-300" : "bg-gradient-to-r from-brand-interactive to-sky-400"}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className={`text-xs ${light ? "text-white/65" : "text-slate-600"}`}>{detail}</p>
    </div>
  );
}

function DeviceFrame({
  viewport,
  title,
  children,
}: {
  viewport: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top,_rgba(27,115,211,0.1),_transparent_50%)] p-3 shadow-sm">
      <div
        className="mx-auto overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white shadow-[0_30px_60px_-40px_rgba(15,23,42,0.55)]"
        style={{ width: `${viewport}px`, maxWidth: "100%" }}
      >
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              {title} · {viewport}px
            </p>
          </div>
        </div>
        <div className="bg-slate-100/70 p-3">{children}</div>
      </div>
    </div>
  );
}

function MacroBentoPreview({ isPhone }: PreviewContext) {
  return (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: isPhone ? "1fr" : "repeat(4, minmax(0, 1fr))",
        gridAutoRows: isPhone ? "minmax(120px, auto)" : "minmax(108px, auto)",
      }}
    >
      <section
        className="rounded-[1.6rem] p-4 text-white shadow-[0_20px_40px_-28px_rgba(1,0,121,0.7)]"
        style={{
          gridColumn: isPhone ? undefined : "span 2",
          gridRow: isPhone ? undefined : "span 2",
          background: "linear-gradient(145deg, #010079 0%, #0b2a75 45%, #1b73d3 100%)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inline-flex rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/80">
              Regime Hero
            </p>
            <h3 className="mt-3 text-3xl font-black tracking-tight">위험 선호</h3>
            <p className="mt-1 text-sm text-white/70">핵심 판정 + 3축 분해를 가장 큰 타일로 고정합니다.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-right">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/60">Confidence</p>
            <p className="mt-1 text-4xl font-black">72%</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3">
          {heroAxes.map((axis) => (
            <AxisRow key={axis.label} {...axis} light />
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm" style={{ gridRow: isPhone ? undefined : "span 2" }}>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Quick Indices</p>
        <div className="mt-4 grid gap-3">
          {quickStrip.map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-black text-slate-900">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Breadth</p>
        <p className="mt-2 text-2xl font-black text-slate-950">7 상승 · 4 하락</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {breadthLeaders.map((item) => (
            <span key={item} className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              {item}
            </span>
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Liquidity</p>
        <p className="mt-2 text-2xl font-black text-slate-950">+$27.6B</p>
        <div className="mt-3 flex h-12 items-end gap-1.5 rounded-2xl bg-slate-100 px-2 py-2">
          {liquidityBars.map((bar, index) => (
            <span
              key={`bento-liquidity-${index}`}
              className="flex-1 rounded-t-md bg-gradient-to-t from-brand-interactive to-sky-400"
              style={{ height: `${bar}%` }}
            />
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">VIX</p>
        <p className="mt-2 text-2xl font-black text-slate-950">14.2</p>
        <p className="mt-2 text-sm font-semibold text-slate-600">낮은 변동성</p>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Crypto</p>
        <p className="mt-2 text-2xl font-black text-slate-950">78</p>
        <p className="mt-2 text-sm font-semibold text-slate-600">탐욕 구간</p>
      </section>

      <section
        className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm"
        style={{ gridColumn: isPhone ? undefined : "span 2" }}
      >
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Banking + Stress</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">건전성</p>
            <p className="mt-2 text-lg font-black text-slate-950">안정</p>
            <p className="mt-1 text-sm text-slate-600">연체율 1.47% · 자본비율 14.17%</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">스트레스</p>
            <p className="mt-2 text-lg font-black text-slate-950">0.16 · 낮음</p>
            <p className="mt-1 text-sm text-slate-600">HY 2.88% · 10Y 4.08%</p>
          </div>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Fear & Greed</p>
        <div className="mt-3 flex items-center justify-center">
          <div className="flex h-28 w-28 items-center justify-center rounded-full border-[12px] border-amber-300 bg-amber-50 text-center">
            <div>
              <p className="text-3xl font-black text-amber-700">72</p>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">탐욕</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function SignalCommandPreview({ isPhone }: PreviewContext) {
  return (
    <div className="space-y-3">
      <section className="rounded-[1.8rem] bg-[linear-gradient(160deg,#020617_0%,#051830_46%,#102a67_100%)] p-5 text-white shadow-[0_28px_54px_-36px_rgba(2,6,23,0.92)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/80">
                Regime Command
              </p>
              <h3 className="mt-3 text-4xl font-black tracking-tight">위험 선호 72%</h3>
              <p className="mt-2 max-w-lg text-sm text-white/70">상단 Hero가 결론을 먼저 말하고, 아래 패널이 심리·확산·유동성·건전성을 진단합니다.</p>
            </div>
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-200">Today</p>
              <p className="mt-1 text-2xl font-black text-emerald-300">판정 유지</p>
            </div>
          </div>
          <div className="grid gap-3">
            {heroAxes.map((axis) => (
              <AxisRow key={axis.label} {...axis} light />
            ))}
          </div>
          <div className={`grid gap-2 ${isPhone ? "grid-cols-2" : "grid-cols-4"}`}>
            {quickStrip.map((item) => (
              <div key={item} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-black text-white/90">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className={`grid gap-3 ${isPhone ? "grid-cols-1" : "grid-cols-3"}`}>
        <details open className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer list-none text-sm font-black text-slate-950">투자심리</summary>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"><span>F&G</span><strong>72 탐욕</strong></div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"><span>VIX</span><strong>14.2 낮음</strong></div>
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"><span>Put/Call</span><strong>0.78 중립</strong></div>
          </div>
        </details>

        <details open className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer list-none text-sm font-black text-slate-950">섹터 확산</summary>
          <div className="mt-3 space-y-2 text-sm">
            <div className="rounded-2xl bg-emerald-50 px-3 py-2 font-bold text-emerald-700">상승 7 · 하락 4</div>
            {breadthLeaders.slice(0, 2).map((item) => (
              <div key={item} className="rounded-2xl bg-slate-50 px-3 py-2 font-semibold text-slate-700">{item}</div>
            ))}
            {breadthLaggards.slice(0, 2).map((item) => (
              <div key={item} className="rounded-2xl bg-slate-50 px-3 py-2 font-semibold text-slate-700">{item}</div>
            ))}
          </div>
        </details>

        <details open className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer list-none text-sm font-black text-slate-950">유동성</summary>
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">+$27.6B · 예대율 71.5%</div>
            <div className="flex h-16 items-end gap-1.5 rounded-2xl bg-slate-100 px-2 py-2">
              {liquidityBars.map((bar, index) => (
                <span
                  key={`command-liquidity-${index}`}
                  className="flex-1 rounded-t-md bg-gradient-to-t from-emerald-600 to-sky-400"
                  style={{ height: `${bar}%` }}
                />
              ))}
            </div>
          </div>
        </details>
      </div>

      <div className={`grid gap-3 ${isPhone ? "grid-cols-1" : "grid-cols-[1.2fr_0.8fr]"}`}>
        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">금융건전성 + 스트레스</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Banking</p>
              <p className="mt-2 text-xl font-black text-slate-950">안정</p>
              <p className="mt-1 text-sm text-slate-600">연체율 1.47% · 자본비율 14.17%</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Stress</p>
              <p className="mt-2 text-xl font-black text-slate-950">0.16 · 낮음</p>
              <p className="mt-1 text-sm text-slate-600">HY 2.88% · 10Y 4.08%</p>
            </div>
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Macro Notes</p>
          <div className="mt-3 space-y-2">
            {["일간 · 2026-03-15", "주간 · 2026-03-14", "분기 · 2025-Q4"].map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function BriefDiagnosticsPreview({ isPhone }: PreviewContext) {
  return (
    <div className="space-y-3">
      <section className="rounded-[1.7rem] border border-amber-200 bg-[linear-gradient(180deg,#fff8ed_0%,#ffffff_100%)] p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-amber-700">Headline Brief</p>
        <div className={`mt-3 flex gap-3 ${isPhone ? "flex-col" : "items-end justify-between"}`}>
          <div>
            <h3 className="text-3xl font-black tracking-tight text-slate-950">위험 선호 72% · 심리 주도, 스트레스 낮음</h3>
            <p className="mt-2 text-sm text-slate-600">지수와 금리를 한 줄에 묶고, 아래 카드에서 증거를 차례대로 읽게 하는 구조입니다.</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-700">
            SPY +1.2% · QQQ +0.8% · 10Y 4.08%
          </div>
        </div>
      </section>

      {[
        {
          title: "투자심리",
          headline: "탐욕 구간 — F&G 72, Crypto 78",
          body: (
            <div className="grid gap-3 sm:grid-cols-[0.7fr_1.3fr]">
              <div className="flex items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex h-24 w-24 items-center justify-center rounded-full border-[10px] border-amber-300 bg-white">
                  <div className="text-center">
                    <p className="text-3xl font-black text-amber-700">72</p>
                    <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-700">탐욕</p>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">VIX 14.2 · 변동성 낮음</div>
                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">Put/Call 0.78 · 중립</div>
                <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">일간 · 2026-03-15</div>
              </div>
            </div>
          ),
        },
        {
          title: "섹터 확산",
          headline: "11개 중 7개 상승 — XLK, XLF 선도",
          body: (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {breadthLeaders.map((item) => (
                  <span key={item} className="rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                    {item}
                  </span>
                ))}
                {breadthLaggards.slice(0, 2).map((item) => (
                  <span key={item} className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                    {item}
                  </span>
                ))}
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm text-slate-700">실시간 · sector ETF ticker</div>
            </div>
          ),
        },
        {
          title: "유동성",
          headline: "대출 +$27.6B 증가 — 예대율 71.5%",
          body: (
            <div className="space-y-3">
              <div className="flex h-16 items-end gap-1.5 rounded-2xl bg-slate-100 px-2 py-2">
                {liquidityBars.map((bar, index) => (
                  <span
                    key={`brief-liquidity-${index}`}
                    className="flex-1 rounded-t-md bg-gradient-to-t from-brand-interactive to-sky-400"
                    style={{ height: `${bar}%` }}
                  />
                ))}
              </div>
              <div className="rounded-2xl bg-slate-50 px-3 py-2 text-sm text-slate-700">주간 · 2026-03-14</div>
            </div>
          ),
        },
        {
          title: "금융안정",
          headline: "스트레스 낮음 — HY 2.88%, 은행 안정",
          body: (
            <div className={`grid gap-3 ${isPhone ? "grid-cols-1" : "grid-cols-2"}`}>
              <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">연체율 1.47% · 자본비율 14.17%</div>
              <div className="rounded-2xl bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700">분기 · 2025-Q4</div>
            </div>
          ),
        },
      ].map((card) => (
        <section key={card.title} className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-sm">
          <div className={`flex gap-3 ${isPhone ? "flex-col" : "items-start justify-between"}`}>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{card.title}</p>
              <h4 className="mt-2 text-xl font-black text-slate-950">{card.headline}</h4>
            </div>
            <button type="button" className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              Detail
            </button>
          </div>
          <div className="mt-4">{card.body}</div>
        </section>
      ))}
    </div>
  );
}

function ChangeFeedPreview({ isPhone }: PreviewContext) {
  return (
    <div className="space-y-3">
      <section className="sticky top-0 rounded-[1.5rem] bg-[linear-gradient(180deg,#09111f_0%,#131f35_100%)] px-4 py-3 text-white shadow-[0_24px_42px_-32px_rgba(2,6,23,0.9)]">
        <div className={`flex gap-3 ${isPhone ? "flex-col" : "items-center justify-between"}`}>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-white/65">Regime Status Bar</p>
            <h3 className="mt-1 text-2xl font-black">위험 선호 72% <span className="text-base text-emerald-300">▲2 vs 어제</span></h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold text-white/75">
            {quickStrip.map((item) => (
              <span key={item} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                {item}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className={`flex gap-3 ${isPhone ? "flex-col" : "items-end justify-between"}`}>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Today&apos;s Changes</p>
            <h4 className="mt-2 text-2xl font-black text-slate-950">어제 대비 가장 많이 움직인 신호 순서</h4>
          </div>
          <p className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
            Delta First
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {feedItems.map((item) => (
            <article key={item.title} className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        item.tone === "up" ? "bg-emerald-500" : item.tone === "down" ? "bg-rose-500" : "bg-slate-400"
                      }`}
                    />
                    <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">{item.impact}</span>
                  </div>
                  <h5 className="mt-2 text-lg font-black text-slate-950">{item.title}</h5>
                  <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">
                  change
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Weekly Context</p>
        <div className="mt-4 flex h-20 items-end gap-2 rounded-[1.25rem] bg-slate-100 px-3 py-3">
          {weeklyContextBars.map((bar, index) => (
            <span
              key={`weekly-context-${index}`}
              className="flex-1 rounded-t-xl bg-gradient-to-t from-fuchsia-600 to-sky-400"
              style={{ height: `${bar}%` }}
            />
          ))}
        </div>
        <div className={`mt-4 grid gap-3 ${isPhone ? "grid-cols-1" : "grid-cols-3"}`}>
          {["심리 약화", "섹터 확산 개선", "은행권 변화 없음"].map((item) => (
            <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CandidateOverviewCard({ candidate }: { candidate: CandidateSpec }) {
  const context: PreviewContext = {
    viewport: 390,
    isPhone: true,
    isTablet: false,
    isDesktop: false,
  };

  return (
    <article className="rounded-[1.7rem] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
              {candidate.code}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${candidate.accent.badge}`}>
              {candidate.concept}
            </span>
          </div>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{candidate.name}</h3>
          <p className="mt-2 text-sm text-slate-600">{candidate.difference}</p>
        </div>
        <Link
          href={candidate.href}
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
        >
          후보 보기
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "3초 가독성", value: candidate.scores.readability },
          { label: "30초 완성도", value: candidate.scores.completeness },
          { label: "모바일 적합", value: candidate.scores.mobile },
          { label: "구현 비용", value: candidate.scores.cost },
        ].map((score) => (
          <div key={score.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{score.label}</p>
            <div className="mt-3 flex items-center gap-1.5">{scoreDots(score.value)}</div>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <DeviceFrame viewport={390} title={candidate.name}>
          {candidate.id === "candidate-a" ? (
            <MacroBentoPreview {...context} />
          ) : candidate.id === "candidate-b" ? (
            <SignalCommandPreview {...context} />
          ) : candidate.id === "candidate-c" ? (
            <BriefDiagnosticsPreview {...context} />
          ) : (
            <ChangeFeedPreview {...context} />
          )}
        </DeviceFrame>
      </div>
    </article>
  );
}

function CandidateDetail({ candidate, context }: { candidate: CandidateSpec; context: PreviewContext }) {
  return (
    <section className="space-y-4">
      <div className="rounded-[1.7rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-600">
                Candidate {candidate.code}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${candidate.accent.badge}`}>
                {candidate.concept}
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-950">{candidate.name}</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">{candidate.philosophy}</p>
          </div>
          <Link
            href="/admin/design-lab?mode=home-preview"
            className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 transition hover:border-brand-interactive hover:text-brand-interactive"
          >
            전체 후보 보기
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "3초 가독성", value: candidate.scores.readability },
            { label: "30초 완성도", value: candidate.scores.completeness },
            { label: "모바일 적합", value: candidate.scores.mobile },
            { label: "구현 비용", value: candidate.scores.cost },
          ].map((score) => (
            <div key={score.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{score.label}</p>
              <div className="mt-3 flex items-center gap-1.5">{scoreDots(score.value)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">강점</p>
            <div className="mt-3 space-y-2">
              {candidate.strengths.map((item) => (
                <div key={item} className="rounded-2xl border border-emerald-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">주의점</p>
            <div className="mt-3 space-y-2">
              {candidate.risks.map((item) => (
                <div key={item} className="rounded-2xl border border-amber-100 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <DeviceFrame viewport={context.viewport} title={candidate.name}>
        {candidate.id === "candidate-a" ? (
          <MacroBentoPreview {...context} />
        ) : candidate.id === "candidate-b" ? (
          <SignalCommandPreview {...context} />
        ) : candidate.id === "candidate-c" ? (
          <BriefDiagnosticsPreview {...context} />
        ) : (
          <ChangeFeedPreview {...context} />
        )}
      </DeviceFrame>
    </section>
  );
}

export default function HomeCandidatePreview({
  initialMode = "overview",
}: HomeCandidatePreviewProps) {
  const [viewport, setViewport] = useState<number>(390);
  const activeCandidate = candidates.find((candidate) => candidate.id === initialMode);
  const context: PreviewContext = {
    viewport,
    isPhone: viewport < 768,
    isTablet: viewport >= 768 && viewport < 1024,
    isDesktop: viewport >= 1024,
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-slate-200 bg-gradient-to-r from-slate-950 via-brand-navy to-brand-interactive p-5 text-white shadow-[0_26px_55px_-38px_rgba(2,6,23,0.92)]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Admin Home Candidate Lab</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">
          {activeCandidate ? `${activeCandidate.code}. ${activeCandidate.name}` : "Home Layout Candidate Explorer"}
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-white/85">
          홈은 시장 방향과 핵심 매크로 흐름을 한눈에 파악하는 브리핑 보드이고, 상단 Hero는 3초 요약을 맡습니다. 여기서는 그 원칙을 서로 다른 정보구조로 비교합니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/admin/design-lab?mode=home-preview"
            className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-white transition hover:bg-white/20"
          >
            전체 후보 보기
          </Link>
          {candidates.map((candidate) => (
            <Link
              key={candidate.id}
              href={candidate.href}
              className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em] transition ${
                activeCandidate?.id === candidate.id
                  ? "border-white bg-white text-slate-950"
                  : "border-white/20 bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              {candidate.code}
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Selection Criteria</p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">3초 요약 + 30초 오버뷰 기준으로 비교</h2>
            <p className="mt-2 text-sm text-slate-600">같은 데이터라도 화면의 정보구조가 다르면 판단 속도와 체감이 크게 달라집니다.</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Viewport</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {viewportOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setViewport(option.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.12em] transition ${
                    viewport === option.value
                      ? "border-brand-interactive bg-brand-interactive text-white"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-brand-interactive hover:text-brand-interactive"
                  }`}
                >
                  {option.label}px
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "3초 가독성", value: "40%", description: "Hero에서 판정을 즉시 읽는가" },
            { label: "30초 완성도", value: "30%", description: "매크로 전반을 빠르게 훑는가" },
            { label: "모바일 우선", value: "20%", description: "가로 스크롤 없이 읽히는가" },
            { label: "구현 비용", value: "10%", description: "기존 카드 재사용이 가능한가" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{item.label}</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{item.value}</p>
              <p className="mt-2 text-sm text-slate-600">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {activeCandidate ? (
        <CandidateDetail candidate={activeCandidate} context={context} />
      ) : (
        <section className="space-y-4">
          {candidates.map((candidate) => (
            <CandidateOverviewCard key={candidate.id} candidate={candidate} />
          ))}
        </section>
      )}
    </div>
  );
}
