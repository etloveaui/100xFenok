import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import MarketEventsClient from "./MarketEventsClient";

export const metadata: Metadata = {
  title: "시장 이벤트 | 100xFenok",
  description: "어닝, 기업 이벤트, IPO, 산업 흐름, 급등락 데이터를 한곳에서 확인합니다.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function MarketEventsPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="market" title="시장 이벤트" backHref="/market-valuation">
        <MarketEventsClient />
      </AppShell>
    </div>
  );
}
