import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import AppShell from '@/components/shell/AppShell';
import ShellChromeOff from '@/components/shell/ShellChromeOff';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import { Stat, StatStrip } from '@/components/ui/Stat';
import { ROUTES } from '@/lib/routes';
import { getDesignVersionFromSearchParams } from '@/lib/design/version';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';

export const metadata: Metadata = {
  title: 'VR 전략 가이드',
  description: 'VR 전략 가이드와 계산기 모음입니다.',
  alternates: {
    canonical: '/vr/',
  },
  openGraph: {
    title: 'VR 전략 가이드 - El Fenomeno',
    description: 'VR 전략 가이드와 계산기 모음입니다.',
    type: 'website',
    images: ['/favicon-96x96.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0ea5e9',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

const VR_BOUNDARY_CHIPS = [
  { key: "legacy-guide", label: "레거시 가이드" },
  { key: "calculator", label: "계산기" },
  { key: "app-shell", label: "앱 셸" },
] as const;

const VR_OWNER_LINKS = [
  { key: "system", label: "완전 가이드", href: "/vr?path=vr/vr-complete-system.html" },
  { key: "calculator", label: "계산기", href: "/vr?path=vr/vr-total-guide-calculator.html" },
  { key: "ib", label: "IB Helper", href: ROUTES.ib },
] as const;

const VR_DOCUMENTS = {
  guide: "/vr?path=vr/vr-complete-system.html",
  calculator: "/vr?path=vr/vr-total-guide-calculator.html",
} as const;

export default async function VRPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  const rawPath = getSingleSearchParam(params.path);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['vr/'] });

  if (safePath && await legacyPublicFileExists(safePath)) {
    const frameTitle = safePath.endsWith('vr-complete-system.html')
      ? 'VR 완전 가이드'
      : safePath.endsWith('vr-total-guide-calculator.html')
        ? 'VR 계산기'
        : 'VR 전략 가이드';
    const frame = (
      <RouteEmbedFrame
        src={`/${safePath}`}
        title={frameTitle}
        loading="eager"
        shellClassName={version === "v1" ? undefined : "route-embed-shell-app"}
      />
    );
    if (version === "v1") return <ShellChromeOff>{frame}</ShellChromeOff>;
    return (
      <AppShell active="vr" title={frameTitle} backHref={ROUTES.home}>
        {frame}
      </AppShell>
    );
  }

  const landing = (
    <div className="vr-page-bg vr-mathematical-bg min-h-screen overflow-x-clip pb-2" data-vr-surface>
      <div className="container mx-auto p-3 sm:p-4 md:p-8">
        <header className="mx-auto mb-3 max-w-6xl md:mb-4">
          <h1 className="text-2xl font-black leading-tight text-[var(--c-ink)] sm:text-3xl md:text-4xl">VR 전략 가이드</h1>
        </header>

        <section className="mx-auto mb-6 max-w-6xl md:mb-8" aria-label="VR 전략 요약" data-vr-summary>
          <StatStrip className="flex-nowrap">
            <Stat className="flex-1" label="문서" value={Object.keys(VR_DOCUMENTS).length} />
            <Stat className="flex-1" label="연결 경로" value={VR_OWNER_LINKS.length} />
            <Stat className="flex-1" label="경계 기준" value={VR_BOUNDARY_CHIPS.length} />
            <Stat className="flex-1" label="리밸런싱 주기" value="2주" />
          </StatStrip>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--c-ink-3)] sm:text-sm">
            밸류 리밸런싱(Value Rebalancing) 관련 문서와 계산기 모음 — 원칙이 정해진 규칙형 투자 시스템
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-8 max-w-6xl mx-auto mb-12 md:mb-16">
          <Link href={VR_DOCUMENTS.guide} className="vr-card p-5 sm:p-8 block" data-vr-card="system">
            <div className="flex justify-between items-start mb-6">
              <span className="vr-system-badge text-white text-sm font-bold px-4 py-2 rounded-full">
                🔬 시스템 가이드
              </span>
              <span className="text-sm text-slate-500">완전판</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 group-hover:text-indigo-600 transition-colors duration-300 mb-4">
              VR 5.0 완전 시스템 가이드
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              밸류 리밸런싱 5.0의 전체 철학과 공식을 다룹니다. 시뮬레이터, 백테스트, 실전 Q&A까지 포함된 완전한 가이드입니다.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>공식별 성과 비교 차트</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>실시간 공식 시뮬레이터</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>실전 투자 Q&A</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">VR 5.0</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">시뮬레이터</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">백테스트</span>
            </div>
          </Link>

          <Link href={VR_DOCUMENTS.calculator} className="vr-card p-5 sm:p-8 block" data-vr-card="calculator">
            <div className="flex justify-between items-start mb-6">
              <span className="vr-calculator-badge text-white text-sm font-bold px-4 py-2 rounded-full">
                🧮 계산기
              </span>
              <span className="text-sm text-slate-500">실용도구</span>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 group-hover:text-green-600 transition-colors duration-300 mb-4">
              밸류 리밸런싱 계산기
            </h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-6">
              TQQQ와 현금 비율을 조절하는 장기 투자 전략 계산기입니다. 실시간 가격 연동과 주문표 자동 생성 기능을 제공합니다.
            </p>
            <div className="space-y-3 mb-6">
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>실시간 TQQQ 가격 연동</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>매수/매도 주문표 자동 생성</span>
              </div>
              <div className="flex items-center text-sm text-slate-600">
                <span aria-hidden="true" className="mr-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--c-brand)]" />
                <span>3단계 라이프사이클 지원</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">TQQQ</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">실시간</span>
              <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-[12px] font-semibold text-slate-700">주문표</span>
            </div>
          </Link>
        </div>

        <section className="vr-card mb-10 max-w-4xl mx-auto border-2 border-indigo-200 p-4 sm:p-6" data-vr-boundary>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[12px] font-black uppercase tracking-[0.14em] text-indigo-600" data-vr-route-owner="legacy-guides">
                VR 전략 가이드
              </p>
              <h2 className="mt-2 text-xl font-black text-slate-800 sm:text-2xl">가이드와 계산기 경계</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {VR_BOUNDARY_CHIPS.map((chip) => (
                <span
                  key={chip.key}
                  data-vr-boundary-chip={chip.key}
                  className="inline-flex min-h-11 items-center rounded-full border border-indigo-100 bg-white/75 px-3 text-[12px] font-black text-slate-700"
                >
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3" data-vr-action-rail>
            {VR_OWNER_LINKS.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                data-vr-owner-link={link.key}
                className="inline-flex min-h-11 items-center justify-center rounded-full border border-indigo-200 bg-white/90 px-4 text-sm font-black text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-50"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </section>

        <div className="vr-card p-4 sm:p-6 mb-10 md:mb-12 text-center max-w-4xl mx-auto border-2 border-indigo-200" data-vr-formula>
          <p className="mb-4 font-semibold text-slate-800">Core Formula</p>
          <div className="max-w-full overflow-x-auto rounded-lg bg-indigo-50 p-3 font-mono text-[12px] text-indigo-700 sm:p-4 sm:text-base md:text-lg">
            V₂ = V₁ + (Pool ÷ G) + (E - V₁) ÷ (2√G)
          </div>
          <p className="text-slate-600 text-sm mt-2">
            V₁: 이전 목표값 | Pool: 현금풀 | G: G-Value | E: 평가금
          </p>
        </div>

        <div className="vr-card p-6 sm:p-8 max-w-4xl mx-auto mb-12 md:mb-16">
          <h3 className="text-2xl font-bold text-slate-800 text-center mb-6">⚖️ VR 전략의 핵심 특징</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-4xl mb-3">🎯</div>
              <h4 className="font-bold text-slate-800 mb-2">수학적 정확성</h4>
              <p className="text-slate-600 text-sm">감정을 배제한 완전 자동화된 매매 시스템</p>
            </div>
            <div>
              <div className="text-4xl mb-3">📊</div>
              <h4 className="font-bold text-slate-800 mb-2">유연한 설정</h4>
              <p className="text-slate-600 text-sm">G-Value로 리스크와 수익률을 자유롭게 조절</p>
            </div>
            <div>
              <div className="text-4xl mb-3">🔄</div>
              <h4 className="font-bold text-slate-800 mb-2">라이프사이클</h4>
              <p className="text-slate-600 text-sm">자산 형성-유지-활용의 3단계 자동 전환</p>
            </div>
          </div>
        </div>

        <div className="vr-card p-6 sm:p-8 text-center max-w-2xl mx-auto border-2 border-green-200">
          <div className="text-5xl mb-4">📈</div>
          <h3 className="text-2xl font-bold text-slate-800 mb-4">VR 전략 운용 기준</h3>
          <div className="grid grid-cols-1 gap-4 text-center">
            <div>
              <div className="text-3xl font-black text-blue-600">2주</div>
              <div className="text-sm text-slate-600">리밸런싱 주기</div>
            </div>
          </div>
          <p className="text-slate-500 text-[12px] mt-4">
            * 수익률·하락폭 수치는 시장 상황에 따라 달라지므로 확정 지표를 표기하지 않습니다.
          </p>
        </div>
      </div>
    </div>
  );

  if (version === "v1") return <ShellChromeOff>{landing}</ShellChromeOff>;

  return (
    <AppShell active="vr" title="VR 전략 가이드" backHref={ROUTES.home}>
      {landing}
    </AppShell>
  );
}
