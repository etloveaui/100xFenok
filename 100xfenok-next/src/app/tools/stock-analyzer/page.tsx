import type { Metadata } from "next";
import { cookies } from "next/headers";
import AppShell from "@/components/shell/AppShell";
import RouteEmbedFrame from "@/components/RouteEmbedFrame";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import { getDesignVersionFromSearchParams } from "@/lib/design/version";

export const metadata: Metadata = {
  title: "종목분석 (레거시) | 100xFenok",
  description: "레거시 Stock Analyzer와 네이티브 미리보기 경계를 분리한 종목 분석 도구",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StockAnalyzerPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const version = getDesignVersionFromSearchParams(
    params,
    cookieStore.get("fenok_design_version")?.value,
  );
  const frame = (
    <RouteEmbedFrame
      src="/tools/stock_analyzer/stock_analyzer.html"
      title="Stock Analyzer"
      loading="eager"
      shellClassName="route-embed-shell-fill-parent"
    />
  );

  // v1 backdoor: bare legacy embed, no v5 shell (HARD: V1 reachable byte-intact).
  if (version === "v1") return frame;

  return (
    <div className="fnk-shell" data-stock-analyzer-surface="true">
      <AppShell active="stockAnalyzer" title="종목분석" backHref={ROUTES.home}>
        <div className="space-y-[var(--s4)]" data-stock-analyzer-route-owner="legacy-iframe">
          <section className="panel" data-stock-analyzer-boundary="true">
            <div className="data-shell-header">
              <div className="data-shell-head-main">
                <p className="data-shell-kicker">Stock Analyzer</p>
                <h1 className="data-shell-title">종목분석 (레거시)</h1>
                <p className="data-shell-desc">
                  현재 기본 경로는 레거시 HTML iframe입니다. 네이티브 대시보드는 별도 미리보기 경로로 유지해 전환
                  범위를 분리합니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.08em]">
                  <span
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600"
                    data-stock-analyzer-boundary-chip="legacy-iframe"
                  >
                    legacy iframe
                  </span>
                  <span
                    className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700"
                    data-stock-analyzer-boundary-chip="native-preview"
                  >
                    native preview
                  </span>
                  <span
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700"
                    data-stock-analyzer-boundary-chip="v1-backdoor"
                  >
                    v1 backdoor
                  </span>
                </div>
              </div>
              <nav className="data-shell-head-actions" aria-label="종목분석 경로">
                <TransitionLink
                  href={ROUTES.stockAnalyzerNative}
                  className="data-shell-link min-h-11"
                  style={{ minHeight: 44 }}
                  data-stock-analyzer-owner-link="native"
                >
                  네이티브 미리보기
                </TransitionLink>
                <TransitionLink
                  href={ROUTES.screener}
                  className="data-shell-link min-h-11"
                  style={{ minHeight: 44 }}
                  data-stock-analyzer-owner-link="screener"
                >
                  스크리너
                </TransitionLink>
                <TransitionLink
                  href={ROUTES.stock("NVDA")}
                  className="data-shell-link min-h-11"
                  style={{ minHeight: 44 }}
                  data-stock-analyzer-owner-link="stock"
                >
                  NVDA 상세
                </TransitionLink>
              </nav>
            </div>
          </section>

          <div data-stock-analyzer-legacy-frame="true">{frame}</div>
        </div>
      </AppShell>
    </div>
  );
}
