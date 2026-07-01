import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import { ROUTES } from "@/lib/routes";
import NewEtfsList from "./NewEtfsList";

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "신규 상장 ETF | 100xFenok",
  description: "최근 상장된 ETF 목록을 확인하고 상세 페이지로 이동합니다.",
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewEtfsPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {};

  return (
    <div className="fnk-shell" data-etf-new-surface="true" data-etf-new-route-owner="new-etf-radar">
      <AppShell active="etfs" title="신규 상장 ETF">
        <section className="panel" data-etf-new-header="true">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">신규 ETF</p>
              <h1 className="data-shell-title">신규 상장 ETF</h1>
              <p className="data-shell-desc">
                최근 상장된 ETF를 한곳에서 보고 각 항목에서 상세 페이지로 이동합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <TransitionLink
                href={ROUTES.etfs}
                className="data-shell-link"
                data-etf-new-owner-link="etf-center"
                style={{ minHeight: 44 }}
              >
                ETF 센터
              </TransitionLink>
            </div>
          </div>
        </section>

        <div className="mt-[var(--s4)]">
          <NewEtfsList
            initialQuery={firstParam(params.q)}
            initialType={firstParam(params.type)}
            initialDays={firstParam(params.days)}
            initialIssuer={firstParam(params.issuer)}
            initialSort={firstParam(params.sort)}
          />
        </div>
      </AppShell>
    </div>
  );
}
