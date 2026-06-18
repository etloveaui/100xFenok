import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import TransitionLink from "@/components/TransitionLink";
import NewEtfsList from "./NewEtfsList";

export const metadata: Metadata = {
  title: "신규 상장 ETF | 100xFenok",
  description: "최근 상장된 ETF 목록을 확인하고 상세 페이지로 이동합니다.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function NewEtfsPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="etfs" title="ETF">
        <section className="panel">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">New ETFs</p>
              <h1 className="data-shell-title">신규 상장 ETF</h1>
              <p className="data-shell-desc">
                최근 상장된 ETF를 한곳에서 보고 각 항목에서 상세 페이지로 이동합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <TransitionLink href="/etfs" className="data-shell-link">
                ETF 검색
              </TransitionLink>
            </div>
          </div>
        </section>

        <div style={{ marginTop: "var(--s4)" }}>
          <NewEtfsList />
        </div>
      </AppShell>
    </div>
  );
}
