import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "개인정보처리방침 | 100xFenok",
  description: "100xFenok 서비스의 개인정보처리방침입니다.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <AppShell title="개인정보처리방침" backHref={ROUTES.home}>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <header className="mb-8">
          <div className="mb-2 text-[13px] font-medium text-[var(--c-ink-3)]">안내 · 법적 고지</div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--c-ink)] sm:text-3xl">
            개인정보처리방침
          </h1>
          <p className="mt-2 text-[13px] text-[var(--c-ink-3)]">시행일자: 2026-09-17</p>
        </header>

        <div className="mb-8 border-b border-[var(--c-line)]" />

        <ol className="space-y-6 text-[15px] leading-relaxed text-[var(--c-ink-2)]">
          <li>
            <span className="font-semibold text-[var(--c-ink)]">1. 수집하는 정보:</span> Google 계정으로 로그인하면 Google이 제공하는 이름, 이메일 주소, 프로필 사진과 계정 식별자를 저장합니다. 로그인 세션 토큰은 해시로만 저장합니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">2. 이용 목적:</span> 로그인 유지, 계정별 저장(포트폴리오·관심종목·무한매수 기록·매크로 차트 프리셋), 운영자의 이용 현황 확인(최근 접속 시각, 접속 기기 수, 이용 화면).
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">3. 보관과 삭제:</span> 정보는 Cloudflare에 저장됩니다. 로그아웃하면 해당 기기의 세션이 폐기되고, 계정 삭제를 요청하면 저장된 정보를 모두 삭제합니다. 요청은 아래 연락처로 보냅니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">4. 제3자 제공:</span> 정보를 판매하거나 광고 목적으로 제공하지 않습니다. 인증은 Google 로그인을 사용하며, Google의 처리 방식은 Google의 개인정보처리방침을 따릅니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">5. 쿠키:</span> 로그인 상태 유지를 위한 세션 쿠키만 사용합니다. 광고·추적 쿠키는 없습니다.
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">6. 연락처:</span>{" "}
            <a href="mailto:etloveaui@gmail.com" className="text-[var(--c-brand)] hover:underline">
              etloveaui@gmail.com
            </a>
          </li>
          <li>
            <span className="font-semibold text-[var(--c-ink)]">7. 변경:</span> 방침이 바뀌면 이 페이지의 날짜를 갱신합니다.
          </li>
        </ol>

        <div className="my-10 border-b border-[var(--c-line)]" />

        <nav className="flex items-center justify-between text-[13px] text-[var(--c-ink-3)]" aria-label="관련 문서">
          <TransitionLink
            href={ROUTES.terms}
            className="text-[var(--c-brand)] hover:underline"
          >
            서비스 이용약관 보기 →
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
