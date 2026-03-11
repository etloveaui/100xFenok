import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sector Heatmap',
  description: '섹터 맵과 섹터 흐름을 위한 준비 페이지',
};

export default function SectorsPage() {
  return (
    <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sector Map</p>
        <h1 className="mt-2 text-3xl font-black text-slate-900">섹터 맵 준비 페이지</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          섹터 흐름을 독립 화면으로 빼는 방향을 먼저 잡아 둔 mock 페이지입니다.
          현재는 홈에서 보던 요약을 별도 화면으로 옮길 준비 단계이며, 다음 배치에서 실제 섹터 맵과
          비교 보드를 채울 예정입니다.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-bold text-slate-800">핵심 목표</h2>
            <p className="mt-2 text-sm text-slate-600">홈에서 섹터 관련 공간을 줄이고, 별도 화면에서 집중해서 보게 합니다.</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-bold text-slate-800">예정 구성</h2>
            <p className="mt-2 text-sm text-slate-600">섹터 히트맵, 강한 섹터/약한 섹터, ETF 비교, 최근 순환 변화 요약.</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-bold text-slate-800">현재 이동</h2>
            <p className="mt-2 text-sm text-slate-600">지금은 시장 전체 화면에서 먼저 확인할 수 있도록 Market Wrap으로 연결합니다.</p>
          </article>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/market"
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-navy px-4 text-sm font-bold text-white transition hover:bg-brand-interactive"
          >
            Market Wrap 열기
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            홈으로 돌아가기
          </Link>
        </div>
      </section>
    </main>
  );
}
