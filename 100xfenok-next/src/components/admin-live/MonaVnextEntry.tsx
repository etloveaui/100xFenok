import Link from "next/link";

export default function MonaVnextEntry({ locked }: { locked: boolean }) {
  if (locked) {
    return (
      <div className="mt-4 rounded-2xl border border-[var(--wd-line)] px-4 py-3 opacity-50">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[var(--wd-muted)]">Mona vNext</p>
        <p className="mt-1 text-[13px] font-semibold text-[var(--wd-ink)]">대화 종료 후 진입 가능</p>
      </div>
    );
  }

  return (
    <Link
      href="/winddown-vnext"
      aria-label="Mona vNext 새 코치 격리 테스트 열기"
      className="mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-[var(--wd-accent)] bg-[var(--wd-accent-soft)] px-4 text-left text-[var(--wd-accent)] transition active:scale-[0.98]"
    >
      <span>
        <span className="block text-[12px] font-semibold tracking-[0.14em]">Mona vNext</span>
        <span className="mt-1 block text-[13px] font-semibold">새 코치 격리 테스트 열기</span>
      </span>
      <span aria-hidden className="text-xl">›</span>
    </Link>
  );
}
