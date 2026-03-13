import Link from 'next/link';

export default function TariffBanner() {
  return (
    <Link
      href="/posts/2026-02-21_tariff-ruling-comprehensive.html"
      className="group block w-full rounded-2xl overflow-hidden mb-4 bg-gradient-to-r from-red-50 via-amber-50/80 to-slate-50 border border-red-200/50 hover:border-amber-300/70 shadow-sm hover:shadow-lg transition-all duration-300"
    >
      <div className="flex items-start gap-3 px-3 py-3 sm:items-center sm:gap-4 sm:px-5 sm:py-4">
        <span className="text-2xl flex-shrink-0">&#9878;</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 px-2 py-0.5 rounded-full animate-pulse">
              주요 분석
            </span>
            <span className="text-[10px] text-slate-600 font-mono">2026.02.21</span>
          </div>
          <p className="text-sm font-bold text-slate-800 line-clamp-2">
            IEEPA 관세 위헌 판결 — 종합 분석
          </p>
          <p className="text-xs text-slate-600 line-clamp-2">
            대법원 6-3 위헌 · 트럼프 122조 10% 즉시 서명 · 국가별 관세 영향 · 포트폴리오 함의
          </p>
        </div>
        <div className="hidden min-[420px]:block flex-shrink-0 text-slate-300 group-hover:text-amber-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
