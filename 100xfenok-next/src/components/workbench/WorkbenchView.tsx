import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import ExploreHotTopics from "@/app/explore/ExploreHotTopics";
import ExploreDashboard from "@/app/explore/ExploreDashboard";
import MarketThermometer from "@/app/explore/MarketThermometer";
import SignalStrip from "@/app/explore/SignalStrip";
import MyWatchlistStrip from "@/app/explore/MyWatchlistStrip";
import StockWorkbenchCard from "@/app/explore/StockWorkbenchCard";
import MacroPlaybookCard from "@/app/explore/MacroPlaybookCard";
import EtfUniverseCard from "@/app/explore/EtfUniverseCard";
import { WORKBENCH_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";

const WORKBENCH_GATEWAY_LINKS = [
  { label: "시장", meta: "밸류·구조", href: ROUTES.market },
  { label: "섹터", meta: "흐름·ETF", href: ROUTES.sectors },
  { label: "ETF", meta: "유니버스", href: ROUTES.etfs },
  { label: "스크리너", meta: "조건 검색", href: ROUTES.screener },
  { label: "13F", meta: "수급 변화", href: ROUTES.superinvestors },
  { label: "포트폴리오", meta: "보유·현금", href: ROUTES.portfolio },
  { label: "차트", meta: "매크로", href: ROUTES.macroChart },
] as const;

const WORKBENCH_FLOW_STEPS = [
  {
    index: "01",
    label: "시장 체온",
    summary: "밸류·구조·섹터",
    href: ROUTES.market,
  },
  {
    index: "02",
    label: "후보 압축",
    summary: "스크리너·13F·ETF",
    href: ROUTES.screener,
  },
  {
    index: "03",
    label: "보유 점검",
    summary: "포트폴리오·차트",
    href: ROUTES.portfolio,
  },
] as const;

export default function WorkbenchView() {
  return (
    <div className="fnk-shell">
      <AppShell active="workbench" title={WORKBENCH_PRODUCT_TITLE}>
        <SignalStrip />

        <section
          aria-label="워크벤치 작업 순서"
          data-workbench-route-rail
          data-workbench-owner-route-count={WORKBENCH_GATEWAY_LINKS.length}
          className="rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] p-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--c-line-2)] pb-2">
            <h2 className="text-sm font-black text-[var(--c-ink)]">오늘 순서</h2>
            <span
              data-workbench-route-count
              className="rounded-md bg-[var(--c-surface-2)] px-2 py-1 text-[11px] font-bold text-[var(--c-ink-2)]"
            >
              {WORKBENCH_GATEWAY_LINKS.length}개 주요 화면
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {WORKBENCH_FLOW_STEPS.map((step) => (
              <TransitionLink
                key={step.index}
                href={step.href}
                data-workbench-route-step
                data-workbench-route-step-index={step.index}
                className="min-h-16 rounded-lg border border-[var(--c-line-2)] bg-[var(--c-surface)] px-3 py-2 transition hover:border-brand-interactive hover:bg-[var(--c-surface-2)]"
              >
                <span className="flex items-center gap-2 text-xs font-black text-[var(--c-ink)]">
                  <span className="font-mono text-[11px] text-brand-primary">{step.index}</span>
                  {step.label}
                </span>
                <span className="mt-1 block text-[11px] font-semibold text-[var(--c-ink-3)]">{step.summary}</span>
              </TransitionLink>
            ))}
          </div>
        </section>

        <nav
          aria-label="워크벤치 전용 화면"
          data-workbench-gateway
          className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7"
        >
          {WORKBENCH_GATEWAY_LINKS.map((link) => (
            <TransitionLink
              key={link.href}
              href={link.href}
              data-workbench-owner-link
              className="min-h-14 rounded-lg border border-[var(--c-line)] bg-[var(--c-panel)] px-3 py-2 transition hover:border-brand-interactive hover:bg-[var(--c-surface-2)]"
            >
              <span className="block text-sm font-black text-[var(--c-ink)]">{link.label}</span>
              <span className="mt-0.5 block text-[10px] font-semibold text-[var(--c-ink-3)]">{link.meta}</span>
            </TransitionLink>
          ))}
        </nav>

        <div className="cols" style={{ marginTop: "var(--s4)" }}>
          <div className="col-a">
            <MarketThermometer />
            <MacroPlaybookCard />
            <ExploreDashboard />
          </div>
          <div className="col-b">
            <MyWatchlistStrip />
            <StockWorkbenchCard />
            <EtfUniverseCard limit={8} />
          </div>
        </div>

        <div className="f13-wrap-outer" style={{ marginTop: "var(--s4)" }}>
          <ExploreHotTopics />
        </div>

        <p className="data-cap">데이터: 시장 신호 · 밸류에이션 · 일정 · 기관 동향 · 종목 리더보드 · 계산 지표</p>
      </AppShell>
    </div>
  );
}
