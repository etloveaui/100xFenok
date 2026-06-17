import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import EtfUniverseCard from "../explore/EtfUniverseCard";

export const metadata: Metadata = {
  title: "ETF 유니버스 | 100xFenok",
  description: "StockAnalysis 기반 ETF 유니버스와 보유 원장을 검색하고 상세 탭으로 이동합니다.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function EtfsPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="etfs" title="ETF">
        <section className="panel">
          <div className="data-shell-header">
            <div className="data-shell-head-main">
              <p className="data-shell-kicker">ETF Universe</p>
              <h1 className="data-shell-title">ETF 유니버스</h1>
              <p className="data-shell-desc">
                ETF 목록, AUM, 카테고리를 로컬 데이터팩에서 읽고 각 행을 ETF 상세 원장으로 연결합니다.
              </p>
            </div>
            <div className="data-shell-head-actions">
              <span className="data-shell-pill ok"><span />DataPack</span>
            </div>
          </div>
        </section>

        <div style={{ marginTop: "var(--s4)" }}>
          <EtfUniverseCard limit={80} showOpenLink={false} />
        </div>
      </AppShell>
    </div>
  );
}
