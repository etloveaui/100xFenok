import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { canonicalPath } from "@/lib/site-url";
import { ROUTES } from "@/lib/routes";
import EtfCompareClient from "./EtfCompareClient";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "ETF 겹침 비교 | 100xFenok",
  description: "ETF 상위 보유 항목 기준으로 구성 겹침과 핵심 지표를 비교합니다.",
  alternates: {
    canonical: canonicalPath(ROUTES.etfCompare),
  },
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EtfComparePage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};
  const initialTickers = firstParam(params.tickers) ?? firstParam(params.ticker) ?? "SPY,VOO";

  return (
    <div className="fnk-shell" data-etf-compare-surface="true" data-etf-compare-route-owner="holdings-overlap">
      <AppShell active="etfs" title="ETF 비교" backHref={ROUTES.etfs}>
        <section className="panel" data-etf-compare-header="true">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">ETF 비교</p>
              <h1 className="data-shell-title">ETF 겹침 비교</h1>
              <p className="data-shell-desc">
                ETF 상세에 연결된 상위 보유 항목을 기준으로 비용, 규모, 보유 구성 겹침을 확인합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <TransitionLink
                href={ROUTES.etfs}
                className="data-shell-link"
                data-etf-compare-owner-link="etf-center"
                style={{ minHeight: 44 }}
              >
                ETF 센터
              </TransitionLink>
            </div>
          </div>
        </section>

        <div className="mt-[var(--s4)]">
          <EtfCompareClient initialTickers={initialTickers} />
        </div>
      </AppShell>
    </div>
  );
}
