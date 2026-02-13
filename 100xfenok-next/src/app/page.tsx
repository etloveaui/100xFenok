import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-sky-700">
        Day 1 Baseline
      </p>
      <h1 className="mt-3 text-4xl font-bold tracking-tight">Hello 100xFenok</h1>
      <p className="mt-4 max-w-2xl text-zinc-700">
        Next.js 마이그레이션을 위한 초기 스켈레톤입니다. Day 1 완료 기준에 맞춰
        홈(/)과 IB(/ib) 라우트를 우선 제공합니다.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/ib"
          className="rounded-md bg-sky-600 px-4 py-2 text-white hover:bg-sky-700"
        >
          /ib 이동
        </Link>
      </div>
    </main>
  );
}
