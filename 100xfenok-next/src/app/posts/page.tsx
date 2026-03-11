import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import RouteEmbedFrame from '@/components/RouteEmbedFrame';
import {
  getSingleSearchParam,
  legacyPublicFileExists,
  sanitizeLegacyPath,
} from '@/lib/server/legacy-bridge';
import { readPostCatalog } from '@/lib/server/posts';

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
  const posts = readPostCatalog();
  const [featuredPost, ...archivePosts] = posts;

  const filePath = safePath ? safePath.replace(/^posts\//, 'posts-raw/') : null;
  if (filePath && legacyPublicFileExists(filePath)) {
    const rawSrc = `/${filePath}`;
    return <RouteEmbedFrame src={rawSrc} title="Posts Detail" loading="eager" />;
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
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 orbitron mb-3 leading-tight">분석 아카이브</h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            시장의 거시적 흐름과 복잡한 현상의 본질을 파헤치는 심층 분석 콘텐츠.
          </p>
        </header>

        <section className="mb-12 md:mb-16">
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-3">주요 리포트</h2>
          {featuredPost ? (
            <Link
              href={featuredPost.href}
              className="posts-card group block md:flex gap-6 md:gap-8 p-4 sm:p-6 md:p-8"
            >
              <div
                className="md:w-1/2 mb-6 md:mb-0 flex items-center justify-center rounded-lg min-h-[200px]"
                style={{ background: 'linear-gradient(135deg, #fef2f2, #fffbeb, #f1f5f9)' }}
              >
                <div className="text-center p-6">
                  <div className="text-6xl mb-3">&#9878;</div>
                  <div className="text-xs font-bold uppercase tracking-wider text-red-800 bg-red-100 px-3 py-1 rounded-full inline-block">
                    {featuredPost.badgeLabel}
                  </div>
                </div>
              </div>
              <div className="md:w-1/2 flex flex-col">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className={`posts-badge ${featuredPost.badgeClass}`}>{featuredPost.badgeLabel}</span>
                  <span className="text-sm text-slate-500">{featuredPost.displayDate}</span>
                </div>
                <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 group-hover:text-red-600 transition-colors duration-300 mb-4 leading-tight">
                  {featuredPost.title}
                </h3>
                <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6 flex-grow">
                  {featuredPost.description}
                </p>
              </div>
            </Link>
          ) : (
            <div className="posts-card p-6 text-center text-slate-500">표시할 리포트가 없습니다.</div>
          )}
        </section>

        <section>
          <h2 className="text-2xl font-bold text-slate-800 mb-6 border-b pb-3">아카이브</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {archivePosts.map((post) => (
              <Link
                key={post.href}
                href={post.href}
                className="posts-card group block p-5 sm:p-8"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className={`posts-badge ${post.badgeClass}`}>{post.badgeLabel}</span>
                  <span className="text-sm text-slate-500">{post.displayDate}</span>
                </div>
                <h3 className="text-xl font-bold text-slate-800 group-hover:text-red-600 transition-colors duration-300 mb-3">
                  {post.title}
                </h3>
                <p className="text-slate-600 text-sm leading-relaxed mb-4">
                  {post.description}
                </p>
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
