import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "서비스 이용약관 | 100xFenok",
  description: "100xFenok 서비스의 이용약관입니다.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <AppShell title="서비스 이용약관" backHref={ROUTES.home}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <header className="mb-8">
          <div className="mb-2 text-[13px] font-medium text-[var(--c-ink-3)]">안내 · 법적 고지</div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--c-ink)] sm:text-3xl">
            서비스 이용약관
          </h1>
          <p className="mt-2 text-[13px] text-[var(--c-ink-3)]">시행일자: 2026-09-17</p>
        </header>

        <div className="mb-8 border-b border-[var(--c-line)]" />

        <ol className="space-y-6 text-[15px] leading-relaxed text-[var(--c-ink-2)]">
          <li>
            <span className="font-semibold text-[var(--c-ink)]">1. 서비스:</span> 100x Market Radar는 공개된 시장 데이터를 모아 매일 갱신해 보여주는 개인 운영 사이트입니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">2. 투자 판단:</span> 이 사이트의 모든 화면과 수치는 정보 제공을 위한 것이며 투자 권유가 아닙니다. 투자 결정과 그 결과는 이용자 본인의 책임입니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">3. 데이터:</span> 데이터 출처의 지연·오류·누락이 있을 수 있으며, 정확성이나 완전성을 보증하지 않습니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">4. 계정:</span> Google 계정으로 로그인해 이용합니다. 운영자는 서비스 안정을 해치는 이용을 제한할 수 있습니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">5. 서비스 변경:</span> 화면과 기능은 예고 없이 바뀌거나 중단될 수 있습니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">6. 연락처:</span>{" "}
            <a href="mailto:etloveaui@gmail.com" className="text-[var(--c-brand)] hover:underline">
              etloveaui@gmail.com
            </a>
          </li>
        </ol>

        <div className="my-10 border-b border-[var(--c-line)]" />

        <nav className="flex items-center justify-between text-[13px] text-[var(--c-ink-3)]" aria-label="관련 문서">
          <TransitionLink
            href={ROUTES.privacy}
            className="text-[var(--c-brand)] hover:underline"
          >
            개인정보처리방침 보기 →
          </TransitionLink>
          <TransitionLink
            href={ROUTES.home}
            className="text-[var(--c-ink-3)] hover:text-[var(--c-ink)]"
          >
            홈으로 이동
          </TransitionLink>
        </nav>
      </div>
    </AppShell>
  );
}
