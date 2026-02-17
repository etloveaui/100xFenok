'use client';

const posts = [
  {
    id: 1,
    title: '2026년 시장 전망: 변동성 속 기회',
    date: '2026-02-15',
    category: 'Market Wrap',
    excerpt: '금리 인하 기대감과 지정학적 리스크가 공존하는 시장. 투자자들이 주목해야 할 핵심 포인트를 분석합니다.',
  },
  {
    id: 2,
    title: '무한매수 전략의 실전 적용',
    date: '2026-02-10',
    category: 'Strategy',
    excerpt: 'DCA 전략을 활용한 리스크 관리 방법과 실제 포트폴리오 적용 사례를 소개합니다.',
  },
  {
    id: 3,
    title: '섹터 로테이션: 기술주에서 가치주로',
    date: '2026-02-05',
    category: 'Alpha Scout',
    excerpt: '시장 상황 변화에 따른 섹터 전환 전략과 수혜 업종 분석.',
  },
  {
    id: 4,
    title: 'VIX와 시장 심리: 공포 지수 해석하기',
    date: '2026-01-28',
    category: 'Analytics',
    excerpt: 'VIX 지수를 활용한 시장 심리 분석과 실제 트레이딩 적용법.',
  },
  {
    id: 5,
    title: 'ETF 리밸런싱 전략 가이드',
    date: '2026-01-20',
    category: 'Guide',
    excerpt: '정기적인 리밸런싱의 중요성과 효과적인 실행 방법을 상세히 설명합니다.',
  },
  {
    id: 6,
    title: '2025년 4분기 회고: 교훈과 인사이트',
    date: '2026-01-15',
    category: 'Review',
    excerpt: '지난 분기의 시장 움직임을 되돌아볼며 얻을 수 있는 투자 교훈을 정리합니다.',
  },
];

const categoryColors: Record<string, string> = {
  'Market Wrap': 'bg-blue-100 text-blue-700',
  'Strategy': 'bg-green-100 text-green-700',
  'Alpha Scout': 'bg-purple-100 text-purple-700',
  'Analytics': 'bg-orange-100 text-orange-700',
  'Guide': 'bg-slate-100 text-slate-700',
  'Review': 'bg-brand-gold/20 text-brand-gold',
};

export default function PostsPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black orbitron text-slate-800 mb-2">
          Insights <span className="text-brand-gold">투자 인사이트</span>
        </h1>
        <p className="text-slate-600">시장 분석과 투자 전략을 공유합니다</p>
      </div>

      {/* Posts Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {posts.map((post) => (
          <article
            key={post.id}
            className="bento-card hover:shadow-lg transition-shadow cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2 py-1 rounded text-xs font-bold ${categoryColors[post.category] || 'bg-slate-100 text-slate-700'}`}>
                {post.category}
              </span>
              <span className="text-xs text-slate-400">{post.date}</span>
            </div>
            
            <h2 className="font-bold text-slate-800 mb-2 line-clamp-2">
              {post.title}
            </h2>
            
            <p className="text-sm text-slate-600 line-clamp-3">
              {post.excerpt}
            </p>
            
            <div className="mt-4 flex items-center text-brand-interactive text-sm font-bold">
              <span>자세히 보기</span>
              <i className="fas fa-arrow-right ml-2 text-xs"></i>
            </div>
          </article>
        ))}
      </div>

      {/* Load More */}
      <div className="mt-8 text-center">
        <button className="px-6 py-3 border-2 border-slate-200 rounded-lg font-bold text-slate-600 hover:border-brand-navy hover:text-brand-navy transition-colors">
          더 보기
        </button>
      </div>
    </div>
  );
}
