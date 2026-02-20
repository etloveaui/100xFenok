import Image from 'next/image';
import type { Metadata, Viewport } from 'next';

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

function sanitizePostsPath(rawPath?: string): string | null {
  if (!rawPath) return null;

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const normalized = decoded.replace(/^\/+/, '');
  if (!normalized.startsWith('posts/')) return null;
  if (!/^[A-Za-z0-9/_\-.?=&]+$/.test(normalized)) return null;
  if (!normalized.includes('.html')) return null;
  return normalized;
}

export default async function PostsPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const rawPath = Array.isArray(params.path) ? params.path[0] : params.path;
  const safePath = sanitizePostsPath(rawPath);

  if (safePath) {
    return (
      <div className="route-embed-shell">
        <iframe
          src={`/${safePath}`}
          title="Posts Detail"
          className="h-full w-full border-0"
        />
      </div>
    );
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
          <a
            href="/posts?path=posts/2025-06-30_Alpha_Pick_RMD/2025-06-30_Alpha_Pick_RMD-main.html"
            className="posts-card group block md:flex gap-6 md:gap-8 p-4 sm:p-6 md:p-8"
          >
            <div className="md:w-1/2 mb-6 md:mb-0">
              <Image
                src="https://placehold.co/600x400/ef4444/ffffff?text=Alpha+Pick"
                alt="Alpha Pick RMD"
                width={600}
                height={400}
                unoptimized
                className="rounded-lg w-full aspect-[16/10] md:aspect-auto h-full object-cover"
              />
            </div>
            <div className="md:w-1/2 flex flex-col">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="posts-badge posts-badge-new">LATEST</span>
                <span className="text-sm text-slate-500">2025-06-30</span>
              </div>
              <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 group-hover:text-red-600 transition-colors duration-300 mb-4 leading-tight">
                Alpha Pick: ResMed (RMD) 투자 분석
              </h3>
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6 flex-grow">
                경쟁사의 리콜 사태로 압도적인 시장 지위를 확보한 ResMed(RMD)에 대한 심층 분석. 독점적 해자, 재무 건전성, 그리고 GLP-1 약물 확산이 가져올 역설적 기회까지 종합적으로 평가하여 최우선 투자 대상으로 선정했습니다.
              </p>
              <div className="flex flex-wrap gap-2">
                <span className="posts-badge posts-badge-alphapick">Alpha Pick</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">리스크 분석</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">포트폴리오</span>
                <span className="inline-block bg-slate-100 rounded-full px-3 py-1 text-xs font-semibold text-slate-600">재무 분석</span>
              </div>
            </div>
          </a>
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-3">Archive</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <a
              href="/posts?path=posts/2025-06-23_stablecoin-revolution-complete-masterplan.html"
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
            </a>

            <a
              href="/posts?path=posts/2025-06-22_playbook.html"
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
            </a>
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
