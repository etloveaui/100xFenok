import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";

import AppShell from "@/components/shell/AppShell";
import { MarketStructureDetailWired } from "@/lib/market-valuation/charts/marketStructurePanelComponents";

export const metadata: Metadata = {
  title: "시장 구조 상세 | 100xFenok",
  description: "시장 구조 인덱스의 유동성, 집중도, 심리 시계열을 원천 깊이까지 확인합니다.",
};

const plexKr = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export default function MarketStructureDetailPage() {
  return (
    <div className={`fnk-shell ${plexKr.className}`}>
      <AppShell active="market" title="시장 구조" backHref="/market-valuation">
        <MarketStructureDetailWired />
      </AppShell>
    </div>
  );
}
