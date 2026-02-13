export default function IbPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
        Infinite Buy
      </p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">무한매수법 (IB)</h1>
      <p className="mt-4 max-w-2xl text-zinc-700">
        Day 1 최소 라우트입니다. 기존 IB 가이드의 핵심 내용을 단계적으로 Next.js
        컴포넌트로 이관할 예정입니다.
      </p>

      <section className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-5">
        <h2 className="text-lg font-semibold">초기 범위 (Day 1)</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-zinc-700">
          <li>핵심 철학: 규칙 기반 분할매수/분할매도</li>
          <li>TQQQ·SOXL 기준 전략 섹션 골격</li>
          <li>실시간 시세/주문 생성기는 Day 3+에서 순차 이관</li>
        </ul>
      </section>
    </main>
  );
}
