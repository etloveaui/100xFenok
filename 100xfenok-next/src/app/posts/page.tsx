import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';

export const metadata: Metadata = {
  title: '분석 아카이브',
  description: '시장 분석 자료를 모아 둔 아카이브 페이지입니다.',
  alternates: {
    canonical: '/posts',
  },
  openGraph: {
    title: '분석 아카이브 - El Fenomeno',
    description: '시장 분석 자료를 모아 둔 아카이브 페이지입니다.',
    type: 'website',
    images: ['/favicon-96x96.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#3b82f6',
};

type PageProps = {
  searchParams?: Promise<{ path?: string | string[] }>;
};

export default async function PostsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = getSingleSearchParam(params.path);
  const safePath = sanitizeLegacyPath(rawPath, { prefixes: ['posts/'] });

  if (safePath && legacyPublicFileExists(safePath)) {
    return <RouteEmbedFrame src={`/${safePath}`} title="Posts Detail" loading="eager" />;
  }

  return (
    <div 
      className="text-slate-800 min-h-screen"
      style={{
        backgroundColor: '#f8fafc'
      }}
    >
      <div className="container mx-auto p-3 sm:p-4 md:p-8">
        <header className="text-center my-8 sm:my-10 md:my-16">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 orbitron mb-3 leading-tight">Quantum Analysis</h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            시장의 거시적 흐름과 복잡한 현상의 본질을 파헤치는 심층 분석 콘텐츠.
          </p>
        </header>

        <section className="mb-12 md:mb-16">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-3">Featured Post</h2>
          <Link
            href="/posts/2026-02-21_tariff-ruling-comprehensive.html"
            className="posts-card group block md:flex gap-6 md:gap-8 p-4 sm:p-6 md:p-8"
          >
            <div className="md:w-1/2 mb-6 md:mb-0 flex items-center justify-center rounded-lg min-h-[200px]"
              style={{ background: 'linear-gradient(135deg, #fef2f2, #fffbeb, #f1f5f9)' }}>
              <div className="text-center p-6">
                <div className="text-6xl mb-3">&#9878;</div>
                <div className="text-xs font-bold uppercase tracking-wider text-red-800 bg-red-100 px-3 py-1 rounded-full inline-block">Breaking Analysis</div>
              </div>
            </div>
            <div className="md:w-1/2 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="posts-badge posts-badge-alphapick">BREAKING</span>
                <span className="text-sm text-slate-500">2026-02-21</span>
              </div>
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 group-hover:text-red-600 transition-colors duration-300 mb-4 leading-tight">
                IEEPA 관세 위헌 판결 — 종합 분석
              </h3>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6 flex-grow">
                대법원 6-3 위헌 판결, 트럼프 122조 즉시 서명(10% + 150일), 국가별 관세율 영향 분석. 외신 반응부터 포트폴리오 함의까지 완전 정리.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="posts-badge posts-badge-alphapick">SCOTUS 6-3</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">관세 분석</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">포트폴리오</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">국가별 영향</span>
              </div>
            </div>
          </Link>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-3">Archive</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Link
              href="/posts/2025-06-30_Alpha_Pick_RMD/2025-06-30_Alpha_Pick_RMD-main.html"
              className="posts-card group block p-5 sm:p-8"
            >
              <div className="flex justify-between items-start mb-4">
                <span className="posts-badge posts-badge-alphapick">Alpha Pick</span>
                <span className="text-sm text-slate-500">2025-06-30</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 group-hover:text-red-600 transition-colors duration-300 mb-3">
                Alpha Pick: ResMed (RMD) 투자 분석
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                경쟁사 리콜 사태로 압도적 시장 지위를 확보한 ResMed에 대한 심층 분석. 독점적 해자와 GLP-1 역설적 기회까지 종합 평가.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">리스크 분석</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">재무 분석</span>
              </div>
            </Link>
            <Link
              href="/posts/2025-06-23_stablecoin-revolution-complete-masterplan.html"
              className="posts-card group block p-5 sm:p-8"
            >
              <div className="flex justify-between items-start mb-4">
                <span className="posts-badge posts-badge-masterplan">마스터플랜</span>
                <span className="text-sm text-slate-500">2025-06-23</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 group-hover:text-amber-600 transition-colors duration-300 mb-3">
                스테이블코인 마스터플랜: 디지털 시대 달러 패권 설계도
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                40년 패권 사이클부터 2028년 로드맵까지, 미국의 디지털 달러 패권 전략을 완전 해부합니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">40년 사이클</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">RRP</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">시뮬레이터</span>
              </div>
            </Link>

            <Link
              href="/posts/2025-06-22_playbook.html"
              className="posts-card group block p-5 sm:p-8"
            >
              <div className="flex justify-between items-start mb-4">
                <span className="posts-badge posts-badge-playbook">플레이북</span>
                <span className="text-sm text-slate-500">2025-06-22</span>
              </div>
              <h3 className="text-xl font-bold text-slate-800 group-hover:text-green-600 transition-colors duration-300 mb-3">
                미국 경제 플레이북
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                패권 유지를 위한 미국의 경제 전략 분석. 정부 주도 성장과 AI 혁명을 통한 구조적 전환의 핵심을 다룹니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">패권전략</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">AI혁명</span>
              </div>
            </Link>
          </div>
        </section>

        <section className="mt-12 md:mt-16 text-center">
          <div className="bg-slate-100 p-8 rounded-lg max-w-2xl mx-auto border-2 border-dashed border-slate-300">
            <div className="text-4xl mb-4">🚀</div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">더 많은 분석이 준비 중입니다</h3>
            <p className="text-slate-600">새로운 시장 분석과 경제 전략 콘텐츠가 곧 추가될 예정입니다.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
